import { Plus } from "lucide-react";
import { requireFullAuth } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { clientVisibilityWhere, dealVisibilityWhere } from "@/lib/rbac";
import { getPaginatedInvoices } from "@/lib/invoice-stats";
import { InvoiceStatus } from "@/generated/prisma";
import { CLIENTS_PAGE_SIZE, LIST_FETCH_CAP } from "@/lib/app-constants";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/shared/search-input";
import { Pagination } from "@/components/shared/pagination";
import { InvoicesTable } from "@/components/invoices/invoices-table";
import { InvoiceFilters } from "@/components/invoices/invoice-filters";
import { InvoiceFormDialog } from "@/components/invoices/invoice-form-dialog";

export const metadata = { title: "Invoices" };

function parseStatus(v?: string): InvoiceStatus | undefined {
  if (v && (Object.values(InvoiceStatus) as string[]).includes(v)) return v as InvoiceStatus;
  return undefined;
}

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; client?: string; organization?: string; currency?: string; page?: string }>;
}) {
  const user = await requireFullAuth();
  const { q, status, client, organization, currency, page } = await searchParams;

  const [clientVis, dealVis] = await Promise.all([clientVisibilityWhere(user), dealVisibilityWhere(user)]);
  const [invoicePage, orgs, deals, currencyRows] = await Promise.all([
    getPaginatedInvoices(user, {
      search: q,
      status: parseStatus(status),
      clientId: client,
      organizationId: organization,
      currency,
      page: Number.parseInt(page ?? "", 10) || 1,
      pageSize: CLIENTS_PAGE_SIZE,
    }),
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
    prisma.invoice.findMany({
      where: { organization: { client: clientVis }, currency: { not: null } },
      distinct: ["currency"],
      select: { currency: true },
    }),
  ]);
  const total = invoicePage.total;
  const currencies = currencyRows.map((r) => r.currency!).filter(Boolean).sort();
  const orgOptions = orgs.map((o) => ({ id: o.id, name: o.sourceName }));
  const appliedOrgName = organization ? orgOptions.find((o) => o.id === organization)?.name ?? null : null;

  return (
    <div>
      <PageHeader
        title="Invoices"
        description={`${total} ${total === 1 ? "invoice" : "invoices"} · ${invoicePage.totalAmountSum.toLocaleString("en-US", { maximumFractionDigits: 0 })} total`}
      >
        <InvoiceFormDialog
          organizations={orgOptions}
          deals={deals}
          defaultOrganizationId={organization}
          trigger={
            <Button>
              <Plus /> New invoice
            </Button>
          }
        />
      </PageHeader>

      <div className="space-y-4 p-4 md:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput placeholder="Search number, SAL, services…" />
          <InvoiceFilters currencies={currencies} appliedOrgName={appliedOrgName} />
        </div>
        <InvoicesTable invoices={invoicePage.invoices} canManage />
        {total > CLIENTS_PAGE_SIZE && (
          <Pagination
            pathname="/invoices"
            params={{ q, status, client, organization, currency, page }}
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
