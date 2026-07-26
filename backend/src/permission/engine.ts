import { Prisma } from '@prisma/client';
import { db } from '../db';

export type ReaderNote = {
  id: string;
  body: string;
  createdAt: Date;
  shares: { id: string; name: string }[];
  images: { id: string }[];
};

export interface ShareDef {
  id: string;
  name: string;
  isAutoUpdate: boolean;
  include: string[]; // tag ids ANDed (>=1)
  exclude: string[]; // tag ids; note must have none of these
}

export interface FeedParams {
  cardId: string;
  cardOwnerId: string;
  visibleUntil: Date;
  tabShareId?: string; // undefined => "recent" = union of all shares
  limit: number;
  cursor?: { createdAtRaw: string; id: string };
}

const RAW_TS = `to_char(n.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/**
 * Cursor = "<createdAtRaw>_<id>" (spec §3.2); createdAtRaw and cuid contain no '_'.
 * A malformed cursor is simply ignored (page 1) — no Date parsing, so it can never
 * crash a feed. Shared by the login and the no-login reader paths.
 */
export function parseCursor(raw?: string): { createdAtRaw: string; id: string } | undefined {
  if (!raw) return undefined;
  const idx = raw.lastIndexOf('_');
  if (idx <= 0 || idx >= raw.length - 1) return undefined;
  return { createdAtRaw: raw.slice(0, idx), id: raw.slice(idx + 1) };
}

export async function loadShares(cardId: string): Promise<ShareDef[]> {
  const shares = await db.share.findMany({ where: { cardId }, include: { shareTags: true } });
  return shares.map((s) => ({
    id: s.id,
    name: s.name,
    isAutoUpdate: s.isAutoUpdate,
    include: s.shareTags.filter((st) => !st.exclude).map((st) => st.tagId),
    exclude: s.shareTags.filter((st) => st.exclude).map((st) => st.tagId),
  }));
}

/**
 * Every authorizing (note, share) pair for a card (spec §3). A note is authorized by
 * a share iff it has ALL the share's include tags, NONE of its exclude tags, and the
 * share is auto-update OR the note is at/before the cutoff. Owner-scoped throughout.
 * createdAtRaw is full µs precision text (exact, cursor-safe — avoids JS Date truncation).
 */
async function authorizingPairs(
  cardOwnerId: string,
  visibleUntil: Date,
  shares: ShareDef[],
  noteId?: string,
): Promise<{ note_id: string; share_id: string; createdAtRaw: string }[]> {
  const valid = shares.filter((s) => s.include.length > 0);
  if (valid.length === 0) return [];
  const perShare = valid.map((s) => {
    const excludeClause = s.exclude.length
      ? Prisma.sql`AND NOT EXISTS (SELECT 1 FROM note_tags nx WHERE nx.note_id = n.id AND nx.tag_id IN (${Prisma.join(s.exclude)}))`
      : Prisma.empty;
    return Prisma.sql`
      SELECT n.id AS note_id, ${s.id}::text AS share_id, ${Prisma.raw(RAW_TS)} AS "createdAtRaw"
      FROM notes n
      WHERE n.user_id = ${cardOwnerId}
        ${noteId ? Prisma.sql`AND n.id = ${noteId}` : Prisma.empty}
        AND (${s.isAutoUpdate} OR n.created_at <= ${visibleUntil})
        AND (SELECT count(DISTINCT nt.tag_id) FROM note_tags nt
             WHERE nt.note_id = n.id AND nt.tag_id IN (${Prisma.join(s.include)})) = ${s.include.length}
        ${excludeClause}`;
  });
  return db.$queryRaw(Prisma.join(perShare, ' UNION ALL '));
}

/** Reader feed for a card: "recent" (union of all shares) or a single share tab. */
export async function readerFeed(p: FeedParams): Promise<{ notes: ReaderNote[]; nextCursor: string | null }> {
  const shares = await loadShares(p.cardId);
  const shareName = new Map(shares.map((s) => [s.id, s.name]));
  const pairs = await authorizingPairs(p.cardOwnerId, p.visibleUntil, shares);

  // group: note -> { createdAtRaw, authorizing share ids }
  const byNote = new Map<string, { createdAtRaw: string; shareIds: Set<string> }>();
  for (const row of pairs) {
    const e = byNote.get(row.note_id) ?? { createdAtRaw: row.createdAtRaw, shareIds: new Set<string>() };
    e.shareIds.add(row.share_id);
    byNote.set(row.note_id, e);
  }

  // candidates: recent = all visible; tab = notes authorized by that share
  let candidates = [...byNote.entries()].map(([id, v]) => ({ id, createdAtRaw: v.createdAtRaw, shareIds: v.shareIds }));
  if (p.tabShareId) candidates = candidates.filter((c) => c.shareIds.has(p.tabShareId!));

  // deterministic order: createdAt desc, id desc (createdAtRaw is lexically chronological)
  candidates.sort((a, b) =>
    a.createdAtRaw !== b.createdAtRaw ? (a.createdAtRaw < b.createdAtRaw ? 1 : -1) : a.id < b.id ? 1 : -1,
  );

  // keyset slice by exact (createdAtRaw, id) cursor — malformed cursor simply yields page 1
  if (p.cursor) {
    const cur = p.cursor;
    candidates = candidates.filter(
      (c) => c.createdAtRaw < cur.createdAtRaw || (c.createdAtRaw === cur.createdAtRaw && c.id < cur.id),
    );
  }

  const page = candidates.slice(0, p.limit);
  const nextCursor = page.length === p.limit ? `${page[page.length - 1].createdAtRaw}_${page[page.length - 1].id}` : null;

  if (page.length === 0) return { notes: [], nextCursor: null };

  // fetch bodies for the page only (column whitelist: no updated_at)
  const bodies = await db.note.findMany({
    where: { id: { in: page.map((p) => p.id) } },
    select: {
      id: true,
      body: true,
      createdAt: true,
      images: { orderBy: { sortOrder: 'asc' }, select: { id: true } },
    },
  });
  const bodyMap = new Map(bodies.map((b) => [b.id, b]));

  const notes: ReaderNote[] = page.map((c) => {
    const b = bodyMap.get(c.id)!;
    const shareList = [...c.shareIds].map((sid) => ({ id: sid, name: shareName.get(sid) ?? '' })).filter((s) => s.name);
    return { id: b.id, body: b.body, createdAt: b.createdAt, shares: shareList, images: b.images };
  });
  return { notes, nextCursor };
}

/** Re-run the same live predicate for a single note before serving protected media. */
export async function readerCanAccessNote(
  cardId: string,
  cardOwnerId: string,
  visibleUntil: Date,
  noteId: string,
): Promise<boolean> {
  const shares = await loadShares(cardId);
  return (await authorizingPairs(cardOwnerId, visibleUntil, shares, noteId)).length > 0;
}
