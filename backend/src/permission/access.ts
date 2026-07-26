import type { Card } from '@prisma/client';
import { db } from '../db';
import { normalizePublicSlug } from '../publicSlug';

/**
 * Reader access guard (spec §3.0 / §4 #5): cardOwnerId is ALWAYS derived from the
 * Card row (never client input), and the caller must hold a CardHolder binding.
 * Returns null for both "no card" and "not a holder" so existence isn't leaked.
 */
export async function readerCardAccess(cardId: string, userId: string): Promise<Card | null> {
  const card = await db.card.findUnique({ where: { id: cardId } });
  if (!card) return null;
  const holder = await db.cardHolder.findUnique({ where: { cardId_userId: { cardId, userId } } });
  if (!holder) return null;
  return card;
}

/**
 * No-login card lookup (v2 §P2). Same IDOR discipline as readerCardAccess — the
 * owner is derived from the Card row, never from the request — with the holder
 * check replaced by possession of the slug. `kind: 'open'` is filtered explicitly
 * (v2 红线 #6) on top of the DB constraint that forbids a private card from ever
 * holding a slug; either guard alone would be enough, which is the point.
 * A malformed slug is rejected before it reaches the database.
 */
export async function publicCardAccess(rawSlug: string): Promise<Card | null> {
  const publicSlug = normalizePublicSlug(rawSlug);
  if (!publicSlug) return null;
  return db.card.findFirst({ where: { publicSlug, kind: 'open' } });
}

/** Reader tabs = the card's shares (display names only). Constituent tags never leak. */
export async function cardShareTabs(cardId: string): Promise<{ id: string; name: string }[]> {
  const shares = await db.share.findMany({
    where: { cardId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true },
  });
  return shares.map((s) => ({ id: s.id, name: s.name }));
}

/** True iff the given share belongs to the card (used to validate a tab param). */
export async function shareInCard(cardId: string, shareId: string): Promise<boolean> {
  return !!(await db.share.findFirst({ where: { id: shareId, cardId }, select: { id: true } }));
}
