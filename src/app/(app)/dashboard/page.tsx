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
import { prisma } from "@/lib/db";
import { isAdmin } from "@/lib/rbac";
import { getOwners } from "@/lib/view-helpers";
import { getAnalytics, getIntervalComparison, type Granularity, type KpiDelta } from "@/lib/analytics";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { DashboardFilters } from "@/components/dashboard/dashboard-filters";
import { DashboardAnalytics } from "@/components/dashboard/dashboard-analytics";
import { MyWork } from "@/components/dashboard/my-overdue";
import type { TaskItemData } from "@/components/tasks/task-common";
import { ScorecardTable } from "@/components/dashboard/scorecard-table";
import {
  FunnelChart,
  CreatedVsWonChart,
  StatusPie,
  ComparisonChart,
} from "@/components/dashboard/dashboard-charts";
import { formatCurrency } from "@/lib/utils";

export const metadata = {
  title: "Dashboard",
};

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
  tone = "var(--chart-1)",
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  delta?: KpiDelta;
  invert?: boolean;
  tone?: string;
}) {
  return (
    <Card className="card-interactive">
      <CardContent className="flex items-start justify-between p-5">
        <div>
          <div className="text-[13px] font-medium text-muted-foreground">{label}</div>
          <div className="mt-1.5 text-[1.65rem] font-semibold tracking-tight tabular-nums text-foreground">{value}</div>
          {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
          <DeltaBadge delta={delta} invert={invert} />
        </div>
        {/* Tinted icon chip adds color without overwhelming the card. */}
        <div
          className="flex h-11 w-11 items-center justify-center rounded-2xl"
          style={{ backgroundColor: `color-mix(in oklch, ${tone} 16%, transparent)`, color: tone }}
        >
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
    <Card className="card-interactive">
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <span
              className="flex h-7 w-7 items-center justify-center rounded-xl"
              style={{ backgroundColor: `color-mix(in oklch, ${tone} 16%, transparent)`, color: tone }}
            >
              <Icon className="h-3.5 w-3.5" />
            </span>
            {label}
          </div>
          <div className="mt-1.5 text-[1.65rem] font-semibold tracking-tight tabular-nums text-foreground">{count}</div>
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

  // "My work" panel: overdue + next-7-days lists for tasks and deals (mine).
  const admin = isAdmin(user);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const in7Days = new Date(today);
  in7Days.setDate(in7Days.getDate() + 7);
  const HOME_CAP = 100;

  const taskInclude = { deal: { select: { salesId: true, title: true } }, assignee: true } as const;
  const dealInclude = { stage: { select: { name: true } } } as const;

  const [overdueTaskRows, upcomingTaskRows, overdueDealRows, upcomingDealRows, owners] =
    await Promise.all([
      prisma.task.findMany({
        where: { assigneeId: user.id, status: "OPEN", dueDate: { lt: today } },
        include: taskInclude,
        orderBy: [{ urgency: "desc" }, { dueDate: "asc" }, { createdAt: "desc" }],
        take: HOME_CAP,
      }),
      prisma.task.findMany({
        where: { assigneeId: user.id, status: "OPEN", dueDate: { gte: today, lt: in7Days } },
        include: taskInclude,
        orderBy: [{ urgency: "desc" }, { dueDate: "asc" }, { createdAt: "desc" }],
        take: HOME_CAP,
      }),
      prisma.deal.findMany({
        // Open deals (not won/lost closed) that I own.
        where: { ownerId: user.id, closedAt: null, deletedAt: null, dueDate: { lt: today } },
        include: dealInclude,
        orderBy: { dueDate: "asc" },
        take: HOME_CAP,
      }),
      prisma.deal.findMany({
        where: { ownerId: user.id, closedAt: null, deletedAt: null, dueDate: { gte: today, lt: in7Days } },
        include: dealInclude,
        orderBy: { dueDate: "asc" },
        take: HOME_CAP,
      }),
      admin ? getOwners() : Promise.resolve([] as { id: string; name: string }[]),
    ]);

  const toTaskRow = (t: (typeof overdueTaskRows)[number]): TaskItemData => ({
    id: t.id,
    title: t.title,
    type: t.type,
    status: t.status,
    urgency: t.urgency,
    dueDate: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null,
    dealSalesId: t.deal.salesId,
    dealTitle: t.deal.title,
    assigneeId: t.assigneeId,
    assigneeName: t.assignee?.name ?? null,
    assigneeColor: t.assignee?.avatarColor ?? null,
  });
  const toDealRow = (dl: (typeof overdueDealRows)[number]) => ({
    id: dl.id,
    salesId: dl.salesId,
    title: dl.title,
    dueDate: dl.dueDate!.toISOString().slice(0, 10),
    amountEur: dl.amountEur != null ? Number(dl.amountEur) : null,
    stageName: dl.stage.name,
  });

  const myOverdueTasks = overdueTaskRows.map((t) => toTaskRow(t));
  const myUpcomingTasks = upcomingTaskRows.map((t) => toTaskRow(t));
  const myOverdueDeals = overdueDealRows.map(toDealRow);
  const myUpcomingDeals = upcomingDealRows.map(toDealRow);

  return (
    <div>
      <PageHeader title="Dashboard" description={`Welcome back, ${user.name.split(" ")[0]}.`} />
      <div className="page-body space-y-6 pt-0">
        <MyWork
          overdueTasks={myOverdueTasks}
          upcomingTasks={myUpcomingTasks}
          overdueDeals={myOverdueDeals}
          upcomingDeals={myUpcomingDeals}
          owners={owners}
          admin={admin}
        />

        <DashboardAnalytics>
          <DashboardFilters />

          {/* KPI row */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard
              label="Pipeline total"
              value={formatCurrency(k.pipelineTotal)}
              sub={`${k.pipelineCount} open deals`}
              icon={Wallet}
              delta={d?.pipelineTotal}
              tone="var(--chart-1)"
            />
            <StatCard
              label="Win rate"
              value={`${Math.round(k.winRate)}%`}
              sub={`${k.wonCount}W / ${k.lostCount}L closed`}
              icon={Target}
              delta={d?.winRate}
              tone="var(--chart-2)"
            />
            <StatCard
              label="Loss rate"
              value={`${Math.round(k.lossRate)}%`}
              sub={`${k.lostCount} of ${k.closedCount} closed`}
              icon={Percent}
              delta={d?.lossRate}
              invert
              tone="var(--chart-4)"
            />
            <StatCard
              label="Avg won deal"
              value={formatCurrency(k.avgWonDeal)}
              sub={`${k.wonCount} won deals`}
              icon={Coins}
              delta={d?.avgWonDeal}
              tone="var(--chart-3)"
            />
            <StatCard
              label="Total won"
              value={formatCurrency(k.totalWon)}
              sub={`${k.wonCount} deals`}
              icon={Trophy}
              delta={d?.totalWon}
              tone="var(--chart-5)"
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
        </DashboardAnalytics>
      </div>
    </div>
  );
}
