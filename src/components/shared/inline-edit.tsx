"use client";

// Small, reusable click-to-edit primitives used across the Deals / Clients /
// Tasks list pages. Each commits a single field via a server action passed in
// as `onSave`. They centralise the shared UX: Enter commits, Escape cancels,
// blur commits, a spinner shows while saving, errors raise a toast and revert,
// success triggers router.refresh().

import * as React from "react";
import { useRouter } from "next/navigation";
import * as Popover from "@radix-ui/react-popover";
import { Check, Loader2, Search } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { TagBadge, type TagView } from "@/components/shared/tag-badge";
import { ClientCombobox, type ComboOption } from "@/components/shared/client-combobox";
import { cn } from "@/lib/utils";

export type SaveResult = { ok?: boolean; error?: string };

const triggerCls =
  "inline-flex min-h-7 w-full cursor-text items-center rounded px-1.5 py-0.5 text-left text-sm transition-colors hover:bg-accent/60 hover:ring-1 hover:ring-border";

/** Click-to-edit text / number / date cell. */
export function InlineInput({
  value,
  type = "text",
  onSave,
  display,
  placeholder = "—",
  align = "left",
  inputClassName,
  triggerClassName,
  refreshOnSave = true,
}: {
  value: string;
  type?: "text" | "number" | "date";
  onSave: (next: string) => Promise<SaveResult>;
  display?: React.ReactNode;
  placeholder?: string;
  align?: "left" | "right";
  inputClassName?: string;
  triggerClassName?: string;
  // Refresh the server component after a successful save (default). Views that
  // manage their own optimistic state (e.g. the paginated deals board/table)
  // pass `false` so a refresh doesn't discard their loaded pages.
  refreshOnSave?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const committedRef = React.useRef(false);

  React.useEffect(() => setDraft(value), [value]);
  React.useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  async function commit() {
    if (busy || committedRef.current) return;
    committedRef.current = true;
    if (draft === value) {
      setEditing(false);
      committedRef.current = false;
      return;
    }
    setBusy(true);
    const res = await onSave(draft);
    setBusy(false);
    committedRef.current = false;
    if (res.error) {
      toast({ title: res.error, variant: "error" });
      setDraft(value);
      setEditing(false);
      return;
    }
    setEditing(false);
    if (refreshOnSave) router.refresh();
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        title="Click to edit"
        className={cn(triggerCls, align === "right" && "justify-end text-right", triggerClassName)}
      >
        {/* Long, unbroken values (e.g. URLs) must truncate rather than overflow
            the cell — min-w-0 lets the flex child shrink so `truncate` applies. */}
        <span className="min-w-0 truncate">
          {display ?? (value ? value : <span className="text-muted-foreground">{placeholder}</span>)}
        </span>
      </button>
    );
  }

  return (
    <span className="relative inline-flex w-full items-center">
      <input
        ref={inputRef}
        type={type}
        value={draft}
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            committedRef.current = true;
            setDraft(value);
            setEditing(false);
            committedRef.current = false;
          }
        }}
        className={cn(
          "form-control h-7 w-full px-1.5 disabled:opacity-60",
          align === "right" && "text-right",
          inputClassName
        )}
      />
      {busy && <Loader2 className="pointer-events-none absolute right-1 h-3.5 w-3.5 animate-spin text-muted-foreground" />}
    </span>
  );
}

/** Click-to-edit multi-line text. Commits on blur / Cmd+Enter, cancels on Esc. */
export function InlineTextarea({
  value,
  onSave,
  placeholder = "—",
  triggerClassName,
}: {
  value: string;
  onSave: (next: string) => Promise<SaveResult>;
  placeholder?: string;
  triggerClassName?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const committedRef = React.useRef(false);

  React.useEffect(() => setDraft(value), [value]);
  React.useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  async function commit() {
    if (busy || committedRef.current) return;
    committedRef.current = true;
    if (draft === value) {
      setEditing(false);
      committedRef.current = false;
      return;
    }
    setBusy(true);
    const res = await onSave(draft);
    setBusy(false);
    committedRef.current = false;
    if (res.error) {
      toast({ title: res.error, variant: "error" });
      setDraft(value);
      setEditing(false);
      return;
    }
    setEditing(false);
    router.refresh();
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        title="Click to edit"
        className={cn(
          "block w-full whitespace-pre-wrap rounded px-1.5 py-1 text-left text-sm transition-colors hover:bg-accent/60 hover:ring-1 hover:ring-border",
          triggerClassName
        )}
      >
        {value ? value : <span className="text-muted-foreground">{placeholder}</span>}
      </button>
    );
  }

  return (
    <div className="relative">
      <textarea
        ref={ref}
        value={draft}
        disabled={busy}
        rows={4}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            committedRef.current = true;
            setDraft(value);
            setEditing(false);
            committedRef.current = false;
          }
        }}
        className="form-control w-full px-2 py-1.5 disabled:opacity-60"
      />
      {busy && <Loader2 className="pointer-events-none absolute right-2 top-2 h-3.5 w-3.5 animate-spin text-muted-foreground" />}
    </div>
  );
}

/** Inline native select that commits immediately on change. */
export function InlineSelect({
  value,
  options,
  onSave,
  placeholder,
  className,
  refreshOnSave = true,
}: {
  value: string;
  options: { value: string; label: string }[];
  onSave: (next: string) => Promise<SaveResult>;
  placeholder?: string;
  className?: string;
  // See InlineInput — pass `false` when the caller owns optimistic state.
  refreshOnSave?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);

  async function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    if (next === value) return;
    setBusy(true);
    const res = await onSave(next);
    setBusy(false);
    if (res.error) return toast({ title: res.error, variant: "error" });
    if (refreshOnSave) router.refresh();
  }

  return (
    <span className="relative inline-flex items-center">
      <select
        value={value}
        disabled={busy}
        onChange={onChange}
        className={cn(
          "form-control h-7 max-w-[11rem] px-1.5 transition-colors hover:bg-accent/60 disabled:opacity-60",
          className
        )}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {busy && <Loader2 className="pointer-events-none ml-1 h-3.5 w-3.5 animate-spin text-muted-foreground" />}
    </span>
  );
}

/** Inline searchable combobox that commits immediately on selection. */
export function InlineCombobox({
  value,
  options,
  onSave,
  onCreate,
  createLabel,
  placeholder,
  align = "end",
}: {
  value: string;
  options: ComboOption[];
  onSave: (next: string) => Promise<SaveResult>;
  // When provided, the combobox can create a new entry from the typed text and
  // commit it in one step (create + select). Return the create result.
  onCreate?: (name: string) => Promise<SaveResult>;
  createLabel?: string;
  placeholder?: string;
  align?: "start" | "end" | "center";
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);

  async function onChange(next: string) {
    if (next === value) return;
    setBusy(true);
    const res = await onSave(next);
    setBusy(false);
    if (res.error) return toast({ title: res.error, variant: "error" });
    router.refresh();
  }

  async function create(name: string) {
    setBusy(true);
    const res = await onCreate!(name);
    setBusy(false);
    if (res.error) return toast({ title: res.error, variant: "error" });
    router.refresh();
  }

  return (
    <ClientCombobox
      value={value}
      options={options}
      onChange={onChange}
      onCreate={onCreate ? create : undefined}
      createLabel={createLabel}
      busy={busy}
      placeholder={placeholder ?? "—"}
      align={align}
      triggerClassName="h-7 max-w-[11rem] px-1.5"
      matchTriggerWidth={false}
    />
  );
}

/**
 * Compact multi-select tag editor in a searchable popover; commits on every
 * toggle. Type to filter tags fast — the popover stays open so several tags can
 * be toggled in a row. No inline creation (tags are managed elsewhere).
 */
export function InlineTagEditor({
  allTags,
  value,
  onSave,
  refreshOnSave = true,
}: {
  allTags: TagView[];
  value: string[];
  onSave: (ids: string[]) => Promise<SaveResult>;
  // See InlineInput — pass `false` when the caller owns optimistic state.
  refreshOnSave?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [selected, setSelected] = React.useState<string[]>(value);
  const [busy, setBusy] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  React.useEffect(() => setSelected(value), [value]);

  async function toggle(id: string) {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    const prev = selected;
    setSelected(next);
    setBusy(true);
    const res = await onSave(next);
    setBusy(false);
    if (res.error) {
      toast({ title: res.error, variant: "error" });
      setSelected(prev);
      return;
    }
    if (refreshOnSave) router.refresh();
  }

  const chosen = allTags.filter((t) => selected.includes(t.id));
  const q = query.trim().toLowerCase();
  const filtered = q ? allTags.filter((t) => t.name.toLowerCase().includes(q)) : allTags;

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
          title="Edit tags"
          className="flex min-h-7 w-full flex-wrap items-center gap-1 rounded px-1.5 py-0.5 text-left transition-colors hover:bg-accent/60 hover:ring-1 hover:ring-border"
        >
          {chosen.length ? (
            chosen.map((t) => <TagBadge key={t.id} tag={t} />)
          ) : (
            <span className="text-xs text-muted-foreground">+ Tag</span>
          )}
          {busy && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-50 w-56 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex items-center gap-2 border-b px-2.5">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tags…"
              className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            {filtered.map((t) => {
              const on = selected.includes(t.id);
              return (
                <button
                  type="button"
                  key={t.id}
                  onClick={() => toggle(t.id)}
                  className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent focus:bg-accent"
                >
                  <span className="flex items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
                    <span className="truncate">{t.name}</span>
                  </span>
                  {on && <Check className="h-4 w-4 shrink-0 text-primary" />}
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="px-2 py-3 text-center text-sm text-muted-foreground">
                {allTags.length === 0 ? "No tags configured." : "No tags found."}
              </div>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
