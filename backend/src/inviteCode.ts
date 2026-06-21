import { randomInt } from 'node:crypto';
import { db } from './db';

/** 32-char alphabet, excludes look-alikes 0 O 1 I L (spec §5/A17). Space ~32^4 ≈ 1.05M. */
export const INVITE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export async function generateUniqueInviteCode(): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    let code = '';
    for (let i = 0; i < 4; i++) code += INVITE_ALPHABET[randomInt(0, INVITE_ALPHABET.length)];
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
  if (up.length !== 4) return null;
  for (const ch of up) if (!INVITE_ALPHABET.includes(ch)) return null;
  return up;
}
