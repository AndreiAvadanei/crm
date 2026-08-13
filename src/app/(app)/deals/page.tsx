import { Plus } from "lucide-react";
import { requireFullAuth } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { clientVisibilityWhere, isAdmin } from "@/lib/rbac";
import { getTagViews, getFieldDefViews, getOwners } from "@/lib/view-helpers";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { DealsToolbar } from "@/components/deals/deals-toolbar";
import { KanbanBoard, type KanbanDeal } from "@/components/deals/kanban-board";
import { DealFormDialog } from "@/components/deals/deal-form-dialog";
import { DealsTable, type DealRow } from "@/components/deals/deals-table";
import { formatCurrency } from "@/lib/utils";
import { recencyCutoff, startOfDay } from "@/lib/filter-helpers";
import { LIST_FETCH_CAP, DEALS_PAGE_SIZE } from "@/lib/app-constants";
import {
  buildDealListQuery,
  pickDealFilterParams,
  getStageTotals,
  fetchStageDeals,
  dealInclude,
  makeOverdueChecker,
  toKanbanDeal,
  toDealRow,
  type DealWithRelations,
  type StageTotal,
} from "@/lib/deal-query";

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
  const filterParams = pickDealFilterParams(sp);

  const { where, orderBy, sort, dir, staleDays, fullScan } = await buildDealListQuery(filterParams, user);

  const pipeline = await prisma.pipeline.findFirst({
    where: { isDefault: true },
    include: { stages: { orderBy: { order: "asc" } } },
  });
  const stages = pipeline?.stages ?? [];
  const stageFlags = new Map(stages.map((s) => [s.id, { isWon: s.isWon, isLost: s.isLost }]));
  const isDealOverdue = makeOverdueChecker(stageFlags, startOfDay(new Date()));

  const clientVis = await clientVisibilityWhere(user);
  const [tags, fieldDefs, owners, clients] = await Promise.all([
    getTagViews(),
    getFieldDefViews("DEAL"),
    admin ? getOwners() : Promise.resolve([]),
    prisma.client.findMany({
      where: clientVis,
      orderBy: { name: "asc" },
      select: { id: true, name: true },
      take: LIST_FETCH_CAP,
    }),
  ]);

  // Rows actually rendered on first paint + the per-stage totals that drive the
  // header and every column/section subtotal (always the *full* matching set,
  // never just the loaded rows).
  let kanbanDeals: KanbanDeal[];
  let dealRows: DealRow[];
  const stageTotals: Record<string, StageTotal> = {};
  let totalCount = 0;
  let totalValue = 0;
  let loadedDealIds: string[];

  if (fullScan) {
    // The `stale` filter and `activity` sort need a cross-table "last activity"
    // rollup that can't be paged in SQL, so this path loads the full result set
    // and post-processes in JS (legacy behaviour). Pagination is disabled and
    // every matching deal is handed to the view up front.
    const deals = await prisma.deal.findMany({
      where,
      include: dealInclude,
      orderBy,
      take: LIST_FETCH_CAP,
    });

    // Deterministic nulls-last ordering (MySQL's implicit NULL placement is
    // unreliable): undated / amount-less deals always sink to the bottom.
    const asc = dir === "asc";
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

    // Cross-source "last activity" per deal for the stale filter / activity sort.
    const lastActivity = new Map<string, number>();
    if (deals.length) {
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
    const dealActivityMs = (d: DealWithRelations) =>
      Math.max(d.updatedAt.getTime(), lastActivity.get(d.id) ?? 0);

    let visibleDeals = deals;
    if (staleDays != null) {
      const cutoffMs = recencyCutoff(staleDays).getTime();
      visibleDeals = deals.filter((d) => {
        const f = stageFlags.get(d.stageId);
        if (f?.isWon || f?.isLost) return false;
        return dealActivityMs(d) < cutoffMs;
      });
    }
    if (sort === "activity") {
      visibleDeals = [...visibleDeals].sort((a, b) => {
        const diff = dealActivityMs(a) - dealActivityMs(b);
        return asc ? diff : -diff;
      });
    }

    kanbanDeals = visibleDeals.map((d) => toKanbanDeal(d, isDealOverdue(d.dueDate, d.stageId)));
    dealRows = visibleDeals.map((d) => toDealRow(d, isDealOverdue(d.dueDate, d.stageId)));
    for (const d of visibleDeals) {
      const t = (stageTotals[d.stageId] ??= { count: 0, value: 0 });
      t.count += 1;
      t.value += d.amountEur ? Number(d.amountEur) : 0;
    }
    totalCount = visibleDeals.length;
    totalValue = visibleDeals.reduce((s, d) => s + (d.amountEur ? Number(d.amountEur) : 0), 0);
    loadedDealIds = visibleDeals.map((d) => d.id);
  } else {
    // Paginated path: aggregate totals for every stage, then load only the
    // first page of each column. "Load more" / "Load all" fetch the rest.
    const totals = await getStageTotals(where);
    const pages = await Promise.all(
      stages.map((s) => fetchStageDeals(where, s.id, sort, dir, 0, DEALS_PAGE_SIZE))
    );
    const paged = pages.flat();

    kanbanDeals = paged.map((d) => toKanbanDeal(d, isDealOverdue(d.dueDate, d.stageId)));
    dealRows = paged.map((d) => toDealRow(d, isDealOverdue(d.dueDate, d.stageId)));
    for (const [stageId, t] of totals) {
      stageTotals[stageId] = t;
      totalCount += t.count;
      totalValue += t.value;
    }
    loadedDealIds = paged.map((d) => d.id);
  }

  const shareUsers = admin
    ? await prisma.user.findMany({
        where: { role: "SALES", status: "ACTIVE" },
        orderBy: { name: "asc" },
        select: { id: true, name: true, avatarColor: true },
      })
    : [];
  const shares =
    admin && loadedDealIds.length
      ? await prisma.share.findMany({
          where: { subject: "DEAL", subjectId: { in: loadedDealIds } },
          select: { subjectId: true, userId: true },
        })
      : [];
  const sharedMap: Record<string, string[]> = {};
  for (const s of shares) (sharedMap[s.subjectId] ??= []).push(s.userId);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Deals" description={`${totalCount} deals · ${formatCurrency(totalValue)} pipeline value`}>
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

      <div className="page-body py-4">
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
            stageTotals={stageTotals}
            paginated={!fullScan}
            filterParams={filterParams}
            pageSize={DEALS_PAGE_SIZE}
            newDeal={{ isAdmin: admin, clients, tags, fieldDefs, owners }}
            shareUsers={shareUsers.map((u) => ({ id: u.id, name: u.name, color: u.avatarColor }))}
            sharedMap={sharedMap}
            currentUserId={user.id}
          />
        </div>
      ) : (
        <div className="page-body pt-0">
          <DealsTable
            deals={dealRows}
            stages={stages.map((s) => ({ id: s.id, name: s.name, color: s.color, phase: s.phase }))}
            stageTotals={stageTotals}
            paginated={!fullScan}
            filterParams={filterParams}
            pageSize={DEALS_PAGE_SIZE}
            owners={owners}
            tags={tags}
            admin={admin}
            shareUsers={shareUsers.map((u) => ({ id: u.id, name: u.name, color: u.avatarColor }))}
            sharedMap={sharedMap}
            currentUserId={user.id}
          />
        </div>
      )}
    </div>
  );
}
