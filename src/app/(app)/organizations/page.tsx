import { Plus, Upload } from "lucide-react";
import { requireFullAuth } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { clientVisibilityWhere, isAdmin } from "@/lib/rbac";
import { getPaginatedOrganizations } from "@/lib/organization-stats";
import { CLIENTS_PAGE_SIZE, LIST_FETCH_CAP } from "@/lib/app-constants";
import { getDefaultOrganizationTvaPercent } from "@/lib/settings";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/shared/search-input";
import { Pagination } from "@/components/shared/pagination";
import { OrganizationsTable } from "@/components/organizations/organizations-table";
import { OrgFormDialog } from "@/components/organizations/org-form-dialog";
import { ImportOrganizationsDialog } from "@/components/organizations/import-organizations-dialog";

export const metadata = { title: "Organizations" };

export default async function OrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; client?: string; page?: string }>;
}) {
  const user = await requireFullAuth();
  const { q, client, page } = await searchParams;

  const clientVis = await clientVisibilityWhere(user);
  const [orgPage, clients, defaultTvaPercent] = await Promise.all([
    getPaginatedOrganizations(user, {
      search: q,
      clientId: client,
      page: Number.parseInt(page ?? "", 10) || 1,
      pageSize: CLIENTS_PAGE_SIZE,
    }),
    prisma.client.findMany({ where: clientVis, orderBy: { name: "asc" }, select: { id: true, name: true }, take: LIST_FETCH_CAP }),
    getDefaultOrganizationTvaPercent(),
  ]);
  const total = orgPage.total;
  const admin = isAdmin(user);

  return (
    <div>
      <PageHeader title="Organizations" description={`${total} billing ${total === 1 ? "entity" : "entities"}`}>
        {admin && (
          <ImportOrganizationsDialog
            trigger={
              <Button variant="outline">
                <Upload /> Import
              </Button>
            }
          />
        )}
        <OrgFormDialog
          clients={clients}
          defaultTvaPercent={defaultTvaPercent}
          trigger={
            <Button>
              <Plus /> New organization
            </Button>
          }
        />
      </PageHeader>

      <div className="space-y-4 p-4 md:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput placeholder="Search name, CUI, IBAN…" />
        </div>
        <OrganizationsTable
          organizations={orgPage.organizations}
          clients={clients}
          canManage
          defaultTvaPercent={defaultTvaPercent}
        />
        {total > CLIENTS_PAGE_SIZE && (
          <Pagination
            pathname="/organizations"
            params={{ q, client, page }}
            page={orgPage.page}
            total={total}
            pageSize={orgPage.pageSize}
            itemLabel="organization"
          />
        )}
      </div>
    </div>
  );
}
