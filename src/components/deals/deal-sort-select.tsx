"use client";

import { ArrowUpDown } from "lucide-react";
import { DEAL_SORT_OPTIONS, parseDealSort } from "@/lib/deal-sort";
import { useFilterUrl } from "@/components/shared/filter-bar";
import { cn } from "@/lib/utils";

/**
 * Sort deals by name / due date / size. The selection lives in the `sort`
 * query param and orders deals within each status column on the board
 * (and across rows in the table view). "Manual order" clears the param.
 */
export function DealSortSelect() {
  const { params, setParams } = useFilterUrl();
  const current = parseDealSort(params.get("sort"));
  const active = current !== "board";

  return (
    <div className="relative">
      <ArrowUpDown className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <select
        value={current}
        onChange={(e) => setParams({ sort: e.target.value === "board" ? null : e.target.value })}
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
  );
}
