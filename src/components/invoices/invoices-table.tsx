"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, Check, ChevronsUpDown, Copy, Download, ExternalLink, Loader2, Mail, Pencil, Sparkles, X } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { DeleteButton } from "@/components/shared/delete-button";
import { ClientCombobox } from "@/components/shared/client-combobox";
import { GenerateInvoiceDialog } from "@/components/invoices/generate-invoice-dialog";
import { DuplicateInvoiceButton } from "@/components/invoices/duplicate-invoice-button";
import { saveXmlFile } from "@/components/invoices/saga-xml-button";
import type { PartNumberOption } from "@/lib/part-numbers";
import { personalizationBlockMessage } from "@/lib/invoice-issue-guard";
import {
  deleteInvoiceAction,
  setInvoiceDealAction,
  setInvoiceExpectedDateAction,
  setInvoiceFinalClientAction,
  setInvoiceNeedsPersonalizationAction,
  setInvoicePaidAction,
  setInvoiceTextFieldAction,
} from "@/server/invoice-actions";
import { quickCreateFinalClientAction } from "@/server/final-client-actions";
import { bulkDownloadInvoicesSagaXmlAction, bulkSendInvoicesEmailAction } from "@/server/saga-actions";
import type { InvoiceRow } from "@/lib/invoice-stats";
import { INVOICE_STATUS_LABELS, invoiceStatusVariant } from "@/lib/invoice-constants";
import { formatDate } from "@/lib/utils";

/** Clickable column header that cycles asc -> desc -> default via URL params. */
function SortHeader({
  label,
  sortKey,
  align = "left",
}: {
  label: string;
  sortKey: string;
  align?: "left" | "right" | "center";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get("sort");
  const dir = params.get("dir") === "asc" ? "asc" : "desc";
  const active = current === sortKey;

  function toggle() {
    const sp = new URLSearchParams(Array.from(params.entries()));
    if (!active) {
      sp.set("sort", sortKey);
      sp.set("dir", "asc");
    } else if (dir === "asc") {
      sp.set("sort", sortKey);
      sp.set("dir", "desc");
    } else {
      sp.delete("sort");
      sp.delete("dir");
    }
    sp.delete("page");
    router.replace(`${pathname}?${sp.toString()}`);
  }

  const justify = align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start";
  return (
    <TableHead className={align === "right" ? "text-right" : align === "center" ? "text-center" : undefined}>
      <button
        type="button"
        onClick={toggle}
        className={`inline-flex w-full items-center gap-1 ${justify} hover:text-foreground ${active ? "text-foreground" : ""}`}
      >
        {label}
        {active ? (
          dir === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" />
        )}
      </button>
    </TableHead>
  );
}

/** Small icon button that copies a value to the clipboard (revealed on row hover). */
function CopyButton({ value, label }: { value: string | null; label?: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = React.useState(false);
  if (!value) return null;

  async function copy(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value!);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      toast({ title: "Copy failed", variant: "error" });
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={`Copy ${label ?? "value"}`}
      aria-label={`Copy ${label ?? "value"}`}
      className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground focus:opacity-100 group-hover:opacity-100"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-[var(--success)]" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

type DealOption = { salesId: string; title: string };

/** Reference data needed to open the "duplicate to new invoice" form. */
type InvoiceFormOptions = {
  organizations: { id: string; name: string; defaultVatPercent?: number; configuredTvaPercent?: number }[];
  issuers: { id: string; name: string }[];
  series: { id: string; prefix: string; nextNumber: number }[];
  partNumbers: PartNumberOption[];
};

/** Read-only deal link that turns into a searchable picker on click. */
function DealCell({ invoice, canManage, deals }: { invoice: InvoiceRow; canManage: boolean; deals: DealOption[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function save(salesId: string) {
    if ((salesId || "") === (invoice.salesId || "")) {
      setEditing(false);
      return;
    }
    setBusy(true);
    const res = await setInvoiceDealAction(invoice.id, salesId || null);
    setBusy(false);
    setEditing(false);
    if (res.error) return toast({ title: res.error, variant: "error" });
    router.refresh();
  }

  if (canManage && editing) {
    return (
      <div className="w-[15rem]">
        <ClientCombobox
          value={invoice.salesId ?? ""}
          options={deals.map((d) => ({ value: d.salesId, label: `${d.salesId} - ${d.title}` }))}
          onChange={save}
          busy={busy}
          placeholder="No deal"
          searchPlaceholder="Search SAL id or title…"
          emptyText="No deals found."
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 font-mono text-xs">
      {invoice.salesId ? (
        invoice.hasDeal ? (
          <Link href={`/deals/${invoice.salesId}`} className="hover:text-primary">
            {invoice.salesId}
          </Link>
        ) : (
          <span className="text-muted-foreground" title="Deal not found in CRM">
            {invoice.salesId}
          </span>
        )
      ) : (
        <span className="text-muted-foreground">—</span>
      )}
      {canManage && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          title="Change deal"
          aria-label="Change deal"
          className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground focus:opacity-100 group-hover:opacity-100"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

type FinalClientOption = { id: string; name: string };

/** Read-only final-client label that turns into a searchable picker (with inline create) on click. */
function FinalClientCell({
  invoice,
  canManage,
  finalClients,
}: {
  invoice: InvoiceRow;
  canManage: boolean;
  finalClients: FinalClientOption[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  // Locally-created final clients so a freshly-created one is selectable/visible before refresh.
  const [extra, setExtra] = React.useState<FinalClientOption[]>(
    invoice.finalClientId && invoice.finalClientName ? [{ id: invoice.finalClientId, name: invoice.finalClientName }] : []
  );

  const options = [...extra, ...finalClients]
    .filter((c, i, arr) => arr.findIndex((x) => x.id === c.id) === i)
    .map((c) => ({ value: c.id, label: c.name }));

  async function save(finalClientId: string) {
    if ((finalClientId || "") === (invoice.finalClientId || "")) {
      setEditing(false);
      return;
    }
    setBusy(true);
    const res = await setInvoiceFinalClientAction(invoice.id, finalClientId || null);
    setBusy(false);
    setEditing(false);
    if (res.error) return toast({ title: res.error, variant: "error" });
    router.refresh();
  }

  if (canManage && editing) {
    return (
      <div className="w-[15rem]">
        <ClientCombobox
          value={invoice.finalClientId ?? ""}
          options={options}
          onChange={save}
          busy={busy}
          placeholder="No final client"
          searchPlaceholder="Search final clients…"
          emptyText="No final clients found."
          createLabel="Create final client"
          onCreate={async (name) => {
            const res = await quickCreateFinalClientAction(name);
            if (res.error || !res.id) {
              return toast({ title: res.error ?? "Could not create final client.", variant: "error" });
            }
            setExtra((prev) => [{ id: res.id!, name: res.name ?? name }, ...prev]);
            await save(res.id);
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <span className="block max-w-[12rem] truncate text-xs" title={invoice.finalClientName ?? undefined}>
        {invoice.finalClientName || <span className="text-muted-foreground">—</span>}
      </span>
      {canManage && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          title="Change final client"
          aria-label="Change final client"
          className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground focus:opacity-100 group-hover:opacity-100"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/** Inline paid toggle that persists immediately. */
function PaidCell({ invoice, canManage }: { invoice: InvoiceRow; canManage: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [checked, setChecked] = React.useState(invoice.paid);
  const [busy, setBusy] = React.useState(false);

  async function onChange(next: boolean) {
    setChecked(next);
    setBusy(true);
    const res = await setInvoicePaidAction(invoice.id, next);
    setBusy(false);
    if (res.error) {
      setChecked(!next);
      return toast({ title: res.error, variant: "error" });
    }
    router.refresh();
  }

  if (!canManage) {
    return <span className="text-muted-foreground">{invoice.paid ? "Yes" : "—"}</span>;
  }
  return <Checkbox checked={checked} disabled={busy} onCheckedChange={(v) => onChange(v === true)} />;
}

/** Icon toggle flagging an invoice as needing manual monthly personalization. */
function PersonalizationToggle({ invoice }: { invoice: InvoiceRow }) {
  const router = useRouter();
  const { toast } = useToast();
  const [on, setOn] = React.useState(invoice.needsPersonalization);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    setOn(invoice.needsPersonalization);
  }, [invoice.needsPersonalization]);

  async function toggle() {
    const next = !on;
    setOn(next);
    setBusy(true);
    const res = await setInvoiceNeedsPersonalizationAction(invoice.id, next);
    setBusy(false);
    if (res.error) {
      setOn(!next);
      return toast({ title: res.error, variant: "error" });
    }
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={on}
      title={on ? "Marked for monthly personalization — click to unmark" : "Mark as needing monthly personalization"}
      aria-label="Toggle monthly personalization"
      className={`shrink-0 rounded p-1 transition hover:bg-muted ${
        on ? "text-violet-600 dark:text-violet-400" : "text-muted-foreground opacity-0 focus:opacity-100 group-hover:opacity-100"
      }`}
    >
      <Sparkles className="h-4 w-4" />
    </button>
  );
}

function toDateInput(d: Date | null): string {
  return d ? new Date(d).toISOString().slice(0, 10) : "";
}

/** Read-only text that turns into an input on click, persisting on blur/Enter (Esc cancels). */
function InlineTextCell({
  invoice,
  field,
  canManage,
  placeholder,
}: {
  invoice: InvoiceRow;
  field: "contractRef";
  canManage: boolean;
  placeholder?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const initial = invoice.contractRef ?? "";
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(initial);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    setValue(initial);
  }, [initial]);

  async function save() {
    setEditing(false);
    if (value.trim() === initial.trim()) return;
    setBusy(true);
    const res = await setInvoiceTextFieldAction(invoice.id, field, value);
    setBusy(false);
    if (res.error) {
      setValue(initial);
      return toast({ title: res.error, variant: "error" });
    }
    router.refresh();
  }

  if (canManage && editing) {
    return (
      <Input
        autoFocus
        value={value}
        disabled={busy}
        placeholder={placeholder}
        title={value || undefined}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            setValue(initial);
            setEditing(false);
          }
        }}
        className="h-8 w-[14rem] text-xs"
      />
    );
  }
  return (
    <span
      role={canManage ? "button" : undefined}
      tabIndex={canManage ? 0 : undefined}
      onClick={() => canManage && setEditing(true)}
      onKeyDown={(e) => {
        if (canManage && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          setEditing(true);
        }
      }}
      title={initial || undefined}
      className={`block max-w-[14rem] truncate text-xs text-muted-foreground ${
        canManage ? "cursor-text rounded px-1 py-0.5 hover:bg-muted" : ""
      }`}
    >
      {initial || "—"}
    </span>
  );
}

/** Read-only expected-invoice-date that turns into a date picker on click. */
function ExpectedDateCell({ invoice, canManage }: { invoice: InvoiceRow; canManage: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const initial = toDateInput(invoice.expectedInvoiceDate);
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(initial);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    setValue(initial);
  }, [initial]);

  async function save(next: string) {
    setValue(next);
    setEditing(false);
    if (next === initial) return;
    setBusy(true);
    const res = await setInvoiceExpectedDateAction(invoice.id, next || null);
    setBusy(false);
    if (res.error) {
      setValue(initial);
      return toast({ title: res.error, variant: "error" });
    }
    router.refresh();
  }

  if (canManage && editing) {
    return (
      <Input
        autoFocus
        type="date"
        value={value}
        disabled={busy}
        onChange={(e) => save(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setValue(initial);
            setEditing(false);
          }
        }}
        className="h-8 w-[9.5rem] text-xs"
      />
    );
  }
  return (
    <span
      role={canManage ? "button" : undefined}
      tabIndex={canManage ? 0 : undefined}
      onClick={() => canManage && setEditing(true)}
      onKeyDown={(e) => {
        if (canManage && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          setEditing(true);
        }
      }}
      className={`block text-xs text-muted-foreground ${canManage ? "cursor-text rounded px-1 py-0.5 hover:bg-muted" : ""}`}
    >
      {formatDate(invoice.expectedInvoiceDate) || "—"}
    </span>
  );
}

/** Split the newline/comma-separated source document URLs into a clean list. */
function parseUrls(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(/[\r\n,]+/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s));
}

function DocLinks({ urls }: { urls: string[] }) {
  if (urls.length === 0) return <span className="text-muted-foreground">—</span>;
  if (urls.length === 1) {
    return (
      <Button asChild variant="outline" size="sm">
        <a href={urls[0]} target="_blank" rel="noreferrer">
          <ExternalLink className="h-3.5 w-3.5" /> Open
        </a>
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {urls.map((url, i) => (
        <Button key={i} asChild variant="outline" size="sm" title={url}>
          <a href={url} target="_blank" rel="noreferrer">
            <ExternalLink className="h-3.5 w-3.5" /> {i + 1}
          </a>
        </Button>
      ))}
    </div>
  );
}

/** Short label for an issuer legal name (first token), full name kept in tooltip. */
function issuerShort(name: string | null): string {
  if (!name) return "—";
  return name.split(/\s+/)[0];
}

function formatAmount(value: number | null, currency: string | null): string {
  if (value == null) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: (currency || "RON").toUpperCase(), maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency ?? ""}`.trim();
  }
}

function amountTone(value: number | null | undefined): string {
  return value != null && value < 0 ? "text-destructive" : "";
}

function invoiceTotal(i: InvoiceRow): number | null {
  return i.totalAmount ?? i.predictedTotalAmount;
}

type OrgGroup = {
  organizationId: string;
  organizationName: string;
  invoices: InvoiceRow[];
};

function groupInvoicesByOrganization(invoices: InvoiceRow[]): OrgGroup[] {
  const map = new Map<string, OrgGroup>();
  for (const inv of invoices) {
    const group = map.get(inv.organizationId);
    if (group) group.invoices.push(inv);
    else {
      map.set(inv.organizationId, {
        organizationId: inv.organizationId,
        organizationName: inv.organizationName,
        invoices: [inv],
      });
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    a.organizationName.localeCompare(b.organizationName, undefined, { sensitivity: "base" })
  );
}

function sumByCurrency(invoices: InvoiceRow[]): { currency: string; total: number }[] {
  const map = new Map<string, number>();
  for (const i of invoices) {
    const amt = i.totalAmount ?? i.predictedTotalAmount;
    if (amt == null) continue;
    const c = (i.currency || "RON").toUpperCase();
    map.set(c, (map.get(c) ?? 0) + amt);
  }
  return Array.from(map.entries())
    .map(([currency, total]) => ({ currency, total }))
    .sort((a, b) => b.total - a.total);
}

function OrgGroupHeader({ group, colSpan }: { group: OrgGroup; colSpan: number }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const totals = sumByCurrency(group.invoices);
  const filterHref = React.useMemo(() => {
    const sp = new URLSearchParams(Array.from(params.entries()));
    sp.set("organization", group.organizationId);
    sp.delete("page");
    return `${pathname}?${sp.toString()}`;
  }, [pathname, params, group.organizationId]);

  return (
    <TableRow className="bg-muted/40 hover:bg-muted/40">
      <TableCell colSpan={colSpan} className="py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Link href={filterHref} className="truncate font-medium hover:text-primary" title="Filter to this organization">
              {group.organizationName}
            </Link>
            <span className="shrink-0 text-xs text-muted-foreground">
              {group.invoices.length} {group.invoices.length === 1 ? "invoice" : "invoices"}
            </span>
          </div>
          {totals.length > 0 && (
            <div className="flex flex-wrap items-baseline gap-x-3 text-sm tabular-nums">
              {totals.map((t) => (
                <span key={t.currency} className={amountTone(t.total)}>
                  {formatAmount(t.total, t.currency)}
                </span>
              ))}
            </div>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function InvoiceTableRow({
  invoice: i,
  canManage,
  deals,
  finalClients,
  formOptions,
  selected,
  toggleOne,
  hideOrganization,
}: {
  invoice: InvoiceRow;
  canManage: boolean;
  deals: DealOption[];
  finalClients: FinalClientOption[];
  formOptions: InvoiceFormOptions;
  selected: Set<string>;
  toggleOne: (id: string) => void;
  hideOrganization?: boolean;
}) {
  const toIssue = !i.issueDate && !!i.expectedInvoiceDate;
  const isNegative = (() => {
    const t = invoiceTotal(i);
    return t != null && t < 0;
  })();

  return (
    <TableRow
      data-selected={selected.has(i.id) ? "true" : undefined}
      className={`group data-[selected=true]:bg-primary/5 ${
        isNegative
          ? "bg-destructive/10 hover:bg-destructive/15 [&>td:first-child]:border-l-2 [&>td:first-child]:border-l-destructive"
          : i.needsPersonalization
            ? "bg-violet-500/10 hover:bg-violet-500/15 [&>td:first-child]:border-l-2 [&>td:first-child]:border-l-violet-500"
            : toIssue
              ? "bg-amber-500/10 hover:bg-amber-500/15 [&>td:first-child]:border-l-2 [&>td:first-child]:border-l-amber-500"
              : ""
      }`}
    >
      {canManage && (
        <TableCell className="w-px">
          <Checkbox
            checked={selected.has(i.id)}
            onCheckedChange={() => toggleOne(i.id)}
            aria-label={`Select invoice ${i.number ?? i.id}`}
          />
        </TableCell>
      )}
      <TableCell>
        <Link href={`/invoices/${i.id}`} className="font-medium hover:text-primary">
          {i.number || i.externalRef || "(no number)"}
        </Link>
      </TableCell>
      {!hideOrganization && (
        <TableCell className="max-w-[16rem]">
          <div className="flex items-center gap-1">
            <Link
              href={`/organizations?q=${encodeURIComponent(i.organizationName)}`}
              className="truncate hover:text-primary"
              title={`Go to ${i.organizationName}`}
            >
              {i.organizationName}
            </Link>
            <CopyButton value={i.organizationName} label="organization" />
          </div>
        </TableCell>
      )}
      <TableCell>
        <div className="flex items-center gap-1">
          {i.clientId ? (
            <Link href={`/clients/${i.clientId}`} className="hover:text-primary">
              {i.clientName}
            </Link>
          ) : (
            i.clientName || "—"
          )}
          <CopyButton value={i.clientName} label="client name" />
        </div>
      </TableCell>
      <TableCell>
        <FinalClientCell invoice={i} canManage={canManage} finalClients={finalClients} />
      </TableCell>
      <TableCell>
        <DealCell invoice={i} canManage={canManage} deals={deals} />
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant={invoiceStatusVariant(i.status)}>{INVOICE_STATUS_LABELS[i.status]}</Badge>
          {toIssue && (
            <Badge className="border-transparent bg-amber-500/15 text-amber-600 dark:text-amber-400">To issue</Badge>
          )}
          {i.needsPersonalization && (
            <Badge className="gap-1 border-transparent bg-violet-500/15 text-violet-600 dark:text-violet-400">
              <Sparkles className="h-3 w-3" /> Personalize
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell>
        <span className="text-xs text-muted-foreground" title={i.issuerName ?? undefined}>
          {issuerShort(i.issuerName)}
        </span>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        <AmountCell value={i.totalBaseAmount} predicted={i.predictedBaseAmount} currency={i.currency} />
      </TableCell>
      <TableCell className="text-right tabular-nums">
        <AmountCell value={i.totalAmount} predicted={i.predictedTotalAmount} currency={i.currency} />
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {i.paid ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className={amountTone(i.unpaidAmount)}>{formatAmount(i.unpaidAmount, i.currency)}</span>
        )}
      </TableCell>
      <TableCell className="text-center">
        {i.articleCount > 0 ? (
          <Badge variant="secondary">{i.articleCount}</Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <InlineTextCell invoice={i} field="contractRef" canManage={canManage} placeholder="Nr. 234/…" />
          <CopyButton value={i.contractRef} label="contract" />
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          {(() => {
            const summary = i.articlesSummary || i.servicesDescription;
            return (
              <span title={summary || undefined} className="block max-w-[14rem] truncate text-xs text-muted-foreground">
                {summary || "—"}
              </span>
            );
          })()}
          <CopyButton value={i.articlesSummary || i.servicesDescription} label="services" />
        </div>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">{formatDate(i.issueDate)}</TableCell>
      <TableCell>
        <ExpectedDateCell invoice={i} canManage={canManage} />
      </TableCell>
      <TableCell className="text-center">
        <PaidCell invoice={i} canManage={canManage} />
      </TableCell>
      <TableCell className="text-right">
        <DocLinks urls={parseUrls(i.fileUrls)} />
      </TableCell>
      {canManage && (
        <TableCell className="text-right">
          <div className="flex items-center justify-end gap-1">
            <PersonalizationToggle invoice={i} />
            <DuplicateInvoiceButton
              invoiceId={i.id}
              organizations={formOptions.organizations}
              deals={deals}
              issuers={formOptions.issuers}
              series={formOptions.series}
              partNumbers={formOptions.partNumbers}
              finalClients={finalClients}
            />
            {i.status === "IN_ASTEPTARE" && <GenerateInvoiceDialog invoice={i} />}
            <DeleteButton
              iconOnly
              onDelete={deleteInvoiceAction.bind(null, i.id)}
              title="Delete invoice?"
              description="This action cannot be undone."
            />
          </div>
        </TableCell>
      )}
    </TableRow>
  );
}

/** Show the stored amount, or a "~" prefixed prediction from the articles when missing. */
function AmountCell({ value, predicted, currency }: { value: number | null; predicted: number | null; currency: string | null }) {
  const tone = amountTone(value ?? predicted);
  if (value != null) return <span className={tone}>{formatAmount(value, currency)}</span>;
  if (predicted != null) {
    return (
      <span className={`italic ${tone || "text-muted-foreground"}`} title="Predicted from articles (not yet set on the invoice)">
        ~{formatAmount(predicted, currency)}
      </span>
    );
  }
  return <span className="text-muted-foreground">—</span>;
}

/** Sticky bar with bulk Saga actions, shown when one or more rows are selected. */
function BulkBar({
  ids,
  blockedLabels,
  onClear,
  onRefresh,
}: {
  ids: string[];
  blockedLabels: string[];
  onClear: () => void;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const [downloading, setDownloading] = React.useState(false);
  const [emailing, setEmailing] = React.useState(false);
  const blocked = blockedLabels.length > 0;
  const blockTitle = blocked ? personalizationBlockMessage(blockedLabels) : undefined;

  async function onDownload() {
    if (blocked) return toast({ title: personalizationBlockMessage(blockedLabels), variant: "error" });
    setDownloading(true);
    const res = await bulkDownloadInvoicesSagaXmlAction(ids);
    setDownloading(false);
    if (res.error || !res.xml || !res.filename) {
      return toast({ title: res.error || "Could not generate XML", variant: "error" });
    }
    saveXmlFile(res.filename, res.xml);
    toast({
      title: `Downloaded ${ids.length} invoice(s)`,
      description: res.warnings?.length ? `${res.warnings.length} note(s)` : undefined,
      variant: "success",
    });
    onRefresh();
  }

  async function onEmail() {
    if (blocked) return toast({ title: personalizationBlockMessage(blockedLabels), variant: "error" });
    if (!confirm(`Send one accounting email with ${ids.length} invoice(s) and the combined XML attached?`)) return;
    setEmailing(true);
    const res = await bulkSendInvoicesEmailAction(ids);
    setEmailing(false);
    if (res.error) return toast({ title: res.error, variant: "error" });
    toast({ title: `Emailed ${res.count} invoice(s)`, variant: "success" });
    onClear();
    onRefresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2">
      <span className="text-sm font-medium">{ids.length} selected</span>
      <Button type="button" variant="outline" size="sm" onClick={onDownload} disabled={downloading || emailing || blocked} title={blockTitle}>
        {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download XML
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={onEmail} disabled={downloading || emailing || blocked} title={blockTitle}>
        {emailing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Email all
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onClear} disabled={downloading || emailing}>
        <X className="h-4 w-4" /> Clear
      </Button>
      {blocked && (
        <span className="text-xs text-violet-600 dark:text-violet-400">
          {blockedLabels.length} need personalization
        </span>
      )}
    </div>
  );
}

export function InvoicesTable({
  invoices,
  canManage,
  deals = [],
  finalClients = [],
  organizations = [],
  issuers = [],
  series = [],
  partNumbers = [],
  groupByOrganization = false,
}: {
  invoices: InvoiceRow[];
  canManage: boolean;
  deals?: DealOption[];
  finalClients?: FinalClientOption[];
  organizations?: InvoiceFormOptions["organizations"];
  issuers?: InvoiceFormOptions["issuers"];
  series?: InvoiceFormOptions["series"];
  partNumbers?: InvoiceFormOptions["partNumbers"];
  groupByOrganization?: boolean;
}) {
  const formOptions = React.useMemo<InvoiceFormOptions>(
    () => ({ organizations, issuers, series, partNumbers }),
    [organizations, issuers, series, partNumbers]
  );
  const router = useRouter();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const colSpan = (canManage ? 19 : 17) - (groupByOrganization ? 1 : 0);
  const orgGroups = groupByOrganization ? groupInvoicesByOrganization(invoices) : null;

  // Drop selections that are no longer on the page (e.g. after filtering/paging).
  React.useEffect(() => {
    setSelected((prev) => {
      const next = new Set<string>();
      for (const i of invoices) if (prev.has(i.id)) next.add(i.id);
      return next.size === prev.size ? prev : next;
    });
  }, [invoices]);

  const allSelected = invoices.length > 0 && invoices.every((i) => selected.has(i.id));
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(invoices.map((i) => i.id)));
  }
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      {canManage && selected.size > 0 && (
        <BulkBar
          ids={Array.from(selected)}
          blockedLabels={invoices
            .filter((i) => selected.has(i.id) && i.needsPersonalization)
            .map((i) => i.number || i.organizationName || i.id)}
          onClear={() => setSelected(new Set())}
          onRefresh={() => router.refresh()}
        />
      )}
      <div className="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            {canManage && (
              <TableHead className="w-px">
                <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all" />
              </TableHead>
            )}
            <SortHeader label="Number" sortKey="number" />
            {!groupByOrganization && <SortHeader label="Organization" sortKey="organization" />}
            <SortHeader label="Client" sortKey="client" />
            <TableHead>Final Client</TableHead>
            <SortHeader label="Deal" sortKey="deal" />
            <SortHeader label="Status" sortKey="status" />
            <SortHeader label="Issuer" sortKey="issuer" />
            <SortHeader label="Base Total" sortKey="baseTotal" align="right" />
            <SortHeader label="Total" sortKey="total" align="right" />
            <TableHead className="text-right">Unpaid</TableHead>
            <TableHead className="text-center">Articles</TableHead>
            <SortHeader label="Contract" sortKey="contract" />
            <TableHead>Services</TableHead>
            <SortHeader label="Issued" sortKey="issued" />
            <SortHeader label="Expected" sortKey="expected" />
            <SortHeader label="Paid" sortKey="paid" align="center" />
            <TableHead className="text-right">Documents</TableHead>
            {canManage && <TableHead className="w-px text-right">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {orgGroups
            ? orgGroups.map((group) => (
                <React.Fragment key={group.organizationId}>
                  <OrgGroupHeader group={group} colSpan={colSpan} />
                  {group.invoices.map((i) => (
                    <InvoiceTableRow
                      key={i.id}
                      invoice={i}
                      canManage={canManage}
                      deals={deals}
                      finalClients={finalClients}
                      formOptions={formOptions}
                      selected={selected}
                      toggleOne={toggleOne}
                      hideOrganization
                    />
                  ))}
                </React.Fragment>
              ))
            : invoices.map((i) => (
                <InvoiceTableRow
                  key={i.id}
                  invoice={i}
                  canManage={canManage}
                  deals={deals}
                  finalClients={finalClients}
                  formOptions={formOptions}
                  selected={selected}
                  toggleOne={toggleOne}
                />
              ))}
          {invoices.length === 0 && (
            <TableRow>
              <TableCell colSpan={colSpan} className="py-10 text-center text-sm text-muted-foreground">
                No invoices found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      </div>
    </div>
  );
}
