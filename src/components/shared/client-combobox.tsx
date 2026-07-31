"use client";

// Searchable single-select combobox for picking a client. Built on Radix
// Popover so it can be used inside dialogs and inline cells. Presentational
// only: callers own the value and react to onChange.

import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronsUpDown, Loader2, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export type ComboOption = { value: string; label: string; searchText?: string };

export function ClientCombobox({
  value,
  options,
  onChange,
  placeholder = "No client",
  searchPlaceholder = "Search clients…",
  emptyText = "No clients found.",
  disabled,
  busy,
  align = "start",
  triggerClassName,
  contentClassName,
  matchTriggerWidth = true,
  wrapLabels = false,
  onCreate,
  createLabel = "Create",
}: {
  value: string;
  options: ComboOption[];
  onChange: (next: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  busy?: boolean;
  align?: "start" | "end" | "center";
  triggerClassName?: string;
  contentClassName?: string;
  matchTriggerWidth?: boolean;
  // When true, option labels wrap to show the full text instead of truncating.
  wrapLabels?: boolean;
  // When provided, an extra row lets the user create a new entry from the typed
  // text if it doesn't match an existing option (e.g. add a new client on the fly).
  onCreate?: (name: string) => void | Promise<void>;
  // Verb shown on the create row, e.g. `Create "Acme"`.
  createLabel?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [creating, setCreating] = React.useState(false);

  const selected = options.find((o) => o.value === value);
  const trimmedQuery = query.trim();
  const filtered = React.useMemo(() => {
    const q = trimmedQuery.toLowerCase();
    if (!q) return options;
    return options.filter((o) => [o.label, o.value, o.searchText].filter(Boolean).join(" ").toLowerCase().includes(q));
  }, [options, trimmedQuery]);

  // Offer to create only when there's a query with no exact (case-insensitive) match.
  const showCreate =
    !!onCreate && trimmedQuery.length > 0 && !options.some((o) => o.label.toLowerCase() === trimmedQuery.toLowerCase());

  function select(next: string) {
    setOpen(false);
    setQuery("");
    if (next !== value) onChange(next);
  }

  async function create() {
    if (!onCreate || creating) return;
    setCreating(true);
    try {
      await onCreate(trimmedQuery);
      setOpen(false);
      setQuery("");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled || busy}
          className={cn(
            "form-control flex h-9 w-full items-center justify-between gap-2 px-3 text-left transition-colors hover:bg-accent/60 disabled:cursor-not-allowed disabled:opacity-70",
            triggerClassName
          )}
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected ? selected.label : placeholder}
          </span>
          {busy ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin opacity-60" />
          ) : (
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align={align}
          sideOffset={4}
          className={cn(
            "z-50 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            matchTriggerWidth && "w-[var(--radix-popover-trigger-width)]",
            "min-w-[14rem]",
            contentClassName
          )}
          onOpenAutoFocus={(e) => {
            // Keep focus management to the search input below.
            e.preventDefault();
          }}
        >
          <div className="flex items-center gap-2 border-b px-2.5">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            <Item label={placeholder} muted selected={!value} onSelect={() => select("")} wrap={wrapLabels} />
            {filtered.map((o) => (
              <Item
                key={o.value}
                label={o.label}
                selected={o.value === value}
                onSelect={() => select(o.value)}
                wrap={wrapLabels}
              />
            ))}
            {filtered.length === 0 && !showCreate && (
              <div className="px-2 py-3 text-center text-sm text-muted-foreground">{emptyText}</div>
            )}
            {showCreate && (
              <button
                type="button"
                onClick={create}
                disabled={creating}
                className="mt-1 flex w-full cursor-pointer items-center gap-2 rounded-sm border-t px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent focus:bg-accent disabled:cursor-not-allowed disabled:opacity-70"
              >
                {creating ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin opacity-70" />
                ) : (
                  <Plus className="h-4 w-4 shrink-0 opacity-70" />
                )}
                <span className={cn(wrapLabels ? "break-words" : "truncate")}>
                  {createLabel} “{trimmedQuery}”
                </span>
              </button>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Item({
  label,
  selected,
  muted,
  onSelect,
  wrap,
}: {
  label: string;
  selected: boolean;
  muted?: boolean;
  onSelect: () => void;
  wrap?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent focus:bg-accent",
        muted && !selected && "text-muted-foreground"
      )}
    >
      <span className={cn(wrap ? "break-words" : "truncate")}>{label}</span>
      {selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
    </button>
  );
}
