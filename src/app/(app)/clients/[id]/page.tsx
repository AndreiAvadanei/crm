import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Globe, Mail, Phone, MapPin } from "lucide-react";
import { requireFullAuth } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { canViewClient, clientVisibilityWhere, isAdmin } from "@/lib/rbac";
import { loadValues } from "@/lib/custom-fields";
import { getTagViews, getFieldDefViews, getOwners } from "@/lib/view-helpers";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { TagBadge, StageBadge } from "@/components/shared/tag-badge";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";
import { ClientShareControl } from "@/components/clients/client-share-control";
import { NewDealButton } from "@/components/clients/new-deal-button";
import { DeleteButton } from "@/components/shared/delete-button";
import { deleteClientAction } from "@/server/client-actions";
import { formatCurrency, formatDate } from "@/lib/utils";

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireFullAuth();
  const { id } = await params;
  if (!(await canViewClient(user, id))) notFound();

  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      tags: true,
      owner: true,
      deals: { include: { stage: true }, orderBy: { createdAt: "desc" } },
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
    prisma.client.findMany({ where: clientVis, orderBy: { name: "asc" }, select: { id: true, name: true }, take: 500 }),
  ]);
  const dealStages = (pipeline?.stages ?? []).map((s) => ({ id: s.id, name: s.name }));

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
        </div>
      </div>
    </div>
  );
}
