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
  type DealStatus,
} from "@/lib/filter-helpers";

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
    amtMin?: string;
    amtMax?: string;
    dueFrom?: string;
    dueTo?: string;
    overdue?: string;
    mine?: string;
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
      orderBy: [{ boardOrder: "asc" }, { createdAt: "desc" }],
      take: view === "board" ? 500 : 200,
    }),
    getTagViews(),
    getFieldDefViews("DEAL"),
    admin ? getOwners() : Promise.resolve([]),
    prisma.client.findMany({ where: clientVis, orderBy: { name: "asc" }, select: { id: true, name: true }, take: 500 }),
  ]);

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

  const kanbanDeals: KanbanDeal[] = deals.map((d) => ({
    id: d.id,
    salesId: d.salesId,
    title: d.title,
    amountEur: d.amountEur ? Number(d.amountEur) : null,
    stageId: d.stageId,
    clientName: d.client?.name ?? null,
    ownerName: d.owner?.name ?? null,
    ownerColor: d.owner?.avatarColor ?? null,
    dueDate: d.dueDate?.toISOString() ?? null,
    overdue: isDealOverdue(d.dueDate, d.stageId),
    tags: d.tags.map((t) => ({ id: t.id, name: t.name, color: t.color })),
    openTasks: d._count.tasks,
  }));

  const totalValue = deals.reduce((s, d) => s + (d.amountEur ? Number(d.amountEur) : 0), 0);

  // Inline-table data (table view): editable rows + admin sharing state.
  const dealRows: DealRow[] = deals.map((d) => ({
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
    admin && deals.length
      ? await prisma.share.findMany({
          where: { subject: "DEAL", subjectId: { in: deals.map((d) => d.id) } },
          select: { subjectId: true, userId: true },
        })
      : [];
  const sharedMap: Record<string, string[]> = {};
  for (const s of shares) (sharedMap[s.subjectId] ??= []).push(s.userId);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Deals" description={`${deals.length} deals · ${formatCurrency(totalValue)} pipeline value`}>
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
          />
        </div>
      ) : (
        <div className="px-4 pb-6 md:px-6">
          <DealsTable
            deals={dealRows}
            stages={stages.map((s) => ({ id: s.id, name: s.name, color: s.color }))}
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
