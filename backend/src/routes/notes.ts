import { Hono } from 'hono';
import type { AuthVars } from '../auth/middleware';
import { requireAuth } from '../auth/middleware';
import * as Notes from '../notes';
import { noteDto } from '../dto';

export const noteRoutes = new Hono<AuthVars>();
noteRoutes.use('*', requireAuth);

noteRoutes.get('/', async (c) => {
  const userId = c.get('userId')!;
  const tagId = c.req.query('tagId') || undefined;
  const q = c.req.query('q') || undefined;
  const notes = await Notes.listNotes(userId, { tagId, q });
  return c.json({ notes: notes.map(noteDto) });
});

noteRoutes.post('/', async (c) => {
  const userId = c.get('userId')!;
  const { body, tagIds } = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  if (typeof body !== 'string' || !body.trim()) return c.json({ error: 'bad_body' }, 400);
  try {
    const note = await Notes.createNote(userId, body, Array.isArray(tagIds) ? tagIds : []);
    return c.json({ note: noteDto(note) }, 201);
  } catch (e) {
    return c.json({ error: (e as Error).message === 'tag_not_owned' ? 'tag_not_owned' : 'error' }, 400);
  }
});

noteRoutes.patch('/:id', async (c) => {
  const userId = c.get('userId')!;
  const { body } = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  if (typeof body !== 'string' || !body.trim()) return c.json({ error: 'bad_body' }, 400);
  const note = await Notes.updateNote(userId, c.req.param('id'), body);
  return note ? c.json({ note: noteDto(note) }) : c.json({ error: 'not_found' }, 404);
});

noteRoutes.put('/:id/tags', async (c) => {
  const userId = c.get('userId')!;
  const { tagIds } = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  if (!Array.isArray(tagIds)) return c.json({ error: 'bad_input' }, 400);
  try {
    const note = await Notes.setNoteTags(userId, c.req.param('id'), tagIds);
    return note ? c.json({ note: noteDto(note) }) : c.json({ error: 'not_found' }, 404);
  } catch {
    return c.json({ error: 'tag_not_owned' }, 400);
  }
});

noteRoutes.delete('/:id', async (c) => {
  const ok = await Notes.deleteNote(c.get('userId')!, c.req.param('id'));
  return ok ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
});
