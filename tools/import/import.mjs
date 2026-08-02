#!/usr/bin/env node
// Fathom P4 导入器 —— 库/*.md → 校验 → 幂等 → 无标签入库。
//
// 零依赖，node >= 18（要 fetch）。两个子命令，对应管线的两端：
//
//   check  <库文件>   Mac 侧全量校验。需要湖里的 原始/ 做逐字重合与方括号比对，
//                     所以只能在数据湖所在的机器上跑。不碰网络。
//   ingest <库文件>   服务器侧入库。结构校验 + state 判重 + POST localhost。
//                     不需要 原始/，单文件 scp 过去就能跑（parse.mjs 只有 check 用，
//                     且是惰性 import——ingest 路径缺它也不崩）。
//
// 为什么校验不能省：提炼不由代码调模型，是用户把 PROMPT.md 交给自己的 agentic AI。
// 契约是文件格式而不是某家 API，所以产物必须当外部输入对待——方括号残留（转写不
// 确定段混进来了）、与原文逐字重合（没提炼、是复制粘贴）、字段残缺，全都要拦。
//
// 幂等语义（决定了为什么用 state 文件而不是查服务器）：state 记「这条导过」。
// 用户在控制台删掉一条导入的笔记 = 审校决定，重跑导入**不能**把它复活——
// 只有 state 文件记得住这件事，查服务器记不住。服务器比对只作为 state 丢失时
// 的兜底（防重复，不防复活）。

import { readFile, writeFile, rename, stat, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, join, basename } from 'node:path';

// ---------- 契约常量 ----------

const KINDS = new Set(['voice', 'chat']);
const KIND_LABEL = { voice: '录音', chat: '对话' };
// suggest 词表 = 用户已有标签（2026-08 快照，与 PROMPT.md 保持一致）。
// 只校验 suggest（本轮不上传），所以词表外只警告不报错。
const SUGGEST_VOCAB = new Set(['日常', '想法', '私密', '价值观', '童年', '可分享']);
const MAX_SUGGEST = 2;
// 逐字重合阈值（对 2026-W29-试跑 的 54 条实测校准）。语义想清楚了：原话本身已经
// 凝练时，提炼如实保留一句原句是忠实而不是偷懒（54 条里有 3 条正是这种，比例 100%
// 但只有一两句）；要拦的是**成段照抄**——没提炼的转写倾倒。所以看绝对长度为主：
const OVERLAP_DUMP_CHARS = 120; // 连续照抄超过这个字数 = 倾倒，错误
const OVERLAP_WARN_CHARS = 60; // 连续照抄超过这个字数、且占正文八成以上 = 人眼看一下
const OVERLAP_WARN_RATIO = 0.8;
const DEFAULT_LAKE = join(process.env.HOME ?? '', '通用空间/潜心');
const DEFAULT_BASE = 'http://localhost:3000'; // app 容器内视角；宿主上是 :80，用 --base 覆盖

// ---------- 库文件解析 ----------

/** 归一化：比对与指纹都用它，避免空白差异造成假阴/假阳。 */
const norm = (s) => s.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').trim();
/** 逐字重合的比对底料：只留内容字符，标点/空白全剥掉（换标点不算改写）。 */
const contentChars = (s) => s.replace(/[\s\p{P}\p{S}]/gu, '');

const fingerprint = (r) =>
  createHash('sha256').update(`${r.source}\n${norm(r.title)}\n${norm(r.body)}`).digest('hex');

/**
 * 解析 库/*.md：连续的「--- frontmatter --- 正文」记录流。
 * `---` 行按奇偶配对切分——奇数段是 frontmatter、偶数段是正文，
 * 所以正文里不能出现独占一行的 `---`（水平线），解析时当结构错误报出来。
 */
export function parseLibraryFile(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const segments = [{ start: 1, lines: [] }];
  for (let i = 0; i < lines.length; i++) {
    if (/^---\s*$/.test(lines[i])) segments.push({ start: i + 2, lines: [] });
    else segments[segments.length - 1].lines.push(lines[i]);
  }

  const records = [];
  const errors = [];
  if (segments[0].lines.some((l) => l.trim())) {
    errors.push(`第 1 行起：首个 --- 之前有内容，不符合记录流格式`);
  }
  // segments: [前导空段, fm1, body1, fm2, body2, ...]
  for (let i = 1; i + 1 < segments.length || i < segments.length; i += 2) {
    const fmSeg = segments[i];
    const bodySeg = segments[i + 1];
    const fmText = fmSeg.lines.join('\n');
    if (!/^\s*source\s*[:：]/m.test(fmText)) {
      errors.push(`第 ${fmSeg.start} 行：应为 frontmatter（含 source:）的段落不含 source —— ` +
        `多半是正文里出现了独占一行的 ---`);
      continue;
    }
    const meta = {};
    for (const line of fmSeg.lines) {
      const m = line.match(/^\s*([A-Za-z_]+)\s*[:：]\s*(.*)$/);
      if (m) meta[m[1]] = m[2].trim();
    }
    let suggest = [];
    if (meta.suggest !== undefined && meta.suggest !== '') {
      const inner = meta.suggest.replace(/^\[/, '').replace(/\]$/, '').trim();
      suggest = inner ? inner.split(/[,，、]/).map((s) => s.trim()).filter(Boolean) : [];
    }

    let title = '';
    const bodyLines = [];
    for (const line of bodySeg?.lines ?? []) {
      const h = line.match(/^##\s+(.*)$/);
      if (h && !title) title = h[1].trim();
      else bodyLines.push(line);
    }
    records.push({
      line: fmSeg.start,
      source: meta.source ?? '',
      kind: meta.kind ?? '',
      dated: meta.dated ?? '',
      suggest,
      title,
      body: bodyLines.join('\n').trim(),
    });
  }
  return { records, errors };
}

// ---------- 校验 ----------

const isIsoDate = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
};

/** 结构校验：check 和 ingest 都跑。返回该记录的错误列表（空 = 干净）。 */
export function validateStructural(r) {
  const errs = [];
  const warns = [];
  if (!r.source) errs.push('缺 source');
  if (!KINDS.has(r.kind)) errs.push(`kind 应为 voice|chat，实为「${r.kind}」`);
  if (!isIsoDate(r.dated)) errs.push(`dated 应为 YYYY-MM-DD，实为「${r.dated}」`);
  if (!r.title) errs.push('缺 ## 一句话标题');
  if (!r.body) errs.push('缺正文');
  if (r.source.startsWith('语音备忘录/') && r.kind !== 'voice') errs.push('source 是语音备忘录但 kind 不是 voice');
  if (r.source.startsWith('chatgpt/') && r.kind !== 'chat') errs.push('source 是 chatgpt 但 kind 不是 chat');

  const text = `${r.title}\n${r.body}`;
  if (/[\[\]【】]/.test(text)) errs.push('标题/正文有方括号残留（不确定段不得进入产物）');
  if (/https?:\/\//.test(text) || /!\[/.test(text) || /\]\(/.test(text)) {
    errs.push('标题/正文含链接或图片语法（红线：所有渲染端禁 image，正文不该有外链）');
  }

  if (r.suggest.length > MAX_SUGGEST) warns.push(`suggest 超过 ${MAX_SUGGEST} 个：[${r.suggest.join(', ')}]`);
  for (const s of r.suggest) {
    if (!SUGGEST_VOCAB.has(s)) warns.push(`suggest「${s}」不在词表（词表见 PROMPT.md；本轮不上传，仅提醒）`);
  }
  return { errs, warns };
}

/** 最长公共子串（字符级，滚动数组）。逐字重合度 = lcs / 笔记内容字符数。 */
function longestCommonSubstring(a, b) {
  if (!a.length || !b.length) return 0;
  let prev = new Int32Array(b.length + 1);
  let cur = new Int32Array(b.length + 1);
  let best = 0;
  for (let i = 1; i <= a.length; i++) {
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      cur[j] = ca === b.charCodeAt(j - 1) ? prev[j - 1] + 1 : 0;
      if (cur[j] > best) best = cur[j];
    }
    [prev, cur] = [cur, prev];
  }
  return best;
}

// ---------- 入库正文（契约：溯源写进笔记首行，不打标签） ----------

/**
 * 首行 = 溯源（决策 8：原始日期进首行；§2.3 决议：来源走首行不走标签），
 * 用 blockquote 让它在流里读起来是元信息不是正文。标题用加粗不用 ##——
 * 流式阅读里 h2 太重。改这里 = 改所有后续导入的笔记形态，改前想清楚。
 */
export const renderNoteBody = (r) =>
  `> ${KIND_LABEL[r.kind]} ${r.dated} · ${r.source}\n\n**${r.title}**\n\n${r.body}`;

// ---------- check：Mac 侧全量校验 ----------

async function loadRawText(lake, source, cache) {
  if (cache.has(source)) return cache.get(source);
  const path = join(lake, '原始', source);
  let entry;
  try {
    const text = await readFile(path, 'utf8');
    const { parseVoice, parseChat } = await import('./parse.mjs');
    const parsed = source.startsWith('语音备忘录/')
      ? parseVoice(text, path, null)
      : parseChat(text, path, null);
    const overlapBase =
      parsed.kind === 'voice' ? parsed.body : parsed.turns.map((t) => t.text).join('\n');
    entry = {
      exists: true,
      overlap: contentChars(overlapBase),
      // 方括号段的内容一个字都不许进产物；两个字符以下的段（如单字语气词）
      // 撞车概率太高，只比对长度 >= 3 的。
      uncertainSpans: (parsed.uncertainSpans ?? []).filter((s) => contentChars(s).length >= 3),
    };
  } catch {
    entry = { exists: false, overlap: '', uncertainSpans: [] };
  }
  cache.set(source, entry);
  return entry;
}

async function cmdCheck(file, opts) {
  const lake = resolve(opts.lake ?? DEFAULT_LAKE);
  const text = await readFile(file, 'utf8');
  const { records, errors: parseErrors } = parseLibraryFile(text);

  const problems = [...parseErrors.map((e) => ({ level: '错误', msg: e }))];
  const rawCache = new Map();
  const seenFp = new Map();
  const overlapStats = [];

  for (const [i, r] of records.entries()) {
    const tag = `#${i + 1}（第 ${r.line} 行「${r.title || r.source || '?'}」）`;
    const { errs, warns } = validateStructural(r);
    for (const e of errs) problems.push({ level: '错误', msg: `${tag}：${e}` });
    for (const w of warns) problems.push({ level: '警告', msg: `${tag}：${w}` });
    if (errs.length) continue;

    const fp = fingerprint(r);
    if (seenFp.has(fp)) problems.push({ level: '错误', msg: `${tag}：与 #${seenFp.get(fp)} 完全重复` });
    seenFp.set(fp, i + 1);

    const raw = await loadRawText(lake, r.source, rawCache);
    if (!raw.exists) {
      problems.push({ level: '错误', msg: `${tag}：原始素材不存在：原始/${r.source}` });
      continue;
    }
    const noteChars = contentChars(`${r.title}${r.body}`);
    for (const span of raw.uncertainSpans) {
      if (noteChars.includes(contentChars(span))) {
        problems.push({ level: '错误', msg: `${tag}：方括号不确定段「${span}」出现在笔记里` });
      }
    }
    const bodyChars = contentChars(r.body);
    const lcs = longestCommonSubstring(bodyChars, raw.overlap);
    const ratio = bodyChars.length ? lcs / bodyChars.length : 0;
    overlapStats.push({ i: i + 1, title: r.title, lcs, ratio });
    if (lcs >= OVERLAP_DUMP_CHARS) {
      problems.push({ level: '错误', msg: `${tag}：连续照抄原文 ${lcs} 字——这是倾倒不是提炼` });
    } else if (lcs >= OVERLAP_WARN_CHARS && ratio >= OVERLAP_WARN_RATIO) {
      problems.push({ level: '警告', msg: `${tag}：整条基本是原句（连续 ${lcs} 字，占正文 ${(ratio * 100).toFixed(0)}%）。原话足够凝练时这没问题，人眼确认一下` });
    }
  }

  // 覆盖情况（只提示不报错）：被引用的周目录里还有哪些 raw 素材没出笔记
  const weeks = [...new Set(records.map((r) => r.source.split('/').slice(0, 2).join('/')))].filter(Boolean);
  const referenced = new Set(records.map((r) => r.source));
  const uncovered = [];
  for (const week of weeks) {
    const rawDir = join(lake, '原始', week, 'raw');
    let entries = [];
    try {
      entries = (await readdir(rawDir, { recursive: true })).filter((f) => f.endsWith('.md'));
    } catch { continue; }
    for (const f of entries) {
      const rel = `${week}/raw/${f}`;
      if (!referenced.has(rel)) uncovered.push(rel);
    }
  }

  // ---- 汇报 ----
  const lens = records.map((r) => contentChars(r.body).length).sort((a, b) => a - b);
  const median = lens.length ? lens[Math.floor(lens.length / 2)] : 0;
  const ratios = overlapStats.map((s) => s.ratio).sort((a, b) => a - b);
  const maxOverlap = overlapStats.reduce((m, s) => (s.ratio > m.ratio ? s : m), { ratio: 0, lcs: 0, i: 0 });

  console.log(`库文件：${file}`);
  console.log(`记录：${records.length} 条，来自 ${new Set(records.map((r) => r.source)).size} 份素材`);
  if (lens.length) console.log(`正文（内容字符）：中位 ${median} / 最长 ${lens[lens.length - 1]}`);
  if (ratios.length) {
    console.log(`逐字重合：比例中位 ${(ratios[Math.floor(ratios.length / 2)] * 100).toFixed(0)}% / ` +
      `最长连抄 ${Math.max(...overlapStats.map((s) => s.lcs))} 字` +
      `（警告线：连抄 ${OVERLAP_WARN_CHARS} 字且占八成；错误线：连抄 ${OVERLAP_DUMP_CHARS} 字）`);
  }
  if (uncovered.length) {
    console.log(`\n[信息] 被引用周目录里未出笔记的素材（可能没内容，也可能漏了）：`);
    for (const f of uncovered) console.log(`  - ${f}`);
  }
  const errs = problems.filter((p) => p.level === '错误');
  const warns = problems.filter((p) => p.level === '警告');
  for (const p of problems) console.log(`[${p.level}] ${p.msg}`);
  console.log(`\n结论：${errs.length} 错误 / ${warns.length} 警告${errs.length ? '' : ' —— 可入库'}`);
  process.exitCode = errs.length ? 1 : 0;
}

// ---------- ingest：服务器侧幂等入库 ----------

async function loadState(path) {
  try {
    const s = JSON.parse(await readFile(path, 'utf8'));
    if (s.version !== 1 || typeof s.imported !== 'object') throw new Error('bad state');
    return s;
  } catch (e) {
    if (e.code === 'ENOENT') return { version: 1, imported: {} };
    throw new Error(`state 文件损坏（${path}）：${e.message}——不敢在坏 state 上继续，请人工确认`);
  }
}

async function saveState(path, state) {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2) + '\n');
  await rename(tmp, path); // 原子替换：写一半断电也不会留下半个 state
}

async function api(base, path, { token, method = 'GET', body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}

async function cmdIngest(file, opts) {
  const base = opts.base ?? process.env.FATHOM_BASE ?? DEFAULT_BASE;
  const token = opts.token ?? process.env.FATHOM_TOKEN;
  const statePath = resolve(opts.state ?? join(dirname(resolve(file)), '.import-state.json'));
  if (!token && !opts.dryRun) {
    console.error('缺 token：--token 或环境变量 FATHOM_TOKEN（server-ingest.sh 会自动搞定这步）');
    process.exit(1);
  }

  const text = await readFile(file, 'utf8');
  const { records, errors: parseErrors } = parseLibraryFile(text);
  if (parseErrors.length) {
    for (const e of parseErrors) console.error(`[错误] ${e}`);
    console.error('文件结构有错，先修再导。');
    process.exit(1);
  }

  const state = await loadState(statePath);
  // (source + title) 索引：内容改过的记录会撞上它——旧版已导过，不能悄悄再导一条
  const byKey = new Map(Object.entries(state.imported).map(([fp, v]) => [`${v.source}\n${v.title}`, fp]));

  // 服务器现存笔记的归一化正文集合：state 丢失/不同步时的防重兜底
  let remoteBodies = new Set();
  if (!opts.dryRun) {
    const health = await api(base, '/health').catch(() => null);
    if (!health?.ok) {
      console.error(`服务器不可达或不健康：${base}/health`);
      process.exit(1);
    }
    const res = await api(base, '/api/notes', { token });
    if (res.status === 401) {
      console.error('token 无效或过期，重新登录再来');
      process.exit(1);
    }
    if (!res.ok) {
      console.error(`拉取现存笔记失败：HTTP ${res.status}`);
      process.exit(1);
    }
    const { notes } = await res.json();
    remoteBodies = new Set(notes.map((n) => norm(n.body)));
  }

  let imported = 0, dup = 0, reconciled = 0, changed = 0, failed = 0, invalid = 0;
  for (const [i, r] of records.entries()) {
    const tag = `#${i + 1}「${r.title || r.source}」`;
    const { errs } = validateStructural(r);
    if (errs.length) {
      // 单条跳过并汇报（spec P4）：curated 文件理应先过 check，这里兜底
      console.log(`[跳过·校验] ${tag}：${errs.join('；')}`);
      invalid++;
      continue;
    }
    const fp = fingerprint(r);
    if (state.imported[fp]) { dup++; continue; }

    const key = `${r.source}\n${norm(r.title)}`;
    if (byKey.has(key)) {
      console.log(`[跳过·有改动] ${tag}：同源同标题的旧版已导过（${byKey.get(key).slice(0, 8)}）。` +
        `内容更新请去控制台改那条笔记，导入器不覆盖。`);
      changed++;
      continue;
    }

    const body = renderNoteBody(r);
    if (remoteBodies.has(norm(body))) {
      // 服务器上已有一模一样的（state 丢过？）——补记 state，不重复入库
      state.imported[fp] = { source: r.source, title: norm(r.title), noteId: null, at: new Date().toISOString(), reconciled: true };
      await saveState(statePath, state);
      byKey.set(key, fp);
      reconciled++;
      continue;
    }

    if (opts.dryRun) {
      console.log(`[dry-run] 将入库 ${tag}`);
      imported++;
      continue;
    }
    const res = await api(base, '/api/notes', { token, method: 'POST', body: { body } });
    if (res.status === 401) {
      console.error('token 中途失效，中止。已导入的都记在 state 里，重跑会接着来。');
      process.exit(1);
    }
    if (res.status !== 201) {
      console.log(`[失败] ${tag}：HTTP ${res.status} ${await res.text().catch(() => '')}`);
      failed++;
      continue;
    }
    const { note } = await res.json();
    state.imported[fp] = { source: r.source, title: norm(r.title), noteId: note.id, at: new Date().toISOString() };
    await saveState(statePath, state); // 每成功一条就落盘：中途挂了不重复
    byKey.set(key, fp);
    imported++;
  }

  console.log(`\n共 ${records.length} 条：入库 ${imported}${opts.dryRun ? '（dry-run，实际没动）' : ''}` +
    ` / 已导过 ${dup} / 补记 ${reconciled} / 有改动跳过 ${changed} / 校验跳过 ${invalid} / 失败 ${failed}`);
  console.log(`state：${statePath}`);
  process.exitCode = failed || invalid ? 1 : 0;
}

// ---------- CLI ----------

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--lake') opts.lake = argv[++i];
    else if (a === '--state') opts.state = argv[++i];
    else if (a === '--base') opts.base = argv[++i];
    else if (a === '--token') opts.token = argv[++i];
    else if (a === '--dry-run') opts.dryRun = true;
    else opts._.push(a);
  }
  return opts;
}

const USAGE = `Fathom 导入器
用法：
  node import.mjs check  <库文件.md> [--lake ~/通用空间/潜心]
  node import.mjs ingest <库文件.md> [--state <state.json>] [--base ${DEFAULT_BASE}]
                         [--token <会话token> | FATHOM_TOKEN=...] [--dry-run]
整套流程（Mac 一键）：tools/import/upload.sh，见 tools/import/README.md`;

const isMain = process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]));
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  const opts = parseArgs(rest);
  const file = opts._[0];
  if (cmd === 'check' && file) await cmdCheck(file, opts);
  else if (cmd === 'ingest' && file) await cmdIngest(file, opts);
  else { console.log(USAGE); process.exit(cmd ? 1 : 0); }
}
