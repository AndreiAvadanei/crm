"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  AreaChart,
  Area,
  Cell,
  PieChart,
  Pie,
  Legend,
  LineChart,
  Line,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { formatCurrency } from "@/lib/utils";
import type {
  FunnelStage,
  TimePoint,
  StatusRow,
  PeriodMetrics,
} from "@/lib/analytics";

const fmt = (n: number) => formatCurrency(n);

export type LeaderRow = { name: string; color: string; wonValue: number; wonCount: number };

function ValueTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-2xl border border-border/80 bg-popover/95 px-3 py-2 text-xs shadow-[var(--shadow-md)] backdrop-blur-xl">
      <div className="mb-1 font-medium">{label}</div>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: p.color || p.fill || p.stroke }}
          />
          {p.name}:{" "}
          <span className="font-medium">
            {typeof p.value === "number" ? fmt(p.value) : p.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function CountTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-2xl border border-border/80 bg-popover/95 px-3 py-2 text-xs shadow-[var(--shadow-md)] backdrop-blur-xl">
      <div className="mb-1 font-medium">{label}</div>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: p.color || p.fill || p.stroke }}
          />
          {p.name}: <span className="font-medium">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

export function FunnelChart({ data }: { data: FunnelStage[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pipeline funnel by stage</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <EmptyChart label="No open deals in this window." />
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
              data={data}
              layout="vertical"
              margin={{ left: 10, right: 16 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                tickFormatter={(v) => `€${Math.round(v / 1000)}k`}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={120}
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              />
              <Tooltip content={<ValueTooltip />} cursor={{ fill: "var(--accent)" }} />
              <Bar dataKey="value" name="Value" radius={[0, 6, 6, 0]}>
                {data.map((d) => (
                  <Cell key={d.id} fill={d.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

export function CreatedVsWonChart({ data }: { data: TimePoint[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Deals created vs won</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <EmptyChart label="No deals in this window." />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={data} margin={{ left: 10, right: 10 }}>
              <defs>
                <linearGradient id="gCreated" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gWon" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--chart-2)" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="var(--chart-2)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
              <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} allowDecimals={false} />
              <Tooltip content={<CountTooltip />} />
              <Area type="monotone" dataKey="created" name="Created" stroke="var(--chart-1)" fill="url(#gCreated)" strokeWidth={2} />
              <Area type="monotone" dataKey="won" name="Won" stroke="var(--chart-2)" fill="url(#gWon)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

export function StatusPie({ status }: { status: StatusRow }) {
  const pie = [
    { name: "Active", value: status.active.count, color: "var(--chart-1)" },
    { name: "Won (in progress)", value: status.wonInProgress.count, color: "var(--chart-3)" },
    { name: "Won (closed)", value: status.wonClosed.count, color: "var(--chart-2)" },
    { name: "Lost", value: status.lost.count, color: "var(--chart-4)" },
  ].filter((d) => d.value > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Deal status mix</CardTitle>
      </CardHeader>
      <CardContent>
        {pie.length === 0 ? (
          <EmptyChart label="No deals in this window." />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={pie} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
                {pie.map((d) => (
                  <Cell key={d.name} fill={d.color} />
                ))}
              </Pie>
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Tooltip content={<CountTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

export function ComparisonChart({ periods }: { periods: PeriodMetrics[] }) {
  const data = periods.map((p) => ({
    label: p.label,
    won: p.kpis.totalWon,
    pipeline: p.kpis.pipelineTotal,
    winRate: Math.round(p.kpis.winRate),
  }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Period-over-period</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <EmptyChart label="No comparison data." />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={data} margin={{ left: 10, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
              <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickFormatter={(v) => `€${Math.round(v / 1000)}k`} />
              <Tooltip content={<ValueTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="won" name="Won" stroke="var(--chart-2)" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="pipeline" name="Pipeline" stroke="var(--chart-1)" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

export function SellerCompareChart({
  data,
}: {
  data: { name: string; color: string; won: number; pipeline: number }[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Won vs pipeline by seller</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <EmptyChart label="No sellers with deals in this window." />
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(220, data.length * 44)}>
            <BarChart data={data} layout="vertical" margin={{ left: 10, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                tickFormatter={(v) => `€${Math.round(v / 1000)}k`}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={120}
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              />
              <Tooltip content={<ValueTooltip />} cursor={{ fill: "var(--accent)" }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="won" name="Won" fill="var(--chart-2)" radius={[0, 4, 4, 0]} />
              <Bar dataKey="pipeline" name="Pipeline" fill="var(--chart-1)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex h-[240px] flex-col items-center justify-center gap-1.5 text-center">
      <p className="text-sm font-medium tracking-tight">{label}</p>
      <p className="text-xs text-muted-foreground">Try a wider date range or clear filters.</p>
    </div>
  );
}
