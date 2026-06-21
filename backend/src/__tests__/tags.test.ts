import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { deleteTag } from '../tags';
import { makeCard, makeNote, makeTag, makeUser, resetDb } from '../test/helpers';

const NOW = new Date('2026-06-21T12:00:00.000Z');

describe('tag deletion permission cleanup', () => {
  beforeEach(resetDb);

  it('detach keeps notes but deletes every share that references the tag', async () => {
    const user = await makeUser();
    const required = await makeTag(user.id, 'required');
    const excluded = await makeTag(user.id, 'excluded');
    const other = await makeTag(user.id, 'other');
    const first = await makeNote(user.id, 'first', [required.id, other.id], NOW);
    const second = await makeNote(user.id, 'second', [excluded.id, other.id], NOW);
    const card = await makeCard(user.id, NOW, [
      { name: 'requires deleted', include: [required.id] },
      { name: 'excludes deleted', include: [other.id], exclude: [excluded.id] },
      { name: 'untouched', include: [other.id] },
    ]);

    expect((await deleteTag(user.id, required.id, 'detach')).ok).toBe(true);
    expect(await db.note.findUnique({ where: { id: first.id } })).not.toBeNull();
    expect(await db.share.findFirst({ where: { cardId: card.id, name: 'requires deleted' } })).toBeNull();

    expect((await deleteTag(user.id, excluded.id, 'detach')).ok).toBe(true);
    expect(await db.note.findUnique({ where: { id: second.id } })).not.toBeNull();
    expect(await db.share.findFirst({ where: { cardId: card.id, name: 'excludes deleted' } })).toBeNull();
    expect(await db.share.findFirst({ where: { cardId: card.id, name: 'untouched' } })).not.toBeNull();
  });

  it('delete_notes removes tagged notes and referenced shares, but leaves unrelated notes', async () => {
    const user = await makeUser();
    const target = await makeTag(user.id, 'target');
    const other = await makeTag(user.id, 'other');
    const doomed = await makeNote(user.id, 'doomed', [target.id, other.id], NOW);
    const kept = await makeNote(user.id, 'kept', [other.id], NOW);
    const card = await makeCard(user.id, NOW, [{ name: 'target share', include: [target.id] }]);

    expect((await deleteTag(user.id, target.id, 'delete_notes')).ok).toBe(true);
    expect(await db.note.findUnique({ where: { id: doomed.id } })).toBeNull();
    expect(await db.note.findUnique({ where: { id: kept.id } })).not.toBeNull();
    expect(await db.share.findFirst({ where: { cardId: card.id } })).toBeNull();
  });
});
