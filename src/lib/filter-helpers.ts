// Shared (client + server safe) filter metadata + parsing helpers used by the
// Clients / Deals / Tasks list filter bars and their server-side query builders.
// Kept free of `server-only` / prisma so the client filter controls can import
// the option lists too.

// ---------------------------------------------------------------------------
// Option lists (rendered by the client filter controls)
// ---------------------------------------------------------------------------

export type Option<T extends string = string> = { value: T; label: string };

/** Deal status slices, derived from the deal's stage flags (isWon / isLost). */
export type DealStatus = "open" | "won" | "lost" | "all";
export const DEAL_STATUS_OPTIONS: Option<DealStatus>[] = [
  { value: "all", label: "All statuses" },
  { value: "open", label: "Open / active" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
];

/** Task type (mirrors the Prisma `TaskType` enum). */
export const TASK_TYPE_OPTIONS: Option[] = [
  { value: "TASK", label: "Task" },
  { value: "CALL", label: "Call" },
  { value: "EMAIL", label: "Email" },
  { value: "MEETING", label: "Meeting" },
  { value: "NOTE", label: "Note" },
];

/** Task status slice. `open`/`done` map to Prisma `TaskStatus`; `all` = no filter. */
export type TaskStatusFilter = "open" | "done" | "all";
export const TASK_STATUS_OPTIONS: Option<TaskStatusFilter>[] = [
  { value: "open", label: "Open" },
  { value: "done", label: "Done" },
  { value: "all", label: "All" },
];

/** Quick due-date windows shared by deals + tasks. */
export type DueWindow = "overdue" | "today" | "week" | "upcoming";
export const DUE_WINDOW_OPTIONS: Option<DueWindow>[] = [
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Due today" },
  { value: "week", label: "Due this week" },
  { value: "upcoming", label: "Upcoming" },
];

/** Client last-activity recency windows (days). */
export type ActivityWindow = "7" | "30" | "90";
export const ACTIVITY_WINDOW_OPTIONS: Option<ActivityWindow>[] = [
  { value: "7", label: "Active · 7 days" },
  { value: "30", label: "Active · 30 days" },
  { value: "90", label: "Active · 90 days" },
];

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/** Split a comma-separated multi-value param (e.g. `?tag=a,b,c`) into ids. */
export function parseCsvIds(value?: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Parse a finite, non-negative number param (amount filters); else undefined. */
export function parseNumber(value?: string | null): number | undefined {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Parse a `yyyy-mm-dd` date param to a Date at local midnight; else undefined. */
export function parseDate(value?: string | null): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// ---------------------------------------------------------------------------
// Date-window helpers (server uses `now`; pure so they're testable)
// ---------------------------------------------------------------------------

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

/**
 * Translate a quick due-window into a `{ gte?, lt? }` range usable directly as
 * a Prisma DateTime filter. `overdue` => strictly before today.
 */
export function dueWindowRange(
  kind: DueWindow,
  now: Date = new Date()
): { gte?: Date; lt?: Date } {
  const today = startOfDay(now);
  switch (kind) {
    case "overdue":
      return { lt: today };
    case "today":
      return { gte: today, lt: addDays(today, 1) };
    case "week":
      return { gte: today, lt: addDays(today, 7) };
    case "upcoming":
      return { gte: today };
  }
}

/** Cutoff Date for "active within N days" recency windows. */
export function recencyCutoff(days: number, now: Date = new Date()): Date {
  return addDays(startOfDay(now), -days);
}
