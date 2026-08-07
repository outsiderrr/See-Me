import { Hono } from 'hono';
import type { AuthVars } from '../auth/middleware';
import { requireAuth } from '../auth/middleware';
import * as Notes from '../notes';
import { noteDto } from '../dto';

export const noteRoutes = new Hono<AuthVars>();
noteRoutes.use('*', requireAuth);

const MAX_IMAGES = 9;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_TOPIC_LENGTH = 80;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function decodeImages(input: unknown): Notes.NewNoteImage[] | null {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > MAX_IMAGES) return null;
  const result: Notes.NewNoteImage[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') return null;
    const { mimeType, data } = item as Record<string, unknown>;
    if (typeof mimeType !== 'string' || !ALLOWED_IMAGE_TYPES.has(mimeType) || typeof data !== 'string') return null;
    const bytes = Uint8Array.from(Buffer.from(data, 'base64'));
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return null;
    result.push({ mimeType, data: bytes });
  }
  return result;
}

noteRoutes.get('/', async (c) => {
  const userId = c.get('userId')!;
  const tagId = c.req.query('tagId') || undefined;
  const q = c.req.query('q') || undefined;
  const untagged = c.req.query('untagged') === '1';
  const notes = await Notes.listNotes(userId, { tagId, q, untagged });
  return c.json({ notes: notes.map(noteDto) });
});

noteRoutes.post('/', async (c) => {
  const userId = c.get('userId')!;
  const { body, topic, tagIds, images: rawImages } = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const images = decodeImages(rawImages);
  if (
    typeof body !== 'string' ||
    images === null ||
    (!body.trim() && images.length === 0) ||
    (topic !== undefined && topic !== null && (typeof topic !== 'string' || topic.trim().length > MAX_TOPIC_LENGTH))
  ) {
    return c.json({ error: 'bad_note' }, 400);
  }
  try {
    const cleanTopic = typeof topic === 'string' && topic.trim() ? topic.trim() : null;
    const note = await Notes.createNote(userId, body.trim(), cleanTopic, Array.isArray(tagIds) ? tagIds : [], images);
    return c.json({ note: noteDto(note) }, 201);
  } catch (e) {
    return c.json({ error: (e as Error).message === 'tag_not_owned' ? 'tag_not_owned' : 'error' }, 400);
  }
});

noteRoutes.get('/images/:id', async (c) => {
  const image = await Notes.ownImage(c.get('userId')!, c.req.param('id'));
  if (!image) return c.json({ error: 'not_found' }, 404);
  return c.body(Buffer.from(image.data), 200, {
    'Content-Type': image.mimeType,
    'Cache-Control': 'private, max-age=300',
  });
});

noteRoutes.patch('/:id', async (c) => {
  const userId = c.get('userId')!;
  const { body, topic } = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  if (
    typeof body !== 'string' ||
    !body.trim() ||
    (topic !== undefined && topic !== null && (typeof topic !== 'string' || topic.trim().length > MAX_TOPIC_LENGTH))
  ) return c.json({ error: 'bad_body' }, 400);
  const cleanTopic = topic === undefined ? undefined : typeof topic === 'string' && topic.trim() ? topic.trim() : null;
  const note = await Notes.updateNote(userId, c.req.param('id'), body.trim(), cleanTopic);
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
