"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "GENERATA", label: "Generated" },
  { value: "TRIMISA_LA_CONTABILITATE", label: "Sent to accounting" },
  { value: "IN_ASTEPTARE", label: "Pending" },
  { value: "OTHER", label: "Other" },
];

const DATE_FIELD_OPTIONS = [
  { value: "", label: "All dates" },
  { value: "expected", label: "By expected date" },
  { value: "issued", label: "By issue date" },
];

/** First/last day (yyyy-mm-dd) of a yyyy-mm month string. */
function monthBounds(m: string): { from: string; to: string } {
  const [y, mo] = m.split("-").map(Number);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { from: `${m}-01`, to: `${m}-${String(last).padStart(2, "0")}` };
}

/** If from/to span exactly one whole month, return that yyyy-mm; else "". */
function deriveMonth(from: string, to: string): string {
  if (!from || !to) return "";
  const m = from.slice(0, 7);
  const b = monthBounds(m);
  return b.from === from && b.to === to ? m : "";
}

/** Human-readable label for a yyyy-mm month string, e.g. "June 2026". */
function monthLabel(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Quick range presets relative to today (local time). */
function datePresets(): { label: string; from: string; to: string }[] {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-based
  const thisMonth = monthBounds(`${y}-${pad(m + 1)}`);
  const lastDate = new Date(y, m - 1, 1);
  const last = monthBounds(`${lastDate.getFullYear()}-${pad(lastDate.getMonth() + 1)}`);
  const nextDate = new Date(y, m + 1, 1);
  const next = monthBounds(`${nextDate.getFullYear()}-${pad(nextDate.getMonth() + 1)}`);
  return [
    { label: "This month", ...thisMonth },
    { label: "Last month", ...last },
    { label: "Next month", ...next },
    { label: "This year", from: `${y}-01-01`, to: `${y}-12-31` },
  ];
}

export function InvoiceTabs({
  tab,
  toInvoiceCount,
  invoicedCount,
}: {
  tab: "to_invoice" | "invoiced";
  toInvoiceCount: number;
  invoicedCount: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function go(next: string) {
    const sp = new URLSearchParams(Array.from(params.entries()));
    sp.set("tab", next);
    // Reset paging and any column sort so each tab opens on its smart default.
    sp.delete("page");
    sp.delete("sort");
    sp.delete("dir");
    router.replace(`${pathname}?${sp.toString()}`);
  }

  const tabs = [
    { value: "to_invoice", label: "To invoice", count: toInvoiceCount },
    { value: "invoiced", label: "Invoiced", count: invoicedCount },
  ];

  return (
    <div className="inline-flex rounded-lg border bg-card p-1">
      {tabs.map((t) => {
        const active = tab === t.value;
        return (
          <button
            key={t.value}
            type="button"
            onClick={() => go(t.value)}
            className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
            <span
              className={`rounded-full px-1.5 text-xs ${
                active ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground"
              }`}
            >
              {t.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function InvoiceFilters({
  currencies,
  issuers = [],
  appliedOrgName,
  tab,
}: {
  currencies: string[];
  issuers?: string[];
  appliedOrgName?: string | null;
  tab?: "to_invoice" | "invoiced";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  function setParam(key: string, value: string) {
    setParams({ [key]: value });
  }

  function setParams(entries: Record<string, string>) {
    const sp = new URLSearchParams(Array.from(params.entries()));
    for (const [key, value] of Object.entries(entries)) {
      if (value) sp.set(key, value);
      else sp.delete(key);
    }
    sp.delete("page");
    startTransition(() => router.replace(`${pathname}?${sp.toString()}`));
  }

  const selectClass = "h-8 w-full rounded-md border border-input bg-background px-2 text-sm";
  const inputClass = "h-8 rounded-md border border-input bg-background px-2 text-sm";

  const orgApplied = params.get("organization");
  const status = params.get("status") ?? "";
  const currency = params.get("currency") ?? "";
  const issuer = params.get("issuer") ?? "";
  const dateField = params.get("dateField") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const month = deriveMonth(from, to);
  const noDates = params.get("noDates") === "1";

  const datePrefix = dateField === "issued" ? "Issued" : dateField === "expected" ? "Expected" : "Date";
  const dateValueLabel = month ? monthLabel(month) : `${from || "…"} – ${to || "…"}`;

  // Removable chips for everything applied via the modal, so it's always clear what's filtering.
  type Chip = { key: string; label: string; onRemove: () => void };
  const chips: Chip[] = [];
  if (currency) chips.push({ key: "currency", label: `Currency: ${currency}`, onRemove: () => setParam("currency", "") });
  if (issuer) chips.push({ key: "issuer", label: `Issuer: ${issuer}`, onRemove: () => setParam("issuer", "") });
  if (noDates) chips.push({ key: "noDates", label: "No date set", onRemove: () => setParam("noDates", "") });
  else if (from || to) {
    chips.push({
      key: "date",
      label: `${datePrefix}: ${dateValueLabel}`,
      onRemove: () => setParams({ from: "", to: "", dateField: "" }),
    });
  }

  const advancedCount = chips.length;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {orgApplied && (
        <span className="inline-flex h-8 items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 text-sm text-primary">
          <span className="text-muted-foreground">Organization:</span>
          <span className="font-medium">{appliedOrgName ?? orgApplied}</span>
          <button
            type="button"
            aria-label="Remove organization filter"
            className="-mr-1 rounded p-0.5 hover:bg-primary/20"
            onClick={() => setParam("organization", "")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      )}

      <select
        className="h-8 rounded-md border border-input bg-background px-2 text-sm"
        value={status}
        title="Status"
        onChange={(e) => setParam("status", e.target.value)}
      >
        {STATUS_OPTIONS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>

      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <SlidersHorizontal className="h-3.5 w-3.5" />
        Filters
        {advancedCount > 0 && (
          <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
            {advancedCount}
          </span>
        )}
      </Button>

      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-muted/40 px-2.5 text-sm"
        >
          {chip.label}
          <button
            type="button"
            aria-label={`Remove ${chip.label} filter`}
            className="-mr-1 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={chip.onRemove}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      ))}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Filters</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {currencies.length > 0 && (
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <select className={selectClass} value={currency} onChange={(e) => setParam("currency", e.target.value)}>
                  <option value="">All currencies</option>
                  {currencies.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {issuers.length > 0 && (
              <div className="space-y-1.5">
                <Label>Issuer</Label>
                <select className={selectClass} value={issuer} onChange={(e) => setParam("issuer", e.target.value)}>
                  <option value="">All issuers</option>
                  {issuers.map((i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-2 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <Label>Date range</Label>
                {tab !== "invoiced" && (
                  <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                    <input
                      type="checkbox"
                      className="h-4 w-4 cursor-pointer"
                      checked={noDates}
                      onChange={(e) => setParam("noDates", e.target.checked ? "1" : "")}
                    />
                    No date set
                  </label>
                )}
              </div>

              <div className="space-y-1.5">
                <span className="text-xs text-muted-foreground">Apply to</span>
                <select
                  className={`${selectClass} disabled:opacity-50`}
                  value={dateField}
                  disabled={noDates}
                  onChange={(e) => setParam("dateField", e.target.value)}
                >
                  {DATE_FIELD_OPTIONS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <span className="text-xs text-muted-foreground">Whole month</span>
                <input
                  type="month"
                  className={`${inputClass} w-full disabled:opacity-50`}
                  value={month}
                  disabled={noDates}
                  onChange={(e) => {
                    if (!e.target.value) setParams({ from: "", to: "" });
                    else {
                      const b = monthBounds(e.target.value);
                      setParams({ from: b.from, to: b.to });
                    }
                  }}
                />
              </div>

              <div className="space-y-1.5">
                <span className="text-xs text-muted-foreground">Custom range</span>
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <input type="date" className={`${inputClass} w-full disabled:opacity-50`} value={from} title="From" disabled={noDates} onChange={(e) => setParam("from", e.target.value)} />
                  <span>–</span>
                  <input type="date" className={`${inputClass} w-full disabled:opacity-50`} value={to} title="To" disabled={noDates} onChange={(e) => setParam("to", e.target.value)} />
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {datePresets().map((p) => {
                  const active = !noDates && from === p.from && to === p.to;
                  return (
                    <button
                      key={p.label}
                      type="button"
                      disabled={noDates}
                      className={`inline-flex h-8 items-center rounded-md border px-2.5 text-sm disabled:opacity-50 ${
                        active ? "border-primary/40 bg-primary/10 text-primary" : "border-input text-muted-foreground hover:bg-muted"
                      }`}
                      onClick={() => setParams({ from: p.from, to: p.to })}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <DialogFooter className="sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={advancedCount === 0}
              onClick={() => setParams({ currency: "", issuer: "", dateField: "", from: "", to: "", noDates: "" })}
            >
              Clear all
            </Button>
            <Button type="button" size="sm" onClick={() => setOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
