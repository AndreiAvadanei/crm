import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Globe, Mail, Phone, MapPin } from "lucide-react";
import { requireFullAuth } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { canViewClient, clientVisibilityWhere, dealVisibilityWhere, isAdmin } from "@/lib/rbac";
import { loadValues } from "@/lib/custom-fields";
import { getTagViews, getFieldDefViews, getOwners } from "@/lib/view-helpers";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { TagBadge, StageBadge } from "@/components/shared/tag-badge";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";
import { ClientOrganizationsCard } from "@/components/organizations/client-organizations-card";
import { InvoiceListCard } from "@/components/invoices/invoice-list-card";
import { ClientShareControl } from "@/components/clients/client-share-control";
import { NewDealButton } from "@/components/clients/new-deal-button";
import { DeleteButton } from "@/components/shared/delete-button";
import { deleteClientAction } from "@/server/client-actions";
import { formatCurrency, formatDate } from "@/lib/utils";
import { LIST_FETCH_CAP } from "@/lib/app-constants";

type ClientDetailPageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: ClientDetailPageProps): Promise<Metadata> {
  const user = await requireFullAuth();
  const { id } = await params;
  if (!(await canViewClient(user, id))) return { title: "Client" };

  const client = await prisma.client.findUnique({
    where: { id },
    select: { name: true },
  });

  return {
    title: client?.name ?? "Client",
  };
}

export default async function ClientDetailPage({ params }: ClientDetailPageProps) {
  const user = await requireFullAuth();
  const { id } = await params;
  if (!(await canViewClient(user, id))) notFound();
  const dealVis = await dealVisibilityWhere(user);

  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      tags: true,
      owner: true,
      deals: { where: dealVis, include: { stage: true }, orderBy: { createdAt: "desc" } },
      organizations: {
        include: { _count: { select: { invoices: true } } },
        orderBy: { sourceName: "asc" },
      },
    },
  });
  if (!client) notFound();

  const [defs, valuesMap, tags, fieldDefViews, owners] = await Promise.all([
    prisma.customFieldDefinition.findMany({ where: { entity: "CLIENT", active: true }, orderBy: { order: "asc" } }),
    loadValues("CLIENT", id),
    getTagViews(),
    getFieldDefViews("CLIENT"),
    isAdmin(user) ? getOwners() : Promise.resolve([]),
  ]);

  const admin = isAdmin(user);
  const canDelete = admin || client.ownerId === user.id;
  const fieldValues = Object.fromEntries(valuesMap.entries());

  // Admin-only: list active SALES users + their existing share state for this client.
  const [shareUsers, sharedUserIds] = admin
    ? await Promise.all([
        prisma.user.findMany({ where: { role: "SALES", status: "ACTIVE" }, orderBy: { name: "asc" } }),
        prisma.share
          .findMany({ where: { subject: "CLIENT", subjectId: client.id } })
          .then((shares) => shares.map((s) => s.userId)),
      ])
    : [[], [] as string[]];

  // Data required by the pre-filled "New deal" dialog for this client.
  const clientVis = await clientVisibilityWhere(user);
  const [dealFieldDefs, pipeline, dealClients] = await Promise.all([
    getFieldDefViews("DEAL"),
    prisma.pipeline.findFirst({
      where: { isDefault: true },
      include: { stages: { orderBy: { order: "asc" } } },
    }),
    prisma.client.findMany({ where: clientVis, orderBy: { name: "asc" }, select: { id: true, name: true }, take: LIST_FETCH_CAP }),
  ]);
  const dealStages = (pipeline?.stages ?? []).map((s) => ({ id: s.id, name: s.name }));

  // Invoices billed to any of this client's organizations.
  const clientInvoices = await prisma.invoice.findMany({
    where: { OR: [{ clientId: id }, { organization: { clientId: id } }] },
    include: { organization: { select: { sourceName: true } } },
    orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
    take: 100,
  });
  const invoiceItems = clientInvoices.map((i) => ({
    id: i.id,
    number: i.number,
    externalRef: i.externalRef,
    organizationName: i.organization.sourceName,
    status: i.status,
    totalAmount: i.totalAmount == null ? null : Number(i.totalAmount),
    currency: i.currency,
    issueDate: i.issueDate ? i.issueDate.toISOString() : null,
  }));
  const clientOrgOptions = client.organizations.map((o) => ({ id: o.id, name: o.sourceName }));
  const defaultClientOrgId = client.organizations.find((o) => o.isDefault)?.id ?? client.organizations[0]?.id;
  const clientDealOptions = client.deals.map((d) => ({ salesId: d.salesId, title: d.title }));

  return (
    <div className="pb-10">
      <PageHeader title={client.name} description={client.website ?? undefined}>
        <NewDealButton
          clientId={client.id}
          clientName={client.name}
          stages={dealStages}
          clients={dealClients}
          tags={tags}
          fieldDefs={dealFieldDefs}
          owners={owners}
          isAdmin={isAdmin(user)}
          defaultStageId={dealStages[0]?.id}
        />
        <ClientFormDialog
          isAdmin={isAdmin(user)}
          tags={tags}
          fieldDefs={fieldDefViews}
          owners={owners}
          fieldValues={fieldValues}
          client={{
            id: client.id,
            name: client.name,
            website: client.website,
            country: client.country,
            size: client.size,
            contactName: client.contactName,
            contactEmail: client.contactEmail,
            contactPhone: client.contactPhone,
            ownerId: client.ownerId,
            tagIds: client.tags.map((t) => t.id),
          }}
          trigger={
            <Button variant="outline">
              <Pencil /> Edit
            </Button>
          }
        />
        {admin && (
          <ClientShareControl
            clientId={client.id}
            users={shareUsers.map((u) => ({
              id: u.id,
              name: u.name,
              color: u.avatarColor,
              shared: sharedUserIds.includes(u.id),
            }))}
          />
        )}
        {canDelete && (
          <DeleteButton
            variant="outline"
            label="Delete"
            redirectTo="/clients"
            onDelete={deleteClientAction.bind(null, client.id)}
            title="Delete client?"
            description="Deals will be detached from this client."
          />
        )}
      </PageHeader>

      <div className="grid gap-6 p-4 md:grid-cols-3 md:p-6">
        <div className="space-y-6 md:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {client.website && (
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-muted-foreground" /> {client.website}
                </div>
              )}
              {client.country && (
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-muted-foreground" /> {client.country}
                  {client.size ? ` · ${client.size}` : ""}
                </div>
              )}
              {client.contactName && <div className="pt-1 font-medium">{client.contactName}</div>}
              {client.contactEmail && (
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" /> {client.contactEmail}
                </div>
              )}
              {client.contactPhone && (
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-muted-foreground" /> {client.contactPhone}
                </div>
              )}
              <div className="flex flex-wrap gap-1 pt-2">
                {client.tags.map((t) => (
                  <TagBadge key={t.id} tag={t} />
                ))}
              </div>
              <div className="flex items-center gap-2 pt-2 text-muted-foreground">
                Owner: {client.owner ? <Avatar name={client.owner.name} color={client.owner.avatarColor} /> : "—"}
              </div>
            </CardContent>
          </Card>

          <ClientOrganizationsCard
            client={{ id: client.id, name: client.name }}
            canManage={canDelete}
            organizations={client.organizations.map((o) => ({
              id: o.id,
              sourceName: o.sourceName,
              legalName: o.legalName,
              country: o.country,
              taxId: o.taxId,
              regNumber: o.regNumber,
              bankName: o.bankName,
              iban: o.iban,
              address: o.address,
              isDefault: o.isDefault,
              clientId: o.clientId,
              invoiceCount: o._count.invoices,
            }))}
          />

          {defs.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Custom fields</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {defs.map((d) => {
                  const v = valuesMap.get(d.id);
                  return (
                    <div key={d.id} className="flex justify-between gap-4">
                      <span className="text-muted-foreground">{d.label}</span>
                      <span className="text-right font-medium">
                        {Array.isArray(v) ? v.join(", ") : v != null && v !== "" ? String(v) : "—"}
                      </span>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="md:col-span-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle>Deals ({client.deals.length})</CardTitle>
              <NewDealButton
                clientId={client.id}
                clientName={client.name}
                stages={dealStages}
                clients={dealClients}
                tags={tags}
                fieldDefs={dealFieldDefs}
                owners={owners}
                isAdmin={isAdmin(user)}
                defaultStageId={dealStages[0]?.id}
                variant="icon"
              />
            </CardHeader>
            <CardContent className="space-y-2">
              {client.deals.map((d) => (
                <Link
                  key={d.id}
                  href={`/deals/${d.salesId}`}
                  className="flex items-center justify-between rounded-lg border px-3 py-2 hover:bg-accent"
                >
                  <div>
                    <div className="text-xs font-mono text-muted-foreground">{d.salesId}</div>
                    <div className="font-medium">{d.title}</div>
                  </div>
                  <div className="flex items-center gap-4">
                    <StageBadge name={d.stage.name} color={d.stage.color} />
                    <span className="tabular-nums text-sm">{formatCurrency(d.amountEur ? Number(d.amountEur) : null)}</span>
                  </div>
                </Link>
              ))}
              {client.deals.length === 0 && <p className="text-sm text-muted-foreground">No deals yet.</p>}
            </CardContent>
          </Card>

          <div className="mt-6">
            <InvoiceListCard
              invoices={invoiceItems}
              add={
                canDelete && clientOrgOptions.length > 0
                  ? { organizations: clientOrgOptions, deals: clientDealOptions, defaultOrganizationId: defaultClientOrgId }
                  : undefined
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}
