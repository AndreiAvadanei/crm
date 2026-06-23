import "server-only";
import { prisma } from "@/lib/db";
import { clientVisibilityWhere } from "@/lib/rbac";
import { Prisma, type User } from "@/generated/prisma";
import type { ClientSort } from "@/lib/client-sort";
import { recencyCutoff } from "@/lib/filter-helpers";

export type { ClientSort } from "@/lib/client-sort";
export { CLIENT_SORT_OPTIONS } from "@/lib/client-sort";

/**
 * Filter inputs accepted by {@link getClientsWithStats}. All optional and
 * additive on top of the user's RBAC visibility scope — they only ever narrow
 * the already-visible set. Relation/column filters run in Prisma; stats-derived
 * predicates (open/no deals, recency) are applied after enrichment.
 */
export interface ClientFilterOpts {
  search?: string;
  sort?: ClientSort;
  /** Restrict to a single owner (admin-only control in the UI). */
  ownerId?: string;
  /** Client must carry ALL of these tag ids. */
  tagIds?: string[];
  /** Exact match on Client.size. */
  size?: string;
  /** Exact match on Client.country. */
  country?: string;
  /** Only clients with at least one open (not won/lost) deal. */
  hasOpenDeals?: boolean;
  /** Only clients with zero deals. */
  noDeals?: boolean;
  /** Only clients whose lastActivityAt is within the last N days. */
  activeWithinDays?: number;
}

/** Per-client rollups derived from the client's deals and their activity. */
export interface ClientStats {
  dealCount: number;
  openCount: number;
  wonCount: number;
  lostCount: number;
  /** Sum of amountEur for open (not won / not lost) deals. */
  openPipelineEur: number;
  /** Sum of amountEur across all deals. */
  totalPipelineEur: number;
  /** Most recent deal.createdAt — "when was the last deal". */
  lastDealCreatedAt: Date | null;
  /**
   * MAX across the client's deals of any activity: deal.updatedAt, latest
   * comment / task (created + updated) / attachment, and latest Deal AuditLog.
   * This is the "last deal update" used for filtering / sorting.
   */
  lastActivityAt: Date | null;
}

// Shape of the client query — tags + owner are needed by the list UI.
const clientStatsArgs = {
  include: {
    tags: true,
    owner: true,
    deals: {
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
        amountEur: true,
        stage: { select: { isWon: true, isLost: true } },
      },
    },
  },
} satisfies Prisma.ClientDefaultArgs;

type ClientWithDeals = Prisma.ClientGetPayload<typeof clientStatsArgs>;

/** A visible client enriched with deal/activity stats (raw deals omitted). */
export type ClientWithStats = Omit<ClientWithDeals, "deals"> & { stats: ClientStats };

function maxDate(a: Date | null, b: Date | null | undefined): Date | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return b > a ? b : a;
}

/**
 * Fetch all clients the user may see (respecting `clientVisibilityWhere`),
 * each enriched with deal counts, pipeline value, last-deal date and a
 * cross-source "last activity" timestamp. Activity is aggregated with a small
 * fixed number of grouped queries (no N+1 per client).
 */
export async function getClientsWithStats(
  user: User,
  opts: ClientFilterOpts = {}
): Promise<ClientWithStats[]> {
  const { search, sort = "recent" } = opts;
  const visibility = await clientVisibilityWhere(user);

  const searchWhere: Prisma.ClientWhereInput = search
    ? {
        OR: [
          { name: { contains: search } },
          { contactName: { contains: search } },
          { contactEmail: { contains: search } },
          { country: { contains: search } },
        ],
      }
    : {};

  // Column/relation filters that can run in the DB (additive — narrow only).
  const filterWhere: Prisma.ClientWhereInput[] = [];
  if (opts.ownerId) filterWhere.push({ ownerId: opts.ownerId });
  if (opts.size) filterWhere.push({ size: opts.size });
  if (opts.country) filterWhere.push({ country: opts.country });
  // Require ALL selected tags (progressive narrowing).
  for (const tagId of opts.tagIds ?? []) {
    filterWhere.push({ tags: { some: { id: tagId } } });
  }

  const clients = await prisma.client.findMany({
    where: { AND: [visibility, searchWhere, ...filterWhere] },
    ...clientStatsArgs,
    take: 500,
  });

  // Collect every visible deal id so activity lookups stay RBAC-scoped.
  const dealIds = clients.flatMap((c) => c.deals.map((d) => d.id));

  // Per-deal latest-activity maps, built from a handful of grouped queries.
  const commentMax = new Map<string, Date>();
  const taskMax = new Map<string, Date>();
  const attachmentMax = new Map<string, Date>();
  const auditMax = new Map<string, Date>();

  if (dealIds.length > 0) {
    const [comments, tasks, attachments, audits] = await Promise.all([
      prisma.comment.groupBy({
        by: ["dealId"],
        where: { dealId: { in: dealIds } },
        _max: { createdAt: true },
      }),
      prisma.task.groupBy({
        by: ["dealId"],
        where: { dealId: { in: dealIds } },
        _max: { createdAt: true, updatedAt: true },
      }),
      prisma.attachment.groupBy({
        by: ["dealId"],
        where: { dealId: { in: dealIds } },
        _max: { createdAt: true },
      }),
      prisma.auditLog.groupBy({
        by: ["entityId"],
        where: { entity: "Deal", entityId: { in: dealIds } },
        _max: { createdAt: true },
      }),
    ]);

    for (const c of comments) {
      if (c._max.createdAt) commentMax.set(c.dealId, c._max.createdAt);
    }
    for (const t of tasks) {
      const m = maxDate(t._max.createdAt ?? null, t._max.updatedAt ?? null);
      if (m) taskMax.set(t.dealId, m);
    }
    for (const a of attachments) {
      if (a._max.createdAt) attachmentMax.set(a.dealId, a._max.createdAt);
    }
    for (const a of audits) {
      if (a.entityId && a._max.createdAt) auditMax.set(a.entityId, a._max.createdAt);
    }
  }

  const enriched: ClientWithStats[] = clients.map((client) => {
    const { deals, ...rest } = client;

    let openCount = 0;
    let wonCount = 0;
    let lostCount = 0;
    let openPipelineEur = 0;
    let totalPipelineEur = 0;
    let lastDealCreatedAt: Date | null = null;
    let lastActivityAt: Date | null = null;

    for (const d of deals) {
      const amount = d.amountEur ? Number(d.amountEur) : 0;
      totalPipelineEur += amount;

      if (d.stage.isWon) {
        wonCount += 1;
      } else if (d.stage.isLost) {
        lostCount += 1;
      } else {
        openCount += 1;
        openPipelineEur += amount;
      }

      lastDealCreatedAt = maxDate(lastDealCreatedAt, d.createdAt);

      // Roll the deal's own update + every activity source into the client max.
      lastActivityAt = maxDate(lastActivityAt, d.updatedAt);
      lastActivityAt = maxDate(lastActivityAt, commentMax.get(d.id));
      lastActivityAt = maxDate(lastActivityAt, taskMax.get(d.id));
      lastActivityAt = maxDate(lastActivityAt, attachmentMax.get(d.id));
      lastActivityAt = maxDate(lastActivityAt, auditMax.get(d.id));
    }

    const stats: ClientStats = {
      dealCount: deals.length,
      openCount,
      wonCount,
      lostCount,
      openPipelineEur,
      totalPipelineEur,
      lastDealCreatedAt,
      lastActivityAt,
    };

    return { ...rest, stats };
  });

  // Stats-derived predicates can only be evaluated after enrichment.
  const cutoff =
    opts.activeWithinDays != null ? recencyCutoff(opts.activeWithinDays) : null;
  const filtered = enriched.filter((c) => {
    if (opts.hasOpenDeals && c.stats.openCount === 0) return false;
    if (opts.noDeals && c.stats.dealCount !== 0) return false;
    if (cutoff && !(c.stats.lastActivityAt && c.stats.lastActivityAt >= cutoff))
      return false;
    return true;
  });

  return sortClients(filtered, sort);
}

/**
 * Distinct, RBAC-scoped facet values (size / country) for populating the
 * client filter selects. Only values present on clients the user may see.
 */
export async function getClientFilterFacets(
  user: User
): Promise<{ sizes: string[]; countries: string[] }> {
  const visibility = await clientVisibilityWhere(user);
  const rows = await prisma.client.findMany({
    where: visibility,
    select: { size: true, country: true },
    take: 2000,
  });
  const sizes = new Set<string>();
  const countries = new Set<string>();
  for (const r of rows) {
    if (r.size) sizes.add(r.size);
    if (r.country) countries.add(r.country);
  }
  return {
    sizes: [...sizes].sort((a, b) => a.localeCompare(b)),
    countries: [...countries].sort((a, b) => a.localeCompare(b)),
  };
}

function sortClients(clients: ClientWithStats[], sort: ClientSort): ClientWithStats[] {
  const byTimeDesc = (a: Date | null, b: Date | null) =>
    (b?.getTime() ?? 0) - (a?.getTime() ?? 0);

  switch (sort) {
    case "name":
      return clients.sort((a, b) => a.name.localeCompare(b.name));
    case "deals":
      return clients.sort(
        (a, b) =>
          b.stats.dealCount - a.stats.dealCount ||
          byTimeDesc(a.stats.lastActivityAt, b.stats.lastActivityAt)
      );
    case "value":
      return clients.sort(
        (a, b) =>
          b.stats.openPipelineEur - a.stats.openPipelineEur ||
          byTimeDesc(a.stats.lastActivityAt, b.stats.lastActivityAt)
      );
    case "recent":
    default:
      return clients.sort((a, b) =>
        byTimeDesc(a.stats.lastActivityAt, b.stats.lastActivityAt)
      );
  }
}
