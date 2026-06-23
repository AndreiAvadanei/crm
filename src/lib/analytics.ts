import "server-only";
import { prisma } from "@/lib/db";
import { dealVisibilityWhere } from "@/lib/rbac";
import { Prisma, type User } from "@/generated/prisma";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Scorecard column granularity: Trimestrial / Semestrial / Anual. */
export type Granularity = "quarter" | "semester" | "year";

export type AnalyticsFilters = {
  /** Inclusive lower bound for the KPI/funnel/series window (by createdAt). */
  from?: Date | null;
  /** Inclusive upper bound for the KPI/funnel/series window (by createdAt). */
  to?: Date | null;
  /** When true, only open/active deals are considered for KPI/funnel/series. */
  activeOnly?: boolean;
  /** Scorecard column grouping. */
  granularity?: Granularity;
};

export type Kpis = {
  /** Open (not won, not lost) deal value. */
  pipelineTotal: number;
  pipelineCount: number;
  /** won / (won + lost) closed deals, as a percentage. */
  winRate: number;
  /** lost / (won + lost) closed deals, as a percentage. */
  lossRate: number;
  avgWonDeal: number;
  totalWon: number;
  /** Total value of lost deals. */
  totalLost: number;
  wonCount: number;
  lostCount: number;
  openCount: number;
  closedCount: number;
  totalCount: number;
  /** Average days from creation to win (won deals with a closedAt only). */
  avgDaysToClose: number;
};

export type StatusBucket = { count: number; value: number };

/** The status row of the scorecard: Active / Won-in-progress / Won-closed / Lost. */
export type StatusRow = {
  active: StatusBucket;
  wonInProgress: StatusBucket;
  wonClosed: StatusBucket;
  lost: StatusBucket;
};

export type FunnelStage = {
  id: string;
  name: string;
  color: string;
  order: number;
  count: number;
  value: number;
};

export type TimePoint = {
  key: string;
  label: string;
  created: number;
  createdValue: number;
  won: number;
  wonValue: number;
};

export type ScorecardCell = {
  /** Column label, e.g. "Q1", "H1", "Year", or "Total". */
  period: string;
  winRate: number | null;
  /** Won value within the period. */
  totalValue: number;
  dealCount: number;
  wonCount: number;
  lostCount: number;
  lostValue: number;
  lossRate: number | null;
  empty: boolean;
};

export type ScorecardRow = {
  year: number;
  cells: ScorecardCell[];
  total: ScorecardCell;
};

export type Scorecard = {
  /** Column headers, depending on granularity. */
  periods: string[];
  rows: ScorecardRow[];
};

export type ResolvedFilters = {
  from: Date | null;
  to: Date;
  activeOnly: boolean;
  granularity: Granularity;
};

export type AnalyticsResult = {
  kpis: Kpis;
  status: StatusRow;
  funnel: FunnelStage[];
  series: TimePoint[];
  scorecard: Scorecard;
  filters: ResolvedFilters;
};

export type KpiDelta = {
  current: number;
  previous: number;
  absolute: number;
  /** Percentage change vs previous; null when previous is 0. */
  percent: number | null;
};

export type PeriodMetrics = {
  label: string;
  from: Date;
  to: Date;
  kpis: Kpis;
};

export type ComparisonResult = {
  /** Back-to-back consecutive periods, ordered oldest -> newest. */
  periods: PeriodMetrics[];
  /** Most recent period vs the one immediately before it. */
  deltas: {
    pipelineTotal: KpiDelta;
    totalWon: KpiDelta;
    winRate: KpiDelta;
    lossRate: KpiDelta;
    avgWonDeal: KpiDelta;
    wonCount: KpiDelta;
  } | null;
};

export type SellerStats = {
  ownerId: string;
  name: string;
  avatarColor: string;
  role: string;
  /** KPIs over the requested window (honours from/to + activeOnly). */
  kpis: Kpis;
  /** Lead / active / closing / won / lost funnel over the requested window. */
  funnel: FunnelStage[];
  /** Year × period (quarter/semester/year) win-rate & value matrix, all-time. */
  scorecard: Scorecard;
  /** Monthly created-vs-won trend across the window. */
  series: TimePoint[];
};

// ---------------------------------------------------------------------------
// Internal data shape
// ---------------------------------------------------------------------------

type DealLite = {
  amountEur: Prisma.Decimal | null;
  createdAt: Date;
  closedAt: Date | null;
  ownerId: string | null;
  owner: { name: string; avatarColor: string; role: string } | null;
  stage: {
    id: string;
    name: string;
    color: string;
    order: number;
    isWon: boolean;
    isLost: boolean;
    probability: number;
    phase: string | null;
  };
};

const amt = (d: { amountEur: Prisma.Decimal | null }) =>
  d.amountEur ? Number(d.amountEur) : 0;

/**
 * Fetch the minimal deal fields needed for analytics, scoped to what `user`
 * may see via RBAC. Admins receive `{}` (all deals); sales users get the
 * owner/share/tag-scoped OR clause from `dealVisibilityWhere`.
 */
async function fetchScopedDeals(
  user: User,
  extra?: Prisma.DealWhereInput
): Promise<DealLite[]> {
  const visibility = await dealVisibilityWhere(user);
  const where: Prisma.DealWhereInput = extra
    ? { AND: [visibility, extra] }
    : visibility;
  return prisma.deal.findMany({
    where,
    select: {
      amountEur: true,
      createdAt: true,
      closedAt: true,
      ownerId: true,
      owner: { select: { name: true, avatarColor: true, role: true } },
      stage: {
        select: {
          id: true,
          name: true,
          color: true,
          order: true,
          isWon: true,
          isLost: true,
          probability: true,
          phase: true,
        },
      },
    },
    take: 50000,
  });
}

// ---------------------------------------------------------------------------
// Period helpers
// ---------------------------------------------------------------------------

function periodCount(g: Granularity) {
  return g === "quarter" ? 4 : g === "semester" ? 2 : 1;
}

function periodLabels(g: Granularity) {
  if (g === "quarter") return ["Q1", "Q2", "Q3", "Q4"];
  if (g === "semester") return ["H1", "H2"];
  return ["Year"];
}

/** 0-based period index of a date within its year for the given granularity. */
function periodIndex(date: Date, g: Granularity) {
  const m = date.getMonth(); // 0-11
  if (g === "quarter") return Math.floor(m / 3);
  if (g === "semester") return Math.floor(m / 6);
  return 0;
}

function emptyCell(period: string): ScorecardCell {
  return {
    period,
    winRate: null,
    totalValue: 0,
    dealCount: 0,
    wonCount: 0,
    lostCount: 0,
    lostValue: 0,
    lossRate: null,
    empty: true,
  };
}

// ---------------------------------------------------------------------------
// KPI computation
// ---------------------------------------------------------------------------

function computeKpis(deals: DealLite[]): Kpis {
  let pipelineTotal = 0;
  let pipelineCount = 0;
  let totalWon = 0;
  let totalLost = 0;
  let wonCount = 0;
  let lostCount = 0;
  let openCount = 0;
  let cycleDaysSum = 0;
  let cycleCount = 0;

  for (const d of deals) {
    const v = amt(d);
    if (d.stage.isWon) {
      wonCount += 1;
      totalWon += v;
      if (d.closedAt) {
        const days = (d.closedAt.getTime() - d.createdAt.getTime()) / 86_400_000;
        if (days >= 0) {
          cycleDaysSum += days;
          cycleCount += 1;
        }
      }
    } else if (d.stage.isLost) {
      lostCount += 1;
      totalLost += v;
    } else {
      openCount += 1;
      pipelineTotal += v;
      pipelineCount += 1;
    }
  }

  const closedCount = wonCount + lostCount;
  return {
    pipelineTotal,
    pipelineCount,
    winRate: closedCount ? (wonCount / closedCount) * 100 : 0,
    lossRate: closedCount ? (lostCount / closedCount) * 100 : 0,
    avgWonDeal: wonCount ? totalWon / wonCount : 0,
    totalWon,
    totalLost,
    wonCount,
    lostCount,
    openCount,
    closedCount,
    totalCount: deals.length,
    avgDaysToClose: cycleCount ? cycleDaysSum / cycleCount : 0,
  };
}

function computeStatus(deals: DealLite[]): StatusRow {
  const status: StatusRow = {
    active: { count: 0, value: 0 },
    wonInProgress: { count: 0, value: 0 },
    wonClosed: { count: 0, value: 0 },
    lost: { count: 0, value: 0 },
  };
  for (const d of deals) {
    const v = amt(d);
    if (d.stage.isWon) {
      const bucket = d.closedAt ? status.wonClosed : status.wonInProgress;
      bucket.count += 1;
      bucket.value += v;
    } else if (d.stage.isLost) {
      status.lost.count += 1;
      status.lost.value += v;
    } else {
      status.active.count += 1;
      status.active.value += v;
    }
  }
  return status;
}

function computeFunnel(deals: DealLite[]): FunnelStage[] {
  const map = new Map<string, FunnelStage>();
  for (const d of deals) {
    if (d.stage.isWon || d.stage.isLost) continue; // funnel = open pipeline stages
    const s = d.stage;
    const cur =
      map.get(s.id) ??
      { id: s.id, name: s.name, color: s.color, order: s.order, count: 0, value: 0 };
    cur.count += 1;
    cur.value += amt(d);
    map.set(s.id, cur);
  }
  return [...map.values()].sort((a, b) => a.order - b.order);
}

const PHASE_FUNNEL_STAGES = [
  { id: "lead", name: "Lead", color: "var(--chart-1)", order: 1 },
  { id: "closing", name: "Closing", color: "var(--chart-3)", order: 2 },
  { id: "won", name: "Won", color: "var(--success)", order: 3 },
  { id: "lost", name: "Lost", color: "var(--destructive)", order: 4 },
  { id: "active", name: "Active", color: "var(--chart-2)", order: 5 },
] satisfies Omit<FunnelStage, "count" | "value">[];

function phaseBucket(d: DealLite): (typeof PHASE_FUNNEL_STAGES)[number]["id"] {
  if (d.stage.isWon) return "won";
  if (d.stage.isLost) return "lost";

  const phase = d.stage.phase?.trim().toLowerCase();
  if (phase === "lead" || phase === "closing" || phase === "active") return phase;

  return "active";
}

function computePhaseFunnel(deals: DealLite[]): FunnelStage[] {
  const map = new Map(
    PHASE_FUNNEL_STAGES.map((s) => [s.id, { ...s, count: 0, value: 0 }])
  );

  for (const d of deals) {
    const bucket = map.get(phaseBucket(d));
    if (!bucket) continue;
    bucket.count += 1;
    bucket.value += amt(d);
  }

  return [...map.values()].sort((a, b) => a.order - b.order);
}

/** Monthly created-vs-won series across the window (defaults to last 12 months). */
function computeSeries(deals: DealLite[], from: Date | null, to: Date): TimePoint[] {
  const end = new Date(to.getFullYear(), to.getMonth(), 1);
  let start: Date;
  if (from) {
    start = new Date(from.getFullYear(), from.getMonth(), 1);
  } else {
    start = new Date(end.getFullYear(), end.getMonth() - 11, 1);
  }
  // Cap to a sane number of buckets.
  const points: TimePoint[] = [];
  const idx = new Map<string, number>();
  const cursor = new Date(start);
  let guard = 0;
  while (cursor <= end && guard < 120) {
    const key = `${cursor.getFullYear()}-${cursor.getMonth()}`;
    const label =
      cursor.toLocaleString("en", { month: "short" }) +
      (cursor.getMonth() === 0 ? ` '${String(cursor.getFullYear()).slice(2)}` : "");
    idx.set(key, points.length);
    points.push({ key, label, created: 0, createdValue: 0, won: 0, wonValue: 0 });
    cursor.setMonth(cursor.getMonth() + 1);
    guard += 1;
  }

  for (const d of deals) {
    const c = d.createdAt;
    const ck = `${c.getFullYear()}-${c.getMonth()}`;
    if (idx.has(ck)) {
      const p = points[idx.get(ck)!];
      p.created += 1;
      p.createdValue += amt(d);
    }
    if (d.stage.isWon && d.closedAt) {
      const w = d.closedAt;
      const wk = `${w.getFullYear()}-${w.getMonth()}`;
      if (idx.has(wk)) {
        const p = points[idx.get(wk)!];
        p.won += 1;
        p.wonValue += amt(d);
      }
    }
  }
  return points;
}

/**
 * Scorecard matrix: year (rows) x period (Q/H/Year columns) + a per-year total.
 * Deals are bucketed by their resolution date (closedAt, falling back to
 * createdAt) and only closed (won/lost) deals contribute, since the matrix
 * measures win/loss performance per period.
 */
function computeScorecard(deals: DealLite[], g: Granularity): Scorecard {
  const labels = periodLabels(g);
  const count = periodCount(g);

  type Agg = {
    wonCount: number;
    lostCount: number;
    wonValue: number;
    lostValue: number;
  };
  const byYear = new Map<number, Agg[]>();

  const ensure = (year: number) => {
    let arr = byYear.get(year);
    if (!arr) {
      arr = Array.from({ length: count }, () => ({
        wonCount: 0,
        lostCount: 0,
        wonValue: 0,
        lostValue: 0,
      }));
      byYear.set(year, arr);
    }
    return arr;
  };

  for (const d of deals) {
    if (!d.stage.isWon && !d.stage.isLost) continue;
    const ref = d.closedAt ?? d.createdAt;
    const year = ref.getFullYear();
    const pi = periodIndex(ref, g);
    const agg = ensure(year)[pi];
    const v = amt(d);
    if (d.stage.isWon) {
      agg.wonCount += 1;
      agg.wonValue += v;
    } else {
      agg.lostCount += 1;
      agg.lostValue += v;
    }
  }

  const toCell = (period: string, a: Agg): ScorecardCell => {
    const closed = a.wonCount + a.lostCount;
    return {
      period,
      winRate: closed ? (a.wonCount / closed) * 100 : null,
      totalValue: a.wonValue,
      dealCount: closed,
      wonCount: a.wonCount,
      lostCount: a.lostCount,
      lostValue: a.lostValue,
      lossRate: closed ? (a.lostCount / closed) * 100 : null,
      empty: closed === 0,
    };
  };

  const years = [...byYear.keys()].sort((a, b) => b - a); // newest first
  const rows: ScorecardRow[] = years.map((year) => {
    const aggs = byYear.get(year)!;
    const cells = aggs.map((a, i) => toCell(labels[i], a));
    const total: Agg = aggs.reduce(
      (acc, a) => ({
        wonCount: acc.wonCount + a.wonCount,
        lostCount: acc.lostCount + a.lostCount,
        wonValue: acc.wonValue + a.wonValue,
        lostValue: acc.lostValue + a.lostValue,
      }),
      { wonCount: 0, lostCount: 0, wonValue: 0, lostValue: 0 }
    );
    return { year, cells, total: toCell("Total", total) };
  });

  return { periods: labels, rows };
}

// ---------------------------------------------------------------------------
// Window filtering
// ---------------------------------------------------------------------------

function applyWindow(deals: DealLite[], f: ResolvedFilters): DealLite[] {
  return deals.filter((d) => {
    if (f.from && d.createdAt < f.from) return false;
    if (d.createdAt > f.to) return false;
    if (f.activeOnly && (d.stage.isWon || d.stage.isLost)) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Full analytics bundle for the dashboard, scoped to the user's visible deals.
 * KPIs / funnel / series respect the from/to window and active-only toggle;
 * the scorecard spans all years (so the year x period grid is meaningful).
 */
export async function getAnalytics(
  user: User,
  filters: AnalyticsFilters = {}
): Promise<AnalyticsResult> {
  const resolved: ResolvedFilters = {
    from: filters.from ?? null,
    to: filters.to ?? new Date(),
    activeOnly: filters.activeOnly ?? false,
    granularity: filters.granularity ?? "quarter",
  };

  const all = await fetchScopedDeals(user);
  const windowed = applyWindow(all, resolved);

  return {
    kpis: computeKpis(windowed),
    status: computeStatus(windowed),
    funnel: computeFunnel(windowed),
    series: computeSeries(windowed, resolved.from, resolved.to),
    // Scorecard ignores activeOnly (needs closed deals) and spans all years.
    scorecard: computeScorecard(all, resolved.granularity),
    filters: resolved,
  };
}

/**
 * Per-seller KPI breakdown for the admin comparison page. Honours the same
 * window / active-only filters. RBAC still applies (admins see all owners;
 * a scoped user would only see owners of deals they can access).
 */
export async function getSellerBreakdown(
  user: User,
  filters: AnalyticsFilters = {}
): Promise<SellerStats[]> {
  const resolved: ResolvedFilters = {
    from: filters.from ?? null,
    to: filters.to ?? new Date(),
    activeOnly: filters.activeOnly ?? false,
    granularity: filters.granularity ?? "quarter",
  };

  const all = await fetchScopedDeals(user);
  const windowed = applyWindow(all, resolved);

  type Group = {
    meta: DealLite["owner"];
    /** Deals inside the active window — drives KPIs and the trend series. */
    windowed: DealLite[];
    /** All-time deals for this owner — drives the year × period scorecard. */
    all: DealLite[];
  };
  const groups = new Map<string, Group>();
  const ensure = (d: DealLite): Group => {
    const key = d.ownerId ?? "__unassigned__";
    let g = groups.get(key);
    if (!g) {
      g = { meta: d.owner, windowed: [], all: [] };
      groups.set(key, g);
    }
    // Prefer non-null owner metadata if we encounter it.
    if (!g.meta && d.owner) g.meta = d.owner;
    return g;
  };
  for (const d of all) ensure(d).all.push(d);
  for (const d of windowed) ensure(d).windowed.push(d);

  const rows: SellerStats[] = [];
  for (const [ownerId, g] of groups) {
    rows.push({
      ownerId,
      name: g.meta?.name ?? "Unassigned",
      avatarColor: g.meta?.avatarColor ?? "#94a3b8",
      role: g.meta?.role ?? "—",
      kpis: computeKpis(g.windowed),
      funnel: computePhaseFunnel(g.windowed),
      scorecard: computeScorecard(g.all, resolved.granularity),
      series: computeSeries(g.windowed, resolved.from, resolved.to),
    });
  }

  // Default ordering: by won value desc, then pipeline desc.
  rows.sort(
    (a, b) =>
      b.kpis.totalWon - a.kpis.totalWon || b.kpis.pipelineTotal - a.kpis.pipelineTotal
  );
  return rows;
}

function delta(current: number, previous: number): KpiDelta {
  return {
    current,
    previous,
    absolute: current - previous,
    percent: previous !== 0 ? ((current - previous) / Math.abs(previous)) * 100 : null,
  };
}

/**
 * Compare consecutive back-to-back intervals walking backwards from an anchor.
 * e.g. anchorDate=now, periodMonths=3, numberOfPeriods=4 yields the last four
 * 3-month windows (oldest -> newest), each with its own KPIs, plus deltas of
 * the most recent window vs the previous one.
 */
export async function getIntervalComparison(
  user: User,
  opts: {
    anchorDate?: Date;
    periodMonths: number;
    numberOfPeriods: number;
    activeOnly?: boolean;
  }
): Promise<ComparisonResult> {
  const anchor = opts.anchorDate ?? new Date();
  const months = Math.max(1, opts.periodMonths);
  const n = Math.max(1, opts.numberOfPeriods);
  const activeOnly = opts.activeOnly ?? false;

  const all = await fetchScopedDeals(user);

  // Build n consecutive windows ending at the anchor, walking backwards.
  const bounds: { from: Date; to: Date }[] = [];
  let cursorTo = new Date(anchor);
  for (let i = 0; i < n; i++) {
    const from = new Date(cursorTo);
    from.setMonth(from.getMonth() - months);
    bounds.push({ from, to: new Date(cursorTo) });
    cursorTo = from;
  }
  bounds.reverse(); // oldest -> newest

  const periods: PeriodMetrics[] = bounds.map(({ from, to }) => {
    const windowed = all.filter((d) => {
      if (d.createdAt < from || d.createdAt > to) return false;
      if (activeOnly && (d.stage.isWon || d.stage.isLost)) return false;
      return true;
    });
    const fmt = (dt: Date) =>
      dt.toLocaleString("en", { month: "short", year: "2-digit" });
    return {
      label: `${fmt(from)}–${fmt(to)}`,
      from,
      to,
      kpis: computeKpis(windowed),
    };
  });

  let deltas: ComparisonResult["deltas"] = null;
  if (periods.length >= 2) {
    const cur = periods[periods.length - 1].kpis;
    const prev = periods[periods.length - 2].kpis;
    deltas = {
      pipelineTotal: delta(cur.pipelineTotal, prev.pipelineTotal),
      totalWon: delta(cur.totalWon, prev.totalWon),
      winRate: delta(cur.winRate, prev.winRate),
      lossRate: delta(cur.lossRate, prev.lossRate),
      avgWonDeal: delta(cur.avgWonDeal, prev.avgWonDeal),
      wonCount: delta(cur.wonCount, prev.wonCount),
    };
  }

  return { periods, deltas };
}
