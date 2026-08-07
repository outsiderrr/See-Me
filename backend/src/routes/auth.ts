import { Hono } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import { requestCode, verifyCode } from '../auth/otp';
import { createSession, revokeSession } from '../auth/session';
import { consume } from '../lib/rateLimit';
import { clientIpRateKey } from '../lib/clientIp';
import { db } from '../db';
import type { AuthVars } from '../auth/middleware';

export const authRoutes = new Hono<AuthVars>();

/** 归一化 = 幂等的登录标识。trim + 小写，因为邮箱域名部分大小写不敏感，而这一列
 *  是唯一键：`A@x.com` 和 `a@x.com` 不归一就是两个账号。2026-08-03 的手机号事故
 *  （带不带 +86 写法不同 ⇒ 分裂出空账号、笔记全在另一个号下）就是这么来的。
 *  本地部分严格来说大小写敏感，但现实中没有邮件服务商这么干，统一小写是安全的取舍。 */
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const normalizeEmail = (raw: string) => raw.trim().toLowerCase();

/** 发码是唯一能让服务器替陌生人花钱、并以本站已验签域名对外发信的免认证端点。
 *  只按邮箱字符串限流拦不住：`you+1@x.com` 和 `you+2@x.com` 投到同一个信箱却是两个
 *  桶，换本地部分更是无限桶。所以按 IP 与全局各加一道（写法同 public.ts）——没有它，
 *  别人能拿 fathomlog.com 去轰炸任意邮箱、烧掉发信域名声誉，顺带打爆发信配额把
 *  作者自己关在门外。全局桶是最后一道闸：任何绕过手法都得从它下面过。 */
const SEND_IP = { limit: 20, windowMs: 10 * 60_000 };
const VERIFY_IP = { limit: 40, windowMs: 10 * 60_000 };
const SEND_GLOBAL = { limit: 200, windowMs: 60 * 60_000 };

const allowed = async (...checks: Promise<{ allowed: boolean }>[]) =>
  (await Promise.all(checks)).every((g) => g.allowed);

/** 登录 CSRF 防线。跨站 <form> 只能发 form-urlencoded / text-plain / multipart，
 *  发不出 application/json；不挡的话第三方页面能把你悄悄登进**攻击者的**账号，
 *  之后你写的一切都落在那边。Sec-Fetch-Site 是新浏览器的额外一层（老浏览器无此头，
 *  缺失时放行，靠 content-type 那道兜底）。 */
authRoutes.use('/request-code', csrfGuard);
authRoutes.use('/verify', csrfGuard);

async function csrfGuard(c: Parameters<Parameters<typeof authRoutes.use>[1]>[0], next: () => Promise<void>) {
  const ct = (c.req.header('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (ct !== 'application/json') return c.json({ error: 'bad_content_type' }, 415);
  const site = c.req.header('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return c.json({ error: 'cross_site' }, 403);
  await next();
}

authRoutes.post('/request-code', async (c) => {
  const { email: raw } = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  if (typeof raw !== 'string') return c.json({ error: 'bad_email' }, 400);
  const email = normalizeEmail(raw);
  if (email.length > 254 || !EMAIL_RE.test(email)) return c.json({ error: 'bad_email' }, 400);

  const ok = await allowed(
    consume(`otp_send:${email}`, 5, 10 * 60_000),
    consume(`otp_send_ip:${clientIpRateKey(c)}`, SEND_IP.limit, SEND_IP.windowMs),
    consume('otp_send_global', SEND_GLOBAL.limit, SEND_GLOBAL.windowMs),
  );
  if (!ok) return c.json({ error: 'rate_limited' }, 429);

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
  const ok = await allowed(
    consume(`otp_verify:${email}`, 10, 10 * 60_000),
    consume(`otp_verify_ip:${clientIpRateKey(c)}`, VERIFY_IP.limit, VERIFY_IP.windowMs),
  );
  if (!ok) return c.json({ error: 'rate_limited' }, 429);

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
