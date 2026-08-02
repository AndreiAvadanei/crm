import "server-only";
import { prisma } from "@/lib/db";
import { invoiceVisibilityWhere } from "@/lib/rbac";
import type { User } from "@/generated/prisma";

export type PeriodBucket = {
  key: string;
  label: string;
  currency: string;
  amount: number;
  // Scheduled (expected, not-yet-issued) amount for the same bucket.
  scheduled: number;
  count: number;
};

export type MonthComparison = {
  month: number;
  label: string;
  currency: string;
  current: number;
  previous: number;
  // Scheduled amount for the current year's month.
  currentScheduled: number;
  delta: number;
  deltaPct: number | null;
};

export type ForecastBucket = {
  key: string;
  label: string;
  currency: string;
  invoicedCash: number;
  toInvoiceCash: number;
  total: number;
  count: number;
};

export type CurrencySummary = {
  currency: string;
  invoicedYtd: number;
  previousYtd: number;
  ytdDelta: number;
  ytdDeltaPct: number | null;
  invoicedYear: number;
  previousYear: number;
  yoyDelta: number;
  yoyDeltaPct: number | null;
  // Not-yet-issued (scheduled) amount, across every year.
  openToInvoice: number;
  // Not-yet-issued (scheduled) amount whose expected date lands in the current year.
  openToInvoiceYear: number;
  // Scheduled amount expected to be invoiced within the current year.
  scheduledYear: number;
  expectedCashNext90: number;
  // Issued-but-unpaid balance, across every year.
  outstandingNet: number;
  // Issued-but-unpaid balance for invoices issued in the current year.
  outstandingNetYear: number;
  invoiceCount: number;
};

export type YearMonthCell = {
  year: number;
  month: number;
  currency: string;
  amount: number;
  scheduled: number;
  count: number;
  scheduledCount: number;
};

export type ClientYearCell = {
  clientId: string;
  clientName: string;
  year: number;
  currency: string;
  amount: number;
  scheduled: number;
};

// Revenue for a service category (1st part-number segment, e.g. "RED") in a
// given year/month. The client rolls these up into the category-by-year table
// and the per-year/month/average table.
export type CategoryMonthCell = {
  category: string;
  year: number;
  month: number;
  currency: string;
  amount: number;
  scheduled: number;
  count: number;
};

// Revenue for a service class (2nd part-number segment, e.g. "PEN") within its
// category, by year. Feeds the "Clasa servicii / Categorie / Clasa" table.
export type ClassYearCell = {
  category: string;
  serviceClass: string;
  year: number;
  currency: string;
  amount: number;
  scheduled: number;
};

// An unpaid, already-issued invoice, with enough context for the payments-due
// table to group by company, filter by age, and link back to the invoice.
export type DueInvoice = {
  id: string;
  number: string | null;
  clientId: string;
  clientName: string;
  issueDate: string;
  ageDays: number;
  currency: string;
  amount: number;
  status: string;
  partNumberCode: string | null;
  services: string | null;
};

export type InvoiceInsights = {
  generatedAt: Date;
  currentYear: number;
  previousYear: number;
  currencies: string[];
  selectedCurrency: string | null;
  summaries: CurrencySummary[];
  yearly: PeriodBucket[];
  monthly: MonthComparison[];
  quarters: Array<PeriodBucket & { previousAmount: number; delta: number; deltaPct: number | null }>;
  semesters: Array<PeriodBucket & { previousAmount: number; delta: number; deltaPct: number | null }>;
  forecast: ForecastBucket[];
  monthlyMatrix: YearMonthCell[];
  clientYearly: ClientYearCell[];
  categoryMonthly: CategoryMonthCell[];
  classYearly: ClassYearCell[];
  dueInvoices: DueInvoice[];
};

type InvoiceInsightInput = {
  id: string;
  number: string | null;
  currency: string;
  status: string;
  paid: boolean;
  issueDate: Date | null;
  expectedInvoiceDate: Date | null;
  totalAmount: unknown;
  totalBaseAmount: unknown;
  vatAmount: unknown;
  unpaidAmount: unknown;
  organizationId: string;
  organizationName: string;
  partNumberCode: string | null;
  servicesDescription: string | null;
  // Per-line part numbers + net values, used to split invoice revenue across
  // service categories when articles carry different part numbers. A line's code
  // falls back to the invoice-level part number when it doesn't override it.
  lines: Array<{ partNumberCode: string | null; value: unknown }>;
};

// Label used when an invoice has no resolved part-number code, so category
// totals still reconcile with the overall revenue figures.
const UNCATEGORIZED = "(uncategorized)";

// Split a resolved part-number code (e.g. "RED-PEN-B-I-B-30") into its service
// category (1st segment) and class (2nd segment). Codes without a class fall
// back to "—" so they still group under their category.
function parseServiceCode(code: string | null): { category: string; serviceClass: string } {
  const trimmed = code?.trim();
  if (!trimmed) return { category: UNCATEGORIZED, serviceClass: "—" };
  const parts = trimmed.split("-");
  const category = parts[0]?.toUpperCase() || UNCATEGORIZED;
  const serviceClass = parts[1]?.toUpperCase() || "—";
  return { category, serviceClass };
}

// Attribute an invoice's net revenue to one or more service category/class
// segments. When articles carry different part numbers, the revenue is split
// proportionally by each line's net value (a line inherits the invoice-level
// part number unless it overrides it). Invoices without usable line values fall
// back to a single segment from the invoice-level part number. The returned
// amounts always sum to the invoice's net, so category totals still reconcile.
function categorySegments(
  invoice: InvoiceInsightInput
): Array<{ category: string; serviceClass: string; amount: number }> {
  const net = netAmount(invoice);
  const weighted = invoice.lines
    .map((line) => ({ code: line.partNumberCode || invoice.partNumberCode, weight: Math.abs(n(line.value) ?? 0) }))
    .filter((line) => line.weight > 0);

  if (weighted.length === 0) {
    const { category, serviceClass } = parseServiceCode(invoice.partNumberCode);
    return [{ category, serviceClass, amount: net }];
  }

  const totalWeight = weighted.reduce((sum, line) => sum + line.weight, 0);
  const map = new Map<string, { category: string; serviceClass: string; amount: number }>();
  for (const line of weighted) {
    const { category, serviceClass } = parseServiceCode(line.code);
    const key = `${category}||${serviceClass}`;
    const seg = map.get(key) ?? { category, serviceClass, amount: 0 };
    seg.amount += net * (line.weight / totalWeight);
    map.set(key, seg);
  }
  return Array.from(map.values());
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function n(value: unknown): number | null {
  if (value == null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function netAmount(invoice: InvoiceInsightInput): number {
  const base = n(invoice.totalBaseAmount);
  if (base != null) return base;
  const total = n(invoice.totalAmount) ?? 0;
  const vat = n(invoice.vatAmount);
  return Math.max(0, vat == null ? total : total - vat);
}

function outstandingNet(invoice: InvoiceInsightInput): number {
  if (invoice.paid) return 0;
  const unpaid = n(invoice.unpaidAmount);
  const net = netAmount(invoice);
  const gross = n(invoice.totalAmount);
  if (unpaid == null || unpaid <= 0) return net;
  if (gross && gross > 0) return Math.min(net, net * (unpaid / gross));
  return Math.min(net, unpaid);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function year(date: Date): number {
  return date.getUTCFullYear();
}

function month(date: Date): number {
  return date.getUTCMonth() + 1;
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function quarter(date: Date): number {
  return Math.floor(date.getUTCMonth() / 3) + 1;
}

function semester(date: Date): number {
  return date.getUTCMonth() < 6 ? 1 : 2;
}

function pct(delta: number, base: number): number | null {
  return base === 0 ? null : (delta / base) * 100;
}

// A scheduled invoice has no issue date yet but a planned/expected one. Its
// revenue is "predicted" (not yet invoiced) and is only folded into totals when
// the user opts in via the "include scheduled" toggle.
function isScheduled(row: InvoiceInsightInput): boolean {
  return !row.issueDate && !!row.expectedInvoiceDate;
}

// Effective date for bucketing: the issue date for issued invoices, else the
// expected (planned) invoice date for scheduled ones.
function effectiveDate(row: InvoiceInsightInput): Date | null {
  return row.issueDate ?? row.expectedInvoiceDate ?? null;
}

function sumFor(rows: InvoiceInsightInput[], currency: string, predicate: (row: InvoiceInsightInput) => boolean): number {
  return rows.reduce((sum, row) => sum + (row.currency === currency && predicate(row) ? netAmount(row) : 0), 0);
}

function compareByPeriod(
  rows: InvoiceInsightInput[],
  currentYear: number,
  currency: string,
  periods: number,
  getPeriod: (date: Date) => number,
  label: (period: number) => string
) {
  return Array.from({ length: periods }, (_, idx) => {
    const period = idx + 1;
    const current = rows.filter((row) => row.currency === currency && row.issueDate && year(row.issueDate) === currentYear && getPeriod(row.issueDate) === period);
    const previous = rows.filter((row) => row.currency === currency && row.issueDate && year(row.issueDate) === currentYear - 1 && getPeriod(row.issueDate) === period);
    const scheduledRows = rows.filter((row) => row.currency === currency && isScheduled(row) && year(row.expectedInvoiceDate!) === currentYear && getPeriod(row.expectedInvoiceDate!) === period);
    const amount = current.reduce((sum, row) => sum + netAmount(row), 0);
    const previousAmount = previous.reduce((sum, row) => sum + netAmount(row), 0);
    const scheduled = scheduledRows.reduce((sum, row) => sum + netAmount(row), 0);
    const delta = amount - previousAmount;
    return {
      key: `${currentYear}-${period}`,
      label: label(period),
      currency,
      amount,
      scheduled,
      previousAmount,
      delta,
      deltaPct: pct(delta, previousAmount),
      count: current.length,
    };
  });
}

export async function getInvoiceInsights(user: User, opts: { currency?: string | null; issuer?: string | null } = {}): Promise<InvoiceInsights> {
  const invoiceVis = await invoiceVisibilityWhere(user);
  // Optional issuer scope (by canonical issuerName); omitted = overall.
  const where = opts.issuer ? { AND: [invoiceVis, { issuerName: opts.issuer }] } : invoiceVis;
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const previousYear = currentYear - 1;
  const next90 = addDays(now, 90);
  const forecastStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const forecastEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 18, 1));

  const rowsRaw = await prisma.invoice.findMany({
    where,
    select: {
      id: true,
      number: true,
      currency: true,
      status: true,
      paid: true,
      issueDate: true,
      expectedInvoiceDate: true,
      totalAmount: true,
      totalBaseAmount: true,
      vatAmount: true,
      unpaidAmount: true,
      organizationId: true,
      partNumberCode: true,
      servicesDescription: true,
      organization: { select: { legalName: true, sourceName: true } },
      lines: { select: { partNumberCode: true, value: true } },
    },
  });

  const allRows: InvoiceInsightInput[] = rowsRaw.map((row) => ({
    ...row,
    status: row.status,
    currency: row.currency || "RON",
    organizationId: row.organizationId,
    organizationName: row.organization?.legalName || row.organization?.sourceName || "—",
    partNumberCode: row.partNumberCode ?? null,
    servicesDescription: row.servicesDescription ?? null,
    lines: row.lines.map((line) => ({ partNumberCode: line.partNumberCode ?? null, value: line.value })),
  }));
  const currencies = Array.from(new Set(allRows.map((row) => row.currency))).sort();
  const selectedCurrency = opts.currency && currencies.includes(opts.currency) ? opts.currency : null;
  const rows = selectedCurrency ? allRows.filter((row) => row.currency === selectedCurrency) : allRows;
  const activeCurrencies = selectedCurrency ? [selectedCurrency] : currencies;

  // Same-calendar-date cutoff a year ago, so "year to date" compares like-for-like.
  const prevYtdCutoff = new Date(Date.UTC(previousYear, now.getUTCMonth(), now.getUTCDate(), 23, 59, 59));

  const summaries = activeCurrencies.map((currency) => {
    const invoicedYear = sumFor(rows, currency, (row) => !!row.issueDate && year(row.issueDate) === currentYear);
    const previousYearTotal = sumFor(rows, currency, (row) => !!row.issueDate && year(row.issueDate!) === previousYear);
    const invoicedYtd = sumFor(rows, currency, (row) => !!row.issueDate && year(row.issueDate) === currentYear && row.issueDate! <= now);
    const previousYtd = sumFor(rows, currency, (row) => !!row.issueDate && year(row.issueDate) === previousYear && row.issueDate! <= prevYtdCutoff);
    const ytdDelta = invoicedYtd - previousYtd;
    const openToInvoice = sumFor(rows, currency, (row) => !row.issueDate && !!row.expectedInvoiceDate);
    const openToInvoiceYear = sumFor(rows, currency, (row) => !row.issueDate && !!row.expectedInvoiceDate && year(row.expectedInvoiceDate!) === currentYear);
    const scheduledYear = sumFor(rows, currency, (row) => isScheduled(row) && year(row.expectedInvoiceDate!) === currentYear);
    const expectedCashNext90 = rows.reduce((sum, row) => {
      if (row.currency !== currency) return sum;
      const cashDate = row.issueDate ? addDays(row.issueDate, 30) : row.expectedInvoiceDate ? addDays(row.expectedInvoiceDate, 40) : null;
      return cashDate && cashDate >= now && cashDate <= next90 ? sum + netAmount(row) : sum;
    }, 0);
    // "Invoiced but not received": already-issued invoices with a positive unpaid balance.
    const outstanding = rows.reduce((sum, row) => sum + (row.currency === currency && !!row.issueDate ? outstandingNet(row) : 0), 0);
    const outstandingYear = rows.reduce(
      (sum, row) => sum + (row.currency === currency && !!row.issueDate && year(row.issueDate) === currentYear ? outstandingNet(row) : 0),
      0
    );
    const yoyDelta = invoicedYear - previousYearTotal;
    return {
      currency,
      invoicedYtd,
      previousYtd,
      ytdDelta,
      ytdDeltaPct: pct(ytdDelta, previousYtd),
      invoicedYear,
      previousYear: previousYearTotal,
      yoyDelta,
      yoyDeltaPct: pct(yoyDelta, previousYearTotal),
      openToInvoice,
      openToInvoiceYear,
      scheduledYear,
      expectedCashNext90,
      outstandingNet: outstanding,
      outstandingNetYear: outstandingYear,
      invoiceCount: rows.filter((row) => row.currency === currency).length,
    };
  });

  const yearlyMap = new Map<string, PeriodBucket>();
  for (const row of rows) {
    const d = effectiveDate(row);
    if (!d) continue;
    const key = `${row.currency}-${year(d)}`;
    const bucket = yearlyMap.get(key) ?? { key, label: String(year(d)), currency: row.currency, amount: 0, scheduled: 0, count: 0 };
    if (isScheduled(row)) bucket.scheduled += netAmount(row);
    else bucket.amount += netAmount(row);
    bucket.count += 1;
    yearlyMap.set(key, bucket);
  }

  const monthly = activeCurrencies.flatMap((currency) =>
    MONTH_LABELS.map((label, idx) => {
      const m = idx + 1;
      const current = sumFor(rows, currency, (row) => !!row.issueDate && year(row.issueDate) === currentYear && month(row.issueDate) === m);
      const previous = sumFor(rows, currency, (row) => !!row.issueDate && year(row.issueDate) === previousYear && month(row.issueDate) === m);
      const currentScheduled = sumFor(rows, currency, (row) => isScheduled(row) && year(row.expectedInvoiceDate!) === currentYear && month(row.expectedInvoiceDate!) === m);
      const delta = current - previous;
      return { month: m, label, currency, current, previous, currentScheduled, delta, deltaPct: pct(delta, previous) };
    })
  );

  const quarters = activeCurrencies.flatMap((currency) =>
    compareByPeriod(rows, currentYear, currency, 4, quarter, (period) => `Q${period}`)
  );
  const semesters = activeCurrencies.flatMap((currency) =>
    compareByPeriod(rows, currentYear, currency, 2, semester, (period) => `S${period}`)
  );

  const forecastMap = new Map<string, ForecastBucket>();
  for (const row of rows) {
    const cashDate = row.issueDate ? addDays(row.issueDate, 30) : row.expectedInvoiceDate ? addDays(row.expectedInvoiceDate, 40) : null;
    if (!cashDate || cashDate < forecastStart || cashDate >= forecastEnd) continue;
    const key = `${row.currency}-${monthKey(cashDate)}`;
    const existing = forecastMap.get(key) ?? {
      key,
      label: monthKey(cashDate),
      currency: row.currency,
      invoicedCash: 0,
      toInvoiceCash: 0,
      total: 0,
      count: 0,
    };
    const amount = netAmount(row);
    if (row.issueDate) existing.invoicedCash += amount;
    else existing.toInvoiceCash += amount;
    existing.total += amount;
    existing.count += 1;
    forecastMap.set(key, existing);
  }

  // Entire-history aggregations (all currencies, regardless of any filter) so the
  // client can build the year×month heatmap and the client-activity matrix.
  const matrixMap = new Map<string, YearMonthCell>();
  const clientMap = new Map<string, ClientYearCell>();
  const categoryMap = new Map<string, CategoryMonthCell>();
  const classMap = new Map<string, ClassYearCell>();
  for (const row of allRows) {
    const d = effectiveDate(row);
    if (!d) continue;
    const y = year(d);
    const m = month(d);
    const amount = netAmount(row);
    const sched = isScheduled(row);

    const mKey = `${y}-${m}-${row.currency}`;
    const mCell = matrixMap.get(mKey) ?? { year: y, month: m, currency: row.currency, amount: 0, scheduled: 0, count: 0, scheduledCount: 0 };
    if (sched) {
      mCell.scheduled += amount;
      mCell.scheduledCount += 1;
    } else {
      mCell.amount += amount;
      mCell.count += 1;
    }
    matrixMap.set(mKey, mCell);

    const cKey = `${row.organizationId}-${y}-${row.currency}`;
    const cCell = clientMap.get(cKey) ?? {
      clientId: row.organizationId,
      clientName: row.organizationName,
      year: y,
      currency: row.currency,
      amount: 0,
      scheduled: 0,
    };
    if (sched) cCell.scheduled += amount;
    else cCell.amount += amount;
    clientMap.set(cKey, cCell);

    // Split the invoice across category/class segments per its article part
    // numbers (proportional to line values). The segment amounts sum to `amount`.
    for (const seg of categorySegments(row)) {
      const catKey = `${seg.category}-${y}-${m}-${row.currency}`;
      const catCell = categoryMap.get(catKey) ?? { category: seg.category, year: y, month: m, currency: row.currency, amount: 0, scheduled: 0, count: 0 };
      if (sched) catCell.scheduled += seg.amount;
      else {
        catCell.amount += seg.amount;
        catCell.count += 1;
      }
      categoryMap.set(catKey, catCell);

      const clsKey = `${seg.category}-${seg.serviceClass}-${y}-${row.currency}`;
      const clsCell = classMap.get(clsKey) ?? { category: seg.category, serviceClass: seg.serviceClass, year: y, currency: row.currency, amount: 0, scheduled: 0 };
      if (sched) clsCell.scheduled += seg.amount;
      else clsCell.amount += seg.amount;
      classMap.set(clsKey, clsCell);
    }
  }

  // Unpaid, already-issued invoices with a positive outstanding balance. The
  // client filters these by age and rolls them up per company. Amount is the
  // accounting outstanding balance ("neachitat") when known, else the full
  // invoiced total (both gross / as invoiced).
  const dueInvoices: DueInvoice[] = allRows
    .filter((row) => !row.paid && !!row.issueDate)
    .map((row) => {
      const amount = n(row.unpaidAmount) ?? n(row.totalAmount) ?? netAmount(row);
      const ageDays = Math.max(0, Math.floor((now.getTime() - row.issueDate!.getTime()) / 86_400_000));
      const services = row.servicesDescription?.replace(/\s+/g, " ").trim() || null;
      // Show every distinct part number on the invoice (each line inherits the
      // invoice-level default unless it overrides it), else the invoice default.
      const lineCodes = Array.from(
        new Set(row.lines.map((line) => line.partNumberCode || row.partNumberCode).filter((c): c is string => !!c))
      );
      const partNumberCode = lineCodes.length ? lineCodes.join(", ") : row.partNumberCode;
      return {
        id: row.id,
        number: row.number,
        clientId: row.organizationId,
        clientName: row.organizationName,
        issueDate: row.issueDate!.toISOString(),
        ageDays,
        currency: row.currency,
        amount,
        status: row.status,
        partNumberCode,
        services: services ? services.slice(0, 160) : null,
      };
    })
    .filter((d) => d.amount > 0);

  return {
    generatedAt: now,
    currentYear,
    previousYear,
    currencies,
    selectedCurrency,
    summaries,
    yearly: Array.from(yearlyMap.values()).sort((a, b) => a.currency.localeCompare(b.currency) || a.label.localeCompare(b.label)),
    monthly,
    quarters,
    semesters,
    forecast: Array.from(forecastMap.values()).sort((a, b) => a.currency.localeCompare(b.currency) || a.label.localeCompare(b.label)).slice(0, 36),
    monthlyMatrix: Array.from(matrixMap.values()),
    clientYearly: Array.from(clientMap.values()),
    categoryMonthly: Array.from(categoryMap.values()),
    classYearly: Array.from(classMap.values()),
    dueInvoices,
  };
}
