import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../server';
import { createSession } from '../auth/session';
import { importRawUnits, listRawUnits, type RawUnitInput } from '../raw';
import { deleteTag, listTags } from '../tags';
import { readerFeed } from '../permission/engine';
import { db } from '../db';
import { makeCard, makeNote, makeTag, makeUser, resetDb } from '../test/helpers';

const app = buildApp();

function unit(over: Partial<RawUnitInput> = {}): RawUnitInput {
  return {
    source: 'flomo/2026-W31/raw/01-flomo全量导出.md#第1条',
    kind: 'memo',
    title: '三天大亏单复盘',
    body: '7月14、15、16三天，每天一笔超过50%的大亏单。',
    dated: '2026-07-17',
    attribution: '用户随记',
    confidence: '高',
    needsConfirm: false,
    duplicateOf: null,
    reason: '测试用例',
    tags: ['交易', '复盘'],
    ...over,
  };
}

async function authedPost(token: string, body: unknown) {
  return app.request('/api/raw/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

describe('raw layer import', () => {
  beforeEach(resetDb);

  it('requires auth on every raw route', async () => {
    const post = await app.request('/api/raw/import', { method: 'POST' });
    expect(post.status).toBe(401);
    const list = await app.request('/api/raw');
    expect(list.status).toBe(401);
  });

  it('imports units, creating missing tags and reusing existing ones', async () => {
    const user = await makeUser();
    await makeTag(user.id, '交易'); // 已有标签必须复用而不是撞唯一约束
    const { id: token } = await createSession(user.id);

    const res = await authedPost(token, { week: '2026-W31', units: [unit()] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, created: 1, updated: 0 });

    const tags = await db.tag.findMany({ where: { userId: user.id } });
    expect(tags.map((t) => t.name).sort()).toEqual(['交易', '复盘']);

    const { total, units } = await listRawUnits(user.id, {});
    expect(total).toBe(1);
    expect(units[0].tags.map((t) => t.name).sort()).toEqual(['交易', '复盘']);
    expect(units[0].dated).toBe('2026-07-17');
  });

  it('re-import is an idempotent refresh: same source updates fields and replaces tags', async () => {
    const user = await makeUser();
    const { id: token } = await createSession(user.id);

    await authedPost(token, { week: '2026-W31', units: [unit()] });
    const res = await authedPost(token, {
      week: '2026-W31',
      units: [unit({ title: '修订后的标题', tags: ['交易', '交易-复盘-关键'] })],
    });
    expect(await res.json()).toMatchObject({ created: 0, updated: 1 });

    const { total, units } = await listRawUnits(user.id, { week: '2026-W31' });
    expect(total).toBe(1);
    expect(units[0].title).toBe('修订后的标题');
    expect(units[0].tags.map((t) => t.name).sort()).toEqual(['交易', '交易-复盘-关键']);
    // 被替换下来的旧标签本身仍在（标签属于全局词表，不随单元退场）
    expect(await db.tag.count({ where: { userId: user.id } })).toBe(3);
  });

  it('hard-rejects publish tags and 可分享 as a whole batch', async () => {
    const user = await makeUser();
    const { id: token } = await createSession(user.id);

    for (const bad of ['发布-公开', '发布-任何东西', '可分享']) {
      const res = await authedPost(token, {
        week: '2026-W31',
        units: [unit({ tags: ['交易', bad] })],
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('bad_unit');
      expect(body.problems[0].problem).toBe(`forbidden_tag:${bad}`);
    }
    // 整批拒绝：一个坏单元也不能让其余单元入库
    expect(await db.rawUnit.count()).toBe(0);
  });

  it('rejects look-alike tag names: fullwidth publish prefix, zero-width 私密, control chars', async () => {
    const user = await makeUser();
    const { id: token } = await createSession(user.id);

    // 全角减号经 NFKC 折叠成半角，落到红线上
    const fullwidth = await authedPost(token, { week: '2026-W31', units: [unit({ tags: ['发布－公开'] })] });
    expect((await fullwidth.json()).problems[0].problem).toBe('forbidden_tag:发布-公开');
    // 零宽空格夹在「私密」里：与真「私密」肉眼无差，exclude 会 fail-open，必须拒
    const zwsp = await authedPost(token, { week: '2026-W31', units: [unit({ tags: ['私​密'] })] });
    expect(zwsp.status).toBe(400);
    expect((await zwsp.json()).problems[0].problem).toMatch(/^bad_tag_name:/);
    const ctrl = await authedPost(token, { week: '2026-W31', units: [unit({ tags: ['交易'] })] });
    expect(ctrl.status).toBe(400);
    expect(await db.tag.count()).toBe(0);
  });

  it('rejects impossible calendar dates instead of silently rolling them', async () => {
    const user = await makeUser();
    const { id: token } = await createSession(user.id);
    for (const d of ['2026-02-30', '2026-13-01', '2026-04-31']) {
      const res = await authedPost(token, { week: '2026-W31', units: [unit({ dated: d })] });
      expect(res.status).toBe(400);
      expect((await res.json()).problems[0].problem).toBe('bad_dated');
    }
    expect(await db.rawUnit.count()).toBe(0);
  });

  it('rejects sources that escape 原始/ (absolute or ..)', async () => {
    const user = await makeUser();
    const { id: token } = await createSession(user.id);
    for (const s of ['flomo/../../.ssh/id_rsa', '/etc/passwd', 'flomo//x.md']) {
      const res = await authedPost(token, { week: '2026-W31', units: [unit({ source: s })] });
      expect(res.status).toBe(400);
      expect((await res.json()).problems[0].problem).toBe('bad_source');
    }
  });

  it('list route validates week and clamps paging', async () => {
    const user = await makeUser();
    const { id: token } = await createSession(user.id);
    const h = { Authorization: `Bearer ${token}` };
    await importRawUnits(user.id, '2026-W31', [unit({ source: 'a#1' }), unit({ source: 'a#2' })]);

    expect((await app.request('/api/raw?week=31', { headers: h })).status).toBe(400);
    const one = await (await app.request('/api/raw?take=1', { headers: h })).json();
    expect(one.total).toBe(2);
    expect(one.units).toHaveLength(1);
    const huge = await (await app.request('/api/raw?take=99999&skip=-5', { headers: h })).json();
    expect(huge.units).toHaveLength(2);
  });

  it('rejects duplicate sources within one batch and malformed weeks', async () => {
    const user = await makeUser();
    const { id: token } = await createSession(user.id);

    const dup = await authedPost(token, { week: '2026-W31', units: [unit(), unit()] });
    expect(dup.status).toBe(400);
    expect((await dup.json()).problems[0].problem).toBe('duplicate_source');

    const badWeek = await authedPost(token, { week: 'W31', units: [unit()] });
    expect(badWeek.status).toBe(400);
    expect((await badWeek.json()).error).toBe('bad_week');
  });

  it('list filters by week and needsConfirm', async () => {
    const user = await makeUser();
    await importRawUnits(user.id, '2026-W30', [
      unit({ source: 'a#1', needsConfirm: true }),
      unit({ source: 'a#2' }),
    ]);
    await importRawUnits(user.id, '2026-W31', [unit({ source: 'b#1' })]);

    expect((await listRawUnits(user.id, { week: '2026-W30' })).total).toBe(2);
    expect((await listRawUnits(user.id, { needsConfirm: true })).total).toBe(1);
    expect((await listRawUnits(user.id, {})).total).toBe(3);
  });

  it('units are scoped to their owner', async () => {
    const a = await makeUser();
    const b = await makeUser();
    await importRawUnits(a.id, '2026-W31', [unit()]);
    expect((await listRawUnits(b.id, {})).total).toBe(0);
  });

  it('tag listing counts raw usage separately; deleting a tag detaches it from raw units', async () => {
    const user = await makeUser();
    await importRawUnits(user.id, '2026-W31', [unit({ tags: ['交易', '复盘'] })]);

    const before = await listTags(user.id);
    const trade = before.find((t) => t.name === '交易')!;
    expect(trade.noteCount).toBe(0);
    expect(trade.rawUnitCount).toBe(1);

    // 控制台删标签：raw_unit_tags 靠 Cascade 剥离，单元本身留下，重传可补回
    expect((await deleteTag(user.id, trade.id, 'detach')).ok).toBe(true);
    const { units } = await listRawUnits(user.id, {});
    expect(units).toHaveLength(1);
    expect(units[0].tags.map((t) => t.name)).toEqual(['复盘']);
  });
});

describe('raw layer stays out of sharing', () => {
  beforeEach(resetDb);

  it('a raw unit carrying a share include-tag never appears in the reader feed', async () => {
    const owner = await makeUser();
    const tag = await makeTag(owner.id, '交易');
    const note = await makeNote(owner.id, '展示层笔记', [tag.id], new Date('2026-08-01T00:00:00Z'));
    // 原始单元带上与 share 完全相同的标签——如果泄漏，正是从这里漏出去
    await importRawUnits(owner.id, '2026-W31', [
      unit({ tags: ['交易'], body: '绝不能出现在读者端的原始正文' }),
    ]);

    const card = await makeCard(owner.id, new Date('2030-01-01T00:00:00Z'), [{ include: [tag.id] }]);
    const feed = await readerFeed({
      cardId: card.id,
      cardOwnerId: owner.id,
      visibleUntil: card.visibleUntil,
      limit: 20,
    });

    expect(feed.notes).toHaveLength(1);
    expect(feed.notes[0].id).toBe(note.id);
    expect(JSON.stringify(feed)).not.toContain('原始正文');
  });
});
