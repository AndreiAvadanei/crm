import Link from "next/link";
import { AlertTriangle, ArrowRight, CalendarClock, CalendarDays, ListTodo } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DashboardTaskList } from "@/components/dashboard/dashboard-task-list";
import { type TaskItemData } from "@/components/tasks/task-common";
import { cn, formatCurrency, formatDate } from "@/lib/utils";

/** Local yyyy-mm-dd for date-only comparisons (matches task due helpers). */
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export type OverdueDeal = {
  id: string;
  salesId: string;
  title: string;
  dueDate: string; // yyyy-mm-dd
  amountEur: number | null;
  stageName: string;
};

/** Card wrapper with a scrollable body (handles "lots of rows" gracefully). */
function SectionCard({
  title,
  icon: Icon,
  tone,
  count,
  viewAllHref,
  empty,
  children,
}: {
  title: string;
  icon: React.ElementType;
  tone: "danger" | "muted";
  count: number;
  viewAllHref: string;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <Card
      className={cn("min-w-0 overflow-hidden", tone === "danger" && "border-destructive/30")}
    >
      <CardHeader className="pb-3">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <CardTitle className="flex min-w-0 items-center gap-2 text-base">
            <Icon
              className={`h-4 w-4 shrink-0 ${tone === "danger" ? "text-destructive" : "text-muted-foreground"}`}
            />
            <span className="truncate">{title}</span>
            <Badge variant={tone === "danger" ? "destructive" : "secondary"} className="shrink-0">
              {count}
            </Badge>
          </CardTitle>
          {count > 0 && (
            <Link
              href={viewAllHref}
              className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-primary"
            >
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          )}
        </div>
      </CardHeader>
      <CardContent className="min-w-0">
        {count === 0 ? (
          <p className="py-4 text-sm leading-relaxed text-muted-foreground">{empty}</p>
        ) : (
          <div className="max-h-[22rem] min-w-0 space-y-2 overflow-y-auto overflow-x-hidden pr-1">
            {children}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DealRow({ deal, tone }: { deal: OverdueDeal; tone: "danger" | "muted" }) {
  const dueToday = tone !== "danger" && deal.dueDate === todayStr();
  return (
    <Link
      href={`/deals/${deal.salesId}`}
      className={cn(
        "flex min-w-0 items-start gap-3 rounded-lg border px-3 py-2 transition-colors hover:border-primary hover:bg-accent/50",
        dueToday && "border-l-2 border-l-warning"
      )}
    >
      {tone === "danger" ? (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      ) : (
        <CalendarDays
          className={cn(
            "mt-0.5 h-4 w-4 shrink-0",
            dueToday ? "text-warning" : "text-muted-foreground"
          )}
        />
      )}
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="truncate text-sm font-medium">{deal.title}</div>
        <div className="truncate text-xs text-muted-foreground">
          <span className="font-mono">{deal.salesId}</span> · {deal.stageName}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          {deal.amountEur != null && (
            <span className="tabular-nums text-muted-foreground">{formatCurrency(deal.amountEur)}</span>
          )}
          <span
            className={cn(
              "font-medium",
              tone === "danger"
                ? "text-destructive"
                : dueToday
                  ? "text-warning"
                  : "text-muted-foreground"
            )}
          >
            {dueToday ? "Today" : formatDate(deal.dueDate)}
          </span>
        </div>
      </div>
    </Link>
  );
}

/**
 * Homepage "my work" panel: overdue + next-7-days lists for both tasks and
 * deals scoped to the current user. Tasks reuse the full TaskRow (inline title,
 * urgency, due date, complete checkbox); deals are compact links. Each list is
 * scrollable and links out to the matching filtered page when there are many.
 */
export function MyWork({
  overdueTasks,
  upcomingTasks,
  overdueDeals,
  upcomingDeals,
  owners,
  admin,
}: {
  overdueTasks: TaskItemData[];
  upcomingTasks: TaskItemData[];
  overdueDeals: OverdueDeal[];
  upcomingDeals: OverdueDeal[];
  owners: { id: string; name: string }[];
  admin: boolean;
}) {
  const nothing =
    overdueTasks.length === 0 &&
    upcomingTasks.length === 0 &&
    overdueDeals.length === 0 &&
    upcomingDeals.length === 0;
  if (nothing) return null;

  return (
    <div className="min-w-0 space-y-4">
      <div className="grid min-w-0 gap-4 md:grid-cols-2">
        <SectionCard
          title="My overdue tasks"
          icon={ListTodo}
          tone="danger"
          count={overdueTasks.length}
          viewAllHref="/tasks?due=overdue&mine=1"
          empty="No overdue tasks. "
        >
          <DashboardTaskList tasks={overdueTasks} owners={owners} admin={admin} />
        </SectionCard>

        <SectionCard
          title="My tasks · next 7 days"
          icon={ListTodo}
          tone="muted"
          count={upcomingTasks.length}
          viewAllHref="/tasks?due=week&mine=1"
          empty="Nothing due in the next 7 days."
        >
          <DashboardTaskList tasks={upcomingTasks} owners={owners} admin={admin} />
        </SectionCard>
      </div>

      <div className="grid min-w-0 gap-4 md:grid-cols-2">
        <SectionCard
          title="My overdue deals"
          icon={CalendarClock}
          tone="danger"
          count={overdueDeals.length}
          viewAllHref="/deals?overdue=1&mine=1"
          empty="No overdue deals. "
        >
          {overdueDeals.map((d) => (
            <DealRow key={d.id} deal={d} tone="danger" />
          ))}
        </SectionCard>

        <SectionCard
          title="My deals · due next 7 days"
          icon={CalendarDays}
          tone="muted"
          count={upcomingDeals.length}
          viewAllHref="/deals?mine=1"
          empty="No deals due in the next 7 days."
        >
          {upcomingDeals.map((d) => (
            <DealRow key={d.id} deal={d} tone="muted" />
          ))}
        </SectionCard>
      </div>
    </div>
  );
}
