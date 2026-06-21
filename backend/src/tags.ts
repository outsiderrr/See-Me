import { db } from './db';

export async function createTag(userId: string, name: string) {
  return db.tag.create({ data: { userId, name } });
}

export async function listTags(userId: string) {
  const tags = await db.tag.findMany({
    where: { userId },
    orderBy: { name: 'asc' },
    include: { _count: { select: { noteTags: true, shareTags: true } } },
  });
  return tags.map((t) => ({
    id: t.id,
    name: t.name,
    noteCount: t._count.noteTags,
    shareCount: t._count.shareTags,
  }));
}

export async function renameTag(userId: string, id: string, name: string): Promise<boolean> {
  const r = await db.tag.updateMany({ where: { id, userId }, data: { name } });
  return r.count > 0;
}

/** Delete a tag. Refused if it is still used in any share (include OR exclude):
 *  ShareTag is ON DELETE RESTRICT, and deleting it would silently change what a live
 *  card shares (§4). NoteTag cascades, so the tag detaches from notes cleanly. */
export async function deleteTag(
  userId: string,
  id: string,
): Promise<{ ok: boolean; reason?: 'not_found' | 'in_card' }> {
  const tag = await db.tag.findFirst({ where: { id, userId }, select: { id: true } });
  if (!tag) return { ok: false, reason: 'not_found' };
  const inShares = await db.shareTag.count({ where: { tagId: id } });
  if (inShares > 0) return { ok: false, reason: 'in_card' };
  await db.tag.delete({ where: { id } });
  return { ok: true };
}
