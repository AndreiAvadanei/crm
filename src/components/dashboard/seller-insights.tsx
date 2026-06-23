"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { ScorecardGrid } from "@/components/dashboard/scorecard-table";
import { formatCurrency } from "@/lib/utils";
import type { SellerStats } from "@/lib/analytics";

/** Single headline stat used in the per-seller metric strip. */
function Metric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="min-w-[120px] flex-1">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className="mt-0.5 text-lg font-semibold tabular-nums"
        style={tone ? { color: tone } : undefined}
      >
        {value}
      </div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function TrendTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-sm">
      <div className="mb-1 font-medium">{label}</div>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: p.stroke }}
          />
          {p.name}: <span className="font-medium">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Compact created-vs-won trend for a single seller. */
function SellerTrend({ data }: { data: SellerStats["series"] }) {
  const hasData = data.some((d) => d.created > 0 || d.won > 0);
  if (!hasData) {
    return (
      <div className="flex h-[160px] items-center justify-center text-xs text-muted-foreground">
        No activity in this window.
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={160}>
      <AreaChart data={data} margin={{ left: -10, right: 8, top: 8 }}>
        <defs>
          <linearGradient id="sCreated" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="sWon" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--chart-2)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--chart-2)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
        <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} allowDecimals={false} width={28} />
        <Tooltip content={<TrendTooltip />} />
        <Area type="monotone" dataKey="created" name="Created" stroke="var(--chart-1)" fill="url(#sCreated)" strokeWidth={2} />
        <Area type="monotone" dataKey="won" name="Won" stroke="var(--chart-2)" fill="url(#sWon)" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function winColor(rate: number) {
  return rate >= 50
    ? "var(--success)"
    : rate >= 25
      ? "var(--warning)"
      : "var(--destructive)";
}

export function SellerInsights({ sellers }: { sellers: SellerStats[] }) {
  return (
    <div className="space-y-6">
      {sellers.map((s) => {
        const k = s.kpis;
        return (
          <Card key={s.ownerId} className="overflow-hidden">
            <CardHeader className="space-y-4 border-b bg-muted/20">
              <div className="flex items-center gap-3">
                <Avatar name={s.name} color={s.avatarColor} className="h-10 w-10 text-sm" />
                <div>
                  <div className="text-base font-semibold">{s.name}</div>
                  <Badge variant={s.role === "ADMIN" ? "default" : "secondary"} className="mt-0.5">
                    {s.role}
                  </Badge>
                </div>
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-3">
                <Metric label="Won value" value={formatCurrency(k.totalWon)} sub={`${k.wonCount} deals`} />
                <Metric
                  label="Win rate"
                  value={`${Math.round(k.winRate)}%`}
                  sub={`${k.wonCount}W / ${k.lostCount}L`}
                  tone={k.closedCount ? winColor(k.winRate) : undefined}
                />
                <Metric label="Pipeline" value={formatCurrency(k.pipelineTotal)} sub={`${k.openCount} open`} />
                <Metric label="Avg won deal" value={formatCurrency(k.avgWonDeal)} />
                <Metric
                  label="Avg cycle"
                  value={k.avgDaysToClose ? `${Math.round(k.avgDaysToClose)}d` : "—"}
                  sub="create → win"
                />
                <Metric
                  label="Lost value"
                  value={formatCurrency(k.totalLost)}
                  sub={`${Math.round(k.lossRate)}% loss`}
                />
              </div>
            </CardHeader>
            <CardContent className="grid gap-6 p-4 md:p-6 lg:grid-cols-[1.6fr_1fr]">
              <div>
                <div className="mb-2 text-xs font-medium text-muted-foreground">
                  Win rate &amp; value by year × period
                </div>
                <div className="overflow-x-auto">
                  <ScorecardGrid
                    scorecard={s.scorecard}
                    emptyLabel="No closed deals yet for this seller."
                  />
                </div>
              </div>
              <div>
                <div className="mb-2 text-xs font-medium text-muted-foreground">
                  Created vs won (trend)
                </div>
                <SellerTrend data={s.series} />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
