import { db } from './db';

// 原始材料层的合法枚举。词表约定见 docs/标签口径.md（暂行）。
export const RAW_KINDS = new Set(['memo', 'chat', 'voice', 'task']);
export const RAW_ATTRIBUTIONS = new Set([
  '用户观点',
  '用户随记',
  'AI整理',
  '课程转录',
  '外部摘录',
  '系统内容',
  '混合',
  '不确定',
]);
export const RAW_CONFIDENCES = new Set(['高', '中', '低']);

/** 红线：标注产物绝不能携带发布权限。「可分享」参与人工分享决策，同样不收。
 *  服务端硬拒，不信任何上游（提示词、校验器、标注 AI）的自觉。 */
export function isForbiddenRawTag(name: string): boolean {
  return name.startsWith('发布-') || name === '可分享';
}

export type RawUnitInput = {
  source: string;
  kind: string;
  title: string;
  body: string;
  dated: string | null;
  attribution: string;
  confidence: string;
  needsConfirm: boolean;
  duplicateOf: string | null;
  reason: string | null;
  tags: string[];
};

const TX_CHUNK = 50;

/**
 * 幂等批量入库：以 (userId, source) 为锚 upsert，重传即整体刷新（含标签整批替换）。
 * 与展示层导入器不同，这里刻意没有 state 文件——原始材料层是备份镜像，重传刷新
 * 正是想要的语义；控制台也没有删除原始单元的入口，不存在"删过的不复活"问题。
 */
export async function importRawUnits(userId: string, week: string, units: RawUnitInput[]) {
  const wanted = [...new Set(units.flatMap((u) => u.tags))];
  const existing = await db.tag.findMany({ where: { userId, name: { in: wanted } } });
  const byName = new Map(existing.map((t) => [t.name, t.id]));
  const missing = wanted.filter((n) => !byName.has(n));
  if (missing.length) {
    // 逐个 create 而不是 createMany：并发导入撞 @@unique([userId,name]) 时能各自兜底
    for (const name of missing) {
      const tag = await db.tag
        .upsert({ where: { userId_name: { userId, name } }, update: {}, create: { userId, name } })
        .catch(() => db.tag.findUniqueOrThrow({ where: { userId_name: { userId, name } } }));
      byName.set(name, tag.id);
    }
  }

  const sources = units.map((u) => u.source);
  const already = await db.rawUnit.findMany({
    where: { userId, source: { in: sources } },
    select: { source: true },
  });
  const existedBefore = new Set(already.map((r) => r.source));

  for (let i = 0; i < units.length; i += TX_CHUNK) {
    const chunk = units.slice(i, i + TX_CHUNK);
    await db.$transaction(
      chunk.map((u) => {
        const fields = {
          week,
          kind: u.kind,
          title: u.title,
          body: u.body,
          dated: u.dated ? new Date(`${u.dated}T00:00:00Z`) : null,
          attribution: u.attribution,
          confidence: u.confidence,
          needsConfirm: u.needsConfirm,
          duplicateOf: u.duplicateOf,
          reason: u.reason,
        };
        const links = u.tags.map((name) => ({ tagId: byName.get(name)! }));
        return db.rawUnit.upsert({
          where: { userId_source: { userId, source: u.source } },
          create: { userId, source: u.source, ...fields, rawUnitTags: { create: links } },
          update: { ...fields, rawUnitTags: { deleteMany: {}, create: links } },
        });
      }),
    );
  }

  const created = units.filter((u) => !existedBefore.has(u.source)).length;
  return { created, updated: units.length - created };
}

export type RawListFilter = {
  week?: string;
  tagId?: string;
  needsConfirm?: boolean;
  skip?: number;
  take?: number;
};

export async function listRawUnits(userId: string, f: RawListFilter) {
  const where = {
    userId,
    ...(f.week ? { week: f.week } : {}),
    ...(f.tagId ? { rawUnitTags: { some: { tagId: f.tagId } } } : {}),
    ...(f.needsConfirm !== undefined ? { needsConfirm: f.needsConfirm } : {}),
  };
  const [total, rows] = await Promise.all([
    db.rawUnit.count({ where }),
    db.rawUnit.findMany({
      where,
      include: { rawUnitTags: { include: { tag: { select: { id: true, name: true } } } } },
      orderBy: [{ dated: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      skip: f.skip ?? 0,
      take: f.take ?? 50,
    }),
  ]);
  return { total, units: rows.map(rawUnitDto) };
}

export function rawUnitDto(r: {
  id: string;
  week: string;
  source: string;
  kind: string;
  title: string;
  body: string;
  dated: Date | null;
  attribution: string;
  confidence: string;
  needsConfirm: boolean;
  duplicateOf: string | null;
  reason: string | null;
  createdAt: Date;
  rawUnitTags: { tag: { id: string; name: string } }[];
}) {
  return {
    id: r.id,
    week: r.week,
    source: r.source,
    kind: r.kind,
    title: r.title,
    body: r.body,
    dated: r.dated ? r.dated.toISOString().slice(0, 10) : null,
    attribution: r.attribution,
    confidence: r.confidence,
    needsConfirm: r.needsConfirm,
    duplicateOf: r.duplicateOf,
    reason: r.reason,
    createdAt: r.createdAt,
    tags: r.rawUnitTags.map((rt) => rt.tag),
  };
}
