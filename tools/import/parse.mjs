// Fathom 导入管线 —— 格式解析。
//
// 解析对象是 Codex 扒取产出的 markdown（v2 spec §5 的格式契约），不是我们自己
// 写的格式。所以这里的原则是**宽松**：字段缺失不崩，按文件名/mtime 兜底，
// 遇到没见过的结构就把它当正文而不是抛错 —— 上游是另一条独立流水线，它的
// 输出会漂移，导入器不该因为多了一行说明就整批失败。

import { basename } from 'node:path';

/** `- 键：值` 头部列表。中英文冒号都收，值里的冒号不切（对话链接里有 https://）。 */
function parseHeader(lines) {
  const meta = new Map();
  for (const line of lines) {
    const m = line.match(/^\s*[-*]\s*([^：:]+)[：:]\s*(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    const value = m[2].trim().replace(/^`|`$/g, ''); // 源文件路径是反引号包起来的
    if (!meta.has(key)) meta.set(key, value);
  }
  return meta;
}

/** 把文本按 `## 标题` 切成段。返回 [{ title, body }]，标题前的内容归 title=null。 */
function splitSections(text, level = 2) {
  const marker = '#'.repeat(level);
  const re = new RegExp(`^${marker} +(.*)$`);
  const out = [{ title: null, lines: [] }];
  for (const line of text.split('\n')) {
    const m = line.match(re);
    if (m) out.push({ title: m[1].trim(), lines: [] });
    else out[out.length - 1].lines.push(line);
  }
  return out.map((s) => ({ title: s.title, body: s.lines.join('\n').trim() }));
}

const firstHeading = (text) => (text.match(/^#\s+(.*)$/m) || [, ''])[1].trim();

/** ISO 日期（YYYY-MM-DD）。取不到返回 null —— 由调用方决定兜底，解析器不猜。 */
function isoDate(raw) {
  if (!raw) return null;
  const m = String(raw).match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

/**
 * 录音转写稿。
 * 头部：录音日期 / 时长 / 源文件 / 转写方式 / 可选时间说明。
 * 正文：`## 自动转写正文`；可选 `## 识别说明`。
 *
 * 方括号标注的是转写不确定处。这里**只标记不剥离** —— 剥离要在提炼阶段做，
 * 因为提炼要看见"这段拿不准"才能决定绕开它（spec §5：方括号段不得进入提炼产物）。
 */
export function parseVoice(text, filePath, fallbackDate) {
  const sections = splitSections(text);
  const meta = parseHeader((sections[0]?.body || '').split('\n'));
  const pick = (...keys) => {
    for (const k of keys) for (const [mk, mv] of meta) if (mk.includes(k)) return mv;
    return null;
  };
  const transcript = sections.find((s) => s.title && s.title.includes('转写正文'))?.body || '';
  const caveat = sections.find((s) => s.title && s.title.includes('识别说明'))?.body || '';

  return {
    kind: 'voice',
    title: firstHeading(text) || basename(filePath, '.md'),
    recordedOn: isoDate(pick('录音日期', '日期')) || fallbackDate,
    duration: pick('时长') || null,
    sourceFile: pick('源文件') || null,
    method: pick('转写方式') || null,
    body: transcript,
    caveat,
    uncertainSpans: [...transcript.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]),
    // 没有转写正文的文件不是错误，是「还没转写」（比如源文件缺失的那两条）——
    // 交给调用方跳过并汇报，而不是在这里抛。
    empty: transcript.trim().length === 0,
  };
}

/**
 * ChatGPT 单会话。
 * 头部：项目 / 项目内顺序 / 网页显示时间 / 对话链接 / 可选附件、说明。
 * 正文：`## 第 N 条可见消息`（或 `## 第 N 轮`），节内 `### 用户` / `### AI`。
 *
 * 角色区分是**语义关键**，不是格式细节：「用户」是本人表达，「AI」是外部内容。
 * 提炼必须以前者为主，后者只在本人明确认可时以「认可了……」引用（spec §5）。
 */
export function parseChat(text, filePath, fallbackDate) {
  const sections = splitSections(text);
  const meta = parseHeader((sections[0]?.body || '').split('\n'));
  const pick = (...keys) => {
    for (const k of keys) for (const [mk, mv] of meta) if (mk.includes(k)) return mv;
    return null;
  };

  const turns = [];
  if (/^###\s+消息\s*\d+｜/m.test(text)) {
    // Codex 消息正文本身可以包含任意 ## / ### 标题，不能用普通
    // Markdown 层级切分。只有「任务轮次」和「消息 N｜角色」是记录边界。
    const boundary = /^(##\s+任务轮次\s*\d+|###\s+消息\s*\d+｜([^\n]+))\s*$/gm;
    const matches = [...text.matchAll(boundary)];
    let task = '';
    for (let i = 0; i < matches.length; i++) {
      const heading = matches[i][1];
      if (heading.startsWith('## ')) { task = heading.replace(/^##\s+/, ''); continue; }
      const roleLabel = matches[i][2] || '';
      const start = matches[i].index + matches[i][0].length;
      const end = matches[i + 1]?.index ?? text.length;
      const body = text.slice(start, end).trim();
      if (!body) continue;
      const role = roleLabel.includes('用户') ? 'user' : /(AI|Codex|Assistant)/i.test(roleLabel) ? 'ai' : 'other';
      turns.push({ role, section: task || heading, text: body });
    }
  } else {
    for (const section of sections) {
      if (!section.title || !/第\s*\d+\s*(条|轮)/.test(section.title)) continue;
      for (const part of splitSections(section.body, 3)) {
        if (!part.title || !part.body.trim()) continue;
        const role = part.title.includes('用户') ? 'user' : /(AI|Codex|Assistant)/i.test(part.title) ? 'ai' : 'other';
        turns.push({ role, section: section.title, text: part.body.trim() });
      }
    }
  }
  if (!turns.length) {
    // W30 起的漂移：`### 第 N 轮｜用户`——角色并进三级标题，没有二级分节
    for (const part of splitSections(text, 3)) {
      if (!part.title || !/(第\s*\d+\s*(条|轮)|消息\s*\d+)/.test(part.title) || !part.body.trim()) continue;
      const role = part.title.includes('用户') ? 'user' : /(AI|Codex|Assistant)/i.test(part.title) ? 'ai' : 'other';
      turns.push({ role, section: part.title, text: part.body.trim() });
    }
  }

  return {
    kind: 'chat',
    title: firstHeading(text) || basename(filePath, '.md'),
    project: pick('项目') || null,
    orderInProject: Number(pick('项目内顺序')) || null,
    // W29 叫「网页显示时间」，W30 起叫「项目页显示日期」——上游漂移，两个都收
    shownTime: pick('网页显示时间', '显示日期') || null,
    // 对话链接进湖留档，但**不进笔记正文**：它是 chatgpt.com 的链接，
    // 对读者既无意义又可能泄露作者的会话标识。
    link: pick('对话链接') || null,
    attachment: pick('附件') || null,
    note: pick('说明') || null,
    occurredOn: isoDate(pick('网页显示时间', '显示日期', '任务创建时间')) || fallbackDate,
    turns,
    userTurns: turns.filter((t) => t.role === 'user'),
    empty: turns.filter((t) => t.role === 'user').length === 0,
  };
}

/** flomo 导出或人工保存的随记。导出形式可能漂移，因此只取明示日期，不根据文件修改时间猜测。 */
export function parseMemo(text, filePath, fallbackDate) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const meta = parseHeader(lines.slice(0, 40));
  const pick = (...keys) => {
    for (const k of keys) for (const [mk, mv] of meta) if (mk.includes(k)) return mv;
    return null;
  };
  const explicit = pick('创建时间', '更新时间', '日期', '时间');
  return {
    kind: 'memo',
    title: firstHeading(text) || basename(filePath, '.md'),
    occurredOn: isoDate(explicit) || fallbackDate,
    body: text.trim(),
    uncertainSpans: [],
    empty: text.trim().length === 0,
  };
}

/** 周报（`2026-Wnn.md`）：索引 + 摘要 + 未解决事项。只进湖留档，不入库。 */
export function isWeeklyDigest(filePath) {
  return /\d{4}-W\d{2}\.md$/.test(basename(filePath));
}
