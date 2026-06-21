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
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const patch: { name?: string; icon?: string | null; pinned?: boolean } = {};
  if ('name' in body) {
    if (typeof body.name !== 'string' || !body.name.trim()) return c.json({ error: 'bad_name' }, 400);
    patch.name = body.name.trim();
  }
  if ('icon' in body) {
    if (body.icon !== null && typeof body.icon !== 'string') return c.json({ error: 'bad_icon' }, 400);
    const icon = typeof body.icon === 'string' ? body.icon.trim() : null;
    if (icon && Array.from(icon).length > 8) return c.json({ error: 'bad_icon' }, 400);
    patch.icon = icon || null;
  }
  if ('pinned' in body) {
    if (typeof body.pinned !== 'boolean') return c.json({ error: 'bad_pinned' }, 400);
    patch.pinned = body.pinned;
  }
  if (Object.keys(patch).length === 0) return c.json({ error: 'bad_input' }, 400);
  try {
    const ok = await Tags.updateTag(userId, c.req.param('id'), patch);
    return ok ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
  } catch {
    return c.json({ error: 'duplicate' }, 409);
  }
});

tagRoutes.delete('/:id', async (c) => {
  const { mode } = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  if (mode !== 'delete_notes' && mode !== 'detach') return c.json({ error: 'bad_mode' }, 400);
  const r = await Tags.deleteTag(c.get('userId')!, c.req.param('id'), mode);
  if (r.ok) return c.json({ ok: true });
  return c.json({ error: r.reason }, 404);
});
