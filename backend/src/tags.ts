import { db } from './db';

export async function createTag(userId: string, name: string) {
  return db.tag.create({ data: { userId, name } });
}

export async function listTags(userId: string) {
  const tags = await db.tag.findMany({
    where: { userId },
    include: {
      _count: { select: { noteTags: true, shareTags: true, rawUnitTags: true } },
      noteTags: { select: { note: { select: { updatedAt: true } } } },
    },
  });
  return tags
    .map((t) => ({
      id: t.id,
      name: t.name,
      icon: t.icon,
      isPinned: t.pinnedAt !== null,
      lastUsedAt: t.noteTags.reduce<Date | null>(
        (latest, nt) => (!latest || nt.note.updatedAt > latest ? nt.note.updatedAt : latest),
        null,
      ),
      noteCount: t._count.noteTags,
      shareCount: t._count.shareTags,
      // 原始材料层（raw_units）对该标签的引用数。只被原始层使用的标签 noteCount 为 0，
      // 单看展示层会像"从没用过"；分开计数而不合并，因为两层语义不同（备份 vs 发布）。
      rawUnitCount: t._count.rawUnitTags,
    }))
    .sort((a, b) => {
      const at = a.lastUsedAt?.getTime() ?? 0;
      const bt = b.lastUsedAt?.getTime() ?? 0;
      return bt - at || a.name.localeCompare(b.name);
    });
}

export async function updateTag(
  userId: string,
  id: string,
  patch: { name?: string; icon?: string | null; pinned?: boolean },
): Promise<boolean> {
  const r = await db.tag.updateMany({
    where: { id, userId },
    data: {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
      ...(patch.pinned !== undefined ? { pinnedAt: patch.pinned ? new Date() : null } : {}),
    },
  });
  return r.count > 0;
}

export type DeleteTagMode = 'delete_notes' | 'detach';

/** Delete a tag without ever broadening a live card:
 *  - every share that references this tag is deleted wholesale. Required tags cannot
 *    be weakened (A∩B -> A), and excluded tags cannot be detached because notes that
 *    lose that exclusion marker could otherwise become newly visible;
 *  - notes are either deleted wholesale or kept with the tag detached. */
export async function deleteTag(
  userId: string,
  id: string,
  mode: DeleteTagMode,
): Promise<{ ok: boolean; reason?: 'not_found' }> {
  const tag = await db.tag.findFirst({ where: { id, userId }, select: { id: true } });
  if (!tag) return { ok: false, reason: 'not_found' };

  const referencedBy = await db.shareTag.findMany({
    where: { tagId: id },
    select: { shareId: true },
  });
  const referencedShareIds = referencedBy.map((row) => row.shareId);

  await db.$transaction([
    db.share.deleteMany({ where: { id: { in: referencedShareIds }, card: { userId } } }),
    ...(mode === 'delete_notes'
      ? [db.note.deleteMany({ where: { userId, noteTags: { some: { tagId: id } } } })]
      : [db.noteTag.deleteMany({ where: { tagId: id, note: { userId } } })]),
    db.tag.delete({ where: { id } }),
  ]);
  return { ok: true };
}
