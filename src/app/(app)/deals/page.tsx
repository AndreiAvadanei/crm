import { Plus } from "lucide-react";
import { requireFullAuth } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { dealVisibilityWhere, clientVisibilityWhere, isAdmin } from "@/lib/rbac";
import { Prisma } from "@/generated/prisma";
import { getTagViews, getFieldDefViews, getOwners } from "@/lib/view-helpers";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { DealsToolbar } from "@/components/deals/deals-toolbar";
import { KanbanBoard, type KanbanDeal } from "@/components/deals/kanban-board";
import { DealFormDialog } from "@/components/deals/deal-form-dialog";
import { DealsTable, type DealRow } from "@/components/deals/deals-table";
import { formatCurrency } from "@/lib/utils";
import {
  parseCsvIds,
  parseNumber,
  parseDate,
  dueWindowRange,
  recencyCutoff,
  type DealStatus,
} from "@/lib/filter-helpers";
import { parseDealSort, resolveDealSortDir } from "@/lib/deal-sort";
import { LIST_FETCH_CAP } from "@/lib/app-constants";

export const metadata = {
  title: "Deals",
};

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    q?: string;
    owner?: string;
    tag?: string;
    stage?: string;
    status?: string;
    sort?: string;
    dir?: string;
    amtMin?: string;
    amtMax?: string;
    dueFrom?: string;
    dueTo?: string;
    overdue?: string;
    mine?: string;
    stale?: string;
  }>;
}) {
  const user = await requireFullAuth();
  const sp = await searchParams;
  const view = sp.view ?? "board";
  const admin = isAdmin(user);
  const visibility = await dealVisibilityWhere(user);

  // All filters below only narrow within `visibility` (RBAC preserved).
  const filters: Prisma.DealWhereInput[] = [visibility];
  if (sp.q)
    filters.push({
      OR: [
        { title: { contains: sp.q } },
        { salesId: { contains: sp.q } },
        { client: { name: { contains: sp.q } } },
      ],
    });
  // "My deals" wins over an explicit owner select.
  if (sp.mine === "1") filters.push({ ownerId: user.id });
  else if (sp.owner) filters.push({ ownerId: sp.owner });

  // Tags: comma-separated; deal must carry every selected tag.
  for (const tagId of parseCsvIds(sp.tag)) filters.push({ tags: { some: { id: tagId } } });

  if (sp.stage) filters.push({ stageId: sp.stage });

  const status = sp.status as DealStatus | undefined;
  if (status === "open") filters.push({ stage: { isWon: false, isLost: false } });
  else if (status === "won") filters.push({ stage: { isWon: true } });
  else if (status === "lost") filters.push({ stage: { isLost: true } });

  const amtMin = parseNumber(sp.amtMin);
  const amtMax = parseNumber(sp.amtMax);
  if (amtMin != null || amtMax != null)
    filters.push({
      amountEur: { ...(amtMin != null ? { gte: amtMin } : {}), ...(amtMax != null ? { lte: amtMax } : {}) },
    });

  const dueFrom = parseDate(sp.dueFrom);
  const dueTo = parseDate(sp.dueTo);
  if (dueFrom || dueTo)
    filters.push({
      dueDate: { ...(dueFrom ? { gte: dueFrom } : {}), ...(dueTo ? { lte: dueTo } : {}) },
    });

  // Overdue quick filter: past-due and still open (not won/lost).
  if (sp.overdue === "1") {
    const { lt } = dueWindowRange("overdue");
    filters.push({ dueDate: { lt }, stage: { isWon: false, isLost: false } });
  }

  const where: Prisma.DealWhereInput = { AND: filters };

  // Sort applies within each status column on the board (deals are grouped by
  // stage in array order) and across rows in the table view.
  // NOTE: MySQL doesn't support `nulls: last`, and its implicit NULL ordering
  // is easy to get wrong, so `date`/`size` are given an explicit JS nulls-last
  // fixup below (undated / amount-less deals always fall to the bottom).
  const sort = parseDealSort(sp.sort);
  // Direction toggle: `dir` flips any sort the opposite way (defaults per sort).
  const dir = resolveDealSortDir(sort, sp.dir);
  const asc = dir === "asc";
  const orderBy: Prisma.DealOrderByWithRelationInput[] =
    sort === "name"
      ? [{ title: dir }]
      : sort === "date"
        ? [{ dueDate: dir }, { createdAt: "desc" }]
        : sort === "size"
          ? [{ amountEur: dir }, { createdAt: "desc" }]
          : sort === "activity"
            ? // "activity" is a cross-table rollup (comments/tasks/attachments/
              // audit logs) that can't be expressed as a Prisma orderBy, so we
              // seed with the deal's own updatedAt and re-sort in JS below.
              [{ updatedAt: dir }, { createdAt: "desc" }]
            : [{ boardOrder: "asc" }, { createdAt: "desc" }];

  const pipeline = await prisma.pipeline.findFirst({
    where: { isDefault: true },
    include: { stages: { orderBy: { order: "asc" } } },
  });
  const stages = pipeline?.stages ?? [];

  const clientVis = await clientVisibilityWhere(user);
  const [deals, tags, fieldDefs, owners, clients] = await Promise.all([
    prisma.deal.findMany({
      where,
      include: { client: true, owner: true, tags: true, _count: { select: { tasks: { where: { status: "OPEN" } } } } },
      orderBy,
      // Safety bound only — must exceed the real deal count so the sort never
      // decides which deals are visible (see LIST_FETCH_CAP).
      take: LIST_FETCH_CAP,
    }),
    getTagViews(),
    getFieldDefViews("DEAL"),
    admin ? getOwners() : Promise.resolve([]),
    prisma.client.findMany({ where: clientVis, orderBy: { name: "asc" }, select: { id: true, name: true }, take: LIST_FETCH_CAP }),
  ]);

  // Deterministic nulls-last ordering (MySQL's implicit NULL placement is
  // unreliable here). Re-sort in JS so empty values never jump around:
  //  - date: soonest due first, undated deals last
  //  - size: largest amount first, amount-less deals last
  // Nulls (undated / amount-less deals) always sink to the bottom regardless of
  // direction; only the non-null comparison flips with `asc`.
  if (sort === "date") {
    deals.sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      const diff = a.dueDate.getTime() - b.dueDate.getTime();
      return asc ? diff : -diff;
    });
  } else if (sort === "size") {
    deals.sort((a, b) => {
      const av = a.amountEur == null ? null : Number(a.amountEur);
      const bv = b.amountEur == null ? null : Number(b.amountEur);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return asc ? av - bv : bv - av;
    });
  }

  // Overdue = past due date AND still open (won/lost deals are never overdue).
  // Computed here because stage won/lost flags live on the pipeline stages.
  const stageFlags = new Map(stages.map((s) => [s.id, { isWon: s.isWon, isLost: s.isLost }]));
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const isDealOverdue = (dueDate: Date | null, stageId: string) => {
    if (!dueDate) return false;
    const f = stageFlags.get(stageId);
    if (f?.isWon || f?.isLost) return false;
    return dueDate < startOfToday;
  };

  // Cross-source "last activity" per deal: the latest of any comment / task /
  // attachment / audit-log (field change) touch. Combined with the deal's own
  // updatedAt via `dealActivityMs` below (same definition as the clients list's
  // last-activity rollup). Computed only when the stale filter or the
  // "Last activity" sort needs it, via a handful of grouped queries (no N+1).
  const staleDays = parseNumber(sp.stale);
  const needsActivity = staleDays != null || sort === "activity";
  const lastActivity = new Map<string, number>();
  if (needsActivity && deals.length) {
    const ids = deals.map((d) => d.id);
    const [comments, tasks, attachments, audits] = await Promise.all([
      prisma.comment.groupBy({ by: ["dealId"], where: { dealId: { in: ids } }, _max: { createdAt: true } }),
      prisma.task.groupBy({ by: ["dealId"], where: { dealId: { in: ids } }, _max: { createdAt: true, updatedAt: true } }),
      prisma.attachment.groupBy({ by: ["dealId"], where: { dealId: { in: ids } }, _max: { createdAt: true } }),
      prisma.auditLog.groupBy({ by: ["entityId"], where: { entity: "Deal", entityId: { in: ids } }, _max: { createdAt: true } }),
    ]);
    const bump = (id: string | null, d: Date | null | undefined) => {
      if (!id || !d) return;
      const t = d.getTime();
      if (t > (lastActivity.get(id) ?? 0)) lastActivity.set(id, t);
    };
    for (const c of comments) bump(c.dealId, c._max.createdAt);
    for (const t of tasks) {
      bump(t.dealId, t._max.createdAt);
      bump(t.dealId, t._max.updatedAt);
    }
    for (const a of attachments) bump(a.dealId, a._max.createdAt);
    for (const a of audits) bump(a.entityId, a._max.createdAt);
  }
  // Most recent activity for a deal, rolling in its own record update.
  const dealActivityMs = (d: (typeof deals)[number]) =>
    Math.max(d.updatedAt.getTime(), lastActivity.get(d.id) ?? 0);

  // "Stalled / no resolution" filter: open deals (not won/lost) with no activity
  // for at least N days.
  let visibleDeals = deals;
  if (staleDays != null) {
    const cutoffMs = recencyCutoff(staleDays).getTime();
    visibleDeals = deals.filter((d) => {
      const f = stageFlags.get(d.stageId);
      // Won/lost deals are "resolved" by definition — exclude them.
      if (f?.isWon || f?.isLost) return false;
      // Keep only deals whose most recent activity is older than the cutoff.
      return dealActivityMs(d) < cutoffMs;
    });
  }

  // "Last activity" sort: most recently touched first. Done in JS because the
  // rollup spans multiple tables (the DB seed sorted by updatedAt only).
  if (sort === "activity") {
    visibleDeals = [...visibleDeals].sort((a, b) => {
      const diff = dealActivityMs(a) - dealActivityMs(b);
      return asc ? diff : -diff;
    });
  }

  const kanbanDeals: KanbanDeal[] = visibleDeals.map((d) => ({
    id: d.id,
    salesId: d.salesId,
    title: d.title,
    amountEur: d.amountEur ? Number(d.amountEur) : null,
    stageId: d.stageId,
    clientName: d.client?.name ?? null,
    ownerId: d.ownerId,
    ownerName: d.owner?.name ?? null,
    ownerColor: d.owner?.avatarColor ?? null,
    dueDate: d.dueDate?.toISOString() ?? null,
    overdue: isDealOverdue(d.dueDate, d.stageId),
    tags: d.tags.map((t) => ({ id: t.id, name: t.name, color: t.color })),
    openTasks: d._count.tasks,
  }));

  const totalValue = visibleDeals.reduce((s, d) => s + (d.amountEur ? Number(d.amountEur) : 0), 0);

  // Inline-table data (table view): editable rows + admin sharing state.
  const dealRows: DealRow[] = visibleDeals.map((d) => ({
    id: d.id,
    salesId: d.salesId,
    title: d.title,
    clientName: d.client?.name ?? null,
    stageId: d.stageId,
    amountEur: d.amountEur ? Number(d.amountEur) : null,
    dueDate: d.dueDate ? d.dueDate.toISOString().slice(0, 10) : null,
    overdue: isDealOverdue(d.dueDate, d.stageId),
    ownerId: d.ownerId,
    ownerName: d.owner?.name ?? null,
    ownerColor: d.owner?.avatarColor ?? null,
    tagIds: d.tags.map((t) => t.id),
  }));

  const shareUsers = admin
    ? await prisma.user.findMany({
        where: { role: "SALES", status: "ACTIVE" },
        orderBy: { name: "asc" },
        select: { id: true, name: true, avatarColor: true },
      })
    : [];
  const shares =
    admin && visibleDeals.length
      ? await prisma.share.findMany({
          where: { subject: "DEAL", subjectId: { in: visibleDeals.map((d) => d.id) } },
          select: { subjectId: true, userId: true },
        })
      : [];
  const sharedMap: Record<string, string[]> = {};
  for (const s of shares) (sharedMap[s.subjectId] ??= []).push(s.userId);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Deals" description={`${visibleDeals.length} deals · ${formatCurrency(totalValue)} pipeline value`}>
        <DealFormDialog
          isAdmin={admin}
          stages={stages.map((s) => ({ id: s.id, name: s.name }))}
          clients={clients}
          tags={tags}
          fieldDefs={fieldDefs}
          owners={owners}
          defaultStageId={stages[0]?.id}
          trigger={
            <Button>
              <Plus /> New deal
            </Button>
          }
        />
      </PageHeader>

      <div className="px-4 py-4 md:px-6">
        <DealsToolbar
          owners={owners}
          tags={tags}
          stages={stages.map((s) => ({ id: s.id, name: s.name }))}
          showOwnerFilter={admin}
        />
      </div>

      {view === "board" ? (
        <div className="flex-1 overflow-hidden">
          <KanbanBoard
            stages={stages.map((s) => ({
              id: s.id,
              name: s.name,
              color: s.color,
              probability: s.probability,
              phase: s.phase,
            }))}
            deals={kanbanDeals}
            newDeal={{ isAdmin: admin, clients, tags, fieldDefs, owners }}
            shareUsers={shareUsers.map((u) => ({ id: u.id, name: u.name, color: u.avatarColor }))}
            sharedMap={sharedMap}
          />
        </div>
      ) : (
        <div className="px-4 pb-6 md:px-6">
          <DealsTable
            deals={dealRows}
            stages={stages.map((s) => ({ id: s.id, name: s.name, color: s.color, phase: s.phase }))}
            owners={owners}
            tags={tags}
            admin={admin}
            shareUsers={shareUsers.map((u) => ({ id: u.id, name: u.name, color: u.avatarColor }))}
            sharedMap={sharedMap}
          />
        </div>
      )}
    </div>
  );
}
