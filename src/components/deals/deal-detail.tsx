import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Pencil, Receipt, History } from "lucide-react";
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
import { DealCopyLinks } from "@/components/deals/deal-copy-links";
import { DealHeader } from "@/components/deals/deal-header";
import { DealDescription } from "@/components/deals/deal-description";
import { DealCustomFields } from "@/components/deals/deal-custom-fields";
import { DeleteButton } from "@/components/shared/delete-button";
import { DealTabs } from "@/components/deals/deal-tabs";
import { TasksPanel } from "@/components/deals/tasks-panel";
import { CommentsPanel } from "@/components/deals/comments-panel";
import { FilesPanel } from "@/components/deals/files-panel";
import { ShareControl } from "@/components/deals/share-control";
import { InvoiceListCard } from "@/components/invoices/invoice-list-card";
import { deleteDealAction } from "@/server/deal-actions";
import { formatDate, relativeTime } from "@/lib/utils";
import { activityPhrase } from "@/lib/activity-format";
import { resolveOrgVatPercent } from "@/lib/invoice-vat";

/** Shared metadata for the deal detail (used by the full page and the modal). */
export async function getDealMetadata(salesId: string): Promise<Metadata> {
  const user = await requireFullAuth();
  const deal = await prisma.deal.findUnique({
    where: { salesId },
    select: { id: true, title: true, salesId: true },
  });

  if (!deal || !(await canViewDeal(user, deal.id))) return { title: "Deal" };

  return {
    title: `${deal.title} (${deal.salesId})`,
  };
}

/**
 * Full deal detail body. Rendered both by the standalone deal page
 * (`/deals/[salesId]`) and by the intercepting modal route so the two stay in
 * sync. `variant` only controls chrome that differs between the two contexts:
 * the standalone page owns the app's sticky page header, while the modal
 * renders inside a dialog and supplies its own header spacing.
 */
export async function DealDetail({
  salesId,
  variant = "page",
}: {
  salesId: string;
  variant?: "page" | "modal";
}) {
  const user = await requireFullAuth();
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
        select: { id: true, sourceName: true, country: true, tvaPercent: true },
      })
    : [];
  const canManageInvoices = admin || deal.client?.ownerId === user.id;
  const invoiceFinalClients = canManageInvoices
    ? await prisma.finalClient.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true }, take: LIST_FETCH_CAP })
    : [];
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

  const actions = (
    <>
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
          redirectTo={variant === "modal" ? undefined : "/deals"}
          back={variant === "modal"}
          onDelete={deleteDealAction.bind(null, deal.id)}
          title="Delete deal?"
          description="Tasks, comments and files will be removed."
        />
      )}
    </>
  );

  const body = (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Main column — description, tasks, files, comments, then tabs */}
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>Description</CardTitle>
          </CardHeader>
          <CardContent>
            <DealDescription dealId={deal.id} description={deal.description} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Tasks &amp; next actions</CardTitle>
            <Badge variant="secondary">{openTasks} open</Badge>
          </CardHeader>
          <CardContent>
            <TasksPanel dealId={deal.id} tasks={taskItems} owners={owners} admin={admin} />
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

        <DealTabs
          defaultValue="invoices"
          tabs={[
            {
              value: "invoices",
              label: "Invoices",
              icon: <Receipt className="h-4 w-4" />,
              count: invoiceItems.length,
              node: (
                <InvoiceListCard
                  bare
                  invoices={invoiceItems}
                  add={
                    canManageInvoices
                      ? {
                          organizations: dealOrgs.map((o) => ({
                            id: o.id,
                            name: o.sourceName,
                            defaultVatPercent: resolveOrgVatPercent(o),
                            configuredTvaPercent: Number(o.tvaPercent) || 21,
                          })),
                          deals: dealOptions,
                          finalClients: invoiceFinalClients,
                          defaultSalesId: deal.salesId,
                          defaultOrganizationId: defaultOrgId,
                        }
                      : undefined
                  }
                />
              ),
            },
            {
              value: "activity",
              label: "Activity",
              icon: <History className="h-4 w-4" />,
              count: activity.length,
              node: (
                <div className="space-y-3 text-sm">
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
                </div>
              ),
            },
          ]}
        />
      </div>

      {/* Right column — deal properties + custom fields */}
      <div className="space-y-6">
        <DealHeader
          dealId={deal.id}
          salesId={deal.salesId}
          title={deal.title}
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
      </div>
    </div>
  );

  // Modal variant: caller (DealModal) owns the dialog chrome + a11y title, so we
  // render a visible title row (title + SAL id + actions) and the body here.
  if (variant === "modal") {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-3 border-b pb-4 pr-8 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-1">
            <h2 className="truncate text-xl font-medium tracking-tight">{deal.title}</h2>
            <DealCopyLinks salesId={deal.salesId} />
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">{actions}</div>
        </div>
        {body}
      </div>
    );
  }

  return (
    <div className="pb-10">
      <PageHeader title={deal.title} description={undefined}>
        <DealCopyLinks salesId={deal.salesId} />
        {actions}
      </PageHeader>
      <div className="p-4 md:p-6">{body}</div>
    </div>
  );
}
