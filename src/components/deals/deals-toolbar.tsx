"use client";

import { LayoutGrid, Table2, AlarmClock, UserCheck } from "lucide-react";
import { SearchInput } from "@/components/shared/search-input";
import { Button } from "@/components/ui/button";
import {
  FilterSelect,
  FilterToggleChip,
  FilterNumberRange,
  FilterDateRange,
  FilterTagMulti,
  FilterPopover,
  FilterField,
  FilterChips,
  useFilterUrl,
  type FilterChip,
} from "@/components/shared/filter-bar";
import {
  DEAL_STATUS_OPTIONS,
  STALE_WINDOW_OPTIONS,
  parseCsvIds,
} from "@/lib/filter-helpers";
import { DealSortSelect } from "@/components/deals/deal-sort-select";
import { cn } from "@/lib/utils";
import type { TagView } from "@/components/shared/tag-badge";

// Params behind the Filters popover (search/sort/view have their own controls).
const DEAL_FILTER_KEYS = [
  "owner",
  "tag",
  "stage",
  "status",
  "amtMin",
  "amtMax",
  "dueFrom",
  "dueTo",
  "overdue",
  "mine",
  "stale",
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

  const activeCount = DEAL_FILTER_KEYS.filter((k) => params.get(k)).length;
  const clearAll = () => setParams(Object.fromEntries(DEAL_FILTER_KEYS.map((k) => [k, null])));

  const chips: FilterChip[] = [];
  if (params.get("mine") === "1")
    chips.push({ key: "mine", label: "My deals", onRemove: () => setParams({ mine: null }) });
  const status = params.get("status");
  if (status) {
    const label = DEAL_STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status;
    chips.push({ key: "status", label, onRemove: () => setParams({ status: null }) });
  }
  const stage = params.get("stage");
  if (stage) {
    const label = stages.find((s) => s.id === stage)?.name ?? "Stage";
    chips.push({ key: "stage", label, onRemove: () => setParams({ stage: null }) });
  }
  const ownerId = params.get("owner");
  if (showOwnerFilter && ownerId && params.get("mine") !== "1") {
    const name = owners.find((o) => o.id === ownerId)?.name ?? "Owner";
    chips.push({ key: "owner", label: name, onRemove: () => setParams({ owner: null }) });
  }
  for (const id of parseCsvIds(params.get("tag"))) {
    const tag = tags.find((t) => t.id === id);
    if (tag)
      chips.push({
        key: `tag-${id}`,
        label: tag.name,
        onRemove: () => {
          const next = parseCsvIds(params.get("tag")).filter((x) => x !== id);
          setParams({ tag: next.length ? next.join(",") : null });
        },
      });
  }
  const amtMin = params.get("amtMin");
  const amtMax = params.get("amtMax");
  if (amtMin || amtMax)
    chips.push({
      key: "amt",
      label: `€ ${amtMin || "…"} – ${amtMax || "…"}`,
      onRemove: () => setParams({ amtMin: null, amtMax: null }),
    });
  const dueFrom = params.get("dueFrom");
  const dueTo = params.get("dueTo");
  if (dueFrom || dueTo)
    chips.push({
      key: "due",
      label: `Due ${dueFrom || "…"} – ${dueTo || "…"}`,
      onRemove: () => setParams({ dueFrom: null, dueTo: null }),
    });
  if (params.get("overdue") === "1")
    chips.push({ key: "overdue", label: "Overdue", onRemove: () => setParams({ overdue: null }) });
  const stale = params.get("stale");
  if (stale) {
    const label = STALE_WINDOW_OPTIONS.find((o) => o.value === stale)?.label ?? "Stalled";
    chips.push({ key: "stale", label, onRemove: () => setParams({ stale: null }) });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <SearchInput placeholder="Search deals…" wrapperClassName="flex-1 sm:max-w-sm" />
        <DealSortSelect />

        <FilterPopover activeCount={activeCount} onClear={clearAll}>
          <FilterField label="Status">
            <FilterSelect
              param="status"
              placeholder="All statuses"
              ariaLabel="Filter by status"
              options={DEAL_STATUS_OPTIONS.filter((o) => o.value !== "all")}
              className="w-full"
            />
          </FilterField>

          <FilterField label="Stage">
            <FilterSelect
              param="stage"
              placeholder="All stages"
              ariaLabel="Filter by stage"
              options={stages.map((s) => ({ value: s.id, label: s.name }))}
              className="w-full"
            />
          </FilterField>

          {showOwnerFilter && (
            <FilterField label="Owner">
              <FilterSelect
                param="owner"
                placeholder="All owners"
                ariaLabel="Filter by owner"
                options={owners.map((o) => ({ value: o.id, label: o.name }))}
                className="w-full"
              />
            </FilterField>
          )}

          <FilterField label="Tags">
            <FilterTagMulti tags={tags} className="w-full justify-between" />
          </FilterField>

          <FilterField label="Amount (€)">
            <FilterNumberRange minParam="amtMin" maxParam="amtMax" minPlaceholder="Min" maxPlaceholder="Max" />
          </FilterField>

          <FilterField label="No activity for">
            <FilterSelect
              param="stale"
              placeholder="Any activity"
              ariaLabel="Filter stalled open deals"
              options={STALE_WINDOW_OPTIONS}
              className="w-full"
            />
          </FilterField>

          <FilterField label="Due date" span="full">
            <FilterDateRange fromParam="dueFrom" toParam="dueTo" />
          </FilterField>

          <FilterField label="Quick filters" span="full">
            <div className="grid grid-cols-2 gap-2">
              <FilterToggleChip param="overdue" label="Overdue" icon={<AlarmClock />} className="w-full justify-center" />
              <FilterToggleChip param="mine" label="My deals" icon={<UserCheck />} className="w-full justify-center" />
            </div>
          </FilterField>
        </FilterPopover>

        <div className="segment-track ml-auto shrink-0">
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
      </div>

      <FilterChips chips={chips} />
    </div>
  );
}
