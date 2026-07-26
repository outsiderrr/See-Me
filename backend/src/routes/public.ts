import { Hono } from 'hono';
import type { Context } from 'hono';
import { db } from '../db';
import { clientIpRateKey } from '../lib/clientIp';
import { consume } from '../lib/rateLimit';
import { cardShareTabs, publicCardAccess, shareInCard } from '../permission/access';
import { parseCursor, readerCanAccessNote, readerFeed } from '../permission/engine';

/**
 * No-login reading for open cards (v2 §P2): `/c/<slug>` in the browser, this API
 * underneath. No session is read here — the route tree is mounted outside the
 * `/api/*` auth middleware — and nothing about the request is recorded against the
 * card. The permission engine is the same one the login path uses; only the way
 * the caller proves access differs (possession of the slug vs. a CardHolder row).
 */
export const publicRoutes = new Hono();

const PAGE = 20;

// Abuse control only. Buckets are keyed by a hashed caller address and NEVER by
// slug or card id: a card-scoped key would persist "this reader opened this card",
// which is precisely the signal open cards exist in order not to have
// (v2 §1 决策 3, 红线 #3). Feed budget covers header + pages; images get their own,
// larger budget because one screen of notes can legitimately pull dozens.
const FEED = { limit: 240, windowMs: 10 * 60_000 };
const IMAGE = { limit: 900, windowMs: 10 * 60_000 };
const GLOBAL = { limit: 3000, windowMs: 60_000 };

async function allow(c: Context, bucket: 'feed' | 'image'): Promise<boolean> {
  const budget = bucket === 'image' ? IMAGE : FEED;
  const gate = await Promise.all([
    consume(`public_${bucket}_ip:${clientIpRateKey(c)}`, budget.limit, budget.windowMs),
    consume('public_global', GLOBAL.limit, GLOBAL.windowMs),
  ]);
  return gate.every((g) => g.allowed);
}

/** A miss costs an extra hit, so probing for live links burns budget faster than
 *  reading a real one (same shape as the redeem limiter, spec §5). */
async function chargeMiss(c: Context): Promise<void> {
  await consume(`public_feed_ip:${clientIpRateKey(c)}`, FEED.limit, FEED.windowMs);
}

publicRoutes.use('*', async (c, next) => {
  // A shared link must never become a search result.
  c.header('X-Robots-Tag', 'noindex, nofollow');
  await next();
});

/** Card header: title, who shared it, and the share display names (tabs). */
publicRoutes.get('/:slug', async (c) => {
  if (!(await allow(c, 'feed'))) return c.json({ error: 'rate_limited' }, 429);
  const card = await publicCardAccess(c.req.param('slug'));
  if (!card) {
    await chargeMiss(c);
    return c.json({ error: 'not_found' }, 404);
  }
  const owner = await db.user.findUnique({ where: { id: card.userId }, select: { displayName: true } });
  // No masked-phone fallback here (unlike /api/my-cards): an open link is
  // world-readable, so nothing is ever derived from the author's phone number.
  return c.json({
    title: card.title,
    ownerName: owner?.displayName || null,
    tabs: await cardShareTabs(card.id),
  });
});

/** Feed: "recent" (default) or one share tab; keyset pagination per spec §3.2. */
publicRoutes.get('/:slug/notes', async (c) => {
  if (!(await allow(c, 'feed'))) return c.json({ error: 'rate_limited' }, 429);
  const card = await publicCardAccess(c.req.param('slug'));
  if (!card) {
    await chargeMiss(c);
    return c.json({ error: 'not_found' }, 404);
  }

  const tab = c.req.query('tab');
  let tabShareId: string | undefined;
  if (tab && tab !== 'recent') {
    if (!(await shareInCard(card.id, tab))) return c.json({ error: 'not_found' }, 404);
    tabShareId = tab;
  }

  const { notes, nextCursor } = await readerFeed({
    cardId: card.id,
    cardOwnerId: card.userId,
    visibleUntil: card.visibleUntil,
    tabShareId,
    limit: PAGE,
    cursor: parseCursor(c.req.query('cursor')),
  });
  return c.json({ notes, nextCursor });
});

/** Images re-run the same live predicate for their note before any byte is served. */
publicRoutes.get('/:slug/images/:imageId', async (c) => {
  if (!(await allow(c, 'image'))) return c.json({ error: 'rate_limited' }, 429);
  const card = await publicCardAccess(c.req.param('slug'));
  if (!card) {
    await chargeMiss(c);
    return c.json({ error: 'not_found' }, 404);
  }
  const image = await db.noteImage.findUnique({
    where: { id: c.req.param('imageId') },
    select: { noteId: true, data: true, mimeType: true },
  });
  if (!image || !(await readerCanAccessNote(card.id, card.userId, card.visibleUntil, image.noteId))) {
    return c.json({ error: 'not_found' }, 404);
  }
  // 'private' even on an anonymous route: revoking a share must not leave the
  // bytes sitting in a shared cache somewhere along the way.
  return c.body(Buffer.from(image.data), 200, {
    'Content-Type': image.mimeType,
    'Cache-Control': 'private, max-age=300',
  });
});
