import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../server';
import { db } from '../../db';
import { deleteCard } from '../../cards';
import { readerCardAccess } from '../access';
import { resetDb, makeUser, makeTag, makeNote, makeCard, makeOpenCard } from '../../test/helpers';

const T0 = new Date('2026-01-01T00:00:00.000Z');
const CUTOFF = new Date('2026-01-02T00:00:00.000Z');

const app = buildApp();
const anon = (path: string) => app.request(path, { headers: { 'x-forwarded-for': '203.0.113.11' } });

describe('deleting a card revokes access (v2 P3 卡管理)', () => {
  beforeEach(resetDb);

  it('deleting an open card makes its link 404 immediately', async () => {
    const a = await makeUser('林之');
    const t = await makeTag(a.id, '日常');
    const card = await makeOpenCard(a.id, CUTOFF, [{ name: '日常', include: [t.id] }]);
    await makeNote(a.id, 'visible', [t.id], T0);

    expect((await anon(`/public/${card.publicSlug}`)).status).toBe(200);
    expect(await deleteCard(a.id, card.id)).toBe(true);
    expect((await anon(`/public/${card.publicSlug}`)).status).toBe(404);
    expect((await anon(`/public/${card.publicSlug}/notes`)).status).toBe(404);
  });

  it('deleting a login card drops the holder binding, so the reader loses access', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const t = await makeTag(a.id, 't');
    const card = await makeCard(a.id, CUTOFF, [{ include: [t.id] }]);
    await db.cardHolder.create({ data: { cardId: card.id, userId: b.id } });

    expect(await readerCardAccess(card.id, b.id)).not.toBeNull();
    expect(await deleteCard(a.id, card.id)).toBe(true);
    expect(await readerCardAccess(card.id, b.id)).toBeNull();
    expect(await db.cardHolder.count()).toBe(0);
  });

  it('a card carries rules, not content: deleting one leaves notes and tags alone', async () => {
    const a = await makeUser();
    const t = await makeTag(a.id, 't');
    const note = await makeNote(a.id, 'keep me', [t.id], T0);
    const card = await makeCard(a.id, CUTOFF, [{ include: [t.id] }]);

    await deleteCard(a.id, card.id);
    expect(await db.note.findUnique({ where: { id: note.id } })).not.toBeNull();
    expect(await db.tag.findUnique({ where: { id: t.id } })).not.toBeNull();
    expect(await db.noteTag.count({ where: { noteId: note.id } })).toBe(1);
    expect(await db.share.count()).toBe(0);
    expect(await db.shareTag.count()).toBe(0);
  });

  it('another author cannot delete a card that is not theirs', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const t = await makeTag(a.id, 't');
    const card = await makeOpenCard(a.id, CUTOFF, [{ include: [t.id] }]);

    expect(await deleteCard(b.id, card.id)).toBe(false);
    expect(await db.card.findUnique({ where: { id: card.id } })).not.toBeNull();
    expect((await anon(`/public/${card.publicSlug}`)).status).toBe(200);
  });

  it('emptying an open card is NOT retraction — the slug still resolves', async () => {
    // The reason deleteCard has to exist: revoking every share leaves a live link.
    const a = await makeUser();
    const t = await makeTag(a.id, 't');
    const card = await makeOpenCard(a.id, CUTOFF, [{ include: [t.id] }]);
    await makeNote(a.id, 'n', [t.id], T0);

    await db.share.deleteMany({ where: { cardId: card.id } });
    expect((await anon(`/public/${card.publicSlug}`)).status).toBe(200);
    expect((await (await anon(`/public/${card.publicSlug}/notes`)).json()).notes).toEqual([]);

    await deleteCard(a.id, card.id);
    expect((await anon(`/public/${card.publicSlug}`)).status).toBe(404);
  });
});
