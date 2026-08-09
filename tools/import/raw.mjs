#!/usr/bin/env node
// Fathom 原始材料层导入器 —— 周报/<week>/<week>-标签.json → 校验+取正文 → /api/raw/import。
//
// 零依赖，node >= 18（要 fetch）。两个子命令，对应管线两端：
//
//   check  <标签.json>       Mac 侧。逐单元回溯 原始/ 里的正文（flomo 条号、codex 轮次、
//                            chatgpt/语音整文件），校验来源可回溯、标签红线、枚举合法，
//                            产出自足的 raw-upload.json（含正文，之后不再需要湖）。
//   ingest <raw-upload.json> 服务器侧。分批 POST /api/raw/import（token 走 FATHOM_TOKEN）。
//
// 为什么校验不能省：贴标签不由代码调模型，是用户把提示词交给任意 agentic AI
//（Claude/Codex/Trae/Kimi…），产物必须当外部输入对待——id 回溯不到原文、
// 发布-* 混进来、枚举写错，全都要在上传前拦住。
//
// 与展示层导入器（import.mjs）刻意不同的一点：这里没有 state 文件。原始材料层是
// 备份镜像，服务端按 (user, source) 幂等 upsert，重传=刷新正是想要的语义；
// 控制台也没有删除原始单元的入口，不存在「删过的不复活」问题。

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';

const KIND_BY_PREFIX = [
  ['flomo/', 'memo'],
  ['chatgpt/', 'chat'],
  ['codex/', 'task'],
  ['语音备忘录/', 'voice'],
];
const ATTRIBUTIONS = new Set(['用户观点', '用户随记', 'AI整理', '课程转录', '外部摘录', '系统内容', '混合', '不确定']);
const CONFIDENCES = new Set(['高', '中', '低']);
const WEEK_RE = /^\d{4}-W\d{2}$/;
const DEFAULT_LAKE = join(process.env.HOME ?? '', '通用空间/潜心');
const DEFAULT_BASE = 'http://localhost:3000';
const INGEST_BATCH = 200;

const die = (msg) => {
  console.error(`错误：${msg}`);
  process.exit(1);
};

// ---------- 正文回溯 ----------

const fileCache = new Map();
async function readRaw(lake, rel) {
  if (!fileCache.has(rel)) fileCache.set(rel, readFile(join(lake, '原始', rel), 'utf8'));
  return fileCache.get(rel);
}

/** source → { rel, discriminator }。判别符：#第N条（flomo）/ #任务轮次N（codex）。 */
function splitSource(source) {
  const i = source.indexOf('#');
  return i === -1 ? { rel: source, disc: null } : { rel: source.slice(0, i), disc: source.slice(i + 1) };
}

async function resolveBody(lake, source) {
  const { rel, disc } = splitSource(source);
  const text = await readRaw(lake, rel);
  if (!disc) return text.trim();

  let m = disc.match(/^第\s*(\d+)\s*条$/);
  if (m) {
    const parts = text.split(/\n## 第 (\d+) 条\n/);
    for (let i = 1; i < parts.length; i += 2) {
      if (parts[i] === m[1]) {
        const seg = parts[i + 1].split(/### 正文\n+/);
        // flomo 存在只有标签没有正文的空条目，如实回空串
        return seg.length > 1 ? seg[1].trim() : '';
      }
    }
    throw new Error(`在 ${rel} 里找不到 第 ${m[1]} 条`);
  }

  m = disc.match(/^任务轮次\s*(\d+)$/);
  if (m) {
    const parts = text.split(/\n## 任务轮次 (\d+)\n/);
    for (let i = 1; i < parts.length; i += 2) {
      if (parts[i] === m[1]) return parts[i + 1].trim();
    }
    throw new Error(`在 ${rel} 里找不到 任务轮次 ${m[1]}`);
  }

  throw new Error(`看不懂的来源判别符：${source}`);
}

// ---------- check ----------

/** 已知词表：湖配置的 tags ∪ 历周已落地 标签.json 的全部标签。生词只警告不拦——
 *  新标签是否成立是口径问题（docs/标签口径.md），不是完整性问题。 */
async function knownVocab(lake) {
  const vocab = new Set();
  try {
    const conf = JSON.parse(await readFile(join(lake, '.import-config.json'), 'utf8'));
    for (const t of conf.tags ?? []) vocab.add(t);
  } catch {
    /* 没配置就只用历周词表 */
  }
  try {
    const weeks = await readdir(join(lake, '周报'));
    for (const w of weeks) {
      const p = join(lake, '周报', w, `${w}-标签.json`);
      try {
        const data = JSON.parse(await readFile(p, 'utf8'));
        for (const t of Object.keys(data.tag_counts ?? {})) vocab.add(t);
      } catch {
        /* 该周没有标签文件 */
      }
    }
  } catch {
    /* 湖里还没有周报目录 */
  }
  return vocab;
}

async function check(file, opts) {
  const lake = resolve(opts.lake ?? DEFAULT_LAKE);
  const data = JSON.parse(await readFile(file, 'utf8'));
  const week = data.week;
  if (typeof week !== 'string' || !WEEK_RE.test(week)) die(`标签文件缺少合法的 week 字段（现值：${week}）`);
  const units = data.units;
  if (!Array.isArray(units) || units.length === 0) die('标签文件里没有 units');

  const vocab = await knownVocab(lake);
  const errors = [];
  const warnings = [];
  const seen = new Set();
  const out = [];

  for (const u of units) {
    const label = u.id ?? u.source ?? '?';
    const err = (msg) => errors.push(`${label}: ${msg}`);

    const source = typeof u.source === 'string' ? u.source.trim() : '';
    if (!source) {
      err('缺 source');
      continue;
    }
    if (seen.has(source)) err('source 重复');
    seen.add(source);

    const kind = KIND_BY_PREFIX.find(([p]) => source.startsWith(p))?.[1];
    if (!kind) err(`来源前缀不认识（${source}）`);
    if (!ATTRIBUTIONS.has(u.attribution)) err(`归属不合法：${u.attribution}`);
    if (!CONFIDENCES.has(u.confidence)) err(`置信度不合法：${u.confidence}`);
    if (typeof u.title !== 'string' || !u.title.trim()) err('缺标题');
    if (u.dated != null && !/^\d{4}-\d{2}-\d{2}$/.test(u.dated)) err(`dated 不合法：${u.dated}`);

    // 上传用补齐后的 final_tags（上级路径标签是检索入口，服务端不再补齐）
    const tags = Array.isArray(u.final_tags) && u.final_tags.length ? u.final_tags : u.tags;
    if (!Array.isArray(tags) || tags.length === 0) {
      err('没有标签');
      continue;
    }
    for (const t of tags) {
      if (typeof t !== 'string' || !t.trim()) err('存在空标签');
      else if (t.startsWith('发布-') || t === '可分享') err(`红线标签：${t}`);
      else if (!vocab.has(t) && !(u.new_tags ?? []).includes(t)) {
        warnings.push(`${label}: 生词标签「${t}」（不在已知词表、也没declare在 new_tags）`);
      }
    }

    let body = '';
    try {
      body = await resolveBody(lake, source);
    } catch (e) {
      err(`正文回溯失败：${e.message}`);
      continue;
    }

    out.push({
      source,
      kind,
      title: u.title?.trim() ?? '',
      body,
      dated: u.dated ?? null,
      attribution: u.attribution,
      confidence: u.confidence,
      needsConfirm: u.needs_confirm === true,
      duplicateOf: u.duplicate_of ?? null,
      reason: u.reason ?? null,
      tags: [...new Set(tags.map((t) => String(t).trim()))],
    });
  }

  for (const w of warnings) console.warn(`警告：${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`错误：${e}`);
    die(`校验失败：${errors.length} 个错误（0 个单元被上传）`);
  }

  const target = resolve(opts.out ?? join(dirname(resolve(file)), 'raw-upload.json'));
  await writeFile(target, JSON.stringify({ week, units: out }, null, 1), 'utf8');
  const empty = out.filter((u) => !u.body).length;
  console.log(
    `== check 通过：${week}，${out.length} 个单元（空正文 ${empty}），${warnings.length} 个警告`,
  );
  console.log(`== 产物：${target}`);
}

// ---------- ingest ----------

async function ingest(file, opts) {
  const base = opts.base ?? DEFAULT_BASE;
  const token = process.env.FATHOM_TOKEN;
  if (!token) die('缺 FATHOM_TOKEN 环境变量');
  const { week, units } = JSON.parse(await readFile(file, 'utf8'));
  if (!WEEK_RE.test(week ?? '') || !Array.isArray(units)) die('不是 check 产出的 raw-upload.json');

  let created = 0;
  let updated = 0;
  for (let i = 0; i < units.length; i += INGEST_BATCH) {
    const batch = units.slice(i, i + INGEST_BATCH);
    const res = await fetch(`${base}/api/raw/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ week, units: batch }),
    });
    if (!res.ok) {
      console.error(`批次 ${i / INGEST_BATCH + 1} 失败（HTTP ${res.status}）：${await res.text()}`);
      die(`已入库 created=${created} updated=${updated}；修好后重跑即可（幂等，重传=刷新）`);
    }
    const r = await res.json();
    created += r.created;
    updated += r.updated;
    console.log(`.. 批次 ${i / INGEST_BATCH + 1}：+${r.created} 新建 / ${r.updated} 刷新`);
  }
  console.log(`== ingest 完成：${week} 共 ${units.length} 个单元（新建 ${created}，刷新 ${updated}）`);
}

// ---------- CLI ----------

const [cmd, file, ...rest] = process.argv.slice(2);
const opts = {};
for (let i = 0; i < rest.length; i += 2) {
  const k = rest[i]?.replace(/^--/, '');
  if (!k || rest[i + 1] === undefined) die(`参数不成对：${rest[i]}`);
  opts[k] = rest[i + 1];
}

if (cmd === 'check' && file) await check(file, opts);
else if (cmd === 'ingest' && file) await ingest(file, opts);
else {
  console.log('用法：raw.mjs check <标签.json> [--lake 湖路径] [--out 产物路径]');
  console.log('      raw.mjs ingest <raw-upload.json> [--base http://localhost:3000]');
  process.exit(2);
}
