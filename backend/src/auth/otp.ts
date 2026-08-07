import { randomInt } from 'node:crypto';
import { db } from '../db';
import { hmacHex, timingSafeEqualHex } from '../lib/hash';
import { getMailSender } from '../lib/mailer';

const TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: 'no_code' | 'expired' | 'locked' | 'mismatch' };

/** Generate a 6-digit code, store it hashed (single active row per address), email it.
 *  Resend preserves the existing attempts counter (no free brute-force reset).
 *  调用方保证 email 已归一化（trim + 小写）——它是主键，写法飘了就是两个不同的桶。 */
export async function requestCode(email: string): Promise<void> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const codeHash = hmacHex(`${email}:${code}`);
  const expiresAt = new Date(Date.now() + TTL_MS);

  await db.emailOtp.upsert({
    where: { email },
    create: { email, codeHash, expiresAt },
    update: { codeHash, expiresAt, consumed: false }, // attempts intentionally untouched
  });

  // 发信失败必须抛出去：写了行却没送达，用户会对着一个永远等不到的码干等
  await getMailSender().send(email, code);
}

/** Single-use, lockout after MAX_ATTEMPTS, constant-time compare. */
export async function verifyCode(email: string, code: string): Promise<VerifyResult> {
  const row = await db.emailOtp.findUnique({ where: { email } });
  if (!row || row.consumed) return { ok: false, reason: 'no_code' };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, reason: 'locked' };
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, reason: 'expired' };

  if (!timingSafeEqualHex(row.codeHash, hmacHex(`${email}:${code}`))) {
    await db.emailOtp.update({ where: { email }, data: { attempts: { increment: 1 } } });
    return { ok: false, reason: 'mismatch' };
  }

  await db.emailOtp.update({ where: { email }, data: { consumed: true } });
  return { ok: true };
}
