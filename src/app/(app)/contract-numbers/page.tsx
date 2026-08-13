import { Plus } from "lucide-react";
import { requireFullAuth } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { clientVisibilityWhere } from "@/lib/rbac";
import { getActiveIssuers } from "@/lib/issuers";
import { getPaginatedContractNumbers } from "@/lib/contract-number-stats";
import { ContractType } from "@/generated/prisma";
import { CLIENTS_PAGE_SIZE, LIST_FETCH_CAP } from "@/lib/app-constants";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/shared/search-input";
import { FilterBar, FilterSelect, ClearFiltersButton } from "@/components/shared/filter-bar";
import { Pagination } from "@/components/shared/pagination";
import { ContractNumbersTable } from "@/components/contract-numbers/contract-numbers-table";
import { ContractNumberFormDialog } from "@/components/contract-numbers/contract-number-form-dialog";

export const metadata = { title: "Contract Numbers" };

export default async function ContractNumbersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    issuer?: string;
    type?: string;
    frame?: string;
    sort?: string;
    dir?: string;
    page?: string;
  }>;
}) {
  const user = await requireFullAuth();
  const { q, issuer, type, frame, sort, dir, page } = await searchParams;

  const typeFilter = type === "IN" || type === "OUT" ? (type as ContractType) : undefined;
  const frameFilter = frame === "yes" || frame === "no" ? (frame as "yes" | "no") : undefined;

  const clientVis = await clientVisibilityWhere(user);
  const [contractPage, issuers, organizations] = await Promise.all([
    getPaginatedContractNumbers(user, {
      search: q,
      issuerId: issuer,
      type: typeFilter,
      frame: frameFilter,
      sort,
      dir: dir === "asc" ? "asc" : dir === "desc" ? "desc" : undefined,
      page: Number.parseInt(page ?? "", 10) || 1,
      pageSize: CLIENTS_PAGE_SIZE,
    }),
    getActiveIssuers(),
    prisma.organization.findMany({
      where: { client: clientVis },
      orderBy: { sourceName: "asc" },
      select: { id: true, sourceName: true },
      take: LIST_FETCH_CAP,
    }),
  ]);

  const total = contractPage.total;
  const orgOptions = organizations.map((o) => ({ id: o.id, name: o.sourceName }));
  const issuerFilterOptions = issuers.map((i) => ({ value: i.id, label: i.name }));

  return (
    <div>
      <PageHeader
        title="Contract Numbers"
        description={`${total} ${total === 1 ? "contract number" : "contract numbers"}`}
      >
        <ContractNumberFormDialog
          issuers={issuers}
          organizations={orgOptions}
          trigger={
            <Button>
              <Plus /> New contract number
            </Button>
          }
        />
      </PageHeader>

      <div className="page-body space-y-5 pt-0">
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput placeholder="Search number, client, comment…" />
          <FilterBar>
            <FilterSelect param="issuer" options={issuerFilterOptions} placeholder="All companies" ariaLabel="Filter by company" />
            <FilterSelect
              param="type"
              options={[
                { value: "IN", label: "In" },
                { value: "OUT", label: "Out" },
              ]}
              placeholder="All types"
              ariaLabel="Filter by type"
            />
            <FilterSelect
              param="frame"
              options={[
                { value: "yes", label: "Frame agreement" },
                { value: "no", label: "Not frame" },
              ]}
              placeholder="All agreements"
              ariaLabel="Filter by frame agreement"
            />
            <ClearFiltersButton keys={["issuer", "type", "frame"]} />
          </FilterBar>
        </div>

        <ContractNumbersTable
          contractNumbers={contractPage.contractNumbers}
          issuers={issuers}
          organizations={orgOptions}
        />

        {total > CLIENTS_PAGE_SIZE && (
          <Pagination
            pathname="/contract-numbers"
            params={{ q, issuer, type, frame, sort, dir, page }}
            page={contractPage.page}
            total={total}
            pageSize={contractPage.pageSize}
            itemLabel="contract number"
          />
        )}
      </div>
    </div>
  );
}
