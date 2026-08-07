import { describe, it, expect, beforeEach } from 'vitest';
import { readerFeed } from '../engine';
import { db } from '../../db';
import { resetDb, makeUser, makeTag, makeNote, makeCard } from '../../test/helpers';

const T0 = new Date('2026-01-01T00:00:00.000Z');
const CUTOFF = new Date('2026-01-02T00:00:00.000Z');
const AFTER = new Date('2026-01-03T00:00:00.000Z');

type CardT = Awaited<ReturnType<typeof makeCard>>;
async function feed(card: CardT, ownerId: string, tabShareId?: string) {
  return (await readerFeed({ cardId: card.id, cardOwnerId: ownerId, visibleUntil: card.visibleUntil, tabShareId, limit: 50 })).notes;
}

describe('permission engine (share model)', () => {
  beforeEach(resetDb);

  it('boundary: created_at == visible_until is visible; +1ms is hidden (frozen share)', async () => {
    const a = await makeUser();
    const t = await makeTag(a.id, 't');
    const card = await makeCard(a.id, CUTOFF, [{ include: [t.id] }]); // frozen (auto off)
    await makeNote(a.id, 'eq', [t.id], CUTOFF);
    await makeNote(a.id, 'after', [t.id], new Date(CUTOFF.getTime() + 1));
    const bodies = (await feed(card, a.id)).map((n) => n.body);
    expect(bodies).toContain('eq');
    expect(bodies).not.toContain('after');
  });

  it('reader sees the SHARE name, never the constituent tag names', async () => {
    const a = await makeUser();
    const inpool = await makeTag(a.id, 'inpool');
    const secret = await makeTag(a.id, 'secret');
    const card = await makeCard(a.id, CUTOFF, [{ name: '公开', include: [inpool.id] }]);
    await makeNote(a.id, 'n', [inpool.id, secret.id], T0);
    const notes = await feed(card, a.id);
    expect(notes.map((n) => n.body)).toEqual(['n']);
    expect(notes[0].shares.map((s) => s.name)).toEqual(['公开']);
  });

  it('intersection: a share with include {A,B} matches only notes that have BOTH', async () => {
    const a = await makeUser();
    const A = await makeTag(a.id, 'A');
    const B = await makeTag(a.id, 'B');
    const card = await makeCard(a.id, CUTOFF, [{ name: 'AB', include: [A.id, B.id] }]);
    await makeNote(a.id, 'onlyA', [A.id], T0);
    await makeNote(a.id, 'both', [A.id, B.id], T0);
    const bodies = (await feed(card, a.id)).map((n) => n.body);
    expect(bodies).toContain('both');
    expect(bodies).not.toContain('onlyA');
  });

  it('exclusion: include {A} exclude {X} hides notes that also have X', async () => {
    const a = await makeUser();
    const A = await makeTag(a.id, 'A');
    const X = await makeTag(a.id, '私密');
    const card = await makeCard(a.id, CUTOFF, [{ name: 'A−私密', include: [A.id], exclude: [X.id] }]);
    await makeNote(a.id, 'clean', [A.id], T0);
    await makeNote(a.id, 'private', [A.id, X.id], T0);
    const bodies = (await feed(card, a.id)).map((n) => n.body);
    expect(bodies).toContain('clean');
    expect(bodies).not.toContain('private');
  });

  it('post-cutoff note matched by an auto share shows only the auto chip, excluded from the frozen tab', async () => {
    const a = await makeUser();
    const t = await makeTag(a.id, 't');
    const card = await makeCard(a.id, CUTOFF, [
      { name: 'frozen', include: [t.id] },
      { name: 'auto', include: [t.id], auto: true },
    ]);
    await makeNote(a.id, 'late', [t.id], AFTER);
    const frozen = card.shares.find((s) => s.name === 'frozen')!;
    const auto = card.shares.find((s) => s.name === 'auto')!;

    const recent = await feed(card, a.id);
    expect(recent.find((n) => n.body === 'late')!.shares.map((s) => s.name)).toEqual(['auto']);
    expect((await feed(card, a.id, frozen.id)).map((n) => n.body)).not.toContain('late');
    expect((await feed(card, a.id, auto.id)).map((n) => n.body)).toContain('late');
  });

  it('a note matched by two shares appears once with both share chips', async () => {
    const a = await makeUser();
    const A = await makeTag(a.id, 'A');
    const B = await makeTag(a.id, 'B');
    const card = await makeCard(a.id, CUTOFF, [
      { name: 's1', include: [A.id] },
      { name: 's2', include: [B.id] },
    ]);
    await makeNote(a.id, 'dup', [A.id, B.id], T0);
    const recent = await feed(card, a.id);
    expect(recent.filter((n) => n.body === 'dup').length).toBe(1);
    expect(recent[0].shares.map((s) => s.name).sort()).toEqual(['s1', 's2']);
  });

  it('reader note DTO has no updatedAt key; empty card yields empty feed', async () => {
    const a = await makeUser();
    const t = await makeTag(a.id, 't');
    const card = await makeCard(a.id, CUTOFF, [{ include: [t.id] }]);
    await makeNote(a.id, 'x', [t.id], T0);
    expect(Object.keys((await feed(card, a.id))[0])).not.toContain('updatedAt');

    const empty = await makeCard(a.id, CUTOFF, []);
    expect(await feed(empty, a.id)).toEqual([]);
  });

  it('reader feed exposes the topic without exposing author-only fields', async () => {
    const a = await makeUser();
    const t = await makeTag(a.id, 't');
    const card = await makeCard(a.id, CUTOFF, [{ include: [t.id] }]);
    const note = await makeNote(a.id, 'connected thought', [t.id], T0);
    await db.note.update({ where: { id: note.id }, data: { topic: '交易的机会成本' } });

    const item = (await feed(card, a.id))[0];
    expect(item.topic).toBe('交易的机会成本');
    expect(Object.keys(item)).not.toContain('updatedAt');
  });
});
