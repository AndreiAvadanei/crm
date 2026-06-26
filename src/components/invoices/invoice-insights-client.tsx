"use client";

import * as React from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  Cell,
} from "recharts";
import { TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  ClientYearCell,
  CurrencySummary,
  ForecastBucket,
  MonthComparison,
  PeriodBucket,
  YearMonthCell,
} from "@/lib/invoice-insights";

type PeriodCompare = PeriodBucket & { previousAmount: number; delta: number; deltaPct: number | null };

export type InsightsData = {
  generatedAt: string;
  currentYear: number;
  previousYear: number;
  currencies: string[];
  summaries: CurrencySummary[];
  yearly: PeriodBucket[];
  monthly: MonthComparison[];
  quarters: PeriodCompare[];
  semesters: PeriodCompare[];
  forecast: ForecastBucket[];
  monthlyMatrix: YearMonthCell[];
  clientYearly: ClientYearCell[];
};

// Approximate value of one unit of each currency expressed in EUR. Used as the
// neutral anchor so the reporting currency can be switched without losing edits.
const FX_ANCHOR_EUR: Record<string, number> = { EUR: 1, USD: 0.92, RON: 0.2 };
const REPORTING_OPTIONS = ["RON", "EUR", "USD"];
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STORAGE_KEY = "invoiceInsightsFx";

function defaultRate(currency: string, reporting: string): number {
  const cur = FX_ANCHOR_EUR[currency];
  const rep = FX_ANCHOR_EUR[reporting];
  if (cur == null || rep == null || rep === 0) return currency === reporting ? 1 : 1;
  return Number((cur / rep).toFixed(4));
}

function pct(delta: number, base: number): number | null {
  return base === 0 ? null : (delta / base) * 100;
}

function money(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value)} ${currency}`.trim();
  }
}

const CURRENCY_SYMBOLS: Record<string, string> = { EUR: "€", USD: "$", GBP: "£" };

/**
 * Deterministic compact currency format (e.g. "RON 15K", "€1.5M"). Implemented
 * with plain arithmetic instead of Intl compact notation, whose output differs
 * between Node (server) and browser ICU and caused SSR hydration mismatches.
 */
function compactMoney(value: number, currency: string): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  let n = abs;
  let suffix = "";
  if (abs >= 1e9) {
    n = abs / 1e9;
    suffix = "B";
  } else if (abs >= 1e6) {
    n = abs / 1e6;
    suffix = "M";
  } else if (abs >= 1e3) {
    n = abs / 1e3;
    suffix = "K";
  }
  let numStr: string;
  if (suffix) {
    numStr = (Math.round(n * 10) / 10).toString();
    if (numStr.endsWith(".0")) numStr = numStr.slice(0, -2);
  } else {
    // <1000: group thousands deterministically (en-US grouping is ICU-stable).
    numStr = Math.round(n).toLocaleString("en-US");
  }
  const symbol = CURRENCY_SYMBOLS[currency];
  return symbol ? `${symbol}${sign}${numStr}${suffix}` : `${sign}${currency} ${numStr}${suffix}`;
}

function Delta({ value, pctValue }: { value: number; pctValue: number | null }) {
  const positive = value >= 0;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${positive ? "text-[var(--success)]" : "text-destructive"}`}>
      {positive ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
      {pctValue == null ? "—" : `${pctValue >= 0 ? "+" : ""}${pctValue.toFixed(1)}%`}
    </span>
  );
}

function ChartTooltip({ active, payload, label, currency }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium">{label}</div>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color || p.fill || p.stroke }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-medium">{typeof p.value === "number" ? money(p.value, currency) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

export function InvoiceInsightsClient({ data }: { data: InsightsData }) {
  const present = data.currencies.length ? data.currencies : ["RON"];
  const initialReporting = present.includes("EUR") ? "EUR" : present.includes("RON") ? "RON" : present[0];

  const [reporting, setReporting] = React.useState(initialReporting);
  const [rates, setRates] = React.useState<Record<string, number>>({});

  // Build/refresh rate map whenever the reporting currency changes, restoring any
  // saved user overrides for that reporting currency from localStorage.
  React.useEffect(() => {
    let saved: Record<string, Record<string, number>> = {};
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch {
      saved = {};
    }
    const savedForReporting = saved[reporting] ?? {};
    const next: Record<string, number> = {};
    for (const cur of present) {
      next[cur] = cur === reporting ? 1 : savedForReporting[cur] ?? defaultRate(cur, reporting);
    }
    setRates(next);
  }, [reporting, data.currencies.join(",")]);

  function updateRate(currency: string, value: number) {
    setRates((prev) => {
      const next = { ...prev, [currency]: value };
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
        saved[reporting] = { ...(saved[reporting] ?? {}), [currency]: value };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
      } catch {
        /* ignore persistence errors */
      }
      return next;
    });
  }

  const convert = React.useCallback(
    (amount: number, currency: string) => amount * (currency === reporting ? 1 : rates[currency] ?? defaultRate(currency, reporting)),
    [rates, reporting]
  );

  // ---- Overall (converted) aggregations --------------------------------------
  const overall = React.useMemo(() => {
    const summary = {
      invoicedYear: 0,
      previousYear: 0,
      invoicedYtd: 0,
      previousYtd: 0,
      openToInvoice: 0,
      expectedCashNext90: 0,
      outstandingNet: 0,
      invoiceCount: 0,
    };
    for (const s of data.summaries) {
      summary.invoicedYear += convert(s.invoicedYear, s.currency);
      summary.previousYear += convert(s.previousYear, s.currency);
      summary.invoicedYtd += convert(s.invoicedYtd, s.currency);
      summary.previousYtd += convert(s.previousYtd, s.currency);
      summary.openToInvoice += convert(s.openToInvoice, s.currency);
      summary.expectedCashNext90 += convert(s.expectedCashNext90, s.currency);
      summary.outstandingNet += convert(s.outstandingNet, s.currency);
      summary.invoiceCount += s.invoiceCount;
    }

    const yearMap = new Map<string, number>();
    for (const y of data.yearly) yearMap.set(y.label, (yearMap.get(y.label) ?? 0) + convert(y.amount, y.currency));
    const yearly = Array.from(yearMap.entries())
      .map(([label, amount]) => ({ label, amount }))
      .sort((a, b) => a.label.localeCompare(b.label));

    const monthly = MONTH_LABELS.map((label, idx) => {
      const month = idx + 1;
      const rows = data.monthly.filter((m) => m.month === month);
      const current = rows.reduce((sum, m) => sum + convert(m.current, m.currency), 0);
      const previous = rows.reduce((sum, m) => sum + convert(m.previous, m.currency), 0);
      return { label, current, previous };
    });

    const groupCompare = (list: PeriodCompare[]) => {
      const map = new Map<string, { label: string; current: number; previous: number }>();
      for (const row of list) {
        const e = map.get(row.label) ?? { label: row.label, current: 0, previous: 0 };
        e.current += convert(row.amount, row.currency);
        e.previous += convert(row.previousAmount, row.currency);
        map.set(row.label, e);
      }
      return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
    };

    const forecastMap = new Map<string, { label: string; invoiced: number; toInvoice: number; total: number }>();
    for (const f of data.forecast) {
      const e = forecastMap.get(f.label) ?? { label: f.label, invoiced: 0, toInvoice: 0, total: 0 };
      e.invoiced += convert(f.invoicedCash, f.currency);
      e.toInvoice += convert(f.toInvoiceCash, f.currency);
      e.total += convert(f.total, f.currency);
      forecastMap.set(f.label, e);
    }
    let running = 0;
    const forecast = Array.from(forecastMap.values())
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((row) => {
        running += row.total;
        return { ...row, cumulative: running };
      });

    return {
      summary,
      yearly,
      monthly,
      quarters: groupCompare(data.quarters),
      semesters: groupCompare(data.semesters),
      forecast,
    };
  }, [data, convert]);

  const yoyDelta = overall.summary.invoicedYear - overall.summary.previousYear;
  const ytdDelta = overall.summary.invoicedYtd - overall.summary.previousYtd;
  const otherCurrencies = present.filter((c) => c !== reporting);
  const tickMoney = (v: number) => compactMoney(v, reporting);

  return (
    <div className="space-y-6 px-4 pb-6 md:px-6">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 py-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Reporting currency</label>
            <select
              value={reporting}
              onChange={(e) => setReporting(e.target.value)}
              className="block h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              {Array.from(new Set([...REPORTING_OPTIONS, ...present])).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          {otherCurrencies.map((cur) => (
            <div key={cur} className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">1 {cur} = ? {reporting}</label>
              <input
                type="number"
                step="0.0001"
                min={0}
                value={rates[cur] ?? ""}
                onChange={(e) => updateRate(cur, Number(e.target.value) || 0)}
                className="block h-9 w-32 rounded-md border border-input bg-background px-3 text-sm tabular-nums"
              />
            </div>
          ))}
          <p className="ml-auto max-w-sm text-xs text-muted-foreground">
            All figures are net of VAT and converted to {reporting} at the rates above. Rates are approximate and saved in your browser.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title={`Invoiced ${data.currentYear}`}
          value={money(overall.summary.invoicedYtd, reporting)}
          footer={
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">vs {data.previousYear} YTD: {money(overall.summary.previousYtd, reporting)}</span>
                <Delta value={ytdDelta} pctValue={pct(ytdDelta, overall.summary.previousYtd)} />
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">vs {data.previousYear} full: {money(overall.summary.previousYear, reporting)}</span>
                <Delta value={yoyDelta} pctValue={pct(yoyDelta, overall.summary.previousYear)} />
              </div>
            </div>
          }
        />
        <KpiCard
          title="Predicted cash · next 90d"
          value={money(overall.summary.expectedCashNext90, reporting)}
          footer={<span className="text-xs text-muted-foreground">Issued +30d, to-invoice +40d</span>}
        />
        <KpiCard
          title="Open to invoice"
          value={money(overall.summary.openToInvoice, reporting)}
          footer={<span className="text-xs text-muted-foreground">Scheduled, not yet issued</span>}
        />
        <KpiCard
          title="Outstanding (net)"
          value={money(overall.summary.outstandingNet, reporting)}
          footer={<span className="text-xs text-muted-foreground">{overall.summary.invoiceCount} invoices total</span>}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <ChartCard title="Invoiced net by year">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={overall.yearly} margin={{ left: 4, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
              <YAxis tickFormatter={tickMoney} width={64} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
              <Tooltip content={(p) => <ChartTooltip {...p} currency={reporting} />} cursor={{ fill: "var(--accent)" }} />
              <Bar dataKey="amount" name="Invoiced net" radius={[6, 6, 0, 0]}>
                {overall.yearly.map((row) => (
                  <Cell key={row.label} fill={row.label === String(data.currentYear) ? "var(--chart-2)" : "var(--chart-1)"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title={`Predicted cashflow · ${reporting}`}>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={overall.forecast} margin={{ left: 4, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} angle={-30} textAnchor="end" height={50} />
              <YAxis tickFormatter={tickMoney} width={64} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
              <Tooltip content={(p) => <ChartTooltip {...p} currency={reporting} />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="invoiced" name="From invoiced" stackId="cash" fill="var(--chart-2)" radius={[0, 0, 0, 0]} />
              <Bar dataKey="toInvoice" name="From to-invoice" stackId="cash" fill="var(--chart-4)" radius={[6, 6, 0, 0]} />
              <Line dataKey="cumulative" name="Cumulative" stroke="var(--chart-1)" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <ChartCard title={`Monthly net · ${data.currentYear} vs ${data.previousYear}`}>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={overall.monthly} margin={{ left: 4, right: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
            <YAxis tickFormatter={tickMoney} width={64} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
            <Tooltip content={(p) => <ChartTooltip {...p} currency={reporting} />} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="previous" name={String(data.previousYear)} fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
            <Bar dataKey="current" name={String(data.currentYear)} fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="grid gap-6 xl:grid-cols-2">
        <PeriodChart title={`Quarters · ${data.currentYear} vs ${data.previousYear}`} rows={overall.quarters} reporting={reporting} prevYear={data.previousYear} curYear={data.currentYear} tickMoney={tickMoney} />
        <PeriodChart title={`Semesters · ${data.currentYear} vs ${data.previousYear}`} rows={overall.semesters} reporting={reporting} prevYear={data.previousYear} curYear={data.currentYear} tickMoney={tickMoney} />
      </div>

      <HistoryHeatmap matrix={data.monthlyMatrix} convert={convert} reporting={reporting} currentYear={data.currentYear} />

      <ClientActivityMatrix clients={data.clientYearly} convert={convert} reporting={reporting} />

      <Card>
        <CardHeader>
          <CardTitle>Per-currency breakdown (native amounts)</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3">Currency</th>
                <th className="py-2 pr-3 text-right">Invoices</th>
                <th className="py-2 pr-3 text-right">{data.previousYear}</th>
                <th className="py-2 pr-3 text-right">{data.currentYear}</th>
                <th className="py-2 pr-3 text-right">YoY</th>
                <th className="py-2 pr-3 text-right">To invoice</th>
                <th className="py-2 pr-3 text-right">Outstanding</th>
                <th className="py-2 pr-3 text-right">≈ {reporting} (year)</th>
              </tr>
            </thead>
            <tbody>
              {data.summaries.map((s) => (
                <tr key={s.currency} className="border-b last:border-0">
                  <td className="py-2 pr-3 font-medium">{s.currency}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{s.invoiceCount}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{money(s.previousYear, s.currency)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{money(s.invoicedYear, s.currency)}</td>
                  <td className="py-2 pr-3 text-right"><Delta value={s.yoyDelta} pctValue={s.yoyDeltaPct} /></td>
                  <td className="py-2 pr-3 text-right tabular-nums">{money(s.openToInvoice, s.currency)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{money(s.outstandingNet, s.currency)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{money(convert(s.invoicedYear, s.currency), reporting)}</td>
                </tr>
              ))}
              {data.summaries.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-muted-foreground">No invoices yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({ title, value, footer }: { title: string; value: string; footer: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="space-y-2 py-4">
        <div className="text-xs font-medium text-muted-foreground">{title}</div>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        {footer}
      </CardContent>
    </Card>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function PeriodChart({
  title,
  rows,
  reporting,
  prevYear,
  curYear,
  tickMoney,
}: {
  title: string;
  rows: { label: string; current: number; previous: number }[];
  reporting: string;
  prevYear: number;
  curYear: number;
  tickMoney: (v: number) => string;
}) {
  return (
    <ChartCard title={title}>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={rows} margin={{ left: 4, right: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
          <YAxis tickFormatter={tickMoney} width={64} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
          <Tooltip content={(p) => <ChartTooltip {...p} currency={reporting} />} cursor={{ fill: "var(--accent)" }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="previous" name={String(prevYear)} fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
          <Bar dataKey="current" name={String(curYear)} fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// Green heat background scaled to the largest value in the dataset.
function heatStyle(value: number, max: number): React.CSSProperties {
  if (value <= 0 || max <= 0) return {};
  const ratio = Math.min(1, value / max);
  return { backgroundColor: `color-mix(in oklab, var(--success) ${Math.round(8 + ratio * 55)}%, transparent)` };
}

// Badge styling that gets progressively "hotter" the longer a client has been
// inactive: active (green) -> 1yr (amber) -> 2yr (orange) -> 3-4yr (red) -> 5yr+ (deep red).
function inactivityBadge(years: number): { className: string; label: string } {
  if (years <= 0) return { className: "bg-[var(--success)]/15 text-[var(--success)]", label: "active" };
  if (years === 1) return { className: "bg-amber-500/15 text-amber-600 dark:text-amber-400", label: "1 yr" };
  if (years === 2) return { className: "bg-orange-500/20 text-orange-600 dark:text-orange-400", label: "2 yr" };
  if (years <= 4) return { className: "bg-red-500/20 text-red-600 dark:text-red-400", label: `${years} yr` };
  return { className: "bg-red-600/30 text-red-700 dark:text-red-300", label: `${years} yr` };
}

const INACTIVITY_LEGEND: { label: string; className: string }[] = [
  { label: "Active", className: "bg-[var(--success)]/15 text-[var(--success)]" },
  { label: "1 yr", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  { label: "2 yr", className: "bg-orange-500/20 text-orange-600 dark:text-orange-400" },
  { label: "3–4 yr", className: "bg-red-500/20 text-red-600 dark:text-red-400" },
  { label: "5+ yr", className: "bg-red-600/30 text-red-700 dark:text-red-300" },
];

type Convert = (amount: number, currency: string) => number;

function HistoryHeatmap({
  matrix,
  convert,
  reporting,
  currentYear,
}: {
  matrix: YearMonthCell[];
  convert: Convert;
  reporting: string;
  currentYear: number;
}) {
  const years = React.useMemo(() => Array.from(new Set(matrix.map((c) => c.year))).sort((a, b) => a - b), [matrix]);

  // year -> month(1..12) -> converted amount
  const byYear = React.useMemo(() => {
    const map = new Map<number, number[]>();
    for (const y of years) map.set(y, Array(12).fill(0));
    for (const c of matrix) {
      const arr = map.get(c.year);
      if (arr) arr[c.month - 1] += convert(c.amount, c.currency);
    }
    return map;
  }, [matrix, years, convert]);

  const maxMonthCell = React.useMemo(() => {
    let max = 0;
    for (const arr of byYear.values()) for (const v of arr) if (v > max) max = v;
    return max;
  }, [byYear]);

  const quarterRows = years.map((y) => {
    const m = byYear.get(y)!;
    const q = [0, 1, 2, 3].map((qi) => m[qi * 3] + m[qi * 3 + 1] + m[qi * 3 + 2]);
    return { year: y, q };
  });
  const maxQuarter = Math.max(1, ...quarterRows.flatMap((r) => r.q));

  const semesterRows = years.map((y) => {
    const m = byYear.get(y)!;
    const s1 = m.slice(0, 6).reduce((a, b) => a + b, 0);
    const s2 = m.slice(6).reduce((a, b) => a + b, 0);
    return { year: y, s1, s2, ratio: s1 === 0 ? null : (s2 / s1) * 100 };
  });
  const maxSemester = Math.max(1, ...semesterRows.flatMap((r) => [r.s1, r.s2]));

  const cell = (v: number) => (v > 0 ? compactMoney(v, reporting) : "·");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Revenue by year × month (full history)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-right text-xs tabular-nums">
            <thead>
              <tr className="text-muted-foreground">
                <th className="sticky left-0 z-10 bg-card px-2 py-2 text-left">Year</th>
                {MONTH_LABELS.map((m) => (
                  <th key={m} className="px-2 py-2 font-medium">{m}</th>
                ))}
                <th className="px-2 py-2 font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {years.map((y) => {
                const m = byYear.get(y)!;
                const total = m.reduce((a, b) => a + b, 0);
                return (
                  <tr key={y} className={y === currentYear ? "font-medium" : ""}>
                    <td className="sticky left-0 z-10 bg-card px-2 py-1.5 text-left font-medium">{y}</td>
                    {m.map((v, i) => (
                      <td key={i} className="rounded px-2 py-1.5" style={heatStyle(v, maxMonthCell)}>{cell(v)}</td>
                    ))}
                    <td className="px-2 py-1.5 font-semibold">{compactMoney(total, reporting)}</td>
                  </tr>
                );
              })}
              {years.length === 0 && (
                <tr><td colSpan={14} className="py-8 text-center text-muted-foreground">No issued invoices yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="overflow-x-auto">
            <div className="mb-2 text-sm font-medium">Quarters</div>
            <table className="w-full border-separate border-spacing-0 text-right text-xs tabular-nums">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="px-2 py-2 text-left">Year</th>
                  {["Q1", "Q2", "Q3", "Q4"].map((q) => <th key={q} className="px-2 py-2 font-medium">{q}</th>)}
                </tr>
              </thead>
              <tbody>
                {quarterRows.map((r) => (
                  <tr key={r.year} className={r.year === currentYear ? "font-medium" : ""}>
                    <td className="px-2 py-1.5 text-left font-medium">{r.year}</td>
                    {r.q.map((v, i) => (
                      <td key={i} className="rounded px-2 py-1.5" style={heatStyle(v, maxQuarter)}>{cell(v)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="overflow-x-auto">
            <div className="mb-2 text-sm font-medium">Semesters & growth</div>
            <table className="w-full border-separate border-spacing-0 text-right text-xs tabular-nums">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="px-2 py-2 text-left">Year</th>
                  <th className="px-2 py-2 font-medium">S1</th>
                  <th className="px-2 py-2 font-medium">S2</th>
                  <th className="px-2 py-2 font-medium">S2/S1</th>
                </tr>
              </thead>
              <tbody>
                {semesterRows.map((r) => (
                  <tr key={r.year} className={r.year === currentYear ? "font-medium" : ""}>
                    <td className="px-2 py-1.5 text-left font-medium">{r.year}</td>
                    <td className="rounded px-2 py-1.5" style={heatStyle(r.s1, maxSemester)}>{cell(r.s1)}</td>
                    <td className="rounded px-2 py-1.5" style={heatStyle(r.s2, maxSemester)}>{cell(r.s2)}</td>
                    <td className={`px-2 py-1.5 ${r.ratio == null ? "text-muted-foreground" : r.ratio >= 100 ? "text-[var(--success)]" : "text-destructive"}`}>
                      {r.ratio == null ? "—" : `${r.ratio.toFixed(0)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ClientActivityMatrix({
  clients,
  convert,
  reporting,
}: {
  clients: ClientYearCell[];
  convert: Convert;
  reporting: string;
}) {
  const years = React.useMemo(() => Array.from(new Set(clients.map((c) => c.year))).sort((a, b) => a - b), [clients]);
  const latestYear = years.length ? years[years.length - 1] : new Date().getUTCFullYear();

  const [sortBy, setSortBy] = React.useState<number | "total" | "inactive">("total");
  const [onlyInactive, setOnlyInactive] = React.useState(false);
  const [showAll, setShowAll] = React.useState(false);

  const LIMIT = 60;

  type Row = { id: string; name: string; byYear: Map<number, number>; total: number; lastActive: number };
  const rows = React.useMemo(() => {
    const map = new Map<string, Row>();
    for (const c of clients) {
      const amount = convert(c.amount, c.currency);
      const r = map.get(c.clientId) ?? { id: c.clientId, name: c.clientName, byYear: new Map(), total: 0, lastActive: 0 };
      r.byYear.set(c.year, (r.byYear.get(c.year) ?? 0) + amount);
      r.total += amount;
      if (amount > 0 && c.year > r.lastActive) r.lastActive = c.year;
      map.set(c.clientId, r);
    }
    return Array.from(map.values());
  }, [clients, convert]);

  const sorted = React.useMemo(() => {
    let list = rows;
    if (typeof sortBy === "number" && onlyInactive) {
      list = list.filter((r) => (r.byYear.get(sortBy) ?? 0) <= 0);
    }
    if (sortBy === "inactive") {
      // Longest-inactive first; ties broken by larger historic total.
      return [...list].sort(
        (a, b) => (latestYear - a.lastActive) - (latestYear - b.lastActive) === 0
          ? b.total - a.total
          : (latestYear - b.lastActive) - (latestYear - a.lastActive)
      );
    }
    const metric = (r: Row) => (sortBy === "total" ? r.total : r.byYear.get(sortBy) ?? 0);
    return [...list].sort((a, b) => metric(b) - metric(a));
  }, [rows, sortBy, onlyInactive, latestYear]);

  const filtered = React.useMemo(
    () => (showAll ? sorted : sorted.slice(0, LIMIT)),
    [sorted, showAll]
  );

  const maxCell = React.useMemo(() => {
    let max = 0;
    for (const r of rows) for (const v of r.byYear.values()) if (v > max) max = v;
    return max;
  }, [rows]);

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle>Client activity over time ({rows.length})</CardTitle>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Sort by
            <select
              value={String(sortBy)}
              onChange={(e) => {
                const v = e.target.value;
                setSortBy(v === "total" || v === "inactive" ? v : Number(v));
              }}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="total">Total historic</option>
              <option value="inactive">Inactivity (longest first)</option>
              {[...years].reverse().map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
          {typeof sortBy === "number" && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={onlyInactive} onChange={(e) => setOnlyInactive(e.target.checked)} className="h-3.5 w-3.5" />
              Only inactive in {sortBy}
            </label>
          )}
          {sorted.length > LIMIT && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="h-3.5 w-3.5" />
              Show all ({sorted.length})
            </label>
          )}
          <div className="flex items-center gap-1.5">
            {INACTIVITY_LEGEND.map((l) => (
              <span key={l.label} className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${l.className}`}>
                {l.label}
              </span>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-right text-xs tabular-nums">
          <thead>
            <tr className="text-muted-foreground">
              <th className="sticky left-0 z-10 bg-card px-2 py-2 text-left">Company</th>
              <th className="px-2 py-2 font-medium">Active until</th>
              <th className="px-2 py-2 font-medium">Inactive</th>
              {years.map((y) => (
                <th key={y} className={`px-2 py-2 font-medium ${sortBy === y ? "text-foreground underline" : ""}`}>{y}</th>
              ))}
              <th className="px-2 py-2 font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const inactiveYears = Math.max(0, latestYear - r.lastActive);
              return (
                <tr key={r.id} className="border-b">
                  <td className="sticky left-0 z-10 max-w-[220px] truncate bg-card px-2 py-1.5 text-left font-medium" title={r.name}>{r.name}</td>
                  <td className="px-2 py-1.5">{r.lastActive || "—"}</td>
                  <td className="px-2 py-1.5">
                    {(() => {
                      const badge = inactivityBadge(inactiveYears);
                      return (
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${badge.className}`}>
                          {badge.label}
                        </span>
                      );
                    })()}
                  </td>
                  {years.map((y) => {
                    const v = r.byYear.get(y) ?? 0;
                    return (
                      <td key={y} className={`rounded px-2 py-1.5 ${sortBy === y ? "ring-1 ring-inset ring-[var(--ring)]" : ""}`} style={heatStyle(v, maxCell)}>
                        {v > 0 ? compactMoney(v, reporting) : "·"}
                      </td>
                    );
                  })}
                  <td className="px-2 py-1.5 font-semibold">{compactMoney(r.total, reporting)}</td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={years.length + 4} className="py-8 text-center text-muted-foreground">No clients match.</td></tr>
            )}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-muted-foreground">
          {showAll || sorted.length <= LIMIT
            ? `Showing all ${filtered.length} clients by the selected metric.`
            : `Showing top ${LIMIT} of ${sorted.length} clients by the selected metric.`}
        </p>
      </CardContent>
    </Card>
  );
}
