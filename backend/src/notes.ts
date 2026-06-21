import { db } from './db';
import { assertTagsOwned } from './own';

const withTags = { noteTags: { include: { tag: true } } } as const;

export async function createNote(userId: string, body: string, tagIds: string[] = []) {
  await assertTagsOwned(userId, tagIds);
  return db.note.create({
    data: { userId, body, noteTags: { create: [...new Set(tagIds)].map((tagId) => ({ tagId })) } },
    include: withTags,
  });
}

export async function updateNote(userId: string, id: string, body: string) {
  const r = await db.note.updateMany({ where: { id, userId }, data: { body } });
  if (r.count === 0) return null;
  return db.note.findUnique({ where: { id }, include: withTags });
}

export async function deleteNote(userId: string, id: string): Promise<boolean> {
  const r = await db.note.deleteMany({ where: { id, userId } });
  return r.count > 0;
}

/** List the caller's own notes; optional tag filter and case-insensitive text search.
 *  Always scoped to userId (no cross-user leak); Prisma parameterizes (no SQL injection). */
export async function listNotes(userId: string, opts: { tagId?: string; q?: string } = {}) {
  return db.note.findMany({
    where: {
      userId,
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
  ]);
  return db.note.findUnique({ where: { id }, include: withTags });
}
