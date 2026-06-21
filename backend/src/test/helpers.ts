import { db } from '../db';

export async function resetDb() {
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE "card_holders","share_tags","shares","cards","note_tags","notes","tags","sessions","phone_otps","rate_limits","users" RESTART IDENTITY CASCADE;`,
  );
}

let seq = 0;
export async function makeUser() {
  return db.user.create({ data: { phone: `+8613900${String(seq++).padStart(6, '0')}` } });
}

export async function makeTag(userId: string, name: string) {
  return db.tag.create({ data: { userId, name } });
}

/** Create a note with an exact createdAt (for precise cutoff-boundary tests). */
export async function makeNote(userId: string, body: string, tagIds: string[], createdAt: Date) {
  return db.note.create({
    data: {
      userId,
      body,
      createdAt,
      updatedAt: createdAt,
      noteTags: { create: tagIds.map((tagId) => ({ tagId })) },
    },
  });
}

let codeSeq = 0;
export type ShareSpec = { name?: string; auto?: boolean; include: string[]; exclude?: string[] };

export async function makeCard(userId: string, visibleUntil: Date, shares: ShareSpec[]) {
  return db.card.create({
    data: {
      userId,
      title: 'card',
      inviteCode: `T${String(codeSeq++).padStart(3, '0')}`.slice(0, 4),
      visibleUntil,
      shares: {
        create: shares.map((s, i) => ({
          name: s.name ?? `share${i}`,
          isAutoUpdate: !!s.auto,
          shareTags: {
            create: [
              ...s.include.map((tagId) => ({ tagId, exclude: false })),
              ...(s.exclude ?? []).map((tagId) => ({ tagId, exclude: true })),
            ],
          },
        })),
      },
    },
    include: { shares: true },
  });
}
