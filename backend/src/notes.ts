import { db } from './db';
import { assertTagsOwned } from './own';

const withTags = {
  noteTags: { include: { tag: true } },
  images: { orderBy: { sortOrder: 'asc' } },
} as const;

export type NewNoteImage = { mimeType: string; data: Uint8Array<ArrayBuffer> };

export async function createNote(
  userId: string,
  body: string,
  topic: string | null = null,
  tagIds: string[] = [],
  images: NewNoteImage[] = [],
) {
  await assertTagsOwned(userId, tagIds);
  return db.note.create({
    data: {
      userId,
      body,
      topic,
      noteTags: { create: [...new Set(tagIds)].map((tagId) => ({ tagId })) },
      images: { create: images.map((image, sortOrder) => ({ ...image, sortOrder })) },
    },
    include: withTags,
  });
}

export async function updateNote(userId: string, id: string, body: string, topic?: string | null) {
  const r = await db.note.updateMany({
    where: { id, userId },
    data: { body, ...(topic !== undefined ? { topic } : {}) },
  });
  if (r.count === 0) return null;
  return db.note.findUnique({ where: { id }, include: withTags });
}

export async function deleteNote(userId: string, id: string): Promise<boolean> {
  const r = await db.note.deleteMany({ where: { id, userId } });
  return r.count > 0;
}

/** List the caller's own notes; optional tag filter, untagged-only, and case-insensitive
 *  text search. Always scoped to userId (no cross-user leak); Prisma parameterizes (no
 *  SQL injection). `untagged` is the console's inbox: a note with no tag matches no
 *  share's include set, so it is invisible to every card — tagging IS the publish
 *  decision (v2 §1 决策 7). */
export async function listNotes(userId: string, opts: { tagId?: string; q?: string; untagged?: boolean } = {}) {
  return db.note.findMany({
    where: {
      userId,
      ...(opts.untagged ? { noteTags: { none: {} } } : {}),
      ...(opts.tagId ? { noteTags: { some: { tagId: opts.tagId } } } : {}),
      ...(opts.q ? { body: { contains: opts.q, mode: 'insensitive' } } : {}),
    },
    include: withTags,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
}

/** Replace a note's tag set wholesale (only the owner's note + owner's tags). */
export async function setNoteTags(userId: string, id: string, tagIds: string[]) {
  const note = await db.note.findFirst({ where: { id, userId }, select: { id: true } });
  if (!note) return null;
  await assertTagsOwned(userId, tagIds);
  const unique = [...new Set(tagIds)];
  await db.$transaction([
    db.noteTag.deleteMany({ where: { noteId: id } }),
    db.noteTag.createMany({ data: unique.map((tagId) => ({ noteId: id, tagId })) }),
    db.note.update({ where: { id }, data: { updatedAt: new Date() } }),
  ]);
  return db.note.findUnique({ where: { id }, include: withTags });
}

export async function ownImage(userId: string, imageId: string) {
  return db.noteImage.findFirst({
    where: { id: imageId, note: { userId } },
    select: { data: true, mimeType: true },
  });
}
