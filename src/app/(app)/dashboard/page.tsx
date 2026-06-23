import {
  TrendingUp,
  TrendingDown,
  Wallet,
  Trophy,
  Target,
  Percent,
  Coins,
  CircleDot,
  Clock,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { requireFullAuth } from "@/lib/auth/guards";
import { getAnalytics, getIntervalComparison, type Granularity, type KpiDelta } from "@/lib/analytics";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { DashboardFilters } from "@/components/dashboard/dashboard-filters";
import { ScorecardTable } from "@/components/dashboard/scorecard-table";
import {
  FunnelChart,
  CreatedVsWonChart,
  StatusPie,
  ComparisonChart,
} from "@/components/dashboard/dashboard-charts";
import { formatCurrency } from "@/lib/utils";

function parseDate(v?: string): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function DeltaBadge({ delta, invert }: { delta?: KpiDelta; invert?: boolean }) {
  if (!delta) return null;
  const up = delta.absolute > 0;
  const flat = delta.absolute === 0;
  // For "good when down" metrics (e.g. loss rate), invert the color semantics.
  const good = flat ? false : invert ? !up : up;
  const Icon = up ? TrendingUp : TrendingDown;
  const pct = delta.percent;
  return (
    <span
      className={`mt-1 inline-flex items-center gap-1 text-xs ${
        flat ? "text-muted-foreground" : good ? "text-[var(--success)]" : "text-destructive"
      }`}
    >
      {!flat && <Icon className="h-3 w-3" />}
      {pct == null ? "—" : `${up ? "+" : ""}${Math.round(pct)}%`} vs prev
    </span>
  );
}

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  delta,
  invert,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  delta?: KpiDelta;
  invert?: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between p-5">
        <div>
          <div className="text-sm text-muted-foreground">{label}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
          {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
          <DeltaBadge delta={delta} invert={invert} />
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

function StatusCard({
  label,
  count,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  count: number;
  value: number;
  icon: React.ElementType;
  tone: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon className="h-4 w-4" style={{ color: tone }} />
            {label}
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{count}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{formatCurrency(value)}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    active?: string;
    gran?: string;
    cmp?: string;
    cmpMonths?: string;
    cmpCount?: string;
  }>;
}) {
  const user = await requireFullAuth();
  const sp = await searchParams;

  const granularity: Granularity =
    sp.gran === "semester" || sp.gran === "year" ? sp.gran : "quarter";
  const activeOnly = sp.active === "1";

  const analytics = await getAnalytics(user, {
    from: parseDate(sp.from),
    to: parseDate(sp.to) ?? new Date(),
    activeOnly,
    granularity,
  });

  const cmpOn = sp.cmp === "1";
  const comparison = cmpOn
    ? await getIntervalComparison(user, {
        periodMonths: Number(sp.cmpMonths) || 3,
        numberOfPeriods: Number(sp.cmpCount) || 4,
        activeOnly,
      })
    : null;
  const d = comparison?.deltas ?? null;

  const k = analytics.kpis;
  const s = analytics.status;

  return (
    <div className="pb-10">
      <PageHeader title="Dashboard" description={`Welcome back, ${user.name.split(" ")[0]}.`} />
      <div className="space-y-6 p-4 md:p-6">
        <DashboardFilters />

        {/* KPI row */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard
            label="Pipeline total"
            value={formatCurrency(k.pipelineTotal)}
            sub={`${k.pipelineCount} open deals`}
            icon={Wallet}
            delta={d?.pipelineTotal}
          />
          <StatCard
            label="Win rate"
            value={`${Math.round(k.winRate)}%`}
            sub={`${k.wonCount}W / ${k.lostCount}L closed`}
            icon={Target}
            delta={d?.winRate}
          />
          <StatCard
            label="Loss rate"
            value={`${Math.round(k.lossRate)}%`}
            sub={`${k.lostCount} of ${k.closedCount} closed`}
            icon={Percent}
            delta={d?.lossRate}
            invert
          />
          <StatCard
            label="Avg won deal"
            value={formatCurrency(k.avgWonDeal)}
            sub={`${k.wonCount} won deals`}
            icon={Coins}
            delta={d?.avgWonDeal}
          />
          <StatCard
            label="Total won"
            value={formatCurrency(k.totalWon)}
            sub={`${k.wonCount} deals`}
            icon={Trophy}
            delta={d?.totalWon}
          />
        </div>

        {/* Status row */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatusCard label="Active" count={s.active.count} value={s.active.value} icon={CircleDot} tone="var(--chart-1)" />
          <StatusCard label="Won · in progress" count={s.wonInProgress.count} value={s.wonInProgress.value} icon={Clock} tone="var(--chart-3)" />
          <StatusCard label="Won · closed" count={s.wonClosed.count} value={s.wonClosed.value} icon={CheckCircle2} tone="var(--chart-2)" />
          <StatusCard label="Lost" count={s.lost.count} value={s.lost.value} icon={XCircle} tone="var(--chart-4)" />
        </div>

        {/* Charts */}
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <FunnelChart data={analytics.funnel} />
          </div>
          <StatusPie status={s} />
        </div>

        {comparison ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <CreatedVsWonChart data={analytics.series} />
            <ComparisonChart periods={comparison.periods} />
          </div>
        ) : (
          <CreatedVsWonChart data={analytics.series} />
        )}

        {/* Scorecard */}
        <ScorecardTable scorecard={analytics.scorecard} granularity={granularity} />
      </div>
    </div>
  );
}
