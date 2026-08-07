import { Hono } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import { requestCode, verifyCode } from '../auth/otp';
import { createSession, revokeSession } from '../auth/session';
import { consume } from '../lib/rateLimit';
import { db } from '../db';
import type { AuthVars } from '../auth/middleware';

export const authRoutes = new Hono<AuthVars>();

/** 归一化 = 幂等的登录标识。trim + 小写，因为邮箱域名部分大小写不敏感，而这一列
 *  是唯一键：`A@x.com` 和 `a@x.com` 不归一就是两个账号。2026-08-03 的手机号事故
 *  （带不带 +86 写法不同 ⇒ 分裂出空账号、笔记全在另一个号下）就是这么来的。
 *  本地部分严格来说大小写敏感，但现实中没有邮件服务商这么干，统一小写是安全的取舍。 */
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const normalizeEmail = (raw: string) => raw.trim().toLowerCase();

authRoutes.post('/request-code', async (c) => {
  const { email: raw } = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  if (typeof raw !== 'string') return c.json({ error: 'bad_email' }, 400);
  const email = normalizeEmail(raw);
  if (email.length > 254 || !EMAIL_RE.test(email)) return c.json({ error: 'bad_email' }, 400);

  const rl = await consume(`otp_send:${email}`, 5, 10 * 60_000); // 5 / 10min
  if (!rl.allowed) return c.json({ error: 'rate_limited' }, 429);

  try {
    await requestCode(email);
  } catch {
    // 发信挂了要如实说，否则用户会对着一个永远不会到的验证码等下去
    return c.json({ error: 'send_failed' }, 502);
  }
  return c.json({ ok: true });
});

authRoutes.post('/verify', async (c) => {
  const { email: raw, code } = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  if (typeof raw !== 'string' || typeof code !== 'string') {
    return c.json({ error: 'bad_input' }, 400);
  }
  const email = normalizeEmail(raw);
  const rl = await consume(`otp_verify:${email}`, 10, 10 * 60_000);
  if (!rl.allowed) return c.json({ error: 'rate_limited' }, 429);

  const result = await verifyCode(email, code);
  if (!result.ok) return c.json({ error: result.reason }, 401);

  const user = await db.user.upsert({ where: { email }, create: { email }, update: {} });
  const s = await createSession(user.id);

  // Web client: httpOnly cookie. Native client: token in body (store in Keychain).
  setCookie(c, 'session', s.id, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: process.env.NODE_ENV === 'production',
    expires: s.expiresAt,
    path: '/',
  });
  return c.json({ ok: true, token: s.id, user: { id: user.id, email: user.email } });
});

authRoutes.post('/logout', async (c) => {
  const auth = c.req.header('Authorization');
  const bearer = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
  const sid = bearer ?? getCookie(c, 'session');
  if (sid) await revokeSession(sid);
  deleteCookie(c, 'session', { path: '/' });
  return c.json({ ok: true });
});
