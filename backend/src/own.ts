import { db } from './db';

/** Throws 'tag_not_owned' unless every given tag id belongs to userId. */
export async function assertTagsOwned(userId: string, tagIds: string[]): Promise<void> {
  const unique = [...new Set(tagIds)];
  if (unique.length === 0) return;
  const owned = await db.tag.findMany({
    where: { id: { in: unique }, userId },
    select: { id: true },
  });
  if (owned.length !== unique.length) throw new Error('tag_not_owned');
}
