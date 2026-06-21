import { Hono } from 'hono';
import type { AuthVars } from '../auth/middleware';
import { requireAuth } from '../auth/middleware';
import * as Cards from '../cards';

export const cardRoutes = new Hono<AuthVars>();
cardRoutes.use('*', requireAuth);

cardRoutes.get('/', async (c) => {
  const cards = await Cards.listCards(c.get('userId')!);
  return c.json({ cards: cards.map(Cards.cardDto) });
});

cardRoutes.post('/', async (c) => {
  const userId = c.get('userId')!;
  const { title, tags } = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  if (typeof title !== 'string' || !title.trim()) return c.json({ error: 'bad_title' }, 400);
  const tagList = Array.isArray(tags)
    ? tags
        .filter((t) => t && typeof t.tagId === 'string')
        .map((t) => ({ tagId: t.tagId as string, autoUpdate: !!t.autoUpdate }))
    : [];
  try {
    const card = await Cards.createCard(userId, title.trim(), tagList);
    return c.json({ card: Cards.cardDto(card) }, 201);
  } catch (e) {
    return c.json({ error: (e as Error).message === 'tag_not_owned' ? 'tag_not_owned' : 'error' }, 400);
  }
});

cardRoutes.get('/:id', async (c) => {
  const card = await Cards.getOwnCard(c.get('userId')!, c.req.param('id'));
  return card ? c.json({ card: Cards.cardDto(card) }) : c.json({ error: 'not_found' }, 404);
});

cardRoutes.post('/:id/advance', async (c) => {
  const ok = await Cards.advanceTime(c.get('userId')!, c.req.param('id'));
  return ok ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
});

cardRoutes.post('/:id/tags', async (c) => {
  const { tagId, autoUpdate } = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  if (typeof tagId !== 'string') return c.json({ error: 'bad_input' }, 400);
  try {
    const r = await Cards.addCardTag(c.get('userId')!, c.req.param('id'), tagId, !!autoUpdate);
    return r.ok ? c.json({ ok: true }) : c.json({ error: r.reason }, 404);
  } catch {
    return c.json({ error: 'tag_not_owned' }, 400);
  }
});

cardRoutes.patch('/:id/tags/:tagId', async (c) => {
  const { autoUpdate } = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const ok = await Cards.setCardTagAuto(c.get('userId')!, c.req.param('id'), c.req.param('tagId'), !!autoUpdate);
  return ok ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
});

cardRoutes.delete('/:id/tags/:tagId', async (c) => {
  const ok = await Cards.removeCardTag(c.get('userId')!, c.req.param('id'), c.req.param('tagId'));
  return ok ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
});

cardRoutes.post('/:id/rotate-code', async (c) => {
  const code = await Cards.rotateCode(c.get('userId')!, c.req.param('id'));
  return code ? c.json({ inviteCode: code }) : c.json({ error: 'not_found' }, 404);
});
