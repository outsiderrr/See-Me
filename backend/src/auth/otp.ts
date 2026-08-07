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
    // attempts 必须跟着新码归零。旧版刻意不清零，本意是防「重发即免费重置爆破」，
    // 但那让锁定变成**永久**的：verifyCode 先查 attempts 再比对，锁上以后连正确的
    // 新码都进不来，只能改库救。而任何人只要知道你的邮箱，6 个请求就能把你锁死。
    // 爆破面另有两道限流兜着（签发 5 次/10 分钟、校验 10 次/10 分钟，且都加了 IP
    // 与全局桶），10 分钟内至多几十次猜测对 10^6 的空间，可以忽略。
    update: { codeHash, expiresAt, consumed: false, attempts: 0 },
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

  // 成功即清零：错几次再登录成功后，下一轮该有完整的 5 次机会
  await db.emailOtp.update({ where: { email }, data: { consumed: true, attempts: 0 } });
  return { ok: true };
}
