"use client";

import { UserCheck } from "lucide-react";
import {
  FilterBar,
  FilterSelect,
  FilterToggleChip,
  ClearFiltersButton,
} from "@/components/shared/filter-bar";
import {
  TASK_TYPE_OPTIONS,
  TASK_STATUS_OPTIONS,
  DUE_WINDOW_OPTIONS,
} from "@/lib/filter-helpers";

const TASK_FILTER_KEYS = ["type", "status", "assignee", "due", "mine"];

export function TasksFilterBar({
  owners,
  showAssigneeFilter,
}: {
  owners: { id: string; name: string }[];
  showAssigneeFilter: boolean;
}) {
  return (
    <FilterBar>
      <FilterSelect
        param="type"
        placeholder="All types"
        ariaLabel="Filter by task type"
        options={TASK_TYPE_OPTIONS}
      />

      <FilterSelect
        param="status"
        placeholder="Open"
        ariaLabel="Filter by status"
        options={TASK_STATUS_OPTIONS.filter((o) => o.value !== "open")}
      />

      <FilterSelect
        param="due"
        placeholder="Any due date"
        ariaLabel="Filter by due window"
        options={DUE_WINDOW_OPTIONS}
      />

      {showAssigneeFilter && (
        <FilterSelect
          param="assignee"
          placeholder="All assignees"
          ariaLabel="Filter by assignee"
          options={owners.map((o) => ({ value: o.id, label: o.name }))}
        />
      )}

      <FilterToggleChip param="mine" label="Assigned to me" icon={<UserCheck />} />

      <ClearFiltersButton keys={TASK_FILTER_KEYS} />
    </FilterBar>
  );
}
