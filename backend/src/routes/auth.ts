import { Hono } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import { requestCode, verifyCode } from '../auth/otp';
import { createSession, revokeSession } from '../auth/session';
import { consume } from '../lib/rateLimit';
import { db } from '../db';
import type { AuthVars } from '../auth/middleware';

export const authRoutes = new Hono<AuthVars>();

authRoutes.post('/request-code', async (c) => {
  const { phone } = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  if (typeof phone !== 'string' || !/^\+?\d{8,15}$/.test(phone)) {
    return c.json({ error: 'bad_phone' }, 400);
  }
  const rl = await consume(`otp_send:${phone}`, 5, 10 * 60_000); // 5 / 10min
  if (!rl.allowed) return c.json({ error: 'rate_limited' }, 429);
  await requestCode(phone);
  return c.json({ ok: true });
});

authRoutes.post('/verify', async (c) => {
  const { phone, code } = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  if (typeof phone !== 'string' || typeof code !== 'string') {
    return c.json({ error: 'bad_input' }, 400);
  }
  const rl = await consume(`otp_verify:${phone}`, 10, 10 * 60_000);
  if (!rl.allowed) return c.json({ error: 'rate_limited' }, 429);

  const result = await verifyCode(phone, code);
  if (!result.ok) return c.json({ error: result.reason }, 401);

  const user = await db.user.upsert({ where: { phone }, create: { phone }, update: {} });
  const s = await createSession(user.id);

  // Web client: httpOnly cookie. Native client: token in body (store in Keychain).
  setCookie(c, 'session', s.id, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: process.env.NODE_ENV === 'production',
    expires: s.expiresAt,
    path: '/',
  });
  return c.json({ ok: true, token: s.id, user: { id: user.id, phone: user.phone } });
});

authRoutes.post('/logout', async (c) => {
  const auth = c.req.header('Authorization');
  const bearer = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
  const sid = bearer ?? getCookie(c, 'session');
  if (sid) await revokeSession(sid);
  deleteCookie(c, 'session', { path: '/' });
  return c.json({ ok: true });
});
