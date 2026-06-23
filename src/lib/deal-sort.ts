// Shared (client + server safe) sort metadata for the deals list/board.
// Sorting applies within each status column on the board and across the table.

export type DealSort = "board" | "name" | "date" | "size";

export const DEAL_SORT_OPTIONS: { value: DealSort; label: string }[] = [
  { value: "board", label: "Manual order" },
  { value: "name", label: "Name" },
  { value: "date", label: "Due date" },
  { value: "size", label: "Size" },
];

const VALID = new Set<string>(DEAL_SORT_OPTIONS.map((o) => o.value));

/** Coerce an arbitrary string into a valid DealSort (defaults to "board"). */
export function parseDealSort(raw: string | undefined | null): DealSort {
  return (raw && VALID.has(raw) ? raw : "board") as DealSort;
}
