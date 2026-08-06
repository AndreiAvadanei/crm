"use client";

import {
  Phone,
  Mail,
  StickyNote,
  CalendarDays,
  CalendarClock,
  CheckSquare,
  type LucideIcon,
} from "lucide-react";
import { URGENCY_META, type TaskUrgency } from "@/lib/task-urgency";
import { cn, formatDate } from "@/lib/utils";

/** Canonical shape rendered by the shared task UI (list item + editor sheet). */
export type TaskItemData = {
  id: string;
  title: string;
  type: string;
  status: string; // "OPEN" | "DONE"
  urgency: TaskUrgency;
  dueDate: string | null; // yyyy-mm-dd
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeColor: string | null;
  // Optional deal context (shown on the cross-deal Tasks page).
  dealSalesId?: string | null;
  dealTitle?: string | null;
};

export const TASK_TYPE_META: Record<string, { label: string; Icon: LucideIcon }> = {
  TASK: { label: "Task", Icon: CheckSquare },
  CALL: { label: "Call", Icon: Phone },
  EMAIL: { label: "Email", Icon: Mail },
  MEETING: { label: "Meeting", Icon: CalendarDays },
  NOTE: { label: "Note", Icon: StickyNote },
};

export const TASK_TYPE_OPTIONS = Object.entries(TASK_TYPE_META).map(([value, m]) => ({
  value,
  label: m.label,
}));

export function TaskTypeIcon({ type, className }: { type: string; className?: string }) {
  const Icon = TASK_TYPE_META[type]?.Icon ?? CheckSquare;
  return <Icon className={cn("h-4 w-4", className)} />;
}

/** yyyy-mm-dd for local "today", so date-only comparisons ignore time zones. */
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysBetween(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00`);
  const db = new Date(`${b}T00:00:00`);
  return Math.round((da.getTime() - db.getTime()) / 86_400_000);
}

export function isTaskOverdue(dueDate: string | null, status: string): boolean {
  if (!dueDate || status === "DONE") return false;
  return dueDate < todayStr();
}

export function isTaskDueToday(dueDate: string | null, status: string): boolean {
  if (!dueDate || status === "DONE") return false;
  return dueDate === todayStr();
}

/** Smart, compact due-date descriptor (Today / Tomorrow / Overdue …). */
export function dueMeta(dueDate: string | null, status: string) {
  if (!dueDate) return { label: "No date", overdue: false, today: false, muted: true, soon: false };
  const diff = daysBetween(dueDate, todayStr());
  const overdue = status !== "DONE" && diff < 0;
  const today = status !== "DONE" && diff === 0;
  const label =
    diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : diff === -1 ? "Yesterday" : formatDate(dueDate);
  return {
    label,
    overdue,
    today,
    muted: false,
    // Tomorrow / day-after — today has its own highlight.
    soon: status !== "DONE" && diff >= 1 && diff <= 2,
  };
}

export function UrgencyBadge({ urgency, className }: { urgency: TaskUrgency; className?: string }) {
  const meta = URGENCY_META[urgency];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        meta.badgeClass,
        className
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dotClass)} />
      {meta.label}
    </span>
  );
}

export function DueBadge({
  dueDate,
  status,
  className,
}: {
  dueDate: string | null;
  status: string;
  className?: string;
}) {
  const meta = dueMeta(dueDate, status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap text-xs",
        meta.overdue
          ? "font-medium text-destructive"
          : meta.today
            ? "font-medium text-warning"
            : meta.soon
              ? "text-foreground"
              : "text-muted-foreground",
        className
      )}
    >
      <CalendarClock className="h-3.5 w-3.5" />
      {meta.label}
    </span>
  );
}
