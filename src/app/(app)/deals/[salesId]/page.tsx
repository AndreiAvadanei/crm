import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { requireFullAuth } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { canViewDeal, isAdmin, clientVisibilityWhere } from "@/lib/rbac";
import { loadValues } from "@/lib/custom-fields";
import { getTagViews, getFieldDefViews, getOwners } from "@/lib/view-helpers";
import { LIST_FETCH_CAP } from "@/lib/app-constants";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DealFormDialog } from "@/components/deals/deal-form-dialog";
import { DealInlineSettings } from "@/components/deals/deal-inline-settings";
import { DealCustomFields } from "@/components/deals/deal-custom-fields";
import { DeleteButton } from "@/components/shared/delete-button";
import { TasksPanel } from "@/components/deals/tasks-panel";
import { CommentsPanel } from "@/components/deals/comments-panel";
import { FilesPanel } from "@/components/deals/files-panel";
import { ShareControl } from "@/components/deals/share-control";
import { InvoiceListCard } from "@/components/invoices/invoice-list-card";
import { deleteDealAction } from "@/server/deal-actions";
import { formatDate, relativeTime } from "@/lib/utils";
import { activityPhrase } from "@/lib/activity-format";

type DealDetailPageProps = {
  params: Promise<{ salesId: string }>;
};

export async function generateMetadata({ params }: DealDetailPageProps): Promise<Metadata> {
  const user = await requireFullAuth();
  const { salesId } = await params;
  const deal = await prisma.deal.findUnique({
    where: { salesId },
    select: { id: true, title: true, salesId: true },
  });

  if (!deal || !(await canViewDeal(user, deal.id))) return { title: "Deal" };

  return {
    title: `${deal.title} (${deal.salesId})`,
  };
}

export default async function DealDetailPage({ params }: DealDetailPageProps) {
  const user = await requireFullAuth();
  const { salesId } = await params;
  const admin = isAdmin(user);

  const deal = await prisma.deal.findUnique({
    where: { salesId },
    include: {
      client: true,
      owner: true,
      stage: true,
      tags: true,
      tasks: {
        include: { assignee: true },
        orderBy: [{ status: "asc" }, { urgency: "desc" }, { dueDate: "asc" }, { createdAt: "desc" }],
      },
      comments: { include: { author: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
      // Inline images embedded in comments are excluded — they're managed via
      // the rich-text editor, not the Files list.
      attachments: { where: { inline: false }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
      invoices: {
        include: { organization: { select: { sourceName: true } } },
        orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
      },
    },
  });
  if (!deal) notFound();
  if (!(await canViewDeal(user, deal.id))) notFound();

  const pipeline = await prisma.pipeline.findFirst({
    where: { isDefault: true },
    include: { stages: { orderBy: { order: "asc" } } },
  });
  const stages = pipeline?.stages ?? [];

  const clientVis = await clientVisibilityWhere(user);
  const [defs, valuesMap, tags, fieldDefViews, owners, clients, shareUsers, activity] = await Promise.all([
    prisma.customFieldDefinition.findMany({ where: { entity: "DEAL", active: true }, orderBy: { order: "asc" } }),
    loadValues("DEAL", deal.id),
    getTagViews(),
    getFieldDefViews("DEAL"),
    admin ? getOwners() : Promise.resolve([]),
    prisma.client.findMany({ where: clientVis, orderBy: { name: "asc" }, select: { id: true, name: true }, take: LIST_FETCH_CAP }),
    admin
      ? prisma.user.findMany({ where: { role: "SALES", status: "ACTIVE" }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
    prisma.auditLog.findMany({
      where: { entity: "Deal", entityId: deal.id },
      include: { actor: true },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);

  const allSharedIds = (
    await prisma.share.findMany({ where: { subject: "DEAL", subjectId: deal.id }, select: { userId: true } })
  ).map((s) => s.userId);
  const sharedIds = admin ? allSharedIds : [];

  // Comment notification candidates: ACTIVE users who can access this deal —
  // the owner, all admins, and users the deal is shared with.
  const candidateUsers = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      OR: [
        ...(deal.ownerId ? [{ id: deal.ownerId }] : []),
        { role: "ADMIN" as const },
        ...(allSharedIds.length ? [{ id: { in: allSharedIds } }] : []),
      ],
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const notifyCandidates = candidateUsers.map((u) => ({ id: u.id, name: u.name }));
  const candidateIdSet = new Set(notifyCandidates.map((u) => u.id));

  // Infer default recipients from the most recent prior comment that recorded
  // an explicit notify list, intersected with the current candidates.
  let defaultNotifyIds: string[] = [];
  for (const c of deal.comments) {
    const ids = Array.isArray(c.notifiedUserIds) ? (c.notifiedUserIds as unknown[]).filter((x): x is string => typeof x === "string") : [];
    if (ids.length) {
      defaultNotifyIds = ids.filter((id) => candidateIdSet.has(id));
      break;
    }
  }

  // The visible-clients query is filtered + capped, so the deal's currently
  // assigned client may be missing from it. Always include it so the picker
  // shows (and keeps) the correct selection.
  const clientOptions =
    deal.client && !clients.some((c) => c.id === deal.client!.id)
      ? [{ id: deal.client.id, name: deal.client.name }, ...clients]
      : clients;

  const canDelete = admin || deal.ownerId === user.id;
  const fieldValues = Object.fromEntries(valuesMap.entries());
  const openTasks = deal.tasks.filter((t) => t.status === "OPEN").length;

  // Billing organizations for this deal's client (invoice "Add" picker).
  const dealOrgs = deal.clientId
    ? await prisma.organization.findMany({
        where: { clientId: deal.clientId },
        orderBy: { sourceName: "asc" },
        select: { id: true, sourceName: true },
      })
    : [];
  const canManageInvoices = admin || deal.client?.ownerId === user.id;
  const defaultOrgId = dealOrgs.find((o) => o.id)?.id;
  const dealOptions = [{ salesId: deal.salesId, title: deal.title }];
  const invoiceItems = deal.invoices.map((i) => ({
    id: i.id,
    number: i.number,
    externalRef: i.externalRef,
    organizationName: i.organization.sourceName,
    status: i.status,
    totalAmount: i.totalAmount == null ? null : Number(i.totalAmount),
    currency: i.currency,
    issueDate: i.issueDate ? i.issueDate.toISOString() : null,
  }));

  const taskItems = deal.tasks.map((t) => ({
    id: t.id,
    title: t.title,
    type: t.type,
    status: t.status,
    urgency: t.urgency,
    dueDate: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null,
    assigneeId: t.assigneeId ?? null,
    assigneeName: t.assignee?.name ?? null,
    assigneeColor: t.assignee?.avatarColor ?? null,
  }));

  return (
    <div className="pb-10">
      <PageHeader title={deal.title} description={undefined}>
        <DealFormDialog
          isAdmin={admin}
          stages={stages.map((s) => ({ id: s.id, name: s.name }))}
          clients={clientOptions}
          tags={tags}
          fieldDefs={fieldDefViews}
          owners={owners}
          fieldValues={fieldValues}
          deal={{
            id: deal.id,
            title: deal.title,
            description: deal.description,
            amountEur: deal.amountEur ? Number(deal.amountEur) : null,
            clientId: deal.clientId,
            stageId: deal.stageId,
            ownerId: deal.ownerId,
            dueDate: deal.dueDate?.toISOString() ?? null,
            tagIds: deal.tags.map((t) => t.id),
          }}
          trigger={
            <Button variant="outline">
              <Pencil /> Edit
            </Button>
          }
        />
        {admin && (
          <ShareControl
            dealId={deal.id}
            users={shareUsers.map((u) => ({
              id: u.id,
              name: u.name,
              color: u.avatarColor,
              shared: sharedIds.includes(u.id),
            }))}
          />
        )}
        {canDelete && (
          <DeleteButton
            variant="outline"
            redirectTo="/deals"
            onDelete={deleteDealAction.bind(null, deal.id)}
            title="Delete deal?"
            description="Tasks, comments and files will be removed."
          />
        )}
      </PageHeader>

      <div className="grid gap-6 p-4 md:grid-cols-3 md:p-6">
        {/* Sidebar — all settings editable inline */}
        <div className="space-y-6 md:col-span-1">
          <DealInlineSettings
            dealId={deal.id}
            salesId={deal.salesId}
            title={deal.title}
            description={deal.description}
            stageId={deal.stageId}
            stages={stages.map((s) => ({ id: s.id, name: s.name }))}
            amountEur={deal.amountEur ? Number(deal.amountEur) : null}
            clientId={deal.clientId}
            clients={clientOptions}
            dueDate={deal.dueDate ? deal.dueDate.toISOString().slice(0, 10) : null}
            ownerId={deal.ownerId}
            owner={deal.owner ? { name: deal.owner.name, color: deal.owner.avatarColor } : null}
            owners={owners}
            selectedTagIds={deal.tags.map((t) => t.id)}
            allTags={tags}
            isAdmin={admin}
          />

          {defs.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Custom fields</CardTitle>
              </CardHeader>
              <CardContent>
                <DealCustomFields dealId={deal.id} defs={fieldDefViews} values={fieldValues} />
              </CardContent>
            </Card>
          )}

          {/* Tasks live under custom fields — inline editable */}
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Tasks &amp; next actions</CardTitle>
              <Badge variant="secondary">{openTasks} open</Badge>
            </CardHeader>
            <CardContent>
              <TasksPanel dealId={deal.id} tasks={taskItems} owners={owners} admin={admin} />
            </CardContent>
          </Card>
        </div>

        {/* Main — comments & files always visible */}
        <div className="space-y-6 md:col-span-2">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Comments</CardTitle>
              <Badge variant="secondary">{deal.comments.length}</Badge>
            </CardHeader>
            <CardContent>
              <CommentsPanel
                dealId={deal.id}
                notifyCandidates={notifyCandidates}
                defaultNotifyIds={defaultNotifyIds}
                comments={deal.comments.map((c) => ({
                  id: c.id,
                  body: c.body,
                  createdAt: c.createdAt.toISOString(),
                  authorName: c.author?.name ?? null,
                  authorColor: c.author?.avatarColor ?? null,
                  canDelete: admin || c.authorId === user.id,
                }))}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Files</CardTitle>
              <Badge variant="secondary">{deal.attachments.length}</Badge>
            </CardHeader>
            <CardContent>
              <FilesPanel
                dealId={deal.id}
                attachments={deal.attachments.map((a) => ({
                  id: a.id,
                  filename: a.filename,
                  size: a.size,
                  createdAt: a.createdAt.toISOString(),
                  sourceUrl: a.sourceUrl,
                  onDisk: a.storageKey.length > 0,
                }))}
              />
            </CardContent>
          </Card>

          <InvoiceListCard
            invoices={invoiceItems}
            add={
              canManageInvoices
                ? { organizations: dealOrgs.map((o) => ({ id: o.id, name: o.sourceName })), deals: dealOptions, defaultSalesId: deal.salesId, defaultOrganizationId: defaultOrgId }
                : undefined
            }
          />

          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {activity.map((a) => (
                <div key={a.id} className="flex items-start justify-between gap-3 border-b pb-2 last:border-0">
                  <span>
                    <span className="font-medium">{a.actor?.name ?? "System"}</span>{" "}
                    <span className="text-muted-foreground">
                      {activityPhrase(a.action, a.meta as Record<string, unknown> | null)}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(a.createdAt)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Created</span>
                <span className="text-xs">{formatDate(deal.createdAt)}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
