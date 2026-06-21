import type { Card } from '@prisma/client';
import { db } from '../db';

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
