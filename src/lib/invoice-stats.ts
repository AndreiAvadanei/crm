import "server-only";
import { prisma } from "@/lib/db";
import { invoiceVisibilityWhere } from "@/lib/rbac";
import { Prisma, InvoiceStatus, type User } from "@/generated/prisma";

export { INVOICE_STATUS_LABELS } from "@/lib/invoice-constants";

export interface InvoiceListOpts {
  search?: string;
  status?: InvoiceStatus;
  clientId?: string;
  organizationId?: string;
  currency?: string;
  issuer?: string;
  /** Which date column the from/to range applies to. */
  dateField?: "issued" | "expected";
  /** Inclusive range bounds, yyyy-mm-dd. */
  from?: string;
  to?: string;
  /** Only invoices with neither an issue nor an expected date set. */
  noDates?: boolean;
  /** Workflow tab: "to_invoice" (not issued) | "invoiced" (issued) | undefined (all). */
  tab?: InvoiceTab;
  /** Column to sort by (defaults to tab-aware smart ordering). */
  sort?: string;
  dir?: "asc" | "desc";
  page?: number;
  pageSize: number;
}

export type InvoiceTab = "to_invoice" | "invoiced";

const DEFAULT_INVOICE_ORDER: Prisma.InvoiceOrderByWithRelationInput[] = [
  // MySQL sorts NULLs first on ASC, so not-yet-issued invoices float to the top,
  // ordered by soonest expected date; issued invoices follow underneath.
  { issueDate: "asc" },
  { expectedInvoiceDate: "asc" },
  { createdAt: "desc" },
];

function buildInvoiceOrderBy(sort?: string, dir?: "asc" | "desc", tab?: InvoiceTab): Prisma.InvoiceOrderByWithRelationInput[] {
  if (!sort) {
    // Tab-aware defaults: upcoming-soonest first when invoicing, newest issued
    // first when reviewing what's already invoiced.
    if (tab === "to_invoice") return [{ expectedInvoiceDate: "asc" }, { createdAt: "desc" }];
    if (tab === "invoiced") return [{ issueDate: "desc" }, { createdAt: "desc" }];
    return DEFAULT_INVOICE_ORDER;
  }
  const d: "asc" | "desc" = dir === "asc" ? "asc" : "desc";
  switch (sort) {
    case "number":
      return [{ number: d }];
    case "organization":
      return [{ organization: { sourceName: d } }];
    case "client":
      return [{ client: { name: d } }];
    case "deal":
      return [{ salesIdSnapshot: d }];
    case "status":
      return [{ status: d }];
    case "total":
      return [{ totalAmount: d }];
    case "baseTotal":
      return [{ totalBaseAmount: d }];
    case "contract":
      return [{ contractRef: d }];
    case "issued":
      return [{ issueDate: d }];
    case "expected":
      return [{ expectedInvoiceDate: d }];
    case "paid":
      return [{ paid: d }];
    case "issuer":
      return [{ issuerName: d }];
    default:
      return DEFAULT_INVOICE_ORDER;
  }
}

export interface InvoiceRow {
  id: string;
  number: string | null;
  externalRef: string | null;
  status: InvoiceStatus;
  organizationId: string;
  organizationName: string;
  clientId: string | null;
  clientName: string | null;
  salesId: string | null;
  hasDeal: boolean;
  currency: string | null;
  amountRaw: string | null;
  totalAmount: number | null;
  totalBaseAmount: number | null;
  vatAmount: number | null;
  unpaidAmount: number | null;
  issueDate: Date | null;
  expectedInvoiceDate: Date | null;
  paid: boolean;
  createdAt: Date;
  servicesDescription: string | null;
  contractRef: string | null;
  fileUrls: string | null;
  issuerName: string | null;
  paymentTermDays: number | null;
  articleCount: number;
  org: OrganizationBillingInfo;
}

export interface OrganizationBillingInfo {
  legalName: string | null;
  taxId: string | null;
  regNumber: string | null;
  bankName: string | null;
  iban: string | null;
  address: string | null;
  country: string | null;
}

export interface CurrencyTotal {
  currency: string;
  total: number;
}

export interface PaginatedInvoices {
  invoices: InvoiceRow[];
  total: number;
  page: number;
  pageSize: number;
  /** Naive cross-currency sum (kept for callers that don't care about currency). */
  totalAmountSum: number;
  /** Correct per-currency breakdown of totalAmount for the current filter. */
  totalsByCurrency: CurrencyTotal[];
}

/** Build the WHERE clause for every filter EXCEPT the workflow tab. */
async function buildInvoiceWhere(user: User, opts: InvoiceListOpts): Promise<Prisma.InvoiceWhereInput> {
  // Scope to invoices the user may see (owning client visibility OR issue-date share).
  const and: Prisma.InvoiceWhereInput[] = [await invoiceVisibilityWhere(user)];
  if (opts.status) and.push({ status: opts.status });
  if (opts.clientId) and.push({ clientId: opts.clientId });
  if (opts.organizationId) and.push({ organizationId: opts.organizationId });
  if (opts.currency) and.push({ currency: opts.currency });
  if (opts.issuer) and.push({ issuerName: opts.issuer });
  if (opts.search) {
    const q = opts.search.trim();
    and.push({
      OR: [
        { number: { contains: q } },
        { externalRef: { contains: q } },
        { salesIdSnapshot: { contains: q } },
        { servicesDescription: { contains: q } },
        { organization: { sourceName: { contains: q } } },
      ],
    });
  }
  if (opts.noDates) {
    and.push({ issueDate: null, expectedInvoiceDate: null });
  } else if (opts.from || opts.to) {
    const range: Prisma.DateTimeFilter = {};
    if (opts.from) range.gte = new Date(`${opts.from}T00:00:00.000Z`);
    if (opts.to) range.lte = new Date(`${opts.to}T23:59:59.999Z`);
    if (opts.dateField === "expected") {
      and.push({ expectedInvoiceDate: range });
    } else if (opts.dateField === "issued") {
      and.push({ issueDate: range });
    } else {
      // "All dates": match either the issue or the expected date in the range.
      and.push({ OR: [{ issueDate: range }, { expectedInvoiceDate: range }] });
    }
  }
  return { AND: and };
}

/** Tab constraint: not-yet-issued vs already issued. */
function tabWhere(tab?: InvoiceTab): Prisma.InvoiceWhereInput | null {
  if (tab === "to_invoice") return { issueDate: null };
  if (tab === "invoiced") return { issueDate: { not: null } };
  return null;
}

export interface IssuerTotal {
  issuerName: string | null;
  count: number;
  totals: CurrencyTotal[];
}

/** Merge a single normalized currency code (EURO -> EUR). */
function normalizeCurrencyCode(currency: string | null): string {
  const c = (currency || "RON").trim().toUpperCase();
  return c === "EURO" ? "EUR" : c;
}

/** Roll up groupBy(currency) sums into a sorted, currency-normalized list. */
function rollupCurrencyTotals(rows: { currency: string | null; _sum: { totalAmount: Prisma.Decimal | null } }[]): CurrencyTotal[] {
  const map = new Map<string, number>();
  for (const row of rows) {
    const code = normalizeCurrencyCode(row.currency);
    map.set(code, (map.get(code) ?? 0) + (row._sum.totalAmount == null ? 0 : Number(row._sum.totalAmount)));
  }
  return Array.from(map.entries())
    .map(([currency, total]) => ({ currency, total }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Per-issuer totals honoring every active filter EXCEPT the issuer filter itself,
 * so the breakdown always shows all issuers (e.g. BIT SENTINEL + CYBEREDU) and can
 * be used to switch the active issuer filter. Amounts are split by currency since
 * summing across currencies would be meaningless.
 */
export async function getInvoiceIssuerTotals(user: User, opts: InvoiceListOpts): Promise<IssuerTotal[]> {
  const base = await buildInvoiceWhere(user, { ...opts, issuer: undefined });
  const tab = tabWhere(opts.tab);
  const where: Prisma.InvoiceWhereInput = tab ? { AND: [base, tab] } : base;
  const groups = await prisma.invoice.groupBy({
    by: ["issuerName", "currency"],
    where,
    _sum: { totalAmount: true },
    _count: { _all: true },
  });
  const byIssuer = new Map<string, { issuerName: string | null; count: number; rows: typeof groups }>();
  for (const g of groups) {
    const key = g.issuerName ?? "\u0000";
    const entry = byIssuer.get(key) ?? { issuerName: g.issuerName, count: 0, rows: [] as typeof groups };
    entry.count += g._count._all;
    entry.rows.push(g);
    byIssuer.set(key, entry);
  }
  return Array.from(byIssuer.values())
    .map((e) => ({ issuerName: e.issuerName, count: e.count, totals: rollupCurrencyTotals(e.rows) }))
    .sort((a, b) => b.count - a.count);
}

/** Counts per workflow tab honoring all the other active filters. */
export async function getInvoiceTabCounts(user: User, opts: InvoiceListOpts): Promise<{ toInvoice: number; invoiced: number }> {
  const base = await buildInvoiceWhere(user, opts);
  const [toInvoice, invoiced] = await Promise.all([
    prisma.invoice.count({ where: { AND: [base, tabWhere("to_invoice")!] } }),
    prisma.invoice.count({ where: { AND: [base, tabWhere("invoiced")!] } }),
  ]);
  return { toInvoice, invoiced };
}

export async function getPaginatedInvoices(user: User, opts: InvoiceListOpts): Promise<PaginatedInvoices> {
  const base = await buildInvoiceWhere(user, opts);
  const tab = tabWhere(opts.tab);
  const where: Prisma.InvoiceWhereInput = tab ? { AND: [base, tab] } : base;

  const page = Math.max(1, opts.page ?? 1);
  const [total, rows, agg, currencyAgg] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({
      where,
      orderBy: buildInvoiceOrderBy(opts.sort, opts.dir, opts.tab),
      skip: (page - 1) * opts.pageSize,
      take: opts.pageSize,
      include: {
        organization: {
          select: {
            id: true,
            sourceName: true,
            legalName: true,
            taxId: true,
            regNumber: true,
            bankName: true,
            iban: true,
            address: true,
            country: true,
          },
        },
        client: { select: { id: true, name: true } },
        deal: { select: { salesId: true } },
        _count: { select: { lines: true } },
      },
    }),
    prisma.invoice.aggregate({ where, _sum: { totalAmount: true } }),
    prisma.invoice.groupBy({ by: ["currency"], where, _sum: { totalAmount: true } }),
  ]);

  return {
    invoices: rows.map((i) => ({
      id: i.id,
      number: i.number,
      externalRef: i.externalRef,
      status: i.status,
      organizationId: i.organizationId,
      organizationName: i.organization.sourceName,
      clientId: i.clientId,
      clientName: i.client?.name ?? null,
      salesId: i.deal?.salesId ?? i.salesIdSnapshot ?? null,
      hasDeal: !!i.dealId,
      currency: i.currency,
      amountRaw: i.amountRaw,
      totalAmount: i.totalAmount == null ? null : Number(i.totalAmount),
      totalBaseAmount: i.totalBaseAmount == null ? null : Number(i.totalBaseAmount),
      vatAmount: i.vatAmount == null ? null : Number(i.vatAmount),
      unpaidAmount: i.unpaidAmount == null ? null : Number(i.unpaidAmount),
      issueDate: i.issueDate,
      expectedInvoiceDate: i.expectedInvoiceDate,
      paid: i.paid,
      createdAt: i.createdAt,
      servicesDescription: i.servicesDescription,
      contractRef: i.contractRef,
      fileUrls: i.fileUrls,
      issuerName: i.issuerName,
      paymentTermDays: i.paymentTermDays,
      articleCount: i._count.lines,
      org: {
        legalName: i.organization.legalName,
        taxId: i.organization.taxId,
        regNumber: i.organization.regNumber,
        bankName: i.organization.bankName,
        iban: i.organization.iban,
        address: i.organization.address,
        country: i.organization.country,
      },
    })),
    total,
    page,
    pageSize: opts.pageSize,
    totalAmountSum: agg._sum.totalAmount == null ? 0 : Number(agg._sum.totalAmount),
    totalsByCurrency: rollupCurrencyTotals(currencyAgg),
  };
}
