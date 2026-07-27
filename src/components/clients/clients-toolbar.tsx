"use client";

import { Briefcase, CircleSlash } from "lucide-react";
import { SearchInput } from "@/components/shared/search-input";
import { ClientSortSelect } from "@/components/clients/client-sort-select";
import {
  FilterSelect,
  FilterToggleChip,
  FilterTagMulti,
  FilterPopover,
  FilterField,
  FilterChips,
  useFilterUrl,
  type FilterChip,
} from "@/components/shared/filter-bar";
import { ACTIVITY_WINDOW_OPTIONS } from "@/lib/filter-helpers";
import { parseCsvIds } from "@/lib/filter-helpers";
import type { TagView } from "@/components/shared/tag-badge";

// Params owned by the Filters popover (search + sort have their own controls).
const CLIENT_FILTER_KEYS = ["owner", "tag", "size", "country", "hasOpen", "noDeals", "active"];

export function ClientsToolbar({
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
  const { params, setParams } = useFilterUrl();

  const activeCount = CLIENT_FILTER_KEYS.filter((k) => params.get(k)).length;
  const clearAll = () => setParams(Object.fromEntries(CLIENT_FILTER_KEYS.map((k) => [k, null])));

  const chips: FilterChip[] = [];
  const ownerId = params.get("owner");
  if (showOwnerFilter && ownerId) {
    const name = owners.find((o) => o.id === ownerId)?.name ?? "Owner";
    chips.push({ key: "owner", label: name, onRemove: () => setParams({ owner: null }) });
  }
  for (const id of parseCsvIds(params.get("tag"))) {
    const tag = tags.find((t) => t.id === id);
    if (tag) {
      chips.push({
        key: `tag-${id}`,
        label: tag.name,
        onRemove: () => {
          const next = parseCsvIds(params.get("tag")).filter((x) => x !== id);
          setParams({ tag: next.length ? next.join(",") : null });
        },
      });
    }
  }
  const size = params.get("size");
  if (size) chips.push({ key: "size", label: size, onRemove: () => setParams({ size: null }) });
  const country = params.get("country");
  if (country) chips.push({ key: "country", label: country, onRemove: () => setParams({ country: null }) });
  const active = params.get("active");
  if (active) {
    const label = ACTIVITY_WINDOW_OPTIONS.find((o) => o.value === active)?.label ?? "Active";
    chips.push({ key: "active", label, onRemove: () => setParams({ active: null }) });
  }
  if (params.get("hasOpen") === "1")
    chips.push({ key: "hasOpen", label: "Has open deals", onRemove: () => setParams({ hasOpen: null }) });
  if (params.get("noDeals") === "1")
    chips.push({ key: "noDeals", label: "No deals", onRemove: () => setParams({ noDeals: null }) });

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <SearchInput placeholder="Search clients…" wrapperClassName="flex-1 sm:max-w-sm" />
        <ClientSortSelect />
        <FilterPopover activeCount={activeCount} onClear={clearAll}>
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

          {sizes.length > 0 && (
            <FilterField label="Company size">
              <FilterSelect
                param="size"
                placeholder="All sizes"
                ariaLabel="Filter by size"
                options={sizes.map((s) => ({ value: s, label: s }))}
                className="w-full"
              />
            </FilterField>
          )}

          {countries.length > 0 && (
            <FilterField label="Country">
              <FilterSelect
                param="country"
                placeholder="All countries"
                ariaLabel="Filter by country"
                options={countries.map((c) => ({ value: c, label: c }))}
                className="w-full"
              />
            </FilterField>
          )}

          <FilterField label="Activity">
            <FilterSelect
              param="active"
              placeholder="Any activity"
              ariaLabel="Filter by recent activity"
              options={ACTIVITY_WINDOW_OPTIONS}
              className="w-full"
            />
          </FilterField>

          <FilterField label="Deals" span="full">
            <div className="grid grid-cols-2 gap-2">
              <FilterToggleChip param="hasOpen" label="Has open deals" icon={<Briefcase />} className="w-full justify-center" />
              <FilterToggleChip param="noDeals" label="No deals" icon={<CircleSlash />} className="w-full justify-center" />
            </div>
          </FilterField>
        </FilterPopover>
      </div>

      <FilterChips chips={chips} />
    </div>
  );
}
