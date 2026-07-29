import { requireFullAuth } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { dealVisibilityWhere, isAdmin } from "@/lib/rbac";
import { Prisma, type TaskType } from "@/generated/prisma";
import { getOwners } from "@/lib/view-helpers";
import {
  dueWindowRange,
  startOfDay,
  type DueWindow,
  type TaskStatusFilter,
} from "@/lib/filter-helpers";
import { LIST_FETCH_CAP, TASKS_PAGE_SIZE } from "@/lib/app-constants";
import { PageHeader } from "@/components/app/page-header";
import { type TaskItemData } from "@/components/tasks/task-common";
import { TasksBoard } from "@/components/tasks/tasks-board";

export const metadata = {
  title: "Tasks",
};

const TASK_ORDER_BY: Prisma.TaskOrderByWithRelationInput[] = [
  // Urgency first (CRITICAL -> LOW), then soonest due date, then newest.
  { urgency: "desc" },
  { dueDate: "asc" },
  { createdAt: "desc" },
];

const TASK_INCLUDE = {
  deal: { select: { salesId: true, title: true } },
  assignee: true,
} satisfies Prisma.TaskInclude;

function toRow(t: Prisma.TaskGetPayload<{ include: typeof TASK_INCLUDE }>): TaskItemData {
  return {
    id: t.id,
    title: t.title,
    type: t.type,
    status: t.status,
    urgency: t.urgency,
    dueDate: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null,
    dealSalesId: t.deal.salesId,
    dealTitle: t.deal.title,
    assigneeId: t.assigneeId,
    assigneeName: t.assignee?.name ?? null,
    assigneeColor: t.assignee?.avatarColor ?? null,
  };
}

function parsePage(v?: string): number {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    type?: string;
    status?: string;
    assignee?: string;
    due?: string;
    mine?: string;
    overduePage?: string;
    upcomingPage?: string;
  }>;
}) {
  const user = await requireFullAuth();
  const sp = await searchParams;
  const admin = isAdmin(user);
  const dealWhere = await dealVisibilityWhere(user);
  const now = new Date();
  // Due dates are stored date-only (midnight), so "overdue" must be measured
  // against the start of today — not the current time. Otherwise every task due
  // today (00:00) counts as < now and is wrongly bucketed as overdue.
  const today = startOfDay(now);

  // Base RBAC scope: tasks on deals the user can see. Sales users are further
  // locked to their own assigned tasks (admins can target any assignee).
  const and: Prisma.TaskWhereInput[] = [{ deal: dealWhere }];

  const statusFilter = sp.status as TaskStatusFilter | undefined;
  if (statusFilter === "done") and.push({ status: "DONE" });
  else if (statusFilter !== "all") and.push({ status: "OPEN" }); // default

  if (!admin) and.push({ assigneeId: user.id });
  else if (sp.mine === "1") and.push({ assigneeId: user.id });
  else if (sp.assignee) and.push({ assigneeId: sp.assignee });

  if (sp.type) and.push({ type: sp.type as TaskType });

  if (sp.due) and.push({ dueDate: dueWindowRange(sp.due as DueWindow, now) });

  const q = sp.q?.trim();
  if (q) {
    and.push({
      OR: [
        { title: { contains: q } },
        { deal: { title: { contains: q } } },
        { deal: { salesId: { contains: q } } },
        { assignee: { name: { contains: q } } },
      ],
    });
  }

  const base: Prisma.TaskWhereInput = { AND: and };

  // Split into overdue (open + past due) and everything else. Kept null-safe so
  // open tasks without a due date always land in "upcoming" (never dropped).
  const overdueWhere: Prisma.TaskWhereInput = {
    AND: [base, { status: "OPEN", dueDate: { lt: today } }],
  };
  const upcomingWhere: Prisma.TaskWhereInput = {
    AND: [
      base,
      { OR: [{ status: { not: "OPEN" } }, { dueDate: null }, { dueDate: { gte: today } }] },
    ],
  };

  const overduePage = parsePage(sp.overduePage);
  const upcomingPage = parsePage(sp.upcomingPage);

  const [overdueTotal, overdueRows, upcomingTotal, upcomingRows, owners, deals] = await Promise.all([
    prisma.task.count({ where: overdueWhere }),
    prisma.task.findMany({
      where: overdueWhere,
      include: TASK_INCLUDE,
      orderBy: TASK_ORDER_BY,
      skip: (overduePage - 1) * TASKS_PAGE_SIZE,
      take: TASKS_PAGE_SIZE,
    }),
    prisma.task.count({ where: upcomingWhere }),
    prisma.task.findMany({
      where: upcomingWhere,
      include: TASK_INCLUDE,
      orderBy: TASK_ORDER_BY,
      skip: (upcomingPage - 1) * TASKS_PAGE_SIZE,
      take: TASKS_PAGE_SIZE,
    }),
    admin ? getOwners() : Promise.resolve([]),
    // Deals the user can act on, for the quick-add task composer.
    prisma.deal.findMany({
      where: dealWhere,
      orderBy: [{ salesId: "desc" }],
      select: { id: true, salesId: true, title: true },
      take: LIST_FETCH_CAP,
    }),
  ]);

  return (
    <div className="pb-10">
      <PageHeader title="Tasks" description={admin ? "All open next-actions on visible deals" : "Your open next-actions"} />
      <TasksBoard
        overdue={overdueRows.map(toRow)}
        upcoming={upcomingRows.map(toRow)}
        overdueTotal={overdueTotal}
        upcomingTotal={upcomingTotal}
        overduePage={overduePage}
        upcomingPage={upcomingPage}
        pageSize={TASKS_PAGE_SIZE}
        owners={owners}
        deals={deals}
        admin={admin}
      />
    </div>
  );
}
