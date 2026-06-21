import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { db } from './db';
import { env } from './env';
import { withUser, requireAuth, type AuthVars } from './auth/middleware';
import { authRoutes } from './routes/auth';

export function buildApp() {
  const app = new Hono<AuthVars>();

  app.use('*', withUser);

  app.get('/health', async (c) => {
    await db.$queryRaw`SELECT 1`;
    return c.json({ ok: true, service: 'see-me-backend' });
  });

  app.route('/api/auth', authRoutes);

  app.get('/api/me', requireAuth, async (c) => {
    const userId = c.get('userId')!;
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, phone: true, displayName: true },
    });
    return c.json({ user });
  });

  return app;
}

export function startServer() {
  const app = buildApp();
  const port = env.port();
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`[see-me] backend listening on http://localhost:${info.port}`);
  });
  return app;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}
