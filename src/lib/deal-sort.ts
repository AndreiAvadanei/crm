// Shared (client + server safe) sort metadata for the deals list/board.
// Sorting applies within each status column on the board and across the table.

export type DealSort = "board" | "name" | "date" | "size" | "activity";

export const DEAL_SORT_OPTIONS: { value: DealSort; label: string }[] = [
  { value: "board", label: "Manual order" },
  { value: "name", label: "Name" },
  { value: "date", label: "Due date" },
  { value: "size", label: "Size" },
  // "activity" = most recent field change / comment / file upload / task touch,
  // rolled up per deal (see deals page). Most recently active first.
  { value: "activity", label: "Last activity" },
];

const VALID = new Set<string>(DEAL_SORT_OPTIONS.map((o) => o.value));

/** Coerce an arbitrary string into a valid DealSort (defaults to "board"). */
export function parseDealSort(raw: string | undefined | null): DealSort {
  return (raw && VALID.has(raw) ? raw : "board") as DealSort;
}

export type DealSortDir = "asc" | "desc";

// Each sort has a natural default direction (the one shown before the user
// flips it): names read A→Z, due dates soonest-first, while amount and recency
// lead with the biggest / most recent. "board" is manual order — no direction.
export const DEAL_SORT_DEFAULT_DIR: Record<DealSort, DealSortDir> = {
  board: "asc",
  name: "asc",
  date: "asc",
  size: "desc",
  activity: "desc",
};

/**
 * Resolve the effective sort direction: the explicit `dir` query param when
 * valid, otherwise the sort's natural default (see {@link DEAL_SORT_DEFAULT_DIR}).
 */
export function resolveDealSortDir(sort: DealSort, raw: string | undefined | null): DealSortDir {
  if (raw === "asc" || raw === "desc") return raw;
  return DEAL_SORT_DEFAULT_DIR[sort];
}
