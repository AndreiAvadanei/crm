import { Plus } from "lucide-react";
import { requireFullAuth } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { clientVisibilityWhere, isAdmin } from "@/lib/rbac";
import { getClientsWithStats, getClientFilterFacets, type ClientSort } from "@/lib/client-stats";
import { getTagViews, getFieldDefViews, getOwners } from "@/lib/view-helpers";
import { parseCsvIds, parseNumber } from "@/lib/filter-helpers";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/shared/search-input";
import { ClientSortSelect } from "@/components/clients/client-sort-select";
import { ClientsFilterBar } from "@/components/clients/clients-filter-bar";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";
import { ClientsTable, type ClientRow } from "@/components/clients/clients-table";

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
  }>;
}) {
  const user = await requireFullAuth();
  const { q, sort, owner, tag, size, country, hasOpen, noDeals, active } = await searchParams;

  const admin = isAdmin(user);
  const clientVis = await clientVisibilityWhere(user);
  const [clients, facets, tags, fieldDefs, owners, dealFieldDefs, pipeline, dealClients] = await Promise.all([
    getClientsWithStats(user, {
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
    }),
    getClientFilterFacets(user),
    getTagViews(),
    getFieldDefViews("CLIENT"),
    admin ? getOwners() : Promise.resolve([]),
    getFieldDefViews("DEAL"),
    prisma.pipeline.findFirst({ where: { isDefault: true }, include: { stages: { orderBy: { order: "asc" } } } }),
    prisma.client.findMany({ where: clientVis, orderBy: { name: "asc" }, select: { id: true, name: true }, take: 500 }),
  ]);
  const dealStages = (pipeline?.stages ?? []).map((s) => ({ id: s.id, name: s.name }));

  const clientRows: ClientRow[] = clients.map((c) => ({
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
      <PageHeader title="Clients" description={`${clients.length} ${clients.length === 1 ? "client" : "clients"} visible to you`}>
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

      <div className="space-y-4 p-4 md:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput placeholder="Search clients…" />
          <ClientSortSelect />
        </div>
        <ClientsFilterBar
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
      </div>
    </div>
  );
}
