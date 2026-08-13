import { Plus } from "lucide-react";
import { requireFullAuth } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { clientVisibilityWhere, isAdmin } from "@/lib/rbac";
import { getPaginatedClientsWithStats, getClientFilterFacets, type ClientSort } from "@/lib/client-stats";
import { getTagViews, getFieldDefViews, getOwners } from "@/lib/view-helpers";
import { parseCsvIds, parseNumber } from "@/lib/filter-helpers";
import { CLIENTS_PAGE_SIZE, LIST_FETCH_CAP } from "@/lib/app-constants";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { ClientsToolbar } from "@/components/clients/clients-toolbar";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";
import { ClientsTable, type ClientRow } from "@/components/clients/clients-table";
import { Pagination } from "@/components/shared/pagination";

export const metadata = {
  title: "Clients",
};

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    sort?: string;
    owner?: string;
    tag?: string;
    size?: string;
    country?: string;
    hasOpen?: string;
    noDeals?: string;
    active?: string;
    page?: string;
  }>;
}) {
  const user = await requireFullAuth();
  const { q, sort, owner, tag, size, country, hasOpen, noDeals, active, page } = await searchParams;

  const admin = isAdmin(user);
  const clientVis = await clientVisibilityWhere(user);
  const requestedPage = Number.parseInt(page ?? "", 10);
  const [clientPage, facets, tags, fieldDefs, owners, dealFieldDefs, pipeline, dealClients] = await Promise.all([
    getPaginatedClientsWithStats(user, {
      search: q,
      sort: sort as ClientSort | undefined,
      // Owner filter is admin-only (sales already scoped to their own data).
      ownerId: admin ? owner : undefined,
      tagIds: parseCsvIds(tag),
      size,
      country,
      hasOpenDeals: hasOpen === "1",
      noDeals: noDeals === "1",
      activeWithinDays: parseNumber(active),
      page: requestedPage,
      pageSize: CLIENTS_PAGE_SIZE,
    }),
    getClientFilterFacets(user),
    getTagViews(),
    getFieldDefViews("CLIENT"),
    admin ? getOwners() : Promise.resolve([]),
    getFieldDefViews("DEAL"),
    prisma.pipeline.findFirst({ where: { isDefault: true }, include: { stages: { orderBy: { order: "asc" } } } }),
    prisma.client.findMany({ where: clientVis, orderBy: { name: "asc" }, select: { id: true, name: true }, take: LIST_FETCH_CAP }),
  ]);
  const dealStages = (pipeline?.stages ?? []).map((s) => ({ id: s.id, name: s.name }));
  const totalClients = clientPage.total;

  const clientRows: ClientRow[] = clientPage.clients.map((c) => ({
    id: c.id,
    name: c.name,
    website: c.website,
    contactName: c.contactName,
    contactEmail: c.contactEmail,
    country: c.country,
    ownerId: c.ownerId,
    ownerName: c.owner?.name ?? null,
    ownerColor: c.owner?.avatarColor ?? null,
    tagIds: c.tags.map((t) => t.id),
    stats: c.stats,
    createdAt: c.createdAt.toISOString(),
  }));

  return (
    <div>
      <PageHeader title="Clients" description={`${totalClients} ${totalClients === 1 ? "client" : "clients"} visible to you`}>
        <ClientFormDialog
          isAdmin={admin}
          tags={tags}
          fieldDefs={fieldDefs}
          owners={owners}
          trigger={
            <Button>
              <Plus /> New client
            </Button>
          }
        />
      </PageHeader>

      <div className="page-body space-y-5 pt-0">
        <ClientsToolbar
          owners={owners}
          tags={tags}
          sizes={facets.sizes}
          countries={facets.countries}
          showOwnerFilter={admin}
        />
        <ClientsTable
          clients={clientRows}
          owners={owners}
          tags={tags}
          admin={admin}
          dealForm={{
            stages: dealStages,
            clients: dealClients,
            fieldDefs: dealFieldDefs,
            defaultStageId: dealStages[0]?.id,
          }}
        />
        {totalClients > CLIENTS_PAGE_SIZE && (
          <Pagination
            pathname="/clients"
            params={{ q, sort, owner, tag, size, country, hasOpen, noDeals, active, page }}
            page={clientPage.page}
            total={totalClients}
            pageSize={clientPage.pageSize}
            itemLabel="client"
          />
        )}
      </div>
    </div>
  );
}
