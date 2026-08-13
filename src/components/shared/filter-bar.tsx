"use client";

// Reusable, theme-aware, URL-param-driven filter controls shared by the
// Clients / Deals / Tasks list pages. Every control merges into the existing
// `searchParams` (never clobbering search/sort/view) via `router.replace`,
// mirroring the canonical `search-input.tsx` pattern.

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { Check, ChevronDown, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Option } from "@/lib/filter-helpers";
import { parseCsvIds } from "@/lib/filter-helpers";
import { cn } from "@/lib/utils";

const selectCls = "form-control h-9 cursor-pointer rounded-full px-3.5";

/** Merge-and-replace hook: updates only the given keys, preserving everything else. */
export function useFilterUrl() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const setParams = useCallback(
    (updates: Record<string, string | null | undefined>) => {
      const sp = new URLSearchParams(Array.from(params.entries()));
      if (!Object.prototype.hasOwnProperty.call(updates, "page")) sp.delete("page");
      for (const [key, value] of Object.entries(updates)) {
        if (value == null || value === "") sp.delete(key);
        else sp.set(key, value);
      }
      const qs = sp.toString();
      startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname));
    },
    [params, pathname, router]
  );

  return { params, setParams, pending };
}

/** Layout container for a row of filter controls. */
export function FilterBar({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("flex flex-wrap items-center gap-2", className)}>{children}</div>;
}

/** Single-value native select bound to one query param. */
export function FilterSelect({
  param,
  options,
  placeholder,
  ariaLabel,
  className,
}: {
  param: string;
  options: Option[];
  placeholder: string;
  ariaLabel?: string;
  className?: string;
}) {
  const { params, setParams } = useFilterUrl();
  const current = params.get(param) ?? "";
  const active = current !== "";
  return (
    <select
      aria-label={ariaLabel ?? placeholder}
      value={current}
      onChange={(e) => setParams({ [param]: e.target.value || null })}
      className={cn(selectCls, active && "border-foreground/25 bg-accent", className)}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Chip-style boolean toggle (param present === active). */
export function FilterToggleChip({
  param,
  label,
  icon,
  value = "1",
  className,
}: {
  param: string;
  label: string;
  icon?: React.ReactNode;
  value?: string;
  className?: string;
}) {
  const { params, setParams } = useFilterUrl();
  const active = params.get(param) === value;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => setParams({ [param]: active ? null : value })}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-sm font-medium transition-colors [&_svg]:size-4",
        active
          ? "border-primary/25 bg-primary/10 text-primary"
          : "border-input bg-background/70 text-foreground hover:bg-accent/60",
        className
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/** Two number inputs (min / max) committed on blur or Enter. */
export function FilterNumberRange({
  minParam,
  maxParam,
  minPlaceholder = "Min",
  maxPlaceholder = "Max",
  step,
}: {
  minParam: string;
  maxParam: string;
  minPlaceholder?: string;
  maxPlaceholder?: string;
  step?: number;
}) {
  const { params, setParams } = useFilterUrl();
  const [min, setMin] = useState(params.get(minParam) ?? "");
  const [max, setMax] = useState(params.get(maxParam) ?? "");
  const active = !!params.get(minParam) || !!params.get(maxParam);

  const commit = () => setParams({ [minParam]: min || null, [maxParam]: max || null });

  const inputCls = cn(
    "form-control h-9 w-24 rounded-full px-2.5",
    active && "border-primary/25 bg-primary/8"
  );

  return (
    <div className="inline-flex items-center gap-1">
      <input
        type="number"
        inputMode="decimal"
        step={step}
        value={min}
        placeholder={minPlaceholder}
        onChange={(e) => setMin(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        className={inputCls}
      />
      <span className="text-xs text-muted-foreground">–</span>
      <input
        type="number"
        inputMode="decimal"
        step={step}
        value={max}
        placeholder={maxPlaceholder}
        onChange={(e) => setMax(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        className={inputCls}
      />
    </div>
  );
}

/** Two date inputs (from / to) committed immediately. */
export function FilterDateRange({
  fromParam,
  toParam,
}: {
  fromParam: string;
  toParam: string;
}) {
  const { params, setParams } = useFilterUrl();
  const from = params.get(fromParam) ?? "";
  const to = params.get(toParam) ?? "";
  const inputCls = cn(
    "form-control h-9 rounded-full px-2.5",
    (from || to) && "border-primary/25 bg-primary/8"
  );
  return (
    <div className="inline-flex items-center gap-1">
      <input
        type="date"
        aria-label="Due from"
        value={from}
        onChange={(e) => setParams({ [fromParam]: e.target.value || null })}
        className={inputCls}
      />
      <span className="text-xs text-muted-foreground">–</span>
      <input
        type="date"
        aria-label="Due to"
        value={to}
        onChange={(e) => setParams({ [toParam]: e.target.value || null })}
        className={inputCls}
      />
    </div>
  );
}

/** Multi-select tag popover storing a comma-separated id list in one param. */
export function FilterTagMulti({
  tags,
  param = "tag",
  label = "Tags",
  className,
}: {
  tags: { id: string; name: string; color: string }[];
  param?: string;
  label?: string;
  className?: string;
}) {
  const { params, setParams } = useFilterUrl();
  const selected = parseCsvIds(params.get(param));
  const selectedSet = new Set(selected);

  function toggle(id: string) {
    const next = selectedSet.has(id)
      ? selected.filter((x) => x !== id)
      : [...selected, id];
    setParams({ [param]: next.length ? next.join(",") : null });
  }

  const count = selected.length;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-sm font-medium transition-colors",
            count
              ? "border-primary/25 bg-primary/10 text-primary"
              : "border-input bg-background/70 text-foreground hover:bg-accent/60",
            className
          )}
        >
          {label}
          {count > 0 && (
            <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground">{count}</span>
          )}
          <ChevronDown className="h-4 w-4 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-y-auto p-1">
        {tags.length === 0 && (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">No tags</div>
        )}
        {tags.map((t) => {
          const on = selectedSet.has(t.id);
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => toggle(t.id)}
              className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent"
            >
              <span className="flex h-4 w-4 items-center justify-center">
                {on && <Check className="h-4 w-4 text-primary" />}
              </span>
              <span
                className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                style={{ backgroundColor: `${t.color}18`, color: t.color }}
              >
                {t.name}
              </span>
            </button>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * "Clear filters" affordance — only rendered when at least one of `keys` is set.
 * Shows the active-filter count for at-a-glance feedback.
 */
export function ClearFiltersButton({ keys }: { keys: string[] }) {
  const { params, setParams } = useFilterUrl();
  const activeCount = keys.filter((k) => params.get(k)).length;
  if (activeCount === 0) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => setParams(Object.fromEntries(keys.map((k) => [k, null])))}
      className="text-muted-foreground"
    >
      <X className="h-4 w-4" /> Clear filters ({activeCount})
    </Button>
  );
}

/**
 * Labeled field wrapper for controls placed inside a FilterPopover. Sits in one
 * grid cell by default; pass `span="full"` to stretch across both columns
 * (used for tall/wide blocks like date ranges).
 */
export function FilterField({
  label,
  hint,
  children,
  span,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  span?: "full";
}) {
  return (
    <div className={cn("space-y-1.5", span === "full" && "sm:col-span-2")}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {hint && <span className="text-[11px] text-muted-foreground/70">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/**
 * Single "Filters" entry point: one button (with an active-count badge) that
 * opens a popover holding every secondary filter. Keeps the toolbar to one line
 * and surfaces all options behind a single, obvious click.
 */
export function FilterPopover({
  activeCount,
  children,
  label = "Filters",
  onClear,
  align = "end",
  className,
  columns = 2,
}: {
  activeCount: number;
  children: React.ReactNode;
  label?: string;
  onClear?: () => void;
  align?: "start" | "center" | "end";
  className?: string;
  columns?: 1 | 2;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-sm font-medium transition-colors [&_svg]:size-4",
            activeCount > 0
              ? "border-primary/25 bg-primary/10 text-primary"
              : "border-input bg-background/70 text-foreground hover:bg-accent/60",
            className
          )}
        >
          <SlidersHorizontal />
          {label}
          {activeCount > 0 && (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {activeCount}
            </span>
          )}
          <ChevronDown className="opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        className={cn(
          "w-[min(100%,20rem)] max-w-[calc(100vw-1.5rem)]",
          columns === 2 && "sm:w-[min(100%,34rem)]"
        )}
      >
        <div className="flex items-center justify-between pb-2">
          <span className="text-sm font-semibold">{label}</span>
          {onClear && activeCount > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Clear all
            </button>
          )}
        </div>
        <div
          className={cn(
            "grid max-h-[70vh] gap-x-4 gap-y-3 overflow-y-auto",
            columns === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1"
          )}
        >
          {children}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export type FilterChip = { key: string; label: string; onRemove: () => void };

/** Removable chips summarizing the currently-applied filters. */
export function FilterChips({ chips }: { chips: FilterChip[] }) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex h-7 items-center gap-1.5 rounded-full border border-input bg-muted/50 pl-2.5 pr-1 text-xs font-medium"
        >
          {chip.label}
          <button
            type="button"
            aria-label={`Remove ${chip.label} filter`}
            onClick={chip.onRemove}
            className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  );
}
