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
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TaskRow, type TaskRowData } from "@/components/tasks/task-row";
import { TasksFilterBar } from "@/components/tasks/tasks-filter-bar";

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
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      take: 200,
    }),
    admin ? getOwners() : Promise.resolve([]),
  ]);

  const rows: TaskRowData[] = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    type: t.type,
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
      <div className="grid gap-6 p-4 md:grid-cols-2 md:p-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              Overdue <Badge variant="destructive">{overdue.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {overdue.map((t) => (
              <TaskRow key={t.id} task={t} owners={owners} admin={admin} />
            ))}
            {overdue.length === 0 && <p className="text-sm text-muted-foreground">Nothing overdue. </p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Upcoming <Badge variant="secondary">{upcoming.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {upcoming.map((t) => (
              <TaskRow key={t.id} task={t} owners={owners} admin={admin} />
            ))}
            {upcoming.length === 0 && <p className="text-sm text-muted-foreground">No upcoming tasks.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
