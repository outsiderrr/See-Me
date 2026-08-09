import { Hono } from 'hono';
import type { AuthVars } from '../auth/middleware';
import { requireAuth } from '../auth/middleware';
import * as Raw from '../raw';

// 原始材料层——作者控制台专用。刻意不在 reader/public 任何路由暴露：
// 原始材料是备份，不参与分享；结构隔离见 schema 里 RawUnit 的注释。
export const rawRoutes = new Hono<AuthVars>();
rawRoutes.use('*', requireAuth);

const MAX_UNITS_PER_REQUEST = 500;
const MAX_SOURCE = 500;
const MAX_TITLE = 200;
const MAX_BODY = 200_000;
const MAX_TAGS = 30;
const MAX_TAG_NAME = 50;
const MAX_REASON = 2000;
const WEEK_RE = /^\d{4}-W\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type BadUnit = { index: number; source?: string; problem: string };

function parseUnit(input: unknown, index: number): Raw.RawUnitInput | BadUnit {
  if (!input || typeof input !== 'object') return { index, problem: 'not_object' };
  const u = input as Record<string, unknown>;
  const source = typeof u.source === 'string' ? u.source.trim() : '';
  const bad = (problem: string): BadUnit => ({ index, source: source || undefined, problem });

  if (!source || source.length > MAX_SOURCE) return bad('bad_source');
  if (typeof u.kind !== 'string' || !Raw.RAW_KINDS.has(u.kind)) return bad('bad_kind');
  if (typeof u.title !== 'string' || !u.title.trim() || u.title.length > MAX_TITLE) return bad('bad_title');
  // body 允许为空串：flomo 里存在只有标签没有正文的条目，备份层要如实保留
  if (typeof u.body !== 'string' || u.body.length > MAX_BODY) return bad('bad_body');
  if (u.dated != null && (typeof u.dated !== 'string' || !DATE_RE.test(u.dated))) return bad('bad_dated');
  if (typeof u.attribution !== 'string' || !Raw.RAW_ATTRIBUTIONS.has(u.attribution)) return bad('bad_attribution');
  if (typeof u.confidence !== 'string' || !Raw.RAW_CONFIDENCES.has(u.confidence)) return bad('bad_confidence');
  if (u.needsConfirm !== undefined && typeof u.needsConfirm !== 'boolean') return bad('bad_needs_confirm');
  if (u.duplicateOf != null && typeof u.duplicateOf !== 'string') return bad('bad_duplicate_of');
  if (u.reason != null && (typeof u.reason !== 'string' || u.reason.length > MAX_REASON)) return bad('bad_reason');

  if (!Array.isArray(u.tags) || u.tags.length === 0 || u.tags.length > MAX_TAGS) return bad('bad_tags');
  const tags: string[] = [];
  for (const t of u.tags) {
    if (typeof t !== 'string') return bad('bad_tags');
    const name = t.trim();
    if (!name || name.length > MAX_TAG_NAME) return bad('bad_tags');
    if (Raw.isForbiddenRawTag(name)) return bad(`forbidden_tag:${name}`);
    if (!tags.includes(name)) tags.push(name);
  }

  return {
    source,
    kind: u.kind,
    title: u.title.trim(),
    body: u.body,
    dated: (u.dated as string | undefined) ?? null,
    attribution: u.attribution,
    confidence: u.confidence,
    needsConfirm: u.needsConfirm === true,
    duplicateOf: (u.duplicateOf as string | undefined)?.trim() || null,
    reason: (u.reason as string | undefined)?.trim() || null,
    tags,
  };
}

rawRoutes.post('/import', async (c) => {
  const userId = c.get('userId')!;
  const { week, units } = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  if (typeof week !== 'string' || !WEEK_RE.test(week)) return c.json({ error: 'bad_week' }, 400);
  if (!Array.isArray(units) || units.length === 0 || units.length > MAX_UNITS_PER_REQUEST) {
    return c.json({ error: 'bad_units' }, 400);
  }

  const parsed: Raw.RawUnitInput[] = [];
  const problems: BadUnit[] = [];
  const seen = new Set<string>();
  units.forEach((raw, i) => {
    const r = parseUnit(raw, i);
    if ('problem' in r) return void problems.push(r);
    if (seen.has(r.source)) return void problems.push({ index: i, source: r.source, problem: 'duplicate_source' });
    seen.add(r.source);
    parsed.push(r);
  });
  // 整批拒绝而不是跳过坏单元：导入是幂等的，修好重跑没有成本；
  // 静默丢单元会让"备份齐全"变成假象。
  if (problems.length) return c.json({ error: 'bad_unit', problems: problems.slice(0, 20) }, 400);

  const result = await Raw.importRawUnits(userId, week, parsed);
  return c.json({ ok: true, week, ...result });
});

rawRoutes.get('/', async (c) => {
  const userId = c.get('userId')!;
  const week = c.req.query('week') || undefined;
  if (week && !WEEK_RE.test(week)) return c.json({ error: 'bad_week' }, 400);
  const take = Math.min(Math.max(parseInt(c.req.query('take') || '50', 10) || 50, 1), 200);
  const skip = Math.max(parseInt(c.req.query('skip') || '0', 10) || 0, 0);
  const needsConfirmQ = c.req.query('needsConfirm');
  const result = await Raw.listRawUnits(userId, {
    week,
    tagId: c.req.query('tagId') || undefined,
    needsConfirm: needsConfirmQ === undefined ? undefined : needsConfirmQ === '1',
    skip,
    take,
  });
  return c.json(result);
});
