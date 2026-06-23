import { requireFullAuth } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { dealVisibilityWhere, isAdmin } from "@/lib/rbac";
import { Prisma, type TaskType } from "@/generated/prisma";
import { getOwners } from "@/lib/view-helpers";
import {
  dueWindowRange,
  type DueWindow,
  type TaskStatusFilter,
} from "@/lib/filter-helpers";
import { LIST_FETCH_CAP } from "@/lib/app-constants";
import { PageHeader } from "@/components/app/page-header";
import { type TaskRowData } from "@/components/tasks/task-row";
import { TasksFilterBar } from "@/components/tasks/tasks-filter-bar";
import { TasksBoard } from "@/components/tasks/tasks-board";

export const metadata = {
  title: "Tasks",
};

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{
    type?: string;
    status?: string;
    assignee?: string;
    due?: string;
    mine?: string;
  }>;
}) {
  const user = await requireFullAuth();
  const sp = await searchParams;
  const admin = isAdmin(user);
  const dealWhere = await dealVisibilityWhere(user);
  const now = new Date();

  // Base RBAC scope: tasks on deals the user can see. Sales users are further
  // locked to their own assigned tasks (admins can target any assignee).
  const where: Prisma.TaskWhereInput = { deal: dealWhere };

  const statusFilter = sp.status as TaskStatusFilter | undefined;
  if (statusFilter === "done") where.status = "DONE";
  else if (statusFilter !== "all") where.status = "OPEN"; // default

  if (!admin) where.assigneeId = user.id;
  else if (sp.mine === "1") where.assigneeId = user.id;
  else if (sp.assignee) where.assigneeId = sp.assignee;

  if (sp.type) where.type = sp.type as TaskType;

  if (sp.due) where.dueDate = dueWindowRange(sp.due as DueWindow, now);

  const [tasks, owners] = await Promise.all([
    prisma.task.findMany({
      where,
      include: { deal: { select: { salesId: true, title: true } }, assignee: true },
      // Urgency first (CRITICAL -> LOW), then soonest due date, then newest.
      orderBy: [{ urgency: "desc" }, { dueDate: "asc" }, { createdAt: "desc" }],
      // Rows are split into overdue/upcoming in memory below; a cap under the
      // real count would clip whole sections (MySQL clusters NULL due dates at
      // the front), so load the full visible set (see LIST_FETCH_CAP).
      take: LIST_FETCH_CAP,
    }),
    admin ? getOwners() : Promise.resolve([]),
  ]);

  const rows: TaskRowData[] = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    type: t.type,
    urgency: t.urgency,
    dueDate: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null,
    overdue: !!(t.dueDate && t.dueDate < now),
    dealSalesId: t.deal.salesId,
    dealTitle: t.deal.title,
    assigneeId: t.assigneeId,
    assigneeName: t.assignee?.name ?? null,
    assigneeColor: t.assignee?.avatarColor ?? null,
  }));
  const overdue = rows.filter((t) => t.overdue);
  const upcoming = rows.filter((t) => !t.overdue);

  return (
    <div className="pb-10">
      <PageHeader title="Tasks" description={admin ? "All open next-actions on visible deals" : "Your open next-actions"} />
      <div className="px-4 pt-4 md:px-6">
        <TasksFilterBar owners={owners} showAssigneeFilter={admin} />
      </div>
      <TasksBoard overdue={overdue} upcoming={upcoming} owners={owners} admin={admin} />
    </div>
  );
}
