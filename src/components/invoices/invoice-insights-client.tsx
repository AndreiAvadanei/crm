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
import Link from "next/link";
import { ChevronRight, Download, ExternalLink, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { INVOICE_STATUS_LABELS } from "@/lib/invoice-constants";
import type {
  CategoryMonthCell,
  ClassYearCell,
  ClientYearCell,
  CurrencySummary,
  DueInvoice,
  ForecastBucket,
  GrowthChurnYear,
  GrowthClientYearFact,
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
  categoryMonthly: CategoryMonthCell[];
  classYearly: ClassYearCell[];
  dueInvoices: DueInvoice[];
  growthClients: GrowthClientYearFact[];
  growthChurn: GrowthChurnYear[];
  growthActiveMonths: number;
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

/** Escape a single CSV field (RFC 4180). */
function csvCell(value: string | number | null | undefined): string {
  if (value == null) return "";
  const s = typeof value === "number" ? String(value) : value;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Build a CSV string from a header row + data rows. */
function toCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) lines.push(row.map(csvCell).join(","));
  return lines.join("\n");
}

/** Trigger a browser download of a CSV blob. */
function downloadCsv(filename: string, headers: string[], rows: Array<Array<string | number | null | undefined>>) {
  const csv = toCsv(headers, rows);
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Round converted amounts for CSV (matches on-screen money formatting). */
function csvAmount(value: number): number {
  return Math.round(value);
}

function CsvDownloadButton({
  filename,
  headers,
  rows,
  disabled,
}: {
  filename: string;
  headers: string[];
  rows: Array<Array<string | number | null | undefined>>;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled || rows.length === 0}
      onClick={() => downloadCsv(filename, headers, rows)}
      title="Download as CSV"
    >
      <Download /> CSV
    </Button>
  );
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
  // When on, scheduled (not-yet-issued) invoices are folded into every figure,
  // shown as a visually distinct "predicted" layer.
  const [includeScheduled, setIncludeScheduled] = React.useState(false);
  // Scopes the "Open to invoice" / "Outstanding" KPIs. Off = current year only;
  // on = the entire history.
  const [pipelineAllYears, setPipelineAllYears] = React.useState(false);

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
      openToInvoiceYear: 0,
      scheduledYear: 0,
      expectedCashNext90: 0,
      outstandingNet: 0,
      outstandingNetYear: 0,
      invoiceCount: 0,
    };
    for (const s of data.summaries) {
      summary.invoicedYear += convert(s.invoicedYear, s.currency);
      summary.previousYear += convert(s.previousYear, s.currency);
      summary.invoicedYtd += convert(s.invoicedYtd, s.currency);
      summary.previousYtd += convert(s.previousYtd, s.currency);
      summary.openToInvoice += convert(s.openToInvoice, s.currency);
      summary.openToInvoiceYear += convert(s.openToInvoiceYear, s.currency);
      summary.scheduledYear += convert(s.scheduledYear, s.currency);
      summary.expectedCashNext90 += convert(s.expectedCashNext90, s.currency);
      summary.outstandingNet += convert(s.outstandingNet, s.currency);
      summary.outstandingNetYear += convert(s.outstandingNetYear, s.currency);
      summary.invoiceCount += s.invoiceCount;
    }

    const yearMap = new Map<string, { invoiced: number; scheduled: number }>();
    for (const y of data.yearly) {
      const e = yearMap.get(y.label) ?? { invoiced: 0, scheduled: 0 };
      e.invoiced += convert(y.amount, y.currency);
      e.scheduled += convert(y.scheduled, y.currency);
      yearMap.set(y.label, e);
    }
    const yearly = Array.from(yearMap.entries())
      .map(([label, v]) => ({ label, invoiced: v.invoiced, scheduled: v.scheduled }))
      .filter((r) => r.invoiced > 0 || (includeScheduled && r.scheduled > 0))
      .sort((a, b) => a.label.localeCompare(b.label));

    const monthly = MONTH_LABELS.map((label, idx) => {
      const month = idx + 1;
      const rows = data.monthly.filter((m) => m.month === month);
      const current = rows.reduce((sum, m) => sum + convert(m.current, m.currency), 0);
      const previous = rows.reduce((sum, m) => sum + convert(m.previous, m.currency), 0);
      const currentScheduled = rows.reduce((sum, m) => sum + convert(m.currentScheduled, m.currency), 0);
      return { label, current, previous, currentScheduled };
    });

    const groupCompare = (list: PeriodCompare[]) => {
      const map = new Map<string, { label: string; current: number; previous: number; scheduled: number }>();
      for (const row of list) {
        const e = map.get(row.label) ?? { label: row.label, current: 0, previous: 0, scheduled: 0 };
        e.current += convert(row.amount, row.currency);
        e.previous += convert(row.previousAmount, row.currency);
        e.scheduled += convert(row.scheduled, row.currency);
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
  }, [data, convert, includeScheduled]);

  const yoyDelta = overall.summary.invoicedYear - overall.summary.previousYear;
  const ytdDelta = overall.summary.invoicedYtd - overall.summary.previousYtd;
  // "Open to invoice" + "Outstanding" scope: current year by default, or all-time.
  const pipelineScopeLabel = pipelineAllYears ? "all years" : String(data.currentYear);
  const openToInvoiceValue = pipelineAllYears ? overall.summary.openToInvoice : overall.summary.openToInvoiceYear;
  const invoicedNotReceivedValue = pipelineAllYears ? overall.summary.outstandingNet : overall.summary.outstandingNetYear;
  const outstandingValue = openToInvoiceValue + invoicedNotReceivedValue;
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
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Scenario</label>
            <label
              className="flex h-9 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 text-sm transition"
              style={includeScheduled ? { borderColor: "var(--chart-4)", background: "color-mix(in oklab, var(--chart-4) 12%, transparent)" } : undefined}
            >
              <input
                type="checkbox"
                checked={includeScheduled}
                onChange={(e) => setIncludeScheduled(e.target.checked)}
                className="h-4 w-4 accent-[var(--chart-4)]"
              />
              Include scheduled invoices
            </label>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Pipeline period</label>
            <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 text-sm transition">
              <input
                type="checkbox"
                checked={pipelineAllYears}
                onChange={(e) => setPipelineAllYears(e.target.checked)}
                className="h-4 w-4"
              />
              Entire period (all years)
            </label>
          </div>
          <div className="ml-auto flex max-w-sm flex-col items-end gap-2">
            <PredictedLegend active={includeScheduled} />
            <p className="text-right text-xs text-muted-foreground">
              Net of VAT, converted to {reporting}. {includeScheduled
                ? "Predicted (scheduled, not-yet-issued) revenue is folded in and marked distinctly."
                : "Only issued invoices are counted; tick “Include scheduled” to add predictions."}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title={`Invoiced ${data.currentYear}${includeScheduled ? " + predicted" : ""}`}
          value={money(overall.summary.invoicedYtd + (includeScheduled ? overall.summary.scheduledYear : 0), reporting)}
          predicted={includeScheduled && overall.summary.scheduledYear > 0}
          footer={
            <div className="space-y-1">
              {includeScheduled && overall.summary.scheduledYear > 0 && (
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="h-2 w-2.5 rounded-sm" style={{ background: PREDICTED_SWATCH }} />
                  <span className="text-muted-foreground">
                    {money(overall.summary.invoicedYtd, reporting)} invoiced + {money(overall.summary.scheduledYear, reporting)} predicted
                  </span>
                </div>
              )}
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
          predicted
          footer={<span className="text-xs text-muted-foreground">Issued +30d, to-invoice +40d</span>}
        />
        <KpiCard
          title={`Open to invoice · ${pipelineScopeLabel}`}
          value={money(openToInvoiceValue, reporting)}
          predicted
          footer={
            <span className="text-xs text-muted-foreground">
              Scheduled, not yet issued{pipelineAllYears ? " (all years)" : ` (${data.currentYear})`}
            </span>
          }
        />
        <KpiCard
          title={`Outstanding (net) · ${pipelineScopeLabel}`}
          value={money(outstandingValue, reporting)}
          footer={
            <span className="text-xs text-muted-foreground">
              {money(openToInvoiceValue, reporting)} to invoice + {money(invoicedNotReceivedValue, reporting)} invoiced, not received
            </span>
          }
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <ChartCard title={includeScheduled ? "Net by year · invoiced + predicted" : "Invoiced net by year"}>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={overall.yearly} margin={{ left: 4, right: 8 }}>
              <ChartDefs />
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
              <YAxis tickFormatter={tickMoney} width={64} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
              <Tooltip content={(p) => <ChartTooltip {...p} currency={reporting} />} cursor={{ fill: "var(--accent)" }} />
              {includeScheduled && <Legend wrapperStyle={{ fontSize: 12 }} />}
              <Bar dataKey="invoiced" name="Invoiced" stackId="y" radius={includeScheduled ? [0, 0, 0, 0] : [6, 6, 0, 0]}>
                {overall.yearly.map((row) => (
                  <Cell key={row.label} fill={row.label === String(data.currentYear) ? "var(--chart-2)" : "var(--chart-1)"} />
                ))}
              </Bar>
              {includeScheduled && (
                <Bar dataKey="scheduled" name="Predicted (scheduled)" stackId="y" fill="url(#predicted-hatch)" stroke="var(--chart-4)" strokeWidth={1} strokeDasharray="3 2" radius={[6, 6, 0, 0]} />
              )}
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title={`Predicted cashflow · ${reporting}`}>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={overall.forecast} margin={{ left: 4, right: 8 }}>
              <ChartDefs />
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} angle={-30} textAnchor="end" height={50} />
              <YAxis tickFormatter={tickMoney} width={64} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
              <Tooltip content={(p) => <ChartTooltip {...p} currency={reporting} />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="invoiced" name="From invoiced (cash-in)" stackId="cash" fill="var(--chart-2)" radius={[0, 0, 0, 0]} />
              <Bar dataKey="toInvoice" name="Predicted (to-invoice)" stackId="cash" fill="url(#predicted-hatch)" stroke="var(--chart-4)" strokeWidth={1} strokeDasharray="3 2" radius={[6, 6, 0, 0]} />
              <Line dataKey="cumulative" name="Cumulative" stroke="var(--chart-1)" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <ChartCard title={`Monthly net · ${data.currentYear} vs ${data.previousYear}`}>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={overall.monthly} margin={{ left: 4, right: 8 }}>
            <ChartDefs />
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
            <YAxis tickFormatter={tickMoney} width={64} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
            <Tooltip content={(p) => <ChartTooltip {...p} currency={reporting} />} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="previous" name={String(data.previousYear)} fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
            <Bar dataKey="current" name={`${data.currentYear} invoiced`} stackId="cur" fill="var(--chart-2)" radius={includeScheduled ? [0, 0, 0, 0] : [4, 4, 0, 0]} />
            {includeScheduled && (
              <Bar dataKey="currentScheduled" name={`${data.currentYear} predicted`} stackId="cur" fill="url(#predicted-hatch)" stroke="var(--chart-4)" strokeWidth={1} strokeDasharray="3 2" radius={[4, 4, 0, 0]} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="grid gap-6 xl:grid-cols-2">
        <PeriodChart title={`Quarters · ${data.currentYear} vs ${data.previousYear}`} rows={overall.quarters} reporting={reporting} prevYear={data.previousYear} curYear={data.currentYear} tickMoney={tickMoney} includeScheduled={includeScheduled} />
        <PeriodChart title={`Semesters · ${data.currentYear} vs ${data.previousYear}`} rows={overall.semesters} reporting={reporting} prevYear={data.previousYear} curYear={data.currentYear} tickMoney={tickMoney} includeScheduled={includeScheduled} />
      </div>

      <HistoryHeatmap matrix={data.monthlyMatrix} convert={convert} reporting={reporting} currentYear={data.currentYear} includeScheduled={includeScheduled} />

      <CategoryYearMatrix categoryMonthly={data.categoryMonthly} convert={convert} reporting={reporting} currentYear={data.currentYear} includeScheduled={includeScheduled} />

      <ClassYearMatrix classYearly={data.classYearly} convert={convert} reporting={reporting} currentYear={data.currentYear} includeScheduled={includeScheduled} />

      <GrowthMaturitySection
        growthClients={data.growthClients}
        growthChurn={data.growthChurn}
        activeMonths={data.growthActiveMonths}
        convert={convert}
        reporting={reporting}
        currentYear={data.currentYear}
      />

      <CategoryMonthlyMatrix categoryMonthly={data.categoryMonthly} convert={convert} reporting={reporting} currentYear={data.currentYear} includeScheduled={includeScheduled} />

      <ClientActivityMatrix clients={data.clientYearly} convert={convert} reporting={reporting} includeScheduled={includeScheduled} />

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
                <th className="py-2 pr-3 text-right">Not received</th>
                <th className="py-2 pr-3 text-right">≈ {reporting} (year)</th>
              </tr>
            </thead>
            <tbody>
              {data.summaries.map((s) => (
                <tr key={s.currency} className="border-b last:border-0">
                  <td className="py-2 pr-3 font-medium">{s.currency}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{s.invoiceCount}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{money(s.previousYear, s.currency)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {money(s.invoicedYear + (includeScheduled ? s.scheduledYear : 0), s.currency)}
                    {includeScheduled && s.scheduledYear > 0 && (
                      <span className="ml-1 text-[10px] text-[var(--chart-4)]" title={`Includes ${money(s.scheduledYear, s.currency)} predicted (scheduled)`}>+pred</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right"><Delta value={s.yoyDelta} pctValue={s.yoyDeltaPct} /></td>
                  <td className="py-2 pr-3 text-right tabular-nums">{money(pipelineAllYears ? s.openToInvoice : s.openToInvoiceYear, s.currency)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{money(pipelineAllYears ? s.outstandingNet : s.outstandingNetYear, s.currency)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{money(convert(s.invoicedYear + (includeScheduled ? s.scheduledYear : 0), s.currency), reporting)}</td>
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

      <PaymentsDueTable dueInvoices={data.dueInvoices} convert={convert} reporting={reporting} />
    </div>
  );
}

function KpiCard({ title, value, footer, predicted }: { title: string; value: string; footer: React.ReactNode; predicted?: boolean }) {
  return (
    <Card style={predicted ? { borderColor: "color-mix(in oklab, var(--chart-4) 45%, var(--border))" } : undefined}>
      <CardContent className="space-y-2 py-4">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          {predicted && <span className="h-2 w-2.5 rounded-sm" style={{ background: PREDICTED_SWATCH }} title="Includes predicted (scheduled) revenue" />}
          {title}
        </div>
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
  includeScheduled,
}: {
  title: string;
  rows: { label: string; current: number; previous: number; scheduled: number }[];
  reporting: string;
  prevYear: number;
  curYear: number;
  tickMoney: (v: number) => string;
  includeScheduled: boolean;
}) {
  return (
    <ChartCard title={title}>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={rows} margin={{ left: 4, right: 8 }}>
          <ChartDefs />
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
          <YAxis tickFormatter={tickMoney} width={64} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
          <Tooltip content={(p) => <ChartTooltip {...p} currency={reporting} />} cursor={{ fill: "var(--accent)" }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="previous" name={String(prevYear)} fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
          <Bar dataKey="current" name={`${curYear}${includeScheduled ? " invoiced" : ""}`} stackId="cur" fill="var(--chart-2)" radius={includeScheduled ? [0, 0, 0, 0] : [4, 4, 0, 0]} />
          {includeScheduled && (
            <Bar dataKey="scheduled" name={`${curYear} predicted`} stackId="cur" fill="url(#predicted-hatch)" stroke="var(--chart-4)" strokeWidth={1} strokeDasharray="3 2" radius={[4, 4, 0, 0]} />
          )}
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

// CSS swatch used in legends to represent predicted (scheduled) revenue.
const PREDICTED_SWATCH = "repeating-linear-gradient(45deg, var(--chart-4) 0 2px, color-mix(in oklab, var(--chart-4) 20%, transparent) 2px 5px)";

// SVG diagonal-hatch pattern so predicted (scheduled) bar segments read as
// "not yet invoiced" at a glance. Rendered as a child <defs> of each chart.
function ChartDefs() {
  return (
    <defs>
      <pattern id="predicted-hatch" width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width={6} height={6} fill="var(--chart-4)" opacity={0.18} />
        <line x1={0} y1={0} x2={0} y2={6} stroke="var(--chart-4)" strokeWidth={2.5} />
      </pattern>
    </defs>
  );
}

// Small legend clarifying the invoiced vs predicted encoding used across charts
// and tables. `active` highlights it once predictions are folded in.
function PredictedLegend({ active }: { active: boolean }) {
  return (
    <div className={`flex items-center gap-3 text-xs ${active ? "text-foreground" : "text-muted-foreground"}`}>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-3.5 rounded-sm" style={{ background: "var(--chart-2)" }} />
        Invoiced
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-3.5 rounded-sm" style={{ background: PREDICTED_SWATCH, outline: "1px dashed var(--chart-4)", outlineOffset: "-1px" }} />
        Predicted (scheduled)
      </span>
    </div>
  );
}

// A per-cell split of invoiced (actual) vs scheduled (predicted) amounts, both
// already converted to the reporting currency.
type Split = { inv: number; sched: number };

function splitValue(s: Split, include: boolean): number {
  return s.inv + (include ? s.sched : 0);
}

// Heatmap table cell that combines invoiced + (optionally) predicted revenue.
// Cells carrying predictions get a dashed accent outline and a breakdown tooltip
// so combined figures stay distinguishable from actuals.
function HeatCell({
  split,
  include,
  max,
  reporting,
  extraClass,
}: {
  split: Split;
  include: boolean;
  max: number;
  reporting: string;
  extraClass?: string;
}) {
  const value = splitValue(split, include);
  const predicted = include && split.sched > 0;
  const style: React.CSSProperties = { ...heatStyle(value, max) };
  if (predicted) {
    style.outline = "1px dashed var(--chart-4)";
    style.outlineOffset = "-1px";
  }
  const title = predicted
    ? `Invoiced ${money(split.inv, reporting)} · predicted ${money(split.sched, reporting)} = ${money(value, reporting)}`
    : undefined;
  return (
    <td className={`rounded px-2 py-1.5 ${extraClass ?? ""}`} style={style} title={title}>
      {value > 0 ? compactMoney(value, reporting) : "·"}
    </td>
  );
}

// Combined-total cell (row/column totals) with the same predicted affordance.
function totalText(split: Split, include: boolean, reporting: string): string {
  return compactMoney(splitValue(split, include), reporting);
}

// Inactivity buckets that get progressively "hotter" the longer a client has
// been inactive: active (green) -> 1yr (amber) -> 2yr (orange) -> 3-4yr (red) ->
// 5yr+ (deep red). Each bucket owns a matcher so the legend, the per-row badge
// and the click-to-filter logic all stay in sync.
type InactivityBucket = { id: string; label: string; className: string; match: (years: number) => boolean };

const INACTIVITY_BUCKETS: InactivityBucket[] = [
  { id: "active", label: "Active", className: "bg-[var(--success)]/15 text-[var(--success)]", match: (y) => y <= 0 },
  { id: "1", label: "1 yr", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400", match: (y) => y === 1 },
  { id: "2", label: "2 yr", className: "bg-orange-500/20 text-orange-600 dark:text-orange-400", match: (y) => y === 2 },
  { id: "3-4", label: "3–4 yr", className: "bg-red-500/20 text-red-600 dark:text-red-400", match: (y) => y >= 3 && y <= 4 },
  { id: "5+", label: "5+ yr", className: "bg-red-600/30 text-red-700 dark:text-red-300", match: (y) => y >= 5 },
];

function bucketFor(years: number): InactivityBucket {
  return INACTIVITY_BUCKETS.find((b) => b.match(years)) ?? INACTIVITY_BUCKETS[0];
}

function inactivityBadge(years: number): { className: string; label: string } {
  return { className: bucketFor(years).className, label: years <= 0 ? "active" : `${years} yr` };
}

type Convert = (amount: number, currency: string) => number;

function HistoryHeatmap({
  matrix,
  convert,
  reporting,
  currentYear,
  includeScheduled,
}: {
  matrix: YearMonthCell[];
  convert: Convert;
  reporting: string;
  currentYear: number;
  includeScheduled: boolean;
}) {
  const years = React.useMemo(() => {
    const set = new Set<number>();
    for (const c of matrix) if (c.amount > 0 || (includeScheduled && c.scheduled > 0)) set.add(c.year);
    return Array.from(set).sort((a, b) => a - b);
  }, [matrix, includeScheduled]);

  // year -> month(1..12) -> { invoiced, scheduled } converted amounts
  const byYear = React.useMemo(() => {
    const map = new Map<number, Split[]>();
    for (const y of years) map.set(y, Array.from({ length: 12 }, () => ({ inv: 0, sched: 0 })));
    for (const c of matrix) {
      const arr = map.get(c.year);
      if (arr) {
        arr[c.month - 1].inv += convert(c.amount, c.currency);
        arr[c.month - 1].sched += convert(c.scheduled, c.currency);
      }
    }
    return map;
  }, [matrix, years, convert]);

  const maxMonthCell = React.useMemo(() => {
    let max = 0;
    for (const arr of byYear.values()) for (const s of arr) { const v = splitValue(s, includeScheduled); if (v > max) max = v; }
    return max;
  }, [byYear, includeScheduled]);

  const sumSplit = (arr: Split[]) => arr.reduce((a, b) => ({ inv: a.inv + b.inv, sched: a.sched + b.sched }), { inv: 0, sched: 0 });

  const quarterRows = years.map((y) => {
    const m = byYear.get(y)!;
    const q = [0, 1, 2, 3].map((qi) => sumSplit([m[qi * 3], m[qi * 3 + 1], m[qi * 3 + 2]]));
    return { year: y, q };
  });
  const maxQuarter = Math.max(1, ...quarterRows.flatMap((r) => r.q.map((s) => splitValue(s, includeScheduled))));

  const semesterRows = years.map((y) => {
    const m = byYear.get(y)!;
    const s1 = sumSplit(m.slice(0, 6));
    const s2 = sumSplit(m.slice(6));
    const s1v = splitValue(s1, includeScheduled);
    const s2v = splitValue(s2, includeScheduled);
    return { year: y, s1, s2, ratio: s1v === 0 ? null : (s2v / s1v) * 100 };
  });
  const maxSemester = Math.max(1, ...semesterRows.flatMap((r) => [splitValue(r.s1, includeScheduled), splitValue(r.s2, includeScheduled)]));

  const csvRows = years.map((y) => {
    const m = byYear.get(y)!;
    const total = sumSplit(m);
    return [
      y,
      ...m.map((s) => csvAmount(splitValue(s, includeScheduled))),
      csvAmount(splitValue(total, includeScheduled)),
    ];
  });

  return (
    <Card>
      <CardHeader className="gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <CardTitle>Revenue by year × month (full history)</CardTitle>
          {includeScheduled && <PredictedLegend active />}
        </div>
        <CsvDownloadButton
          filename={`revenue-by-year-month-${reporting}`}
          headers={["Year", ...MONTH_LABELS, "Total"]}
          rows={csvRows}
        />
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
                const total = sumSplit(m);
                return (
                  <tr key={y} className={y === currentYear ? "font-medium" : ""}>
                    <td className="sticky left-0 z-10 bg-card px-2 py-1.5 text-left font-medium">{y}</td>
                    {m.map((s, i) => (
                      <HeatCell key={i} split={s} include={includeScheduled} max={maxMonthCell} reporting={reporting} />
                    ))}
                    <td className="px-2 py-1.5 font-semibold">{totalText(total, includeScheduled, reporting)}</td>
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
                    {r.q.map((s, i) => (
                      <HeatCell key={i} split={s} include={includeScheduled} max={maxQuarter} reporting={reporting} />
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
                    <HeatCell split={r.s1} include={includeScheduled} max={maxSemester} reporting={reporting} />
                    <HeatCell split={r.s2} include={includeScheduled} max={maxSemester} reporting={reporting} />
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
  includeScheduled,
}: {
  clients: ClientYearCell[];
  convert: Convert;
  reporting: string;
  includeScheduled: boolean;
}) {
  const years = React.useMemo(() => {
    const set = new Set<number>();
    for (const c of clients) if (c.amount > 0 || (includeScheduled && c.scheduled > 0)) set.add(c.year);
    return Array.from(set).sort((a, b) => a - b);
  }, [clients, includeScheduled]);
  const latestYear = years.length ? years[years.length - 1] : new Date().getUTCFullYear();

  const [sortBy, setSortBy] = React.useState<number | "total" | "inactive">("total");
  const [onlyInactive, setOnlyInactive] = React.useState(false);
  const [showAll, setShowAll] = React.useState(false);
  const [yearsToShow, setYearsToShow] = React.useState<number | "all">("all");
  const [inactivityFilter, setInactivityFilter] = React.useState<string | null>(null);

  const LIMIT = 60;

  // Most-recent N years to render as columns. Totals / inactivity are always
  // computed from full history; this only controls which year columns show.
  const visibleYears = React.useMemo(
    () => (yearsToShow === "all" ? years : years.slice(-yearsToShow)),
    [years, yearsToShow]
  );

  const yearOptions = React.useMemo(() => {
    const opts = [3, 5, 10].filter((n) => n < years.length);
    return opts;
  }, [years.length]);

  // If the year we're sorting/filtering by is no longer visible, fall back to total.
  React.useEffect(() => {
    if (typeof sortBy === "number" && !visibleYears.includes(sortBy)) {
      setSortBy("total");
      setOnlyInactive(false);
    }
  }, [visibleYears, sortBy]);

  type Row = { id: string; name: string; byYear: Map<number, Split>; total: number; lastActive: number };
  // Raw per-year splits (invoiced/predicted), independent of the toggle.
  const rawRows = React.useMemo(() => {
    const map = new Map<string, { id: string; name: string; byYear: Map<number, Split> }>();
    for (const c of clients) {
      const r = map.get(c.clientId) ?? { id: c.clientId, name: c.clientName, byYear: new Map<number, Split>() };
      const s = r.byYear.get(c.year) ?? { inv: 0, sched: 0 };
      s.inv += convert(c.amount, c.currency);
      s.sched += convert(c.scheduled, c.currency);
      r.byYear.set(c.year, s);
      map.set(c.clientId, r);
    }
    return Array.from(map.values());
  }, [clients, convert]);

  // Totals / last-active recomputed whenever predictions are toggled.
  const rows = React.useMemo<Row[]>(() => {
    return rawRows.map((r) => {
      let total = 0;
      let lastActive = 0;
      for (const [y, s] of r.byYear) {
        const v = splitValue(s, includeScheduled);
        total += v;
        if (v > 0 && y > lastActive) lastActive = y;
      }
      return { ...r, total, lastActive };
    }).filter((r) => r.total > 0);
  }, [rawRows, includeScheduled]);

  const valFor = React.useCallback(
    (r: Row, y: number) => splitValue(r.byYear.get(y) ?? { inv: 0, sched: 0 }, includeScheduled),
    [includeScheduled]
  );

  const sorted = React.useMemo(() => {
    let list = rows;
    if (inactivityFilter) {
      list = list.filter((r) => bucketFor(Math.max(0, latestYear - r.lastActive)).id === inactivityFilter);
    }
    if (typeof sortBy === "number" && onlyInactive) {
      list = list.filter((r) => valFor(r, sortBy) <= 0);
    }
    if (sortBy === "inactive") {
      // Longest-inactive first; ties broken by larger historic total.
      return [...list].sort(
        (a, b) => (latestYear - a.lastActive) - (latestYear - b.lastActive) === 0
          ? b.total - a.total
          : (latestYear - b.lastActive) - (latestYear - a.lastActive)
      );
    }
    const metric = (r: Row) => (sortBy === "total" ? r.total : valFor(r, sortBy));
    return [...list].sort((a, b) => metric(b) - metric(a));
  }, [rows, sortBy, onlyInactive, latestYear, inactivityFilter, valFor]);

  const filtered = React.useMemo(
    () => (showAll ? sorted : sorted.slice(0, LIMIT)),
    [sorted, showAll]
  );

  const maxCell = React.useMemo(() => {
    let max = 0;
    for (const r of rows) for (const s of r.byYear.values()) { const v = splitValue(s, includeScheduled); if (v > max) max = v; }
    return max;
  }, [rows, includeScheduled]);

  const csvRows = sorted.map((r) => {
    const inactiveYears = Math.max(0, latestYear - r.lastActive);
    return [
      r.name,
      r.lastActive || "",
      inactivityBadge(inactiveYears).label,
      ...visibleYears.map((y) => csvAmount(valFor(r, y))),
      csvAmount(r.total),
    ];
  });

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <CardTitle>Client activity over time ({rows.length})</CardTitle>
          {includeScheduled && <PredictedLegend active />}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <CsvDownloadButton
            filename={`client-activity-${reporting}`}
            headers={["Company", "Active until", "Inactive", ...visibleYears.map(String), "Total"]}
            rows={csvRows}
          />
          {yearOptions.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Years
              <select
                value={String(yearsToShow)}
                onChange={(e) => {
                  const v = e.target.value;
                  setYearsToShow(v === "all" ? "all" : Number(v));
                }}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm"
              >
                {yearOptions.map((n) => (
                  <option key={n} value={n}>Last {n}</option>
                ))}
                <option value="all">All ({years.length})</option>
              </select>
            </label>
          )}
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
              {[...visibleYears].reverse().map((y) => (
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
            {INACTIVITY_BUCKETS.map((b) => {
              const active = inactivityFilter === b.id;
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setInactivityFilter(active ? null : b.id)}
                  title={`Show only clients inactive ${b.label}`}
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium transition ${b.className} ${
                    active
                      ? "ring-2 ring-inset ring-[var(--ring)]"
                      : inactivityFilter
                        ? "opacity-40 hover:opacity-100"
                        : "hover:opacity-80"
                  }`}
                >
                  {b.label}
                </button>
              );
            })}
            {inactivityFilter && (
              <button
                type="button"
                onClick={() => setInactivityFilter(null)}
                className="text-[10px] text-muted-foreground underline underline-offset-2"
              >
                clear
              </button>
            )}
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
              {visibleYears.map((y) => (
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
                      const bucket = bucketFor(inactiveYears);
                      const active = inactivityFilter === bucket.id;
                      return (
                        <button
                          type="button"
                          onClick={() => setInactivityFilter(active ? null : bucket.id)}
                          title={`Filter by ${bucket.label} inactive`}
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium transition hover:ring-2 hover:ring-inset hover:ring-[var(--ring)] ${badge.className} ${
                            active ? "ring-2 ring-inset ring-[var(--ring)]" : ""
                          }`}
                        >
                          {badge.label}
                        </button>
                      );
                    })()}
                  </td>
                  {visibleYears.map((y) => (
                    <HeatCell
                      key={y}
                      split={r.byYear.get(y) ?? { inv: 0, sched: 0 }}
                      include={includeScheduled}
                      max={maxCell}
                      reporting={reporting}
                      extraClass={sortBy === y ? "ring-1 ring-inset ring-[var(--ring)]" : ""}
                    />
                  ))}
                  <td className="px-2 py-1.5 font-semibold">{compactMoney(r.total, reporting)}</td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={visibleYears.length + 4} className="py-8 text-center text-muted-foreground">No clients match.</td></tr>
            )}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-muted-foreground">
          {(showAll || sorted.length <= LIMIT
            ? `Showing all ${filtered.length} clients by the selected metric.`
            : `Showing top ${LIMIT} of ${sorted.length} clients by the selected metric.`) +
            (inactivityFilter ? ` Filtered to ${INACTIVITY_BUCKETS.find((b) => b.id === inactivityFilter)?.label ?? ""} inactive.` : "")}
        </p>
      </CardContent>
    </Card>
  );
}

// Distinct tint per service category, reused across the category tables so a
// category is visually recognisable at a glance.
const CATEGORY_COLORS: Record<string, string> = {
  RED: "bg-red-500/15 text-red-700 dark:text-red-300",
  RD: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  PHISH: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  ORO: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300",
  KS: "bg-lime-500/15 text-lime-700 dark:text-lime-300",
  CYBEREDU: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  CONSULTANCY: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  BLUE: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
};

function categoryClass(category: string): string {
  return CATEGORY_COLORS[category] ?? "bg-muted text-foreground";
}

// Table 1 — service category (RED, PHISH, …) totals by year, with per-year and
// per-category totals. Rows are ordered by lifetime revenue, biggest first.
function CategoryYearMatrix({
  categoryMonthly,
  convert,
  reporting,
  currentYear,
  includeScheduled,
}: {
  categoryMonthly: CategoryMonthCell[];
  convert: Convert;
  reporting: string;
  currentYear: number;
  includeScheduled: boolean;
}) {
  const years = React.useMemo(() => {
    const set = new Set<number>();
    for (const c of categoryMonthly) if (c.amount > 0 || (includeScheduled && c.scheduled > 0)) set.add(c.year);
    return Array.from(set).sort((a, b) => a - b);
  }, [categoryMonthly, includeScheduled]);

  const { rows, totalsByYear, grandTotal, maxCell } = React.useMemo(() => {
    const map = new Map<string, Map<number, Split>>();
    for (const c of categoryMonthly) {
      const byYear = map.get(c.category) ?? new Map<number, Split>();
      const s = byYear.get(c.year) ?? { inv: 0, sched: 0 };
      s.inv += convert(c.amount, c.currency);
      s.sched += convert(c.scheduled, c.currency);
      byYear.set(c.year, s);
      map.set(c.category, byYear);
    }
    const rows = Array.from(map.entries())
      .map(([category, byYear]) => ({
        category,
        byYear,
        total: Array.from(byYear.values()).reduce((a, b) => a + splitValue(b, includeScheduled), 0),
      }))
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total);
    const totalsByYear = new Map<number, Split>();
    const grandTotal: Split = { inv: 0, sched: 0 };
    let maxCell = 0;
    for (const r of rows) {
      for (const y of years) {
        const s = r.byYear.get(y) ?? { inv: 0, sched: 0 };
        const t = totalsByYear.get(y) ?? { inv: 0, sched: 0 };
        t.inv += s.inv;
        t.sched += s.sched;
        totalsByYear.set(y, t);
        grandTotal.inv += s.inv;
        grandTotal.sched += s.sched;
        const v = splitValue(s, includeScheduled);
        if (v > maxCell) maxCell = v;
      }
    }
    return { rows, totalsByYear, grandTotal, maxCell };
  }, [categoryMonthly, convert, years, includeScheduled]);

  const csvRows = [
    ...rows.map((r) => [
      r.category,
      ...years.map((y) => csvAmount(splitValue(r.byYear.get(y) ?? { inv: 0, sched: 0 }, includeScheduled))),
      csvAmount(r.total),
    ]),
    ...(rows.length > 0
      ? [[
          "Total",
          ...years.map((y) => csvAmount(splitValue(totalsByYear.get(y) ?? { inv: 0, sched: 0 }, includeScheduled))),
          csvAmount(splitValue(grandTotal, includeScheduled)),
        ]]
      : []),
  ];

  return (
    <Card>
      <CardHeader className="gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <CardTitle>Revenue by category × year</CardTitle>
          {includeScheduled && <PredictedLegend active />}
        </div>
        <CsvDownloadButton
          filename={`revenue-by-category-year-${reporting}`}
          headers={["Category", ...years.map(String), "Total"]}
          rows={csvRows}
        />
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-right text-xs tabular-nums">
          <thead>
            <tr className="text-muted-foreground">
              <th className="sticky left-0 z-10 bg-card px-2 py-2 text-left">Category</th>
              {years.map((y) => (
                <th key={y} className={`px-2 py-2 font-medium ${y === currentYear ? "text-foreground" : ""}`}>{y}</th>
              ))}
              <th className="px-2 py-2 font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.category}>
                <td className="sticky left-0 z-10 bg-card px-2 py-1.5 text-left">
                  <span className={`inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium ${categoryClass(r.category)}`}>{r.category}</span>
                </td>
                {years.map((y) => (
                  <HeatCell key={y} split={r.byYear.get(y) ?? { inv: 0, sched: 0 }} include={includeScheduled} max={maxCell} reporting={reporting} />
                ))}
                <td className="px-2 py-1.5 font-semibold">{compactMoney(r.total, reporting)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={years.length + 2} className="py-8 text-center text-muted-foreground">No categorized invoices yet.</td></tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t font-semibold">
                <td className="sticky left-0 z-10 bg-card px-2 py-2 text-left">Total</td>
                {years.map((y) => (
                  <td key={y} className="px-2 py-2">{totalText(totalsByYear.get(y) ?? { inv: 0, sched: 0 }, includeScheduled, reporting)}</td>
                ))}
                <td className="px-2 py-2">{totalText(grandTotal, includeScheduled, reporting)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </CardContent>
    </Card>
  );
}

// Table 2 — service class breakdown (Clasa servicii / Categorie / Clasa) by
// year. Rows are grouped by category (biggest category first) and, within a
// category, by class revenue.
function ClassYearMatrix({
  classYearly,
  convert,
  reporting,
  currentYear,
  includeScheduled,
}: {
  classYearly: ClassYearCell[];
  convert: Convert;
  reporting: string;
  currentYear: number;
  includeScheduled: boolean;
}) {
  const years = React.useMemo(() => {
    const set = new Set<number>();
    for (const c of classYearly) if (c.amount > 0 || (includeScheduled && c.scheduled > 0)) set.add(c.year);
    return Array.from(set).sort((a, b) => a - b);
  }, [classYearly, includeScheduled]);

  const { rows, maxCell } = React.useMemo(() => {
    const map = new Map<string, { category: string; serviceClass: string; byYear: Map<number, Split>; total: number }>();
    const categoryTotals = new Map<string, number>();
    for (const c of classYearly) {
      const key = `${c.category}||${c.serviceClass}`;
      const row = map.get(key) ?? { category: c.category, serviceClass: c.serviceClass, byYear: new Map<number, Split>(), total: 0 };
      const s = row.byYear.get(c.year) ?? { inv: 0, sched: 0 };
      s.inv += convert(c.amount, c.currency);
      s.sched += convert(c.scheduled, c.currency);
      row.byYear.set(c.year, s);
      map.set(key, row);
    }
    let maxCell = 0;
    for (const r of map.values()) {
      r.total = Array.from(r.byYear.values()).reduce((a, b) => a + splitValue(b, includeScheduled), 0);
      categoryTotals.set(r.category, (categoryTotals.get(r.category) ?? 0) + r.total);
      for (const s of r.byYear.values()) { const v = splitValue(s, includeScheduled); if (v > maxCell) maxCell = v; }
    }
    const rows = Array.from(map.values()).filter((r) => r.total > 0).sort((a, b) => {
      const catDelta = (categoryTotals.get(b.category) ?? 0) - (categoryTotals.get(a.category) ?? 0);
      if (catDelta !== 0) return catDelta;
      if (a.category !== b.category) return a.category.localeCompare(b.category);
      return b.total - a.total;
    });
    return { rows, maxCell };
  }, [classYearly, convert, includeScheduled]);

  const csvRows = rows.map((r) => [
    `${r.category}-${r.serviceClass}`,
    r.category,
    r.serviceClass,
    ...years.map((y) => csvAmount(splitValue(r.byYear.get(y) ?? { inv: 0, sched: 0 }, includeScheduled))),
    csvAmount(r.total),
  ]);

  return (
    <Card>
      <CardHeader className="gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <CardTitle>Revenue by service class × year</CardTitle>
          {includeScheduled && <PredictedLegend active />}
        </div>
        <CsvDownloadButton
          filename={`revenue-by-service-class-year-${reporting}`}
          headers={["Clasa servicii", "Categorie", "Clasa", ...years.map(String), "Total"]}
          rows={csvRows}
        />
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-right text-xs tabular-nums">
          <thead>
            <tr className="text-muted-foreground">
              <th className="sticky left-0 z-10 bg-card px-2 py-2 text-left">Clasa servicii</th>
              <th className="px-2 py-2 text-left font-medium">Categorie</th>
              <th className="px-2 py-2 text-left font-medium">Clasa</th>
              {years.map((y) => (
                <th key={y} className={`px-2 py-2 font-medium ${y === currentYear ? "text-foreground" : ""}`}>{y}</th>
              ))}
              <th className="px-2 py-2 font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.category}-${r.serviceClass}`}>
                <td className="sticky left-0 z-10 bg-card px-2 py-1.5 text-left font-medium">{r.category}-{r.serviceClass}</td>
                <td className="px-2 py-1.5 text-left">
                  <span className={`inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium ${categoryClass(r.category)}`}>{r.category}</span>
                </td>
                <td className="px-2 py-1.5 text-left text-muted-foreground">{r.serviceClass}</td>
                {years.map((y) => (
                  <HeatCell key={y} split={r.byYear.get(y) ?? { inv: 0, sched: 0 }} include={includeScheduled} max={maxCell} reporting={reporting} />
                ))}
                <td className="px-2 py-1.5 font-semibold">{compactMoney(r.total, reporting)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={years.length + 4} className="py-8 text-center text-muted-foreground">No categorized invoices yet.</td></tr>
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Growth maturity — new / recurrent / expansion mix for sales-target baselining.
// Issued invoices only. A client is "active" if invoiced in the prior N months
// measured from their first invoice date in the year under review.
// ---------------------------------------------------------------------------

type MixAmounts = {
  newAmount: number;
  reactivatedAmount: number;
  recurrentAmount: number;
  expansionAmount: number;
  crossSellAmount: number;
  totalAmount: number;
};

function emptyMix(): MixAmounts {
  return { newAmount: 0, reactivatedAmount: 0, recurrentAmount: 0, expansionAmount: 0, crossSellAmount: 0, totalAmount: 0 };
}

function addMix(target: MixAmounts, add: MixAmounts) {
  target.newAmount += add.newAmount;
  target.reactivatedAmount += add.reactivatedAmount;
  target.recurrentAmount += add.recurrentAmount;
  target.expansionAmount += add.expansionAmount;
  target.crossSellAmount += add.crossSellAmount;
  target.totalAmount += add.totalAmount;
}

/** Attribute one service line's revenue into the growth-mix buckets. */
function attributeServiceMix(
  status: GrowthClientYearFact["status"],
  amount: number,
  priorYearAmount: number,
  hadCategoryBefore: boolean
): MixAmounts {
  const mix = emptyMix();
  mix.totalAmount = amount;
  if (status === "new") {
    mix.newAmount = amount;
  } else if (status === "reactivated") {
    mix.reactivatedAmount = amount;
  } else {
    const recurrent = Math.min(amount, priorYearAmount);
    const expansion = Math.max(0, amount - priorYearAmount);
    mix.recurrentAmount = recurrent;
    mix.expansionAmount = expansion;
    if (!hadCategoryBefore) mix.crossSellAmount = amount;
  }
  return mix;
}

function mixPct(part: number, total: number): number | null {
  return total <= 0 ? null : (part / total) * 100;
}

function fmtPct(value: number | null, digits = 0): string {
  if (value == null) return "—";
  return `${value.toFixed(digits)}%`;
}

function GrowthMaturitySection({
  growthClients,
  growthChurn,
  activeMonths,
  convert,
  reporting,
  currentYear,
}: {
  growthClients: GrowthClientYearFact[];
  growthChurn: GrowthChurnYear[];
  activeMonths: number;
  convert: Convert;
  reporting: string;
  currentYear: number;
}) {
  const [selectedYear, setSelectedYear] = React.useState<number>(currentYear);
  const [view, setView] = React.useState<"category" | "class">("category");

  const years = React.useMemo(() => {
    const set = new Set<number>();
    for (const c of growthClients) if (c.amount > 0) set.add(c.year);
    return Array.from(set).sort((a, b) => a - b);
  }, [growthClients]);

  React.useEffect(() => {
    if (years.length && !years.includes(selectedYear)) {
      setSelectedYear(years.includes(currentYear) ? currentYear : years[years.length - 1]);
    }
  }, [years, selectedYear, currentYear]);

  // Merge multi-currency rows per client×year (converted), keeping one status.
  const clientsByYear = React.useMemo(() => {
    type ClientAgg = {
      clientId: string;
      clientName: string;
      year: number;
      amount: number;
      priorYearAmount: number;
      status: GrowthClientYearFact["status"];
      services: Array<{
        category: string;
        serviceClass: string;
        amount: number;
        priorYearAmount: number;
        hadCategoryBefore: boolean;
      }>;
    };
    const map = new Map<string, ClientAgg>();
    for (const fact of growthClients) {
      const key = `${fact.clientId}|${fact.year}`;
      const agg = map.get(key) ?? {
        clientId: fact.clientId,
        clientName: fact.clientName,
        year: fact.year,
        amount: 0,
        priorYearAmount: 0,
        status: fact.status,
        services: [],
      };
      agg.amount += convert(fact.amount, fact.currency);
      agg.priorYearAmount += convert(fact.priorYearAmount, fact.currency);
      // Prefer "existing" if any currency row says so (shouldn't diverge).
      if (fact.status === "existing") agg.status = "existing";
      else if (fact.status === "reactivated" && agg.status === "new") agg.status = "reactivated";

      const svcMap = new Map(agg.services.map((s) => [`${s.category}|${s.serviceClass}`, s]));
      for (const s of fact.services) {
        const sk = `${s.category}|${s.serviceClass}`;
        const prev = svcMap.get(sk);
        if (prev) {
          prev.amount += convert(s.amount, fact.currency);
          prev.priorYearAmount += convert(s.priorYearAmount, fact.currency);
          prev.hadCategoryBefore = prev.hadCategoryBefore || s.hadCategoryBefore;
        } else {
          svcMap.set(sk, {
            category: s.category,
            serviceClass: s.serviceClass,
            amount: convert(s.amount, fact.currency),
            priorYearAmount: convert(s.priorYearAmount, fact.currency),
            hadCategoryBefore: s.hadCategoryBefore,
          });
        }
      }
      agg.services = Array.from(svcMap.values());
      map.set(key, agg);
    }
    return map;
  }, [growthClients, convert]);

  const yearSummaries = React.useMemo(() => {
    const churnMap = new Map(growthChurn.map((c) => [c.year, c]));
    return years.map((y) => {
      const mix = emptyMix();
      const clientIds = new Set<string>();
      let newClients = 0;
      let reactivatedClients = 0;
      let existingClients = 0;
      let expandingClients = 0;
      let priorYearFromReturning = 0;
      let retainedFromReturning = 0;
      let currentFromReturning = 0;
      const revenues: number[] = [];

      for (const [, c] of clientsByYear) {
        if (c.year !== y || c.amount <= 0) continue;
        clientIds.add(c.clientId);
        revenues.push(c.amount);
        if (c.status === "new") newClients += 1;
        else if (c.status === "reactivated") reactivatedClients += 1;
        else existingClients += 1;

        if (c.status === "existing" || c.status === "reactivated") {
          // Reactivated: prior calendar year is usually 0; still attribute via services.
        }
        if (c.status === "existing") {
          priorYearFromReturning += c.priorYearAmount;
          retainedFromReturning += Math.min(c.amount, c.priorYearAmount);
          currentFromReturning += c.amount;
          if (c.amount > c.priorYearAmount) expandingClients += 1;
        }

        for (const s of c.services) {
          addMix(mix, attributeServiceMix(c.status, s.amount, s.priorYearAmount, s.hadCategoryBefore));
        }
      }

      revenues.sort((a, b) => b - a);
      const top10 = revenues.slice(0, 10).reduce((a, b) => a + b, 0);
      const churn = churnMap.get(y);
      const activeClients = clientIds.size;
      const acquisition = mix.newAmount + mix.reactivatedAmount;

      return {
        year: y,
        mix,
        acquisition,
        activeClients,
        newClients,
        reactivatedClients,
        existingClients,
        expandingClients,
        churned: churn?.churned ?? 0,
        enteringBase: churn?.enteringBase ?? 0,
        churnRate: churn && churn.enteringBase > 0 ? (churn.churned / churn.enteringBase) * 100 : null,
        avgRevenuePerClient: activeClients > 0 ? mix.totalAmount / activeClients : 0,
        top10ConcentrationPct: mix.totalAmount > 0 ? (top10 / mix.totalAmount) * 100 : null,
        grossRetentionPct: priorYearFromReturning > 0 ? (retainedFromReturning / priorYearFromReturning) * 100 : null,
        netRetentionPct: priorYearFromReturning > 0 ? (currentFromReturning / priorYearFromReturning) * 100 : null,
        newPct: mixPct(mix.newAmount + mix.reactivatedAmount, mix.totalAmount),
        recurrentPct: mixPct(mix.recurrentAmount, mix.totalAmount),
        expansionPct: mixPct(mix.expansionAmount, mix.totalAmount),
      };
    });
  }, [years, clientsByYear, growthChurn]);

  const selectedSummary = yearSummaries.find((s) => s.year === selectedYear) ?? yearSummaries[yearSummaries.length - 1];

  const serviceRows = React.useMemo(() => {
    type Row = MixAmounts & {
      key: string;
      category: string;
      serviceClass: string | null;
      clientCount: number;
      newClients: number;
      existingClients: number;
      expandingClients: number;
    };

    if (view === "category") {
      // Roll up to category using category totals so recurrent/expansion aren't
      // distorted by splitting prior-year spend across service classes.
      const catClient = new Map<string, Array<{ status: GrowthClientYearFact["status"]; amount: number; prior: number; hadBefore: boolean; clientId: string }>>();
      for (const [, c] of clientsByYear) {
        if (c.year !== selectedYear) continue;
        const byCat = new Map<string, { amount: number; prior: number; hadBefore: boolean }>();
        for (const s of c.services) {
          const prev = byCat.get(s.category) ?? { amount: 0, prior: 0, hadBefore: false };
          prev.amount += s.amount;
          prev.prior += s.priorYearAmount;
          prev.hadBefore = prev.hadBefore || s.hadCategoryBefore;
          byCat.set(s.category, prev);
        }
        for (const [cat, v] of byCat) {
          if (v.amount <= 0) continue;
          const list = catClient.get(cat) ?? [];
          list.push({ status: c.status, amount: v.amount, prior: v.prior, hadBefore: v.hadBefore, clientId: c.clientId });
          catClient.set(cat, list);
        }
      }
      const rows: Row[] = [];
      for (const [cat, list] of catClient) {
        const mix = emptyMix();
        const clients = new Set<string>();
        const newSet = new Set<string>();
        const existingSet = new Set<string>();
        const expandingSet = new Set<string>();
        for (const item of list) {
          addMix(mix, attributeServiceMix(item.status, item.amount, item.prior, item.hadBefore));
          clients.add(item.clientId);
          if (item.status === "new" || item.status === "reactivated") newSet.add(item.clientId);
          else {
            existingSet.add(item.clientId);
            if (item.amount > item.prior) expandingSet.add(item.clientId);
          }
        }
        rows.push({
          key: cat,
          category: cat,
          serviceClass: null,
          ...mix,
          clientCount: clients.size,
          newClients: newSet.size,
          existingClients: existingSet.size,
          expandingClients: expandingSet.size,
        });
      }
      return rows.filter((r) => r.totalAmount > 0).sort((a, b) => b.totalAmount - a.totalAmount);
    }

    const map = new Map<string, Row & { clients: Set<string>; newSet: Set<string>; existingSet: Set<string>; expandingSet: Set<string> }>();
    for (const [, c] of clientsByYear) {
      if (c.year !== selectedYear) continue;
      for (const s of c.services) {
        if (s.amount <= 0) continue;
        const key = `${s.category}|${s.serviceClass}`;
        const row = map.get(key) ?? {
          key,
          category: s.category,
          serviceClass: s.serviceClass,
          ...emptyMix(),
          clientCount: 0,
          newClients: 0,
          existingClients: 0,
          expandingClients: 0,
          clients: new Set<string>(),
          newSet: new Set<string>(),
          existingSet: new Set<string>(),
          expandingSet: new Set<string>(),
        };
        addMix(row, attributeServiceMix(c.status, s.amount, s.priorYearAmount, s.hadCategoryBefore));
        row.clients.add(c.clientId);
        if (c.status === "new" || c.status === "reactivated") row.newSet.add(c.clientId);
        else {
          row.existingSet.add(c.clientId);
          if (s.amount > s.priorYearAmount) row.expandingSet.add(c.clientId);
        }
        map.set(key, row);
      }
    }

    return Array.from(map.values())
      .map((r) => ({
        key: r.key,
        category: r.category,
        serviceClass: r.serviceClass,
        newAmount: r.newAmount,
        reactivatedAmount: r.reactivatedAmount,
        recurrentAmount: r.recurrentAmount,
        expansionAmount: r.expansionAmount,
        crossSellAmount: r.crossSellAmount,
        totalAmount: r.totalAmount,
        clientCount: r.clients.size,
        newClients: r.newSet.size,
        existingClients: r.existingSet.size,
        expandingClients: r.expandingSet.size,
      }))
      .filter((r) => r.totalAmount > 0)
      .sort((a, b) => b.totalAmount - a.totalAmount);
  }, [clientsByYear, selectedYear, view]);

  const chartData = yearSummaries.map((s) => ({
    label: String(s.year),
    New: Math.round(s.mix.newAmount),
    Reactivated: Math.round(s.mix.reactivatedAmount),
    Recurrent: Math.round(s.mix.recurrentAmount),
    Expansion: Math.round(s.mix.expansionAmount),
    total: Math.round(s.mix.totalAmount),
  }));

  const csvServiceRows = serviceRows.map((r) => {
    const acq = r.newAmount + r.reactivatedAmount;
    return [
      r.category,
      r.serviceClass ?? "",
      selectedYear,
      csvAmount(r.totalAmount),
      csvAmount(acq),
      mixPct(acq, r.totalAmount)?.toFixed(1) ?? "",
      csvAmount(r.newAmount),
      csvAmount(r.reactivatedAmount),
      csvAmount(r.recurrentAmount),
      mixPct(r.recurrentAmount, r.totalAmount)?.toFixed(1) ?? "",
      csvAmount(r.expansionAmount),
      mixPct(r.expansionAmount, r.totalAmount)?.toFixed(1) ?? "",
      csvAmount(r.crossSellAmount),
      r.clientCount,
      r.newClients,
      r.existingClients,
      r.expandingClients,
    ];
  });

  const csvYearRows = yearSummaries.map((s) => [
    s.year,
    csvAmount(s.mix.totalAmount),
    csvAmount(s.mix.newAmount),
    csvAmount(s.mix.reactivatedAmount),
    csvAmount(s.acquisition),
    s.newPct?.toFixed(1) ?? "",
    csvAmount(s.mix.recurrentAmount),
    s.recurrentPct?.toFixed(1) ?? "",
    csvAmount(s.mix.expansionAmount),
    s.expansionPct?.toFixed(1) ?? "",
    csvAmount(s.mix.crossSellAmount),
    s.activeClients,
    s.newClients,
    s.reactivatedClients,
    s.existingClients,
    s.expandingClients,
    s.enteringBase,
    s.churned,
    s.churnRate?.toFixed(1) ?? "",
    csvAmount(s.avgRevenuePerClient),
    s.top10ConcentrationPct?.toFixed(1) ?? "",
    s.grossRetentionPct?.toFixed(1) ?? "",
    s.netRetentionPct?.toFixed(1) ?? "",
  ]);

  if (years.length === 0) return null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle>Growth maturity · new / recurrent / expansion</CardTitle>
            <p className="max-w-3xl text-xs text-muted-foreground">
              Issued invoices only. A client is <span className="font-medium text-foreground">active</span> if they were invoiced in the{" "}
              <span className="font-medium text-foreground">{activeMonths} months</span> before their first invoice in the year.
              New = first-time clients · Reactivated = returned after a gap · Recurrent = existing clients up to prior-year spend ·
              Expansion = spend above prior year (cross-sell when the service category is new to them). Use this mix as the baseline for sales targets.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Year
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm"
              >
                {years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </label>
            <CsvDownloadButton
              filename={`growth-maturity-years-${reporting}`}
              headers={[
                "Year", "Total", "New", "Reactivated", "Acquisition", "Acquisition %",
                "Recurrent", "Recurrent %", "Expansion", "Expansion %", "Cross-sell",
                "Active clients", "New clients", "Reactivated clients", "Existing clients", "Expanding clients",
                "Entering base", "Churned", "Churn %", "Avg revenue / client", "Top-10 concentration %",
                "Gross retention %", "Net retention %",
              ]}
              rows={csvYearRows}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {selectedSummary && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
              <GrowthKpi label="Total invoiced" value={money(selectedSummary.mix.totalAmount, reporting)} hint={`${selectedSummary.activeClients} clients`} />
              <GrowthKpi
                label="Acquisition"
                value={money(selectedSummary.acquisition, reporting)}
                hint={`${fmtPct(selectedSummary.newPct, 0)} · ${selectedSummary.newClients + selectedSummary.reactivatedClients} clients`}
                tone="new"
              />
              <GrowthKpi
                label="Recurrent"
                value={money(selectedSummary.mix.recurrentAmount, reporting)}
                hint={fmtPct(selectedSummary.recurrentPct, 0)}
                tone="recurrent"
              />
              <GrowthKpi
                label="Expansion"
                value={money(selectedSummary.mix.expansionAmount, reporting)}
                hint={`${fmtPct(selectedSummary.expansionPct, 0)} · ${selectedSummary.expandingClients} expanding`}
                tone="expansion"
              />
              <GrowthKpi
                label="Gross retention"
                value={fmtPct(selectedSummary.grossRetentionPct, 0)}
                hint="Kept of prior-year $ from existing"
              />
              <GrowthKpi
                label="Net retention"
                value={fmtPct(selectedSummary.netRetentionPct, 0)}
                hint="Existing clients YoY (incl. expansion)"
              />
              <GrowthKpi
                label="Churned clients"
                value={String(selectedSummary.churned)}
                hint={selectedSummary.enteringBase > 0 ? `${fmtPct(selectedSummary.churnRate, 0)} of ${selectedSummary.enteringBase} base` : "No entering base"}
                tone="warn"
              />
              <GrowthKpi
                label="Avg / client"
                value={money(selectedSummary.avgRevenuePerClient, reporting)}
                hint={selectedSummary.top10ConcentrationPct != null ? `Top-10: ${fmtPct(selectedSummary.top10ConcentrationPct, 0)}` : undefined}
              />
            </div>
          )}

          <div className="grid gap-6 xl:grid-cols-2">
            <div>
              <div className="mb-2 text-sm font-medium">Revenue mix by year</div>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData} margin={{ left: 4, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                  <YAxis tickFormatter={(v) => compactMoney(Number(v), reporting)} width={64} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                  <Tooltip content={(p) => <ChartTooltip {...p} currency={reporting} />} cursor={{ fill: "var(--accent)" }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="New" stackId="mix" fill="var(--chart-2)" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="Reactivated" stackId="mix" fill="var(--chart-4)" />
                  <Bar dataKey="Recurrent" stackId="mix" fill="var(--chart-1)" />
                  <Bar dataKey="Expansion" stackId="mix" fill="var(--chart-3)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="overflow-x-auto">
              <div className="mb-2 text-sm font-medium">Year-by-year mix & client base</div>
              <table className="w-full border-separate border-spacing-0 text-right text-xs tabular-nums">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="px-2 py-2 text-left">Year</th>
                    <th className="px-2 py-2">Total</th>
                    <th className="px-2 py-2">Acq %</th>
                    <th className="px-2 py-2">Rec %</th>
                    <th className="px-2 py-2">Exp %</th>
                    <th className="px-2 py-2">Clients</th>
                    <th className="px-2 py-2">New</th>
                    <th className="px-2 py-2">Churn</th>
                    <th className="px-2 py-2">GRR</th>
                    <th className="px-2 py-2">NRR</th>
                  </tr>
                </thead>
                <tbody>
                  {yearSummaries.map((s) => (
                    <tr
                      key={s.year}
                      className={`cursor-pointer border-b hover:bg-accent/40 ${s.year === selectedYear ? "bg-accent/50 font-medium" : ""}`}
                      onClick={() => setSelectedYear(s.year)}
                    >
                      <td className="px-2 py-1.5 text-left font-medium">{s.year}</td>
                      <td className="px-2 py-1.5">{compactMoney(s.mix.totalAmount, reporting)}</td>
                      <td className="px-2 py-1.5">{fmtPct(s.newPct, 0)}</td>
                      <td className="px-2 py-1.5">{fmtPct(s.recurrentPct, 0)}</td>
                      <td className="px-2 py-1.5">{fmtPct(s.expansionPct, 0)}</td>
                      <td className="px-2 py-1.5">{s.activeClients}</td>
                      <td className="px-2 py-1.5">{s.newClients + s.reactivatedClients}</td>
                      <td className="px-2 py-1.5">{s.churned}</td>
                      <td className="px-2 py-1.5">{fmtPct(s.grossRetentionPct, 0)}</td>
                      <td className="px-2 py-1.5">{fmtPct(s.netRetentionPct, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>
              Service mix · {selectedYear}
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Acquisition = new + reactivated. Cross-sell is expansion on a category the client had never bought before.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex rounded-md border border-input p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setView("category")}
                className={`rounded px-2.5 py-1 ${view === "category" ? "bg-accent font-medium" : "text-muted-foreground hover:text-foreground"}`}
              >
                Category
              </button>
              <button
                type="button"
                onClick={() => setView("class")}
                className={`rounded px-2.5 py-1 ${view === "class" ? "bg-accent font-medium" : "text-muted-foreground hover:text-foreground"}`}
              >
                Service class
              </button>
            </div>
            <CsvDownloadButton
              filename={`growth-maturity-services-${selectedYear}-${reporting}`}
              headers={[
                "Category", "Service class", "Year", "Total",
                "Acquisition", "Acquisition %", "New", "Reactivated",
                "Recurrent", "Recurrent %", "Expansion", "Expansion %", "Cross-sell",
                "Clients", "New/reactivated clients", "Existing clients", "Expanding clients",
              ]}
              rows={csvServiceRows}
            />
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-right text-xs tabular-nums">
            <thead>
              <tr className="text-muted-foreground">
                <th className="sticky left-0 z-10 bg-card px-2 py-2 text-left">Service</th>
                {view === "class" && <th className="px-2 py-2 text-left">Class</th>}
                <th className="px-2 py-2">Total</th>
                <th className="px-2 py-2">Acquisition</th>
                <th className="px-2 py-2">Acq %</th>
                <th className="px-2 py-2">Recurrent</th>
                <th className="px-2 py-2">Rec %</th>
                <th className="px-2 py-2">Expansion</th>
                <th className="px-2 py-2">Exp %</th>
                <th className="px-2 py-2">Cross-sell</th>
                <th className="px-2 py-2">Clients</th>
                <th className="px-2 py-2">New</th>
                <th className="px-2 py-2">Expanding</th>
              </tr>
            </thead>
            <tbody>
              {serviceRows.map((r) => {
                const acq = r.newAmount + r.reactivatedAmount;
                return (
                  <tr key={r.key} className="border-b">
                    <td className="sticky left-0 z-10 bg-card px-2 py-1.5 text-left">
                      <span className={`inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium ${categoryClass(r.category)}`}>{r.category}</span>
                    </td>
                    {view === "class" && (
                      <td className="px-2 py-1.5 text-left text-muted-foreground">{r.serviceClass}</td>
                    )}
                    <td className="px-2 py-1.5 font-semibold">{compactMoney(r.totalAmount, reporting)}</td>
                    <td className="px-2 py-1.5">{compactMoney(acq, reporting)}</td>
                    <td className="px-2 py-1.5 text-muted-foreground">{fmtPct(mixPct(acq, r.totalAmount), 0)}</td>
                    <td className="px-2 py-1.5">{compactMoney(r.recurrentAmount, reporting)}</td>
                    <td className="px-2 py-1.5 text-muted-foreground">{fmtPct(mixPct(r.recurrentAmount, r.totalAmount), 0)}</td>
                    <td className="px-2 py-1.5">{compactMoney(r.expansionAmount, reporting)}</td>
                    <td className="px-2 py-1.5 text-muted-foreground">{fmtPct(mixPct(r.expansionAmount, r.totalAmount), 0)}</td>
                    <td className="px-2 py-1.5">{r.crossSellAmount > 0 ? compactMoney(r.crossSellAmount, reporting) : "·"}</td>
                    <td className="px-2 py-1.5">{r.clientCount}</td>
                    <td className="px-2 py-1.5">{r.newClients}</td>
                    <td className="px-2 py-1.5">{r.expandingClients}</td>
                  </tr>
                );
              })}
              {serviceRows.length === 0 && (
                <tr><td colSpan={view === "class" ? 13 : 12} className="py-8 text-center text-muted-foreground">No issued revenue in {selectedYear}.</td></tr>
              )}
            </tbody>
            {serviceRows.length > 0 && selectedSummary && (
              <tfoot>
                <tr className="border-t font-semibold">
                  <td className="sticky left-0 z-10 bg-card px-2 py-2 text-left">Total</td>
                  {view === "class" && <td />}
                  <td className="px-2 py-2">{compactMoney(selectedSummary.mix.totalAmount, reporting)}</td>
                  <td className="px-2 py-2">{compactMoney(selectedSummary.acquisition, reporting)}</td>
                  <td className="px-2 py-2">{fmtPct(selectedSummary.newPct, 0)}</td>
                  <td className="px-2 py-2">{compactMoney(selectedSummary.mix.recurrentAmount, reporting)}</td>
                  <td className="px-2 py-2">{fmtPct(selectedSummary.recurrentPct, 0)}</td>
                  <td className="px-2 py-2">{compactMoney(selectedSummary.mix.expansionAmount, reporting)}</td>
                  <td className="px-2 py-2">{fmtPct(selectedSummary.expansionPct, 0)}</td>
                  <td className="px-2 py-2">{compactMoney(selectedSummary.mix.crossSellAmount, reporting)}</td>
                  <td className="px-2 py-2">{selectedSummary.activeClients}</td>
                  <td className="px-2 py-2">{selectedSummary.newClients + selectedSummary.reactivatedClients}</td>
                  <td className="px-2 py-2">{selectedSummary.expandingClients}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function GrowthKpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "new" | "recurrent" | "expansion" | "warn";
}) {
  const bar =
    tone === "new"
      ? "border-l-[var(--chart-2)]"
      : tone === "recurrent"
        ? "border-l-[var(--chart-1)]"
        : tone === "expansion"
          ? "border-l-[var(--chart-3)]"
          : tone === "warn"
            ? "border-l-destructive"
            : "border-l-border";
  return (
    <div className={`rounded-lg border border-l-4 bg-card px-3 py-2.5 ${bar}`}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

// Table 3 — for each category, revenue per year broken into months plus the
// yearly total and monthly average (Medie = total ÷ months with revenue).
function CategoryMonthlyMatrix({
  categoryMonthly,
  convert,
  reporting,
  currentYear,
  includeScheduled,
}: {
  categoryMonthly: CategoryMonthCell[];
  convert: Convert;
  reporting: string;
  currentYear: number;
  includeScheduled: boolean;
}) {
  const [selected, setSelected] = React.useState<string>("all");

  // category -> year -> month[12] split (converted)
  const byCategory = React.useMemo(() => {
    const map = new Map<string, Map<number, Split[]>>();
    for (const c of categoryMonthly) {
      const byYear = map.get(c.category) ?? new Map<number, Split[]>();
      const arr = byYear.get(c.year) ?? Array.from({ length: 12 }, () => ({ inv: 0, sched: 0 }));
      arr[c.month - 1].inv += convert(c.amount, c.currency);
      arr[c.month - 1].sched += convert(c.scheduled, c.currency);
      byYear.set(c.year, arr);
      map.set(c.category, byYear);
    }
    return map;
  }, [categoryMonthly, convert]);

  const categories = React.useMemo(() => {
    const totals = new Map<string, number>();
    for (const [cat, byYear] of byCategory) {
      let t = 0;
      for (const arr of byYear.values()) for (const s of arr) t += splitValue(s, includeScheduled);
      totals.set(cat, t);
    }
    return Array.from(totals.entries()).filter(([, t]) => t > 0).sort((a, b) => b[1] - a[1]).map(([cat]) => cat);
  }, [byCategory, includeScheduled]);

  const shown = selected === "all" ? categories : categories.filter((c) => c === selected);

  const maxCell = React.useMemo(() => {
    let max = 0;
    for (const cat of shown) {
      const byYear = byCategory.get(cat);
      if (!byYear) continue;
      for (const arr of byYear.values()) for (const s of arr) { const v = splitValue(s, includeScheduled); if (v > max) max = v; }
    }
    return max;
  }, [byCategory, shown, includeScheduled]);

  const csvRows: Array<Array<string | number | null | undefined>> = [];
  for (const cat of shown) {
    const byYear = byCategory.get(cat);
    if (!byYear) continue;
    const catYears = Array.from(byYear.keys())
      .filter((y) => byYear.get(y)!.some((s) => splitValue(s, includeScheduled) > 0))
      .sort((a, b) => a - b);
    for (const y of catYears) {
      const months = byYear.get(y)!;
      const total = months.reduce((a, b) => a + splitValue(b, includeScheduled), 0);
      const activeMonths = months.filter((s) => splitValue(s, includeScheduled) > 0).length;
      const avg = activeMonths > 0 ? total / activeMonths : null;
      csvRows.push([
        cat,
        y,
        ...months.map((s) => csvAmount(splitValue(s, includeScheduled))),
        csvAmount(total),
        avg == null ? "" : csvAmount(avg),
      ]);
    }
  }

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <CardTitle>Category by year & month (with monthly average)</CardTitle>
          {includeScheduled && <PredictedLegend active />}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <CsvDownloadButton
            filename={`category-by-year-month-${reporting}`}
            headers={["Category", "Year", ...MONTH_LABELS, "Total", "Avg"]}
            rows={csvRows}
          />
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Category
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="all">All ({categories.length})</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-right text-xs tabular-nums">
          <thead>
            <tr className="text-muted-foreground">
              <th className="sticky left-0 z-10 bg-card px-2 py-2 text-left">Category</th>
              <th className="px-2 py-2 text-left font-medium">Year</th>
              {MONTH_LABELS.map((m) => (
                <th key={m} className="px-2 py-2 font-medium">{m}</th>
              ))}
              <th className="px-2 py-2 font-semibold">Total</th>
              <th className="px-2 py-2 font-semibold">Avg</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((cat) => {
              const byYear = byCategory.get(cat);
              if (!byYear) return null;
              const catYears = Array.from(byYear.keys())
                .filter((y) => byYear.get(y)!.some((s) => splitValue(s, includeScheduled) > 0))
                .sort((a, b) => a - b);
              return catYears.map((y, idx) => {
                const months = byYear.get(y)!;
                const total = months.reduce((a, b) => a + splitValue(b, includeScheduled), 0);
                const activeMonths = months.filter((s) => splitValue(s, includeScheduled) > 0).length;
                const avg = activeMonths > 0 ? total / activeMonths : null;
                return (
                  <tr key={`${cat}-${y}`} className={y === currentYear ? "font-medium" : ""}>
                    {idx === 0 && (
                      <td rowSpan={catYears.length} className="sticky left-0 z-10 bg-card px-2 py-1.5 align-top text-left">
                        <span className={`inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium ${categoryClass(cat)}`}>{cat}</span>
                      </td>
                    )}
                    <td className="px-2 py-1.5 text-left font-medium">{y}</td>
                    {months.map((s, i) => (
                      <HeatCell key={i} split={s} include={includeScheduled} max={maxCell} reporting={reporting} />
                    ))}
                    <td className="px-2 py-1.5 font-semibold">{compactMoney(total, reporting)}</td>
                    <td className="px-2 py-1.5 text-muted-foreground">{avg == null ? "—" : compactMoney(avg, reporting)}</td>
                  </tr>
                );
              });
            })}
            {shown.length === 0 && (
              <tr><td colSpan={16} className="py-8 text-center text-muted-foreground">No categorized invoices yet.</td></tr>
            )}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-muted-foreground">Avg (Medie) = yearly total ÷ number of months with revenue{includeScheduled ? " (predictions included)" : ""}.</p>
      </CardContent>
    </Card>
  );
}

function statusLabel(status: string): string {
  return (INVOICE_STATUS_LABELS as Record<string, string>)[status] ?? status;
}

// ISO timestamp -> "YYYY-MM-DD" (deterministic, SSR-safe).
function fmtDay(iso: string): string {
  return iso.slice(0, 10);
}

// Final table — companies with unpaid, already-issued invoices. The age filter
// controls how old (by issue date) an invoice must be to count. Rows roll up
// per company and expand to the individual due invoices, each linking to the
// invoice page.
function PaymentsDueTable({
  dueInvoices,
  convert,
  reporting,
}: {
  dueInvoices: DueInvoice[];
  convert: Convert;
  reporting: string;
}) {
  const [minAge, setMinAge] = React.useState(30);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  const companies = React.useMemo(() => {
    type Company = {
      id: string;
      name: string;
      total: number;
      count: number;
      oldestAge: number;
      newestAge: number;
      firstDue: string;
      lastDue: string;
      invoices: DueInvoice[];
    };
    const map = new Map<string, Company>();
    for (const inv of dueInvoices) {
      if (inv.ageDays <= minAge) continue;
      const c = map.get(inv.clientId) ?? {
        id: inv.clientId,
        name: inv.clientName,
        total: 0,
        count: 0,
        oldestAge: inv.ageDays,
        newestAge: inv.ageDays,
        firstDue: inv.issueDate,
        lastDue: inv.issueDate,
        invoices: [],
      };
      c.total += convert(inv.amount, inv.currency);
      c.count += 1;
      if (inv.ageDays > c.oldestAge) {
        c.oldestAge = inv.ageDays;
        c.firstDue = inv.issueDate;
      }
      if (inv.ageDays < c.newestAge) {
        c.newestAge = inv.ageDays;
        c.lastDue = inv.issueDate;
      }
      c.invoices.push(inv);
      map.set(inv.clientId, c);
    }
    const list = Array.from(map.values()).sort((a, b) => b.total - a.total);
    for (const c of list) c.invoices.sort((a, b) => b.ageDays - a.ageDays);
    return list;
  }, [dueInvoices, minAge, convert]);

  const grandTotal = React.useMemo(() => companies.reduce((sum, c) => sum + c.total, 0), [companies]);
  const invoiceCount = React.useMemo(() => companies.reduce((sum, c) => sum + c.count, 0), [companies]);

  const csvRows = companies.map((c) => [
    c.name,
    c.count,
    fmtDay(c.firstDue),
    c.oldestAge,
    fmtDay(c.lastDue),
    c.newestAge,
    csvAmount(c.total),
  ]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Payments due by company</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {companies.length} companies · {invoiceCount} invoices · {money(grandTotal, reporting)} outstanding (converted to {reporting}). Per-invoice amounts are the outstanding balance in the invoice currency.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <CsvDownloadButton
            filename={`payments-due-by-company-${reporting}`}
            headers={["Company", "Invoices", "First due", "First due age (days)", "Last due", "Last due age (days)", `Total due (${reporting})`]}
            rows={csvRows}
          />
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Invoices older than
            <input
              type="number"
              min={0}
              step={1}
              value={minAge}
              onChange={(e) => setMinAge(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
              className="h-8 w-20 rounded-md border border-input bg-background px-2 text-sm tabular-nums"
            />
            days
          </label>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-xs tabular-nums">
          <thead>
            <tr className="text-muted-foreground">
              <th className="sticky left-0 z-10 bg-card px-2 py-2 text-left">Company</th>
              <th className="px-2 py-2 text-right font-medium">Invoices</th>
              <th className="px-2 py-2 text-right font-medium">First due</th>
              <th className="px-2 py-2 text-right font-medium">Last due</th>
              <th className="px-2 py-2 text-right font-semibold">Total due</th>
            </tr>
          </thead>
          <tbody>
            {companies.map((c) => {
              const isOpen = expanded.has(c.id);
              return (
                <React.Fragment key={c.id}>
                  <tr className="cursor-pointer border-b hover:bg-accent/50" onClick={() => toggle(c.id)}>
                    <td className="sticky left-0 z-10 max-w-[280px] truncate bg-card px-2 py-1.5 text-left font-medium" title={c.name}>
                      <span className="inline-flex items-center gap-1">
                        <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`} />
                        {c.name}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right">{c.count}</td>
                    <td className="px-2 py-1.5 text-right">
                      {fmtDay(c.firstDue)} <span className="text-muted-foreground">({c.oldestAge}d)</span>
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {fmtDay(c.lastDue)} <span className="text-muted-foreground">({c.newestAge}d)</span>
                    </td>
                    <td className="px-2 py-1.5 text-right font-semibold">{money(c.total, reporting)}</td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b bg-muted/30">
                      <td colSpan={5} className="px-2 py-2">
                        <table className="w-full text-xs tabular-nums">
                          <thead>
                            <tr className="text-muted-foreground">
                              <th className="px-2 py-1 text-left font-medium">Invoice</th>
                              <th className="px-2 py-1 text-left font-medium">Issued</th>
                              <th className="px-2 py-1 text-right font-medium">Age</th>
                              <th className="px-2 py-1 text-left font-medium">What</th>
                              <th className="px-2 py-1 text-left font-medium">Status</th>
                              <th className="px-2 py-1 text-right font-medium">Amount</th>
                              <th className="px-2 py-1 text-right font-medium">Open</th>
                            </tr>
                          </thead>
                          <tbody>
                            {c.invoices.map((inv) => {
                              const what = inv.partNumberCode || inv.services || "—";
                              return (
                                <tr key={inv.id} className="border-t border-border/50">
                                  <td className="px-2 py-1 text-left font-medium">
                                    <Link href={`/invoices/${inv.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                                      {inv.number || "(no number)"}
                                    </Link>
                                  </td>
                                  <td className="px-2 py-1 text-left">{fmtDay(inv.issueDate)}</td>
                                  <td className="px-2 py-1 text-right">{inv.ageDays}d</td>
                                  <td className="max-w-[320px] truncate px-2 py-1 text-left" title={inv.services || inv.partNumberCode || undefined}>{what}</td>
                                  <td className="px-2 py-1 text-left text-muted-foreground">{statusLabel(inv.status)}</td>
                                  <td className="px-2 py-1 text-right">{money(inv.amount, inv.currency)}</td>
                                  <td className="px-2 py-1 text-right">
                                    <Link
                                      href={`/invoices/${inv.id}`}
                                      className="inline-flex items-center justify-end text-muted-foreground hover:text-foreground"
                                      title="Open invoice"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <ExternalLink className="h-3.5 w-3.5" />
                                    </Link>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {companies.length === 0 && (
              <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">No companies with unpaid invoices older than {minAge} days.</td></tr>
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
