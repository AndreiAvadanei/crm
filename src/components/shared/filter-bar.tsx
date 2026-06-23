"use client";

// Reusable, theme-aware, URL-param-driven filter controls shared by the
// Clients / Deals / Tasks list pages. Every control merges into the existing
// `searchParams` (never clobbering search/sort/view) via `router.replace`,
// mirroring the canonical `search-input.tsx` pattern.

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Option } from "@/lib/filter-helpers";
import { parseCsvIds } from "@/lib/filter-helpers";
import { cn } from "@/lib/utils";

const selectCls = "form-control h-9 cursor-pointer px-3";

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
}: {
  param: string;
  options: Option[];
  placeholder: string;
  ariaLabel?: string;
}) {
  const { params, setParams } = useFilterUrl();
  const current = params.get(param) ?? "";
  const active = current !== "";
  return (
    <select
      aria-label={ariaLabel ?? placeholder}
      value={current}
      onChange={(e) => setParams({ [param]: e.target.value || null })}
      className={cn(selectCls, active && "border-foreground/25 bg-accent")}
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
}: {
  param: string;
  label: string;
  icon?: React.ReactNode;
  value?: string;
}) {
  const { params, setParams } = useFilterUrl();
  const active = params.get(param) === value;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => setParams({ [param]: active ? null : value })}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-md border px-3 text-sm font-medium transition-colors [&_svg]:size-4",
        active
          ? "border-foreground/25 bg-accent text-foreground"
          : "border-input bg-background text-foreground hover:bg-accent/60"
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
    "form-control h-9 w-24 px-2.5",
    active && "border-foreground/25 bg-accent"
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
    "form-control h-9 px-2.5",
    (from || to) && "border-foreground/25 bg-accent"
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
}: {
  tags: { id: string; name: string; color: string }[];
  param?: string;
  label?: string;
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
            "inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-md border px-3 text-sm font-medium transition-colors",
            count
              ? "border-foreground/25 bg-accent text-foreground"
              : "border-input bg-background text-foreground hover:bg-accent/60"
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
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent"
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
