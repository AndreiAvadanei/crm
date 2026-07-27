"use client";

import { UserCheck } from "lucide-react";
import {
  FilterSelect,
  FilterToggleChip,
  FilterPopover,
  FilterField,
  useFilterUrl,
} from "@/components/shared/filter-bar";
import {
  TASK_TYPE_OPTIONS,
  TASK_STATUS_OPTIONS,
  DUE_WINDOW_OPTIONS,
} from "@/lib/filter-helpers";

const TASK_FILTER_KEYS = ["type", "status", "assignee", "due", "mine"];

/** One-button filter popover for the cross-deal Tasks page (URL-param driven). */
export function TasksFilters({
  owners,
  showAssigneeFilter,
}: {
  owners: { id: string; name: string }[];
  showAssigneeFilter: boolean;
}) {
  const { params, setParams } = useFilterUrl();
  const activeCount = TASK_FILTER_KEYS.filter((k) => params.get(k)).length;
  const clearAll = () => setParams(Object.fromEntries(TASK_FILTER_KEYS.map((k) => [k, null])));

  return (
    <FilterPopover activeCount={activeCount} onClear={clearAll} columns={1} className="h-9">
      <FilterField label="Type">
        <FilterSelect
          param="type"
          placeholder="All types"
          ariaLabel="Filter by task type"
          options={TASK_TYPE_OPTIONS}
          className="w-full"
        />
      </FilterField>

      <FilterField label="Status">
        <FilterSelect
          param="status"
          placeholder="Open"
          ariaLabel="Filter by status"
          options={TASK_STATUS_OPTIONS.filter((o) => o.value !== "open")}
          className="w-full"
        />
      </FilterField>

      <FilterField label="Due">
        <FilterSelect
          param="due"
          placeholder="Any due date"
          ariaLabel="Filter by due window"
          options={DUE_WINDOW_OPTIONS}
          className="w-full"
        />
      </FilterField>

      {showAssigneeFilter && (
        <FilterField label="Assignee">
          <FilterSelect
            param="assignee"
            placeholder="All assignees"
            ariaLabel="Filter by assignee"
            options={owners.map((o) => ({ value: o.id, label: o.name }))}
            className="w-full"
          />
        </FilterField>
      )}

      <FilterToggleChip param="mine" label="Assigned to me" icon={<UserCheck />} className="w-full justify-center" />
    </FilterPopover>
  );
}
