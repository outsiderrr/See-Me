import { db } from './db';

// 原始材料层的合法枚举。词表约定见 docs/标签口径.md（暂行）。
export const RAW_KINDS = new Set(['memo', 'chat', 'voice', 'task']);
// 归属是单元级的"主导归属"。AI 侧刻意分三种（口径 v0.1，2026-08-09）：
//   AI整理 = AI 转写/结构化用户自己的话（可与 观点/规则/复盘 双贴）；
//   AI观点 = AI 自己的判断、框架、建议；
//   AI引用 = AI 转述的外部事实/他人观点（要求可反查来源，无源者按 AI观点/待核）。
// 一个单元内 AI 观点与引用交织时用 混合，命题级区分留给 库 阶段的账本。
export const RAW_ATTRIBUTIONS = new Set([
  '用户观点',
  '用户随记',
  'AI整理',
  'AI观点',
  'AI引用',
  '课程转录',
  '外部摘录',
  '系统内容',
  '混合',
  '不确定',
]);
export const RAW_CONFIDENCES = new Set(['高', '中', '低']);

export const MAX_TAG_NAME = 50;

/**
 * 标签名归一。原始层是第一条把 AI 产物名字自动写进 tags 表（= 分享决策词表）的路径，
 * 所以要防同形异码：全角减号「发布－公开」、零宽字符夹在「私密」里、繁体变体……
 * 这些在控制台里与真标签肉眼无差，而 exclude 方向是 fail-open 的——作者给笔记贴上
 * AI 造出的假「私密」，真「私密」的排除匹配不到，笔记会被自动更新的卡放出去。
 * NFKC 折叠兼容字符后，再拒绝格式/控制/不可见字符与非常规空白；红线判定在归一之后。
 * 返回 null = 不合法。
 */
export function normalizeRawTagName(raw: string): string | null {
  const s = raw.normalize('NFKC').trim();
  if (!s || s.length > MAX_TAG_NAME) return null;
  if (/[\p{Cf}\p{Cc}\p{Zl}\p{Zp}]/u.test(s)) return null;
  if (/[^\S ]/.test(s) || / {2,}/.test(s)) return null;
  return s;
}

/** 红线：标注产物绝不能携带发布权限。「可分享」参与人工分享决策，同样不收。
 *  服务端硬拒，不信任何上游（提示词、校验器、标注 AI）的自觉。传入应已归一。 */
export function isForbiddenRawTag(name: string): boolean {
  const n = name.normalize('NFKC');
  return n.startsWith('发布-') || n === '可分享';
}

/** 真实日历日期，不只是形状：JS 会把 2026-02-30 静默滚成 03-02，越界月份则是 Invalid Date。 */
export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

/** source 是相对 原始/ 的路径 + 判别符：拒绝绝对路径与 `..` 段（湖侧 check 同样拦，这里是纵深）。 */
export function isSaneSource(source: string): boolean {
  const rel = source.split('#')[0];
  if (!rel || rel.startsWith('/') || rel.startsWith('\\')) return false;
  return !rel.split(/[\\/]/).some((seg) => seg === '..' || seg === '');
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
 *
 * 与既有标签管理的交互：标签属于全局词表，原始层复用同一张 tags 表。作者在控制台
 * 删除一个标签时，raw_unit_tags 靠 FK Cascade 一并剥离（deleteTag 不单独处理），
 * 重传该周即可补回——这是"备份镜像"语义的自然推论，不算数据丢失。
 * 输入应已由路由层校验（枚举、红线、真实日期、source 形状），这里不再重复。
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
