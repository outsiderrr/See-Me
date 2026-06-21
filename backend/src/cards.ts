import type { Card, CardTag, Tag } from '@prisma/client';
import { db } from './db';
import { assertTagsOwned } from './own';
import { generateUniqueInviteCode } from './inviteCode';

const withCardTags = { cardTags: { include: { tag: true } } } as const;
export type CardWithTags = Card & { cardTags: (CardTag & { tag: Tag })[] };

/** Owner-side card DTO. NEVER includes holders (§4 #7: A sees no holder info in MVP). */
export function cardDto(card: CardWithTags) {
  return {
    id: card.id,
    title: card.title,
    inviteCode: card.inviteCode,
    visibleUntil: card.visibleUntil,
    createdAt: card.createdAt,
    tags: card.cardTags.map((ct) => ({ id: ct.tag.id, name: ct.tag.name, isAutoUpdate: ct.isAutoUpdate })),
  };
}

export async function createCard(
  userId: string,
  title: string,
  tags: { tagId: string; autoUpdate?: boolean }[],
): Promise<CardWithTags> {
  await assertTagsOwned(userId, tags.map((t) => t.tagId));
  const inviteCode = await generateUniqueInviteCode();
  return db.card.create({
    data: {
      userId,
      title,
      inviteCode,
      visibleUntil: new Date(),
      cardTags: { create: tags.map((t) => ({ tagId: t.tagId, isAutoUpdate: !!t.autoUpdate })) },
    },
    include: withCardTags,
  });
}

export async function listCards(userId: string): Promise<CardWithTags[]> {
  return db.card.findMany({ where: { userId }, include: withCardTags, orderBy: { createdAt: 'desc' } });
}

export async function getOwnCard(userId: string, cardId: string): Promise<CardWithTags | null> {
  return db.card.findFirst({ where: { id: cardId, userId }, include: withCardTags });
}

export async function advanceTime(userId: string, cardId: string): Promise<boolean> {
  const r = await db.card.updateMany({ where: { id: cardId, userId }, data: { visibleUntil: new Date() } });
  return r.count > 0;
}

export async function addCardTag(
  userId: string,
  cardId: string,
  tagId: string,
  autoUpdate: boolean,
): Promise<{ ok: boolean; reason?: 'not_found' }> {
  const card = await db.card.findFirst({ where: { id: cardId, userId }, select: { id: true } });
  if (!card) return { ok: false, reason: 'not_found' };
  await assertTagsOwned(userId, [tagId]);
  await db.cardTag.upsert({
    where: { cardId_tagId: { cardId, tagId } },
    create: { cardId, tagId, isAutoUpdate: autoUpdate },
    update: { isAutoUpdate: autoUpdate },
  });
  return { ok: true };
}

/** Remove a tag from the pool. Holders silently lose any notes only that tag authorized (§4). */
export async function removeCardTag(userId: string, cardId: string, tagId: string): Promise<boolean> {
  const card = await db.card.findFirst({ where: { id: cardId, userId }, select: { id: true } });
  if (!card) return false;
  await db.cardTag.deleteMany({ where: { cardId, tagId } });
  return true;
}

export async function setCardTagAuto(
  userId: string,
  cardId: string,
  tagId: string,
  autoUpdate: boolean,
): Promise<boolean> {
  const card = await db.card.findFirst({ where: { id: cardId, userId }, select: { id: true } });
  if (!card) return false;
  const r = await db.cardTag.updateMany({ where: { cardId, tagId }, data: { isAutoUpdate: autoUpdate } });
  return r.count > 0;
}

export async function rotateCode(userId: string, cardId: string): Promise<string | null> {
  const card = await db.card.findFirst({ where: { id: cardId, userId }, select: { id: true } });
  if (!card) return null;
  const inviteCode = await generateUniqueInviteCode();
  await db.card.update({ where: { id: cardId }, data: { inviteCode } });
  return inviteCode;
}
