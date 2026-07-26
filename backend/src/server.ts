import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { db } from './db';
import { env } from './env';
import { withUser, requireAuth, type AuthVars } from './auth/middleware';
import { authRoutes } from './routes/auth';
import { noteRoutes } from './routes/notes';
import { tagRoutes } from './routes/tags';
import { cardRoutes } from './routes/cards';
import { readerRoutes } from './routes/reader';
import { publicRoutes } from './routes/public';

/**
 * Asset version stamped onto every local .js/.css URL in the HTML shells. There is no
 * build step, so filenames carry no content hash and a cached bundle would otherwise
 * survive a deploy — and a stale front end renders wrong state silently instead of
 * failing loudly. The container restarts on every deploy, so start time is exactly the
 * right granularity: new deploy ⇒ new URLs ⇒ guaranteed fresh, no churn in between.
 */
const ASSET_V = Date.now().toString(36);
const stampAssets = (html: string) => html.replace(/(src|href)="(\/[^"]+\.(?:js|css))"/g, `$1="$2?v=${ASSET_V}"`);

async function shell(file: string, cache: { html: string | null }): Promise<string> {
  cache.html ??= stampAssets(await readFile(file, 'utf8'));
  return cache.html;
}

const readerShell = { html: null as string | null };
const consoleShell = { html: null as string | null };

export function buildApp() {
  const app = new Hono<AuthVars>();

  app.onError((err, c) => {
    console.error('[see-me] unhandled error:', err);
    return c.json({ error: 'internal' }, 500);
  });

  app.use('/api/*', withUser);

  app.get('/health', async (c) => {
    await db.$queryRaw`SELECT 1`;
    return c.json({ ok: true, service: 'see-me-backend' });
  });

  app.route('/api/auth', authRoutes);
  app.route('/api/notes', noteRoutes);
  app.route('/api/tags', tagRoutes);
  app.route('/api/cards', cardRoutes);
  app.route('/api', readerRoutes);

  // Open cards: JSON under /public/*, mounted OUTSIDE the /api/* auth middleware so
  // no session is ever read on that path, and the pretty link at /c/<slug>.
  app.route('/public', publicRoutes);
  app.get('/c/:slug', async (c) => {
    c.header('X-Robots-Tag', 'noindex, nofollow');
    c.header('Cache-Control', 'no-cache');
    return c.html(await shell('./public/index.html', readerShell));
  });

  app.get('/api/me', requireAuth, async (c) => {
    const userId = c.get('userId')!;
    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        phone: true,
        displayName: true,
        createdAt: true,
        _count: { select: { notes: true, tags: true } },
      },
    });
    if (!user) return c.json({ error: 'not_found' }, 404);
    return c.json({
      user: {
        id: user.id,
        phone: user.phone,
        displayName: user.displayName,
        createdAt: user.createdAt,
        noteCount: user._count.notes,
        tagCount: user._count.tags,
      },
    });
  });

  /** The one writable field on the profile: the name a reader sees above an open
   *  card ("X 分享给你"). Nothing else about the account is editable, and the phone
   *  number is never derived from — an open link is world-readable. */
  app.patch('/api/me', requireAuth, async (c) => {
    const { displayName } = await c.req.json().catch(() => ({}) as Record<string, unknown>);
    if (displayName !== null && typeof displayName !== 'string') return c.json({ error: 'bad_input' }, 400);
    const name = typeof displayName === 'string' ? displayName.trim() : '';
    if (name && Array.from(name).length > 24) return c.json({ error: 'too_long' }, 400);
    await db.user.update({ where: { id: c.get('userId')! }, data: { displayName: name || null } });
    return c.json({ ok: true, displayName: name || null });
  });

  // A console (vanilla JS, paper design) — the SPA shell; assets load from /console/.
  app.get('/console', async (c) => {
    c.header('Cache-Control', 'no-cache');
    return c.html(await shell('./public/console/index.html', consoleShell));
  });

  // The B login page: same stamping, so its bundle can't go stale either.
  app.get('/', async (c) => {
    c.header('Cache-Control', 'no-cache');
    return c.html(await shell('./public/index.html', readerShell));
  });

  // Front-end assets must revalidate on every load. There is no build step and no
  // content hash in the filenames, so a cached bundle survives a deploy — and a stale
  // console silently renders wrong state rather than failing loudly. 'no-cache' still
  // allows a 304, so the cost is one conditional request per asset.
  app.use('/*', async (c, next) => {
    await next();
    const p = c.req.path;
    if (p.endsWith('.js') || p.endsWith('.css') || p.endsWith('.html')) c.header('Cache-Control', 'no-cache');
  });

  // B reading web (vanilla JS) served from ./public; must be the last (catch-all) route.
  app.use('/*', serveStatic({ root: './public' }));

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
