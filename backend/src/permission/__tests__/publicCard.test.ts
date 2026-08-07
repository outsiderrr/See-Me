import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../server';
import { db } from '../../db';
import { rotateCode } from '../../cards';
import { redeemCode } from '../../redeem';
import { resetDb, makeUser, makeTag, makeNote, makeCard, makeOpenCard, makeImage, testSlug } from '../../test/helpers';

const T0 = new Date('2026-01-01T00:00:00.000Z');
const CUTOFF = new Date('2026-01-02T00:00:00.000Z');
const AFTER = new Date('2026-01-03T00:00:00.000Z');

const IP = '203.0.113.9';
const app = buildApp();
const get = (path: string) => app.request(path, { headers: { 'x-forwarded-for': IP } });

const KIND_SLUG_CHECK = `CHECK (("kind" = 'open' AND "public_slug" IS NOT NULL) OR ("kind" = 'private' AND "public_slug" IS NULL))`;

describe('open cards: no-login reading (v2 P2)', () => {
  beforeEach(resetDb);

  it('an open card is readable with no session at all', async () => {
    const a = await makeUser('林之');
    const t = await makeTag(a.id, '日常');
    const card = await makeOpenCard(a.id, CUTOFF, [{ name: '日常', include: [t.id] }], { title: '给想更了解我的人' });
    await makeNote(a.id, 'hello', [t.id], T0);

    const head = await get(`/public/${card.publicSlug}`);
    expect(head.status).toBe(200);
    expect(head.headers.get('x-robots-tag')).toContain('noindex');
    const header = await head.json();
    expect(header.title).toBe('给想更了解我的人');
    expect(header.ownerName).toBe('林之');
    expect(header.tabs.map((t: { name: string }) => t.name)).toEqual(['日常']);

    const feed = await (await get(`/public/${card.publicSlug}/notes`)).json();
    expect(feed.notes.map((n: { body: string }) => n.body)).toEqual(['hello']);
  });

  it('the header never derives anything from the author phone number', async () => {
    const a = await makeUser(); // no display name
    const t = await makeTag(a.id, 't');
    const card = await makeOpenCard(a.id, CUTOFF, [{ include: [t.id] }]);
    const raw = await (await get(`/public/${card.publicSlug}`)).text();
    const phone = (await db.user.findUniqueOrThrow({ where: { id: a.id } })).phone;
    expect(JSON.parse(raw).ownerName).toBeNull();
    expect(raw).not.toContain(phone.slice(-4));
  });

  it('a login card can never carry a public slug, and its ids are not public keys', async () => {
    const a = await makeUser();
    const t = await makeTag(a.id, 't');
    const card = await makeCard(a.id, CUTOFF, [{ include: [t.id] }]);
    await makeNote(a.id, 'private note', [t.id], T0);

    // the DB itself refuses the dangerous state
    await expect(db.card.update({ where: { id: card.id }, data: { publicSlug: testSlug() } })).rejects.toThrow();

    expect((await get(`/public/${card.id}`)).status).toBe(404);
    expect((await get(`/public/${card.inviteCode}`)).status).toBe(404);
    expect((await get(`/public/${testSlug()}`)).status).toBe(404);
  });

  it('defense in depth: without the DB constraint the route still refuses a login card', async () => {
    const a = await makeUser();
    const t = await makeTag(a.id, 't');
    const card = await makeOpenCard(a.id, CUTOFF, [{ include: [t.id] }]);
    await makeNote(a.id, 'secret', [t.id], T0);
    expect((await get(`/public/${card.publicSlug}`)).status).toBe(200);

    await db.$executeRawUnsafe('ALTER TABLE "cards" DROP CONSTRAINT "cards_kind_slug_ck"');
    try {
      await db.$executeRawUnsafe(`UPDATE "cards" SET "kind" = 'private' WHERE "id" = $1`, card.id);
      expect((await get(`/public/${card.publicSlug}`)).status).toBe(404);
      expect((await get(`/public/${card.publicSlug}/notes`)).status).toBe(404);
    } finally {
      await db.$executeRawUnsafe(`UPDATE "cards" SET "kind" = 'open' WHERE "id" = $1`, card.id);
      await db.$executeRawUnsafe(`ALTER TABLE "cards" ADD CONSTRAINT "cards_kind_slug_ck" ${KIND_SLUG_CHECK}`);
    }
  });

  it('the reader DTO whitelist holds on the public path (no updated_at, no tag names)', async () => {
    const a = await makeUser();
    const pool = await makeTag(a.id, '可分享');
    const secret = await makeTag(a.id, '不能说的标签');
    const card = await makeOpenCard(a.id, CUTOFF, [{ name: '随想', include: [pool.id] }]);
    await makeNote(a.id, 'n', [pool.id, secret.id], T0);

    const raw = await (await get(`/public/${card.publicSlug}/notes`)).text();
    expect(raw).not.toContain('不能说的标签');
    expect(raw).not.toContain('可分享');
    expect(raw).not.toContain('updatedAt');
    expect(raw).not.toContain('updated_at');
    const note = JSON.parse(raw).notes[0];
    expect(Object.keys(note).sort()).toEqual(['body', 'createdAt', 'id', 'images', 'shares', 'topic']);
    expect(note.shares.map((s: { name: string }) => s.name)).toEqual(['随想']);
  });

  it('cutoff and exclusion govern the public path exactly as they do the login path', async () => {
    const a = await makeUser();
    const t = await makeTag(a.id, 't');
    const x = await makeTag(a.id, '私密');
    const card = await makeOpenCard(a.id, CUTOFF, [{ name: 'frozen', include: [t.id], exclude: [x.id] }]);
    await makeNote(a.id, 'visible', [t.id], CUTOFF);
    await makeNote(a.id, 'too late', [t.id], AFTER);
    await makeNote(a.id, 'excluded', [t.id, x.id], T0);
    await makeNote(a.id, 'untagged', [], T0);

    const feed = await (await get(`/public/${card.publicSlug}/notes`)).json();
    expect(feed.notes.map((n: { body: string }) => n.body)).toEqual(['visible']);
  });

  it('an unknown share id as ?tab is rejected instead of widening the feed', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const t = await makeTag(a.id, 't');
    const bt = await makeTag(b.id, 'bt');
    const card = await makeOpenCard(a.id, CUTOFF, [{ include: [t.id] }]);
    const other = await makeCard(b.id, CUTOFF, [{ include: [bt.id] }]);

    expect((await get(`/public/${card.publicSlug}/notes?tab=${other.shares[0].id}`)).status).toBe(404);
    expect((await get(`/public/${card.publicSlug}/notes?tab=nope`)).status).toBe(404);
    expect((await get(`/public/${card.publicSlug}/notes?tab=recent`)).status).toBe(200);
  });

  it('keyset pagination pages through without gaps; a malformed cursor falls back to page 1', async () => {
    const a = await makeUser();
    const t = await makeTag(a.id, 't');
    const card = await makeOpenCard(a.id, CUTOFF, [{ include: [t.id] }]);
    for (let i = 0; i < 25; i++) await makeNote(a.id, `n${i}`, [t.id], new Date(T0.getTime() + i * 1000));

    const p1 = await (await get(`/public/${card.publicSlug}/notes`)).json();
    expect(p1.notes).toHaveLength(20);
    expect(p1.nextCursor).toBeTruthy();

    const p2 = await (
      await get(`/public/${card.publicSlug}/notes?cursor=${encodeURIComponent(p1.nextCursor)}`)
    ).json();
    expect(p2.notes).toHaveLength(5);
    expect(p2.nextCursor).toBeNull();

    const seen = [...p1.notes, ...p2.notes].map((n: { id: string }) => n.id);
    expect(new Set(seen).size).toBe(25);

    const junk = await (await get(`/public/${card.publicSlug}/notes?cursor=___`)).json();
    expect(junk.notes.map((n: { id: string }) => n.id)).toEqual(p1.notes.map((n: { id: string }) => n.id));
  });

  it('images are served only for notes the card actually authorizes', async () => {
    const a = await makeUser();
    const t = await makeTag(a.id, 't');
    const card = await makeOpenCard(a.id, CUTOFF, [{ include: [t.id] }]);
    const shown = await makeNote(a.id, 'shown', [t.id], T0);
    const hidden = await makeNote(a.id, 'hidden', [], T0);
    const okImage = await makeImage(shown.id);
    const secretImage = await makeImage(hidden.id);

    const ok = await get(`/public/${card.publicSlug}/images/${okImage.id}`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toContain('private');
    expect((await get(`/public/${card.publicSlug}/images/${secretImage.id}`)).status).toBe(404);
    expect((await get(`/public/${testSlug()}/images/${okImage.id}`)).status).toBe(404);
  });

  it('rotating an open card kills the old link and mints a new one', async () => {
    const a = await makeUser();
    const t = await makeTag(a.id, 't');
    const card = await makeOpenCard(a.id, CUTOFF, [{ include: [t.id] }]);
    await makeNote(a.id, 'n', [t.id], T0);

    const rotated = await rotateCode(a.id, card.id);
    expect(rotated!.publicSlug).toBeTruthy();
    expect(rotated!.publicSlug).not.toBe(card.publicSlug);
    expect((await get(`/public/${card.publicSlug}`)).status).toBe(404);
    expect((await get(`/public/${rotated!.publicSlug}`)).status).toBe(200);
  });

  it('rotating a login card leaves it slug-free', async () => {
    const a = await makeUser();
    const t = await makeTag(a.id, 't');
    const card = await makeCard(a.id, CUTOFF, [{ include: [t.id] }]);
    const rotated = await rotateCode(a.id, card.id);
    expect(rotated!.publicSlug).toBeNull();
    expect((await db.card.findUniqueOrThrow({ where: { id: card.id } })).publicSlug).toBeNull();
  });

  it('an open card keeps zero reader records: its invite code cannot be redeemed', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const t = await makeTag(a.id, 't');
    const open = await makeOpenCard(a.id, CUTOFF, [{ include: [t.id] }]);
    const login = await makeCard(a.id, CUTOFF, [{ include: [t.id] }]);

    expect(await redeemCode(b.id, open.inviteCode)).toEqual({ ok: false, reason: 'unavailable' });
    expect(await db.cardHolder.count()).toBe(0);
    expect((await redeemCode(b.id, login.inviteCode)).ok).toBe(true); // login cards unaffected
  });

  it('a lowercased or padded link still resolves; junk never reaches a card', async () => {
    const a = await makeUser();
    const t = await makeTag(a.id, 't');
    const card = await makeOpenCard(a.id, CUTOFF, [{ include: [t.id] }]);

    expect((await get(`/public/${card.publicSlug.toLowerCase()}`)).status).toBe(200);
    expect((await get(`/public/${card.publicSlug.slice(0, 13)}`)).status).toBe(404);
    expect((await get(`/public/${card.publicSlug}X`)).status).toBe(404);
    expect((await get('/public/OOOOOOOOOOOOOO')).status).toBe(404); // charset outsiders
  });

  it('public reads are rate limited, and no limit key identifies the card or the reader', async () => {
    const a = await makeUser();
    const t = await makeTag(a.id, 't');
    const card = await makeOpenCard(a.id, CUTOFF, [{ include: [t.id] }]);

    expect((await get(`/public/${card.publicSlug}`)).status).toBe(200);
    const keys = (await db.rateLimit.findMany({ select: { key: true } })).map((r) => r.key);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key).not.toContain(card.publicSlug);
      expect(key).not.toContain(card.id);
      expect(key).not.toContain(IP);
    }

    const bucket = keys.find((k) => k.startsWith('public_feed_ip:'))!;
    expect(bucket).toBeTruthy();
    await db.rateLimit.update({
      where: { key: bucket },
      data: { count: 1_000_000, windowEnd: new Date(Date.now() + 600_000) },
    });
    expect((await get(`/public/${card.publicSlug}`)).status).toBe(429);
  });

  it('/c/<slug> serves the reader shell and asks robots to stay out', async () => {
    const res = await app.request('/c/PUBTEST2222222');
    expect(res.status).toBe(200);
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
    expect(await res.text()).toContain('id="app"');
  });
});
