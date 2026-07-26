import { Hono } from 'hono';
import type { AuthVars } from '../auth/middleware';
import { requireAuth } from '../auth/middleware';
import * as Cards from '../cards';
import type { ShareInput } from '../cards';

export const cardRoutes = new Hono<AuthVars>();
cardRoutes.use('*', requireAuth);

function parseShare(raw: unknown): ShareInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.include) || !r.include.every((t) => typeof t === 'string')) return null;
  const exclude = Array.isArray(r.exclude) ? r.exclude.filter((t): t is string => typeof t === 'string') : [];
  return {
    name: typeof r.name === 'string' ? r.name : undefined,
    autoUpdate: !!r.autoUpdate,
    include: r.include as string[],
    exclude,
  };
}

cardRoutes.get('/', async (c) => {
  const cards = await Cards.listCards(c.get('userId')!);
  return c.json({ cards: cards.map(Cards.cardDto) });
});

cardRoutes.post('/', async (c) => {
  const userId = c.get('userId')!;
  const { title, kind, shares } = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  if (typeof title !== 'string' || !title.trim()) return c.json({ error: 'bad_title' }, 400);
  const cardKind = Cards.parseCardKind(kind);
  if (!cardKind) return c.json({ error: 'bad_kind' }, 400);
  const parsed = Array.isArray(shares) ? shares.map(parseShare) : [];
  if (parsed.some((s) => s === null) || parsed.some((s) => s!.include.length === 0)) {
    return c.json({ error: 'bad_shares' }, 400);
  }
  try {
    const card = await Cards.createCard(userId, title.trim(), parsed as ShareInput[], cardKind);
    return c.json({ card: Cards.cardDto(card) }, 201);
  } catch (e) {
    const m = (e as Error).message;
    return c.json({ error: m === 'tag_not_owned' || m === 'share_needs_include' ? m : 'error' }, 400);
  }
});

cardRoutes.get('/:id', async (c) => {
  const card = await Cards.getOwnCard(c.get('userId')!, c.req.param('id'));
  return card ? c.json({ card: Cards.cardDto(card) }) : c.json({ error: 'not_found' }, 404);
});

cardRoutes.delete('/:id', async (c) => {
  const ok = await Cards.deleteCard(c.get('userId')!, c.req.param('id'));
  return ok ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
});

cardRoutes.post('/:id/advance', async (c) => {
  const ok = await Cards.advanceTime(c.get('userId')!, c.req.param('id'));
  return ok ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
});

cardRoutes.post('/:id/shares', async (c) => {
  const input = parseShare(await c.req.json().catch(() => ({})));
  if (!input || input.include.length === 0) return c.json({ error: 'bad_shares' }, 400);
  const r = await Cards.addShare(c.get('userId')!, c.req.param('id'), input);
  return r.ok ? c.json({ ok: true }) : c.json({ error: r.reason }, r.reason === 'not_found' ? 404 : 400);
});

cardRoutes.patch('/:id/shares/:shareId', async (c) => {
  const { name, autoUpdate } = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const ok = await Cards.updateShare(c.get('userId')!, c.req.param('id'), c.req.param('shareId'), {
    name: typeof name === 'string' ? name : undefined,
    autoUpdate: typeof autoUpdate === 'boolean' ? autoUpdate : undefined,
  });
  return ok ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
});

cardRoutes.put('/:id/shares/:shareId/tags', async (c) => {
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const include = Array.isArray(body.include) ? body.include.filter((t: unknown): t is string => typeof t === 'string') : [];
  const exclude = Array.isArray(body.exclude) ? body.exclude.filter((t: unknown): t is string => typeof t === 'string') : [];
  const r = await Cards.setShareTags(c.get('userId')!, c.req.param('id'), c.req.param('shareId'), include, exclude);
  return r.ok ? c.json({ ok: true }) : c.json({ error: r.reason }, r.reason === 'not_found' ? 404 : 400);
});

cardRoutes.delete('/:id/shares/:shareId', async (c) => {
  const ok = await Cards.removeShare(c.get('userId')!, c.req.param('id'), c.req.param('shareId'));
  return ok ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
});

cardRoutes.post('/:id/rotate-code', async (c) => {
  const rotated = await Cards.rotateCode(c.get('userId')!, c.req.param('id'));
  return rotated ? c.json(rotated) : c.json({ error: 'not_found' }, 404);
});

cardRoutes.get('/:id/preview', async (c) => {
  const preview = await Cards.ownerPreview(c.get('userId')!, c.req.param('id'));
  return preview ? c.json(preview) : c.json({ error: 'not_found' }, 404);
});
