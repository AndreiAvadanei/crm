"use client";

import { LayoutGrid, Table2, AlarmClock, UserCheck } from "lucide-react";
import { SearchInput } from "@/components/shared/search-input";
import { Button } from "@/components/ui/button";
import {
  FilterBar,
  FilterSelect,
  FilterToggleChip,
  FilterNumberRange,
  FilterDateRange,
  FilterTagMulti,
  ClearFiltersButton,
  useFilterUrl,
} from "@/components/shared/filter-bar";
import { DEAL_STATUS_OPTIONS } from "@/lib/filter-helpers";
import { DealSortSelect } from "@/components/deals/deal-sort-select";
import type { TagView } from "@/components/shared/tag-badge";

// Query params owned by this toolbar (used for the Clear-filters affordance).
const DEAL_FILTER_KEYS = [
  "q",
  "owner",
  "tag",
  "stage",
  "status",
  "sort",
  "amtMin",
  "amtMax",
  "dueFrom",
  "dueTo",
  "overdue",
  "mine",
];

export function DealsToolbar({
  owners,
  tags,
  stages,
  showOwnerFilter,
}: {
  owners: { id: string; name: string }[];
  tags: TagView[];
  stages: { id: string; name: string }[];
  showOwnerFilter: boolean;
}) {
  const { params, setParams } = useFilterUrl();
  const view = params.get("view") ?? "board";

  return (
    <FilterBar>
      <SearchInput placeholder="Search deals…" />

      <FilterSelect
        param="status"
        placeholder="All statuses"
        ariaLabel="Filter by status"
        options={DEAL_STATUS_OPTIONS.filter((o) => o.value !== "all")}
      />

      <FilterSelect
        param="stage"
        placeholder="All stages"
        ariaLabel="Filter by stage"
        options={stages.map((s) => ({ value: s.id, label: s.name }))}
      />

      {showOwnerFilter && (
        <FilterSelect
          param="owner"
          placeholder="All owners"
          ariaLabel="Filter by owner"
          options={owners.map((o) => ({ value: o.id, label: o.name }))}
        />
      )}

      <FilterTagMulti tags={tags} />

      <DealSortSelect />

      <FilterNumberRange minParam="amtMin" maxParam="amtMax" minPlaceholder="€ min" maxPlaceholder="€ max" />

      <FilterDateRange fromParam="dueFrom" toParam="dueTo" />

      <FilterToggleChip param="overdue" label="Overdue" icon={<AlarmClock />} />

      <FilterToggleChip param="mine" label="My deals" icon={<UserCheck />} />

      <ClearFiltersButton keys={DEAL_FILTER_KEYS} />

      <div className="ml-auto flex items-center rounded-md border p-0.5">
        <Button
          variant={view === "board" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setParams({ view: "board" })}
        >
          <LayoutGrid className="h-4 w-4" /> Board
        </Button>
        <Button
          variant={view === "table" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setParams({ view: "table" })}
        >
          <Table2 className="h-4 w-4" /> Table
        </Button>
      </div>
    </FilterBar>
  );
}
