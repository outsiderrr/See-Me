import { db } from './db';
import { normalizeInviteCode } from './inviteCode';

export type RedeemResult =
  | { ok: true; cardId: string }
  | { ok: false; reason: 'invalid' | 'unavailable' };

/**
 * Bind a card to the current user via its invite code. Idempotent.
 * Self-redeem is rejected, AND it returns the SAME opaque 'unavailable' as a
 * non-existent code — so a well-formed code never reveals whether a card exists
 * (no enumeration oracle, spec §3.0 #2). 'invalid' is format-only (leaks nothing).
 */
export async function redeemCode(userId: string, rawCode: unknown): Promise<RedeemResult> {
  const code = normalizeInviteCode(rawCode);
  if (!code) return { ok: false, reason: 'invalid' };
  const card = await db.card.findUnique({
    where: { inviteCode: code },
    select: { id: true, userId: true, kind: true },
  });
  // An open card is link-only: binding a CardHolder to it would create exactly the
  // reader record the kind is defined by not having (v2 §1 决策 3). Same opaque
  // 'unavailable' as a missing card, so the response still leaks nothing.
  if (!card || card.userId === userId || card.kind === 'open') return { ok: false, reason: 'unavailable' };
  await db.cardHolder.upsert({
    where: { cardId_userId: { cardId: card.id, userId } },
    create: { cardId: card.id, userId },
    update: {},
  });
  return { ok: true, cardId: card.id };
}
