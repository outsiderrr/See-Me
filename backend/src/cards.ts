import { db } from './db';
import { assertTagsOwned } from './own';
import { generateUniqueInviteCode } from './inviteCode';
import { generateUniquePublicSlug } from './publicSlug';
import { readerFeed } from './permission/engine';
import { cardShareTabs } from './permission/access';

export type ShareInput = { name?: string; autoUpdate?: boolean; include: string[]; exclude?: string[] };

/** 'private' = login card (invite code + CardHolder) | 'open' = link-only card. */
export type CardKind = 'private' | 'open';

export function parseCardKind(raw: unknown): CardKind | null {
  if (raw === undefined || raw === null) return 'private';
  return raw === 'private' || raw === 'open' ? raw : null;
}

const cardInclude = {
  shares: { include: { shareTags: { include: { tag: true } } }, orderBy: { createdAt: 'asc' } },
} as const;

type CardWithShares = NonNullable<Awaited<ReturnType<typeof getOwnCard>>>;

export function cardDto(card: CardWithShares) {
  return {
    id: card.id,
    title: card.title,
    kind: card.kind,
    inviteCode: card.inviteCode,
    // owner-facing only: the slug IS the card's credential, so it lives in A's
    // own card payload and nowhere on any reader surface.
    publicSlug: card.publicSlug,
    visibleUntil: card.visibleUntil,
    createdAt: card.createdAt,
    shares: card.shares.map((s) => ({
      id: s.id,
      name: s.name,
      isAutoUpdate: s.isAutoUpdate,
      include: s.shareTags.filter((st) => !st.exclude).map((st) => ({ id: st.tag.id, name: st.tag.name })),
      exclude: s.shareTags.filter((st) => st.exclude).map((st) => ({ id: st.tag.id, name: st.tag.name })),
    })),
  };
}

async function tagNames(tagIds: string[]): Promise<Map<string, string>> {
  const tags = await db.tag.findMany({ where: { id: { in: tagIds } }, select: { id: true, name: true } });
  return new Map(tags.map((t) => [t.id, t.name]));
}

function defaultShareName(include: string[], exclude: string[], names: Map<string, string>): string {
  const inc = include.map((id) => names.get(id) ?? '?').join('∩');
  const exc = exclude.length ? ' −' + exclude.map((id) => names.get(id) ?? '?').join(',') : '';
  return inc + exc;
}

async function validateShares(userId: string, shares: ShareInput[]): Promise<void> {
  for (const s of shares) {
    if (!Array.isArray(s.include) || s.include.length === 0) throw new Error('share_needs_include');
  }
  const all = [...new Set(shares.flatMap((s) => [...s.include, ...(s.exclude ?? [])]))];
  await assertTagsOwned(userId, all);
}

function shareTagRows(input: ShareInput) {
  return [
    ...input.include.map((tagId) => ({ tagId, exclude: false })),
    ...(input.exclude ?? []).map((tagId) => ({ tagId, exclude: true })),
  ];
}

export async function createCard(userId: string, title: string, shares: ShareInput[], kind: CardKind = 'private') {
  await validateShares(userId, shares);
  const names = await tagNames([...new Set(shares.flatMap((s) => [...s.include, ...(s.exclude ?? [])]))]);
  const inviteCode = await generateUniqueInviteCode();
  return db.card.create({
    data: {
      userId,
      title,
      kind,
      inviteCode,
      publicSlug: kind === 'open' ? await generateUniquePublicSlug() : null,
      visibleUntil: new Date(),
      shares: {
        create: shares.map((s) => ({
          name: s.name?.trim() || defaultShareName(s.include, s.exclude ?? [], names),
          isAutoUpdate: !!s.autoUpdate,
          shareTags: { create: shareTagRows(s) },
        })),
      },
    },
    include: cardInclude,
  });
}

export async function listCards(userId: string) {
  return db.card.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, include: cardInclude });
}

export async function getOwnCard(userId: string, cardId: string) {
  return db.card.findFirst({ where: { id: cardId, userId }, include: cardInclude });
}

export async function advanceTime(userId: string, cardId: string): Promise<boolean> {
  const r = await db.card.updateMany({ where: { id: cardId, userId }, data: { visibleUntil: new Date() } });
  return r.count > 0;
}

/** Rotate a card's credentials. For an open card the link itself is the credential,
 *  so the slug rotates with the code — the old /c/<slug> URL dies immediately. */
export async function rotateCode(
  userId: string,
  cardId: string,
): Promise<{ inviteCode: string; publicSlug: string | null } | null> {
  const card = await db.card.findFirst({ where: { id: cardId, userId }, select: { id: true, kind: true } });
  if (!card) return null;
  const inviteCode = await generateUniqueInviteCode();
  const publicSlug = card.kind === 'open' ? await generateUniquePublicSlug() : null;
  await db.card.update({
    where: { id: cardId },
    data: { inviteCode, ...(card.kind === 'open' ? { publicSlug } : {}) },
  });
  return { inviteCode, publicSlug };
}

async function ownsCard(userId: string, cardId: string): Promise<boolean> {
  return !!(await db.card.findFirst({ where: { id: cardId, userId }, select: { id: true } }));
}
async function ownsShare(userId: string, cardId: string, shareId: string): Promise<boolean> {
  return !!(await db.share.findFirst({ where: { id: shareId, cardId, card: { userId } }, select: { id: true } }));
}

export async function addShare(
  userId: string,
  cardId: string,
  input: ShareInput,
): Promise<{ ok: boolean; reason?: 'not_found' | 'needs_include' | 'tag_not_owned' }> {
  if (!(await ownsCard(userId, cardId))) return { ok: false, reason: 'not_found' };
  try {
    await validateShares(userId, [input]);
  } catch (e) {
    return { ok: false, reason: (e as Error).message === 'share_needs_include' ? 'needs_include' : 'tag_not_owned' };
  }
  const names = await tagNames([...input.include, ...(input.exclude ?? [])]);
  await db.share.create({
    data: {
      cardId,
      name: input.name?.trim() || defaultShareName(input.include, input.exclude ?? [], names),
      isAutoUpdate: !!input.autoUpdate,
      shareTags: { create: shareTagRows(input) },
    },
  });
  return { ok: true };
}

export async function updateShare(
  userId: string,
  cardId: string,
  shareId: string,
  patch: { name?: string; autoUpdate?: boolean },
): Promise<boolean> {
  if (!(await ownsShare(userId, cardId, shareId))) return false;
  await db.share.update({
    where: { id: shareId },
    data: {
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.autoUpdate !== undefined ? { isAutoUpdate: patch.autoUpdate } : {}),
    },
  });
  return true;
}

export async function setShareTags(
  userId: string,
  cardId: string,
  shareId: string,
  include: string[],
  exclude: string[],
): Promise<{ ok: boolean; reason?: 'not_found' | 'needs_include' | 'tag_not_owned' }> {
  if (!(await ownsShare(userId, cardId, shareId))) return { ok: false, reason: 'not_found' };
  if (include.length === 0) return { ok: false, reason: 'needs_include' };
  try {
    await assertTagsOwned(userId, [...new Set([...include, ...exclude])]);
  } catch {
    return { ok: false, reason: 'tag_not_owned' };
  }
  await db.$transaction([
    db.shareTag.deleteMany({ where: { shareId } }),
    db.shareTag.createMany({
      data: [
        ...include.map((tagId) => ({ shareId, tagId, exclude: false })),
        ...exclude.map((tagId) => ({ shareId, tagId, exclude: true })),
      ],
    }),
  ]);
  return { ok: true };
}

/** Remove a share (silent revoke for holders). */
export async function removeShare(userId: string, cardId: string, shareId: string): Promise<boolean> {
  if (!(await ownsShare(userId, cardId, shareId))) return false;
  await db.share.delete({ where: { id: shareId } });
  return true;
}

/** Owner-preview: A sees exactly what a holder sees right now (no CardHolder created). */
export async function ownerPreview(userId: string, cardId: string) {
  const card = await db.card.findFirst({ where: { id: cardId, userId } });
  if (!card) return null;
  const [tabs, feed] = await Promise.all([
    cardShareTabs(card.id),
    readerFeed({ cardId: card.id, cardOwnerId: userId, visibleUntil: card.visibleUntil, limit: 50 }),
  ]);
  return { title: card.title, tabs, notes: feed.notes };
}
