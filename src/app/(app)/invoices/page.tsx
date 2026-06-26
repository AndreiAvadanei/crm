import { Plus } from "lucide-react";
import Link from "next/link";
import { requireFullAuth } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { clientVisibilityWhere, dealVisibilityWhere, isAdmin } from "@/lib/rbac";
import { getPaginatedInvoices, getInvoiceTabCounts, getInvoiceIssuerTotals, type InvoiceTab } from "@/lib/invoice-stats";
import { getActiveIssuers, getIssuerFilterNames } from "@/lib/issuers";
import { getActiveSeries } from "@/lib/series";
import { getActivePartNumbers } from "@/lib/part-number-catalog";
import { InvoiceStatus } from "@/generated/prisma";
import { CLIENTS_PAGE_SIZE, LIST_FETCH_CAP } from "@/lib/app-constants";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/shared/search-input";
import { Pagination } from "@/components/shared/pagination";
import { InvoicesTable } from "@/components/invoices/invoices-table";
import { InvoiceFilters, InvoiceTabs } from "@/components/invoices/invoice-filters";
import { InvoiceFormDialog } from "@/components/invoices/invoice-form-dialog";
import { InvoiceImportDialog } from "@/components/invoices/invoice-import-dialog";
import { IssuerTotals } from "@/components/invoices/issuer-totals";

export const metadata = { title: "Invoices" };

function parseStatus(v?: string): InvoiceStatus | undefined {
  if (v && (Object.values(InvoiceStatus) as string[]).includes(v)) return v as InvoiceStatus;
  return undefined;
}

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; client?: string; organization?: string; currency?: string; issuer?: string; dateField?: string; from?: string; to?: string; noDates?: string; tab?: string; sort?: string; dir?: string; page?: string }>;
}) {
  const user = await requireFullAuth();
  const { q, status, client, organization, currency, issuer, dateField, from, to, noDates, tab, sort, dir, page } = await searchParams;
  const dateFieldOpt: "expected" | "issued" | undefined = dateField === "expected" || dateField === "issued" ? dateField : undefined;
  const noDatesOpt = noDates === "1";
  const tabOpt: InvoiceTab = tab === "invoiced" ? "invoiced" : "to_invoice";
  const dirOpt = dir === "asc" ? "asc" : dir === "desc" ? "desc" : undefined;

  const filterOpts = {
    search: q,
    status: parseStatus(status),
    clientId: client,
    organizationId: organization,
    currency,
    issuer,
    dateField: dateFieldOpt,
    from,
    to,
    noDates: noDatesOpt,
  };

  const [clientVis, dealVis] = await Promise.all([clientVisibilityWhere(user), dealVisibilityWhere(user)]);
  const [invoicePage, tabCounts, issuerTotals, orgs, deals, issuerList, issuerNames, currencyRows, partNumbers, seriesList] = await Promise.all([
    getPaginatedInvoices(user, {
      ...filterOpts,
      tab: tabOpt,
      sort,
      dir: dirOpt,
      page: Number.parseInt(page ?? "", 10) || 1,
      pageSize: CLIENTS_PAGE_SIZE,
    }),
    getInvoiceTabCounts(user, { ...filterOpts, pageSize: CLIENTS_PAGE_SIZE }),
    getInvoiceIssuerTotals(user, { ...filterOpts, tab: tabOpt, pageSize: CLIENTS_PAGE_SIZE }),
    prisma.organization.findMany({
      where: { client: clientVis },
      orderBy: { sourceName: "asc" },
      select: { id: true, sourceName: true },
      take: LIST_FETCH_CAP,
    }),
    prisma.deal.findMany({
      where: dealVis,
      orderBy: [{ salesId: "desc" }],
      select: { salesId: true, title: true },
      take: LIST_FETCH_CAP,
    }),
    getActiveIssuers(),
    getIssuerFilterNames(),
    prisma.invoice.findMany({
      where: { organization: { client: clientVis }, currency: { not: null } },
      distinct: ["currency"],
      select: { currency: true },
    }),
    getActivePartNumbers(),
    getActiveSeries(),
  ]);
  const total = invoicePage.total;
  const currencies = currencyRows.map((r) => r.currency!).filter(Boolean).sort();
  const orgOptions = orgs.map((o) => ({ id: o.id, name: o.sourceName }));
  const appliedOrgName = organization ? orgOptions.find((o) => o.id === organization)?.name ?? null : null;

  return (
    <div>
      <PageHeader
        title="Invoices"
        description={`${total} ${total === 1 ? "invoice" : "invoices"}${
          invoicePage.totalsByCurrency.length
            ? " · " +
              invoicePage.totalsByCurrency
                .map((t) => `${t.total.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${t.currency}`)
                .join(" · ")
            : ""
        }`}
      >
        {isAdmin(user) && (
          <Button asChild variant="outline">
            <Link href="/invoices/insights">Insights</Link>
          </Button>
        )}
        <InvoiceImportDialog issuers={issuerList} />
        <InvoiceFormDialog
          organizations={orgOptions}
          deals={deals}
          issuers={issuerList}
          series={seriesList}
          partNumbers={partNumbers}
          defaultOrganizationId={organization}
          trigger={
            <Button>
              <Plus /> New invoice
            </Button>
          }
        />
      </PageHeader>

      <div className="space-y-3 p-4 md:px-6 md:py-4">
        <div className="flex flex-wrap items-center gap-3">
          <InvoiceTabs tab={tabOpt} toInvoiceCount={tabCounts.toInvoice} invoicedCount={tabCounts.invoiced} />
          <IssuerTotals totals={issuerTotals} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput placeholder="Search number, SAL, services…" className="h-8" />
          <InvoiceFilters currencies={currencies} issuers={issuerNames} appliedOrgName={appliedOrgName} tab={tabOpt} />
        </div>
        <InvoicesTable invoices={invoicePage.invoices} canManage deals={deals} />
        {total > CLIENTS_PAGE_SIZE && (
          <Pagination
            pathname="/invoices"
            params={{ q, status, client, organization, currency, issuer, dateField, from, to, noDates, tab, sort, dir, page }}
            page={invoicePage.page}
            total={total}
            pageSize={invoicePage.pageSize}
            itemLabel="invoice"
          />
        )}
      </div>
    </div>
  );
}
