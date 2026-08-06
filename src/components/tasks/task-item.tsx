"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { AlarmClock, Loader2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar } from "@/components/ui/avatar";
import { useToast } from "@/components/ui/toast";
import { SnoozeMenu } from "@/components/tasks/snooze-menu";
import { toggleTaskAction } from "@/server/deal-actions";
import {
  TaskTypeIcon,
  UrgencyBadge,
  DueBadge,
  isTaskOverdue,
  isTaskDueToday,
  type TaskItemData,
} from "@/components/tasks/task-common";
import { cn } from "@/lib/utils";

/**
 * Compact, responsive task row. The whole row is a click target that opens the
 * full editor (`TaskSheet`) — so even in a narrow sidebar or on mobile there's
 * always room to edit. The checkbox either completes the task or (in the Tasks
 * page's multi-select mode) toggles selection.
 */
export function TaskItem({
  task,
  onOpen,
  showDeal = false,
  compact = false,
  selected,
  onSelectChange,
  showSnooze = false,
}: {
  task: TaskItemData;
  onOpen: () => void;
  showDeal?: boolean;
  /** Always stack metadata under the title (for narrow columns / sidebars). */
  compact?: boolean;
  /** When provided, the checkbox toggles selection instead of completing. */
  selected?: boolean;
  onSelectChange?: (checked: boolean) => void;
  /** Show a quick snooze control in the row's right-side meta cluster. */
  showSnooze?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const selectable = onSelectChange !== undefined;
  const isDone = task.status === "DONE";
  const overdue = isTaskOverdue(task.dueDate, task.status);
  const dueToday = isTaskDueToday(task.dueDate, task.status);

  function complete() {
    startTransition(async () => {
      const res = await toggleTaskAction(task.id);
      if (res?.error) return toast({ title: res.error, variant: "error" });
      router.refresh();
    });
  }

  return (
    <div
      className={cn(
        "group flex items-start gap-2.5 rounded-lg border px-2.5 py-2 transition-colors",
        selected ? "border-primary bg-primary/5" : "border-border hover:border-foreground/20 hover:bg-accent/40",
        overdue && !selected && "border-l-2 border-l-destructive",
        dueToday && !selected && "border-l-2 border-l-warning"
      )}
    >
      <div className="pt-0.5">
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <Checkbox
            checked={selectable ? !!selected : isDone}
            onCheckedChange={(c) => (selectable ? onSelectChange?.(c === true) : complete())}
            aria-label={selectable ? "Select task" : isDone ? "Reopen task" : "Complete task"}
          />
        )}
      </div>

      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
      >
        <TaskTypeIcon type={task.type} className="mt-0.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block text-sm font-medium [overflow-wrap:anywhere]",
              isDone && "text-muted-foreground line-through"
            )}
          >
            {task.title}
          </span>
          {showDeal && task.dealSalesId && (
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              <span className="font-mono">{task.dealSalesId}</span>
              {task.dealTitle ? ` · ${task.dealTitle}` : ""}
            </span>
          )}
          {/* Meta under the title: always on mobile; always in compact mode */}
          <span
            className={cn(
              "mt-1 flex flex-wrap items-center gap-x-2 gap-y-1",
              compact ? "flex" : "sm:hidden"
            )}
          >
            <UrgencyBadge urgency={task.urgency} />
            <DueBadge dueDate={task.dueDate} status={task.status} />
            {compact && task.assigneeName && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Avatar name={task.assigneeName} color={task.assigneeColor} className="h-4 w-4 text-[8px]" />
                {task.assigneeName}
              </span>
            )}
          </span>
        </span>
      </button>

      {/* Right-side meta cluster (hidden in compact / on mobile) */}
      {!compact && (
        <div className="hidden shrink-0 items-center gap-2.5 pt-0.5 sm:flex">
          {showSnooze && !isDone && (
            <SnoozeMenu taskId={task.id}>
              <button
                type="button"
                aria-label="Snooze task"
                title="Snooze"
                className="rounded p-1 text-muted-foreground opacity-0 transition-colors hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
              >
                <AlarmClock className="h-4 w-4" />
              </button>
            </SnoozeMenu>
          )}
          <UrgencyBadge urgency={task.urgency} />
          <DueBadge dueDate={task.dueDate} status={task.status} />
          {task.assigneeName && (
            <Avatar name={task.assigneeName} color={task.assigneeColor} className="h-6 w-6 text-[10px]" />
          )}
        </div>
      )}
    </div>
  );
}
