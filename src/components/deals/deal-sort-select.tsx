"use client";

import { ArrowUpDown, ArrowDownWideNarrow, ArrowUpWideNarrow } from "lucide-react";
import {
  DEAL_SORT_OPTIONS,
  parseDealSort,
  resolveDealSortDir,
  DEAL_SORT_DEFAULT_DIR,
} from "@/lib/deal-sort";
import { useFilterUrl } from "@/components/shared/filter-bar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Sort deals by name / due date / size / last activity, plus a direction toggle
 * that flips any sort the opposite way. The selection lives in the `sort` query
 * param and the direction in `dir` (omitted when it matches the sort's natural
 * default). Sorting orders deals within each status column on the board (and
 * across rows in the table view). "Manual order" clears both params.
 */
export function DealSortSelect() {
  const { params, setParams } = useFilterUrl();
  const current = parseDealSort(params.get("sort"));
  const active = current !== "board";
  const dir = resolveDealSortDir(current, params.get("dir"));

  // Changing the sort resets direction to that sort's natural default.
  const onSortChange = (value: string) =>
    setParams({ sort: value === "board" ? null : value, dir: null });

  // Flip direction; keep the URL clean by clearing `dir` when it's the default.
  const toggleDir = () => {
    const next = dir === "asc" ? "desc" : "asc";
    setParams({ dir: next === DEAL_SORT_DEFAULT_DIR[current] ? null : next });
  };

  return (
    <div className="flex items-center gap-1.5">
      <div className="relative">
        <ArrowUpDown className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <select
          value={current}
          onChange={(e) => onSortChange(e.target.value)}
          aria-label="Sort deals"
          className={cn(
            "form-control h-9 cursor-pointer pl-8 pr-3",
            active && "border-foreground/25 bg-accent"
          )}
        >
          {DEAL_SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {active && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={toggleDir}
          aria-label="Toggle sort direction"
          title={
            dir === "asc"
              ? "Ascending — click for descending"
              : "Descending — click for ascending"
          }
          className={cn("h-9 w-9 shrink-0", dir !== DEAL_SORT_DEFAULT_DIR[current] && "bg-accent")}
        >
          {dir === "asc" ? (
            <ArrowUpWideNarrow className="h-4 w-4" />
          ) : (
            <ArrowDownWideNarrow className="h-4 w-4" />
          )}
        </Button>
      )}
    </div>
  );
}
