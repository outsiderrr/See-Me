import { Hono } from 'hono';
import type { AuthVars } from '../auth/middleware';
import { requireAuth } from '../auth/middleware';
import * as Tags from '../tags';

export const tagRoutes = new Hono<AuthVars>();
tagRoutes.use('*', requireAuth);

tagRoutes.get('/', async (c) => {
  return c.json({ tags: await Tags.listTags(c.get('userId')!) });
});

tagRoutes.post('/', async (c) => {
  const userId = c.get('userId')!;
  const { name } = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  if (typeof name !== 'string' || !name.trim()) return c.json({ error: 'bad_name' }, 400);
  try {
    return c.json({ tag: await Tags.createTag(userId, name.trim()) }, 201);
  } catch {
    return c.json({ error: 'duplicate' }, 409); // unique(userId, name)
  }
});

tagRoutes.patch('/:id', async (c) => {
  const userId = c.get('userId')!;
  const { name } = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  if (typeof name !== 'string' || !name.trim()) return c.json({ error: 'bad_name' }, 400);
  try {
    const ok = await Tags.renameTag(userId, c.req.param('id'), name.trim());
    return ok ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
  } catch {
    return c.json({ error: 'duplicate' }, 409);
  }
});

tagRoutes.delete('/:id', async (c) => {
  const r = await Tags.deleteTag(c.get('userId')!, c.req.param('id'));
  if (r.ok) return c.json({ ok: true });
  return c.json({ error: r.reason }, r.reason === 'not_found' ? 404 : 409);
});
