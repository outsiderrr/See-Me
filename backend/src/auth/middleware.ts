import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import { validateSession } from './session';

export type AuthVars = { Variables: { userId: string | null } };

function sessionIdFrom(c: Context): string | undefined {
  const auth = c.req.header('Authorization');
  const bearer = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
  return bearer ?? getCookie(c, 'session');
}

/** Reads session from Bearer header (native app) or cookie (web), sets userId (or null). */
export const withUser = createMiddleware<AuthVars>(async (c, next) => {
  const sid = sessionIdFrom(c);
  const userId = sid ? (await validateSession(sid))?.userId ?? null : null;
  c.set('userId', userId);
  await next();
});

/** Guards protected routes; must run after withUser. */
export const requireAuth = createMiddleware<AuthVars>(async (c, next) => {
  if (!c.get('userId')) return c.json({ error: 'unauthorized' }, 401);
  await next();
});
