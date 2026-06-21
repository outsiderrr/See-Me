import { randomInt } from 'node:crypto';
import { db } from '../db';
import { hmacHex, timingSafeEqualHex } from '../lib/hash';
import { getSmsSender } from '../lib/sms';

const TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: 'no_code' | 'expired' | 'locked' | 'mismatch' };

/** Generate a 6-digit code, store it hashed (single active row per phone), send via SMS.
 *  Resend preserves the existing attempts counter (no free brute-force reset). */
export async function requestCode(phone: string): Promise<void> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const codeHash = hmacHex(`${phone}:${code}`);
  const expiresAt = new Date(Date.now() + TTL_MS);

  await db.phoneOtp.upsert({
    where: { phone },
    create: { phone, codeHash, expiresAt },
    update: { codeHash, expiresAt, consumed: false }, // attempts intentionally untouched
  });

  await getSmsSender().send(phone, code);
}

/** Single-use, lockout after MAX_ATTEMPTS, constant-time compare. */
export async function verifyCode(phone: string, code: string): Promise<VerifyResult> {
  const row = await db.phoneOtp.findUnique({ where: { phone } });
  if (!row || row.consumed) return { ok: false, reason: 'no_code' };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, reason: 'locked' };
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, reason: 'expired' };

  if (!timingSafeEqualHex(row.codeHash, hmacHex(`${phone}:${code}`))) {
    await db.phoneOtp.update({ where: { phone }, data: { attempts: { increment: 1 } } });
    return { ok: false, reason: 'mismatch' };
  }

  await db.phoneOtp.update({ where: { phone }, data: { consumed: true } });
  return { ok: true };
}
