import { randomInt } from 'node:crypto';
import { db } from './db';
import { INVITE_ALPHABET } from './inviteCode';

/**
 * Open-card link slug (v2 §P2). Same look-alike-free alphabet as the invite code,
 * but 14 chars: an invite code is protected by redeem rate limiting on top of a
 * logged-in account, whereas the slug alone grants access to anyone who has it.
 * Keyspace = 31^14 ≈ 2.4 × 10^20 — unguessable without relying on the limiter.
 */
export const PUBLIC_SLUG_LENGTH = 14;

export async function generateUniquePublicSlug(): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    let slug = '';
    for (let i = 0; i < PUBLIC_SLUG_LENGTH; i++) slug += INVITE_ALPHABET[randomInt(0, INVITE_ALPHABET.length)];
    const exists = await db.card.findUnique({ where: { publicSlug: slug }, select: { id: true } });
    if (!exists) return slug;
  }
  throw new Error('slug_generation_failed');
}

/** Same normalization discipline as the invite code (spec §5): strip whitespace,
 *  ASCII-uppercase (locale-invariant), validate against the exact charset. Returns
 *  null for anything malformed — a junk URL never reaches the database. */
export function normalizePublicSlug(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const up = input.replace(/\s+/g, '').toUpperCase();
  if (up.length !== PUBLIC_SLUG_LENGTH) return null;
  for (const ch of up) if (!INVITE_ALPHABET.includes(ch)) return null;
  return up;
}
