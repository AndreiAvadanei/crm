"use client";

import { Briefcase, CircleSlash } from "lucide-react";
import {
  FilterBar,
  FilterSelect,
  FilterToggleChip,
  FilterTagMulti,
  ClearFiltersButton,
} from "@/components/shared/filter-bar";
import { ACTIVITY_WINDOW_OPTIONS } from "@/lib/filter-helpers";
import type { TagView } from "@/components/shared/tag-badge";

// Query params owned by this filter bar (excludes q/sort which have their own controls).
const CLIENT_FILTER_KEYS = ["owner", "tag", "size", "country", "hasOpen", "noDeals", "active"];

export function ClientsFilterBar({
  owners,
  tags,
  sizes,
  countries,
  showOwnerFilter,
}: {
  owners: { id: string; name: string }[];
  tags: TagView[];
  sizes: string[];
  countries: string[];
  showOwnerFilter: boolean;
}) {
  return (
    <FilterBar>
      {showOwnerFilter && (
        <FilterSelect
          param="owner"
          placeholder="All owners"
          ariaLabel="Filter by owner"
          options={owners.map((o) => ({ value: o.id, label: o.name }))}
        />
      )}

      <FilterTagMulti tags={tags} />

      {sizes.length > 0 && (
        <FilterSelect
          param="size"
          placeholder="All sizes"
          ariaLabel="Filter by size"
          options={sizes.map((s) => ({ value: s, label: s }))}
        />
      )}

      {countries.length > 0 && (
        <FilterSelect
          param="country"
          placeholder="All countries"
          ariaLabel="Filter by country"
          options={countries.map((c) => ({ value: c, label: c }))}
        />
      )}

      <FilterSelect
        param="active"
        placeholder="Any activity"
        ariaLabel="Filter by recent activity"
        options={ACTIVITY_WINDOW_OPTIONS}
      />

      <FilterToggleChip param="hasOpen" label="Has open deals" icon={<Briefcase />} />

      <FilterToggleChip param="noDeals" label="No deals" icon={<CircleSlash />} />

      <ClearFiltersButton keys={CLIENT_FILTER_KEYS} />
    </FilterBar>
  );
}
