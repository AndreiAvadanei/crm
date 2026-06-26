"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, Check, ChevronsUpDown, Copy, Download, ExternalLink, Loader2, Mail, Pencil, X } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { DeleteButton } from "@/components/shared/delete-button";
import { ClientCombobox } from "@/components/shared/client-combobox";
import { GenerateInvoiceDialog } from "@/components/invoices/generate-invoice-dialog";
import { saveXmlFile } from "@/components/invoices/saga-xml-button";
import {
  deleteInvoiceAction,
  setInvoiceDealAction,
  setInvoiceExpectedDateAction,
  setInvoicePaidAction,
  setInvoiceTextFieldAction,
} from "@/server/invoice-actions";
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
  field: "contractRef" | "servicesDescription";
  canManage: boolean;
  placeholder?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const initial = (field === "contractRef" ? invoice.contractRef : invoice.servicesDescription) ?? "";
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

/** Sticky bar with bulk Saga actions, shown when one or more rows are selected. */
function BulkBar({
  ids,
  onClear,
  onRefresh,
}: {
  ids: string[];
  onClear: () => void;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const [downloading, setDownloading] = React.useState(false);
  const [emailing, setEmailing] = React.useState(false);

  async function onDownload() {
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
      <Button type="button" variant="outline" size="sm" onClick={onDownload} disabled={downloading || emailing}>
        {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download XML
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={onEmail} disabled={downloading || emailing}>
        {emailing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Email all
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onClear} disabled={downloading || emailing}>
        <X className="h-4 w-4" /> Clear
      </Button>
    </div>
  );
}

export function InvoicesTable({
  invoices,
  canManage,
  deals = [],
}: {
  invoices: InvoiceRow[];
  canManage: boolean;
  deals?: DealOption[];
}) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

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
        <BulkBar ids={Array.from(selected)} onClear={() => setSelected(new Set())} onRefresh={() => router.refresh()} />
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
            <SortHeader label="Organization" sortKey="organization" />
            <SortHeader label="Client" sortKey="client" />
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
          {invoices.map((i) => {
            const toIssue = !i.issueDate && !!i.expectedInvoiceDate;
            return (
            <TableRow
              key={i.id}
              data-selected={selected.has(i.id) ? "true" : undefined}
              className={`group data-[selected=true]:bg-primary/5 ${toIssue ? "bg-amber-500/10 hover:bg-amber-500/15 [&>td:first-child]:border-l-2 [&>td:first-child]:border-l-amber-500" : ""}`}
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
                <DealCell invoice={i} canManage={canManage} deals={deals} />
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap items-center gap-1">
                  <Badge variant={invoiceStatusVariant(i.status)}>{INVOICE_STATUS_LABELS[i.status]}</Badge>
                  {toIssue && (
                    <Badge className="border-transparent bg-amber-500/15 text-amber-600 dark:text-amber-400">To issue</Badge>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <span className="text-xs text-muted-foreground" title={i.issuerName ?? undefined}>
                  {issuerShort(i.issuerName)}
                </span>
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatAmount(i.totalBaseAmount, i.currency)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatAmount(i.totalAmount, i.currency)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {i.paid ? <span className="text-muted-foreground">—</span> : formatAmount(i.unpaidAmount, i.currency)}
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
                  <InlineTextCell invoice={i} field="servicesDescription" canManage={canManage} placeholder="Services…" />
                  <CopyButton value={i.servicesDescription} label="services" />
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
          })}
          {invoices.length === 0 && (
            <TableRow>
              <TableCell colSpan={canManage ? 18 : 16} className="py-10 text-center text-sm text-muted-foreground">
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
