import { randomInt } from 'node:crypto';
import { db } from './db';

/** 31-char alphabet (8 digits 2-9 + 23 letters; excludes look-alikes 0 O 1 I L).
 *  Keyspace = 31^8 ≈ 852 billion. Redeem remains multi-layer rate-limited. */
export const INVITE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const INVITE_CODE_LENGTH = 8;

export async function generateUniqueInviteCode(): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    let code = '';
    for (let i = 0; i < INVITE_CODE_LENGTH; i++) code += INVITE_ALPHABET[randomInt(0, INVITE_ALPHABET.length)];
    const exists = await db.card.findUnique({ where: { inviteCode: code }, select: { id: true } });
    if (!exists) return code;
  }
  throw new Error('code_generation_failed');
}

/** Normalize a user-typed code: strip whitespace, ASCII-uppercase (locale-invariant),
 *  validate against the exact charset. Returns null if invalid (no silent mapping). */
export function normalizeInviteCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const up = input.replace(/\s+/g, '').toUpperCase();
  if (up.length !== INVITE_CODE_LENGTH) return null;
  for (const ch of up) if (!INVITE_ALPHABET.includes(ch)) return null;
  return up;
}
