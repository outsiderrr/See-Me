import { Hono } from 'hono';
import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { AuthVars } from '../auth/middleware';
import { requireAuth } from '../auth/middleware';
import { consume } from '../lib/rateLimit';
import { redeemCode } from '../redeem';
import { readerCardAccess, cardShareTabs, shareInCard } from '../permission/access';
import { readerCanAccessNote, readerFeed } from '../permission/engine';
import { db } from '../db';

export const readerRoutes = new Hono<AuthVars>();
readerRoutes.use('*', requireAuth);

const PAGE = 20;

function clientIp(c: Context): string {
  const xff = c.req.header('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Redeem an invite code. Multi-layer rate limit (spec §5): per-user + per-IP + global,
 * with failures charged double so brute-force exhausts the budget far faster than legit
 * redemption. redeemCode returns an opaque 'unavailable' for both missing and self codes.
 */
readerRoutes.post('/redeem', async (c) => {
  const userId = c.get('userId')!;
  const ip = clientIp(c);
  const { code } = await c.req.json().catch(() => ({}) as Record<string, unknown>);

  const gate = await Promise.all([
    consume(`redeem_user:${userId}`, 30, 10 * 60_000),
    consume(`redeem_ip:${ip}`, 60, 10 * 60_000),
    consume('redeem_global', 600, 60_000),
  ]);
  if (gate.some((g) => !g.allowed)) return c.json({ error: 'rate_limited' }, 429);

  const r = await redeemCode(userId, code);
  if (r.ok) return c.json({ ok: true, cardId: r.cardId });

  // failures cost an extra hit against the same buckets (misses > hits)
  await Promise.all([
    consume(`redeem_user:${userId}`, 30, 10 * 60_000),
    consume(`redeem_ip:${ip}`, 60, 10 * 60_000),
  ]);
  return c.json({ error: r.reason }, r.reason === 'invalid' ? 400 : 404);
});

/** B's list of held cards. */
readerRoutes.get('/my-cards', async (c) => {
  const holdings = await db.cardHolder.findMany({
    where: { userId: c.get('userId')! },
    include: {
      card: {
        select: {
          id: true,
          title: true,
          user: { select: { displayName: true, phone: true } },
        },
      },
    },
    orderBy: { redeemedAt: 'desc' },
  });
  return c.json({
    cards: holdings.map((h) => ({
      id: h.card.id,
      title: h.card.title,
      ownerName: h.card.user.displayName || maskPhone(h.card.user.phone),
    })),
  });
});

function maskPhone(phone: string): string {
  if (phone.length < 7) return phone;
  return phone.slice(0, 3) + '••••' + phone.slice(-4);
}

/** Reader card header: title + tabs (share display names). Access-guarded. */
readerRoutes.get('/read/:cardId', async (c) => {
  const card = await readerCardAccess(c.req.param('cardId'), c.get('userId')!);
  if (!card) return c.json({ error: 'not_found' }, 404);
  return c.json({ title: card.title, tabs: await cardShareTabs(card.id) });
});

/** Reader feed: "recent" (default) or a specific share tab; keyset pagination. */
readerRoutes.get('/read/:cardId/notes', async (c) => {
  const card = await readerCardAccess(c.req.param('cardId'), c.get('userId')!);
  if (!card) return c.json({ error: 'not_found' }, 404);

  const tab = c.req.query('tab');
  let tabShareId: string | undefined;
  if (tab && tab !== 'recent') {
    if (!(await shareInCard(card.id, tab))) return c.json({ error: 'not_found' }, 404);
    tabShareId = tab;
  }

  // cursor = "<createdAtRaw>_<id>"; createdAtRaw and cuid contain no '_'. A malformed
  // cursor is simply ignored (page 1) — no Date parsing, so it can never crash the feed.
  let cursor: { createdAtRaw: string; id: string } | undefined;
  const craw = c.req.query('cursor');
  if (craw) {
    const idx = craw.lastIndexOf('_');
    if (idx > 0 && idx < craw.length - 1) cursor = { createdAtRaw: craw.slice(0, idx), id: craw.slice(idx + 1) };
  }

  const { notes, nextCursor } = await readerFeed({
    cardId: card.id,
    cardOwnerId: card.userId,
    visibleUntil: card.visibleUntil,
    tabShareId,
    limit: PAGE,
    cursor,
  });
  return c.json({ notes, nextCursor });
});

readerRoutes.get('/read/:cardId/images/:imageId', async (c) => {
  const card = await readerCardAccess(c.req.param('cardId'), c.get('userId')!);
  if (!card) return c.json({ error: 'not_found' }, 404);
  const image = await db.noteImage.findUnique({
    where: { id: c.req.param('imageId') },
    select: { noteId: true, data: true, mimeType: true },
  });
  if (!image || !(await readerCanAccessNote(card.id, card.userId, card.visibleUntil, image.noteId))) {
    return c.json({ error: 'not_found' }, 404);
  }
  return c.body(Buffer.from(image.data), 200, {
    'Content-Type': image.mimeType,
    'Cache-Control': 'private, max-age=300',
  });
});
