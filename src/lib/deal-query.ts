import "server-only";
import { Prisma, type User } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { dealVisibilityWhere } from "@/lib/rbac";
import {
  parseCsvIds,
  parseNumber,
  parseDate,
  dueWindowRange,
  startOfDay,
  type DealStatus,
} from "@/lib/filter-helpers";
import { parseDealSort, resolveDealSortDir, type DealSort, type DealSortDir } from "@/lib/deal-sort";
import { type DealFilterParams, type StageTotal } from "@/lib/deal-filter-params";
import type { KanbanDeal } from "@/components/deals/kanban-board";
import type { DealRow } from "@/components/deals/deals-table";

export { pickDealFilterParams, type DealFilterParams, type StageTotal } from "@/lib/deal-filter-params";

export const dealInclude = {
  client: true,
  owner: true,
  tags: true,
  _count: { select: { tasks: { where: { status: "OPEN" } } } },
} satisfies Prisma.DealInclude;

export type DealWithRelations = Prisma.DealGetPayload<{ include: typeof dealInclude }>;

export type DealListQuery = {
  where: Prisma.DealWhereInput;
  orderBy: Prisma.DealOrderByWithRelationInput[];
  sort: DealSort;
  dir: DealSortDir;
  staleDays: number | undefined;
  /**
   * `true` when the query relies on a cross-table "last activity" rollup that
   * can't be expressed as SQL (the `stale` filter or `activity` sort). Callers
   * fall back to loading the full result set and post-processing in JS instead
   * of paginating per stage.
   */
  fullScan: boolean;
};

/**
 * Build the Prisma `where` + `orderBy` for the deals list from URL params and
 * the caller's RBAC scope. Shared by the deals page and the load-more action so
 * they never drift. Note: the `stale` filter and `activity` sort are applied in
 * JS by the caller (they need a cross-table rollup) — see {@link DealListQuery.fullScan}.
 */
export async function buildDealListQuery(
  sp: DealFilterParams,
  user: User
): Promise<DealListQuery> {
  const visibility = await dealVisibilityWhere(user);

  // All filters below only narrow within `visibility` (RBAC preserved).
  const filters: Prisma.DealWhereInput[] = [visibility];
  if (sp.q)
    filters.push({
      OR: [
        { title: { contains: sp.q } },
        { salesId: { contains: sp.q } },
        { client: { name: { contains: sp.q } } },
      ],
    });
  // "My deals" wins over an explicit owner select.
  if (sp.mine === "1") filters.push({ ownerId: user.id });
  else if (sp.owner) filters.push({ ownerId: sp.owner });

  // Tags: comma-separated; deal must carry every selected tag.
  for (const tagId of parseCsvIds(sp.tag)) filters.push({ tags: { some: { id: tagId } } });

  if (sp.stage) filters.push({ stageId: sp.stage });

  const status = sp.status as DealStatus | undefined;
  if (status === "open") filters.push({ stage: { isWon: false, isLost: false } });
  else if (status === "won") filters.push({ stage: { isWon: true } });
  else if (status === "lost") filters.push({ stage: { isLost: true } });

  const amtMin = parseNumber(sp.amtMin);
  const amtMax = parseNumber(sp.amtMax);
  if (amtMin != null || amtMax != null)
    filters.push({
      amountEur: { ...(amtMin != null ? { gte: amtMin } : {}), ...(amtMax != null ? { lte: amtMax } : {}) },
    });

  const dueFrom = parseDate(sp.dueFrom);
  const dueTo = parseDate(sp.dueTo);
  if (dueFrom || dueTo)
    filters.push({
      dueDate: { ...(dueFrom ? { gte: dueFrom } : {}), ...(dueTo ? { lte: dueTo } : {}) },
    });

  // Overdue quick filter: past-due and still open (not won/lost).
  if (sp.overdue === "1") {
    const { lt } = dueWindowRange("overdue");
    filters.push({ dueDate: { lt }, stage: { isWon: false, isLost: false } });
  }

  const where: Prisma.DealWhereInput = { AND: filters };

  const sort = parseDealSort(sp.sort);
  const dir = resolveDealSortDir(sort, sp.dir);
  const orderBy = orderByForSort(sort, dir);

  const staleDays = parseNumber(sp.stale);
  const fullScan = staleDays != null || sort === "activity";

  return { where, orderBy, sort, dir, staleDays, fullScan };
}

/**
 * Prisma orderBy for the whole list (used by the full-scan path). `date`/`size`
 * get a JS nulls-last fixup by the page; the per-stage paginated fetch handles
 * nulls-last itself (see {@link fetchStageDeals}).
 */
function orderByForSort(sort: DealSort, dir: DealSortDir): Prisma.DealOrderByWithRelationInput[] {
  switch (sort) {
    case "name":
      return [{ title: dir }];
    case "date":
      return [{ dueDate: dir }, { createdAt: "desc" }];
    case "size":
      return [{ amountEur: dir }, { createdAt: "desc" }];
    case "activity":
      // Seeded by updatedAt; the real cross-table rollup sort happens in JS.
      return [{ updatedAt: dir }, { createdAt: "desc" }];
    default:
      return [{ boardOrder: "asc" }, { createdAt: "desc" }];
  }
}

/**
 * Fetch one page of deals for a single stage, ordered to match the board/table.
 *
 * MySQL can't express `NULLS LAST`, so for `date`/`size` sorts (where the key is
 * nullable) we page the non-null rows first and only spill into the null rows
 * once they're exhausted — keeping undated / amount-less deals pinned to the
 * bottom of the column regardless of sort direction and page boundary.
 */
export async function fetchStageDeals(
  where: Prisma.DealWhereInput,
  stageId: string,
  sort: DealSort,
  dir: DealSortDir,
  offset: number,
  limit: number
): Promise<DealWithRelations[]> {
  const base: Prisma.DealWhereInput = { AND: [where, { stageId }] };

  const nullableField: "dueDate" | "amountEur" | null =
    sort === "date" ? "dueDate" : sort === "size" ? "amountEur" : null;

  if (!nullableField) {
    return prisma.deal.findMany({
      where: base,
      include: dealInclude,
      orderBy: orderByForSort(sort, dir),
      skip: offset,
      take: limit,
    });
  }

  const nonNullOrder: Prisma.DealOrderByWithRelationInput[] =
    nullableField === "dueDate" ? [{ dueDate: dir }, { createdAt: "desc" }] : [{ amountEur: dir }, { createdAt: "desc" }];

  const nonNull = await prisma.deal.findMany({
    where: { AND: [base, { [nullableField]: { not: null } }] },
    include: dealInclude,
    orderBy: nonNullOrder,
    skip: offset,
    take: limit,
  });

  if (nonNull.length === limit) return nonNull;

  // Ran out of non-null rows for this window — backfill from the null rows,
  // which always sort last. Work out where in the null segment we are.
  let nonNullTotal: number;
  if (nonNull.length > 0) {
    // We started inside the non-null segment and consumed the rest of it.
    nonNullTotal = offset + nonNull.length;
  } else {
    // The window starts at/after the null boundary — count to find it.
    nonNullTotal = await prisma.deal.count({
      where: { AND: [base, { [nullableField]: { not: null } }] },
    });
  }

  const nullSkip = Math.max(0, offset - nonNullTotal);
  const nullTake = limit - nonNull.length;
  const nulls = await prisma.deal.findMany({
    where: { AND: [base, { [nullableField]: null }] },
    include: dealInclude,
    orderBy: [{ createdAt: "desc" }],
    skip: nullSkip,
    take: nullTake,
  });

  return [...nonNull, ...nulls];
}

/**
 * Per-stage `{ count, value }` for every stage that has at least one matching
 * deal — the source of truth for the header total and each column/section
 * subtotal. Independent of how many deals are actually loaded into the view.
 */
export async function getStageTotals(where: Prisma.DealWhereInput): Promise<Map<string, StageTotal>> {
  const grouped = await prisma.deal.groupBy({
    by: ["stageId"],
    where,
    _count: { _all: true },
    _sum: { amountEur: true },
  });
  const map = new Map<string, StageTotal>();
  for (const g of grouped) {
    map.set(g.stageId, {
      count: g._count._all,
      value: g._sum.amountEur ? Number(g._sum.amountEur) : 0,
    });
  }
  return map;
}

// ---------------------------------------------------------------------------
// Row → view mappers (shared by the page's first-page render and load-more).
// ---------------------------------------------------------------------------

/** Overdue = past due AND still open (won/lost stages are never overdue). */
export function makeOverdueChecker(
  stageFlags: Map<string, { isWon: boolean; isLost: boolean }>,
  today: Date = startOfDay(new Date())
) {
  return (dueDate: Date | null, stageId: string) => {
    if (!dueDate) return false;
    const f = stageFlags.get(stageId);
    if (f?.isWon || f?.isLost) return false;
    return dueDate < today;
  };
}

export function toKanbanDeal(d: DealWithRelations, overdue: boolean): KanbanDeal {
  return {
    id: d.id,
    salesId: d.salesId,
    title: d.title,
    amountEur: d.amountEur ? Number(d.amountEur) : null,
    stageId: d.stageId,
    clientName: d.client?.name ?? null,
    ownerId: d.ownerId,
    ownerName: d.owner?.name ?? null,
    ownerColor: d.owner?.avatarColor ?? null,
    dueDate: d.dueDate?.toISOString() ?? null,
    overdue,
    tags: d.tags.map((t) => ({ id: t.id, name: t.name, color: t.color })),
    openTasks: d._count.tasks,
  };
}

export function toDealRow(d: DealWithRelations, overdue: boolean): DealRow {
  return {
    id: d.id,
    salesId: d.salesId,
    title: d.title,
    clientName: d.client?.name ?? null,
    stageId: d.stageId,
    amountEur: d.amountEur ? Number(d.amountEur) : null,
    dueDate: d.dueDate ? d.dueDate.toISOString().slice(0, 10) : null,
    overdue,
    ownerId: d.ownerId,
    ownerName: d.owner?.name ?? null,
    ownerColor: d.owner?.avatarColor ?? null,
    tagIds: d.tags.map((t) => t.id),
  };
}
