// Shared (client + server safe) metadata for the Task `urgency` field.
// No `server-only` / prisma imports so client controls can use the options too.

import type { Option } from "@/lib/filter-helpers";

export type TaskUrgency = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/** Ordered low -> high (matches the Prisma enum declaration order). */
export const TASK_URGENCY_VALUES: TaskUrgency[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

export const TASK_URGENCY_OPTIONS: Option<TaskUrgency>[] = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
  { value: "CRITICAL", label: "Critical" },
];

/** Higher rank = more urgent; used for client-side sorting / comparisons. */
export const URGENCY_RANK: Record<TaskUrgency, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

type UrgencyMeta = {
  label: string;
  /** Tailwind classes for a compact pill badge. */
  badgeClass: string;
  /** Dot/text color token for subtle inline accents. */
  dotClass: string;
};

export const URGENCY_META: Record<TaskUrgency, UrgencyMeta> = {
  LOW: {
    label: "Low",
    badgeClass: "bg-muted text-muted-foreground",
    dotClass: "bg-muted-foreground/50",
  },
  MEDIUM: {
    label: "Medium",
    badgeClass: "bg-primary/8 text-primary",
    dotClass: "bg-primary",
  },
  HIGH: {
    label: "High",
    badgeClass: "bg-[var(--warning)]/12 text-[var(--warning)]",
    dotClass: "bg-[var(--warning)]",
  },
  CRITICAL: {
    label: "Critical",
    badgeClass: "bg-destructive/12 text-destructive",
    dotClass: "bg-destructive",
  },
};

export function urgencyLabel(u: TaskUrgency): string {
  return URGENCY_META[u]?.label ?? u;
}

/** Text-color class for a colored inline <select> reflecting current urgency. */
export const URGENCY_TEXT_CLASS: Record<TaskUrgency, string> = {
  LOW: "text-muted-foreground",
  MEDIUM: "text-primary",
  HIGH: "text-[var(--warning)]",
  CRITICAL: "text-destructive font-semibold",
};
