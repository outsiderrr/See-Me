import { db } from '../db';
import { INVITE_ALPHABET } from '../inviteCode';
import type { CardKind } from '../cards';

export async function resetDb() {
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE "card_holders","share_tags","shares","cards","note_images","note_tags","notes","raw_unit_tags","raw_units","tags","sessions","email_otps","rate_limits","users" RESTART IDENTITY CASCADE;`,
  );
}

let seq = 0;
export async function makeUser(displayName?: string) {
  return db.user.create({ data: { email: `fathom-test-owner-${seq++}@test.local`, displayName } });
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

/** Deterministic counter rendered in the real charset — fixtures must be codes the
 *  production normalizers actually accept (0/1/I/L/O are not in the alphabet). */
function base31(n: number, width: number): string {
  let out = '';
  for (let i = 0; i < width; i++) {
    out = INVITE_ALPHABET[n % INVITE_ALPHABET.length] + out;
    n = Math.floor(n / INVITE_ALPHABET.length);
  }
  return out;
}

export function testSlug(): string {
  return 'PUBTEST2' + base31(slugSeq++, 6);
}
let slugSeq = 0;

export async function makeCard(
  userId: string,
  visibleUntil: Date,
  shares: ShareSpec[],
  opts: { kind?: CardKind; publicSlug?: string; title?: string } = {},
) {
  const kind = opts.kind ?? 'private';
  return db.card.create({
    data: {
      userId,
      title: opts.title ?? 'card',
      kind,
      inviteCode: 'TEST' + base31(codeSeq++, 4),
      publicSlug: kind === 'open' ? (opts.publicSlug ?? testSlug()) : null,
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

export async function makeOpenCard(
  userId: string,
  visibleUntil: Date,
  shares: ShareSpec[],
  opts: { publicSlug?: string; title?: string } = {},
) {
  const card = await makeCard(userId, visibleUntil, shares, { ...opts, kind: 'open' });
  return card as typeof card & { publicSlug: string };
}

export async function makeImage(noteId: string, sortOrder = 0) {
  return db.noteImage.create({
    data: { noteId, mimeType: 'image/png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47]), sortOrder },
  });
}
