import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { db } from './db';
import { env } from './env';

export function buildApp() {
  const app = new Hono();

  app.get('/health', async (c) => {
    await db.$queryRaw`SELECT 1`;
    return c.json({ ok: true, service: 'see-me-backend' });
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

// When run directly (production: `tsx src/server.ts` with DATABASE_URL preset).
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}
