"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, FileSpreadsheet, Info, Loader2, Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  applyInvoiceWorkbookImportAction,
  previewInvoiceWorkbookAction,
  type InvoiceImportPreview,
  type InvoiceImportPreviewRow,
} from "@/server/invoice-import-actions";

type RowStatusFilter = "all" | "ready" | "warning" | "error" | "new-org";

function originalTitle(row: InvoiceImportPreviewRow, keys: string[]): string {
  return keys.map((key) => `${key}: ${row.originalValues[key] ?? "—"}`).join("\n");
}

function OriginalInfo({ title }: { title: string }) {
  return (
    <span title={title} className="inline-flex cursor-help align-middle text-muted-foreground">
      <Info className="h-3.5 w-3.5" />
    </span>
  );
}

function amount(value: string | null, currency?: string | null) {
  return value ? `${value}${currency ? ` ${currency}` : ""}` : "—";
}

function hasBlockingErrors(preview: InvoiceImportPreview | null): boolean {
  if (!preview) return true;
  return preview.errors.length > 0 || preview.invoices.some((row) => row.errors.length > 0);
}

function importFileNameError(fileName: string): string | null {
  if (!/\.(xls|xlsx)$/i.test(fileName)) return "Only .xls and .xlsx files are supported.";
  const lower = fileName.toLowerCase();
  const hasRon = /\bron\b/.test(lower) || lower.includes("ron -") || lower.includes("- ron");
  const hasValuta = lower.includes("valuta");
  if (hasRon && hasValuta) return "File name must identify only one export type: RON or valuta.";
  if (!hasRon && !hasValuta) return 'File name must include "ron" or "valuta" so the importer can validate it.';
  return null;
}

function rowStatus(row: InvoiceImportPreviewRow): "ready" | "warning" | "error" {
  if (row.errors.length > 0) return "error";
  if (row.warnings.length > 0) return "warning";
  return "ready";
}

function matchesStatus(row: InvoiceImportPreviewRow, filter: RowStatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "new-org") return row.willCreateOrganization;
  return rowStatus(row) === filter;
}

function PreviewMessages({ preview }: { preview: InvoiceImportPreview }) {
  const rowErrors = preview.invoices.flatMap((row) => row.errors.map((error) => `${row.number}: ${error}`));
  const warnings = preview.invoices.flatMap((row) => row.warnings.map((warning) => `${row.number}: ${warning}`));
  if (preview.errors.length === 0 && rowErrors.length === 0 && warnings.length === 0) return null;
  return (
    <div className="space-y-2">
      {[...preview.errors, ...rowErrors].length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <div className="mb-1 flex items-center gap-2 font-medium text-destructive">
            <AlertTriangle className="h-4 w-4" /> Errors to fix before import
          </div>
          <ul className="max-h-28 space-y-1 overflow-auto text-xs">
            {[...preview.errors, ...rowErrors].map((error, index) => (
              <li key={index}>{error}</li>
            ))}
          </ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="rounded-md border bg-muted/30 p-3 text-sm">
          <div className="mb-1 font-medium">Warnings</div>
          <ul className="max-h-24 space-y-1 overflow-auto text-xs text-muted-foreground">
            {warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function InvoiceImportDialog({ issuers = [] }: { issuers?: { id: string; name: string }[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [open, setOpen] = React.useState(false);
  const [preview, setPreview] = React.useState<InvoiceImportPreview | null>(null);
  const [busy, setBusy] = React.useState<"preview" | "apply" | null>(null);
  const [statusFilter, setStatusFilter] = React.useState<RowStatusFilter>("all");
  const [issuerId, setIssuerId] = React.useState("");
  const filteredInvoices = React.useMemo(
    () => preview?.invoices.filter((row) => matchesStatus(row, statusFilter)) ?? [],
    [preview, statusFilter]
  );

  async function onPreview(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return toast({ title: "Choose a file first", variant: "error" });
    const fileError = importFileNameError(file.name);
    if (fileError) return toast({ title: fileError, variant: "error" });
    const fd = new FormData();
    fd.set("file", file);
    setBusy("preview");
    const res = await previewInvoiceWorkbookAction(fd);
    setBusy(null);
    if (res.error) return toast({ title: res.error, variant: "error" });
    setPreview(res.preview ?? null);
    setStatusFilter("all");
  }

  async function onApply() {
    if (!preview || hasBlockingErrors(preview)) return;
    if (issuers.length > 0 && !issuerId) return toast({ title: "Select the issuer these invoices belong to", variant: "error" });
    setBusy("apply");
    const res = await applyInvoiceWorkbookImportAction(JSON.stringify(preview), issuerId || undefined);
    setBusy(null);
    if (res.error) return toast({ title: res.error, variant: "error" });
    toast({
      title: `Imported ${res.imported ?? 0} invoices`,
      description: `${res.createdOrganizations ?? 0} organization(s) created.`,
      variant: "success",
    });
    setOpen(false);
    setPreview(null);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Upload className="h-4 w-4" /> Import XLS
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-6xl">
        <DialogHeader>
          <DialogTitle>Import accounting invoices</DialogTitle>
          <DialogDescription>
            Preview `ron - facturi.xls` or `valuta - facturi.xls`, review errors and new organizations, then apply the upsert.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onPreview} className="flex flex-col gap-3 sm:flex-row">
          <Input
            ref={fileRef}
            type="file"
            accept=".xls,.xlsx"
            onChange={(e) => {
              setPreview(null);
              const file = e.currentTarget.files?.[0];
              const fileError = file ? importFileNameError(file.name) : null;
              if (fileError) toast({ title: fileError, variant: "error" });
            }}
          />
          <Button type="submit" disabled={busy != null}>
            {busy === "preview" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
            Preview
          </Button>
        </form>

        {issuers.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label htmlFor="import-issuer" className="font-medium">
              Import as issuer <span className="text-destructive">*</span>
            </label>
            <select
              id="import-issuer"
              value={issuerId}
              onChange={(e) => setIssuerId(e.target.value)}
              className="flex h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Select issuer…</option>
              {issuers.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground">All imported invoices are stamped as issued by this entity.</span>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Tip: add issuers in Settings to tag imported invoices with the entity that issued them.
          </p>
        )}

        {preview && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="secondary">{preview.invoices.length} grouped invoices</Badge>
              <Badge variant="secondary">{preview.totalRows} source rows</Badge>
              <Badge variant={preview.createdOrganizationCount ? "warning" : "secondary"}>
                {preview.createdOrganizationCount} new organizations
              </Badge>
              <span className="text-muted-foreground">
                {preview.fileName} · {preview.sheetName}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Show</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as RowStatusFilter)}
                className="flex h-8 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="all">All rows ({preview.invoices.length})</option>
                <option value="ready">Ready ({preview.invoices.filter((row) => rowStatus(row) === "ready").length})</option>
                <option value="warning">Warnings ({preview.invoices.filter((row) => rowStatus(row) === "warning").length})</option>
                <option value="error">Errors ({preview.invoices.filter((row) => rowStatus(row) === "error").length})</option>
                <option value="new-org">New organizations ({preview.invoices.filter((row) => row.willCreateOrganization).length})</option>
              </select>
              <span className="text-xs text-muted-foreground">
                {filteredInvoices.length} visible
              </span>
            </div>

            <PreviewMessages preview={preview} />

            <div className="max-h-[52vh] overflow-auto rounded-md border">
              <table className="w-full caption-bottom text-sm">
                <thead className="[&_tr]:border-b">
                  <tr className="border-b">
                    <th className="sticky top-0 z-10 h-10 bg-card px-3 text-left align-middle text-xs font-medium text-muted-foreground shadow-sm">Invoice</th>
                    <th className="sticky top-0 z-10 h-10 bg-card px-3 text-left align-middle text-xs font-medium text-muted-foreground shadow-sm">Organization</th>
                    <th className="sticky top-0 z-10 h-10 bg-card px-3 text-left align-middle text-xs font-medium text-muted-foreground shadow-sm">Issued</th>
                    <th className="sticky top-0 z-10 h-10 bg-card px-3 text-right align-middle text-xs font-medium text-muted-foreground shadow-sm">Base</th>
                    <th className="sticky top-0 z-10 h-10 bg-card px-3 text-right align-middle text-xs font-medium text-muted-foreground shadow-sm">TVA</th>
                    <th className="sticky top-0 z-10 h-10 bg-card px-3 text-right align-middle text-xs font-medium text-muted-foreground shadow-sm">Unpaid</th>
                    <th className="sticky top-0 z-10 h-10 bg-card px-3 text-left align-middle text-xs font-medium text-muted-foreground shadow-sm">Articles</th>
                    <th className="sticky top-0 z-10 h-10 bg-card px-3 text-left align-middle text-xs font-medium text-muted-foreground shadow-sm">Services</th>
                    <th className="sticky top-0 z-10 h-10 bg-card px-3 text-left align-middle text-xs font-medium text-muted-foreground shadow-sm">Status</th>
                  </tr>
                </thead>
                <tbody className="[&_tr:last-child]:border-0">
                  {filteredInvoices.map((row) => (
                    <tr key={row.importKey} className={`border-b transition-colors hover:bg-muted/30 ${row.willCreateOrganization ? "bg-amber-500/10" : ""}`}>
                      <td className="px-3 py-2.5 align-middle font-medium">
                        <span className="inline-flex items-center gap-1">
                          {row.number}
                          <OriginalInfo title={originalTitle(row, ["nr_iesire", "id_iesire", "id_solicit"])} />
                        </span>
                      </td>
                      <td className="px-3 py-2.5 align-middle">
                        <div className="flex max-w-[14rem] items-center gap-1">
                          <span className="truncate" title={row.organizationName}>
                            {row.organizationName || "—"}
                          </span>
                          <OriginalInfo title={originalTitle(row, ["denumire", "cod", "cont_cli"])} />
                          {row.willCreateOrganization && <Badge variant="warning">new</Badge>}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 align-middle">
                        <span className="inline-flex items-center gap-1">
                          {row.issueDate ?? "—"}
                          <OriginalInfo title={originalTitle(row, ["data", "scadent"])} />
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right align-middle tabular-nums">
                        <span className="inline-flex items-center justify-end gap-1">
                          {amount(row.totalBaseAmount, row.currency)}
                          <OriginalInfo title={originalTitle(row, ["baza_tva", "total", "cod_valuta"])} />
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right align-middle tabular-nums">
                        <span className="inline-flex items-center justify-end gap-1">
                          {amount(row.vatAmount, row.currency)}
                          <OriginalInfo title={originalTitle(row, ["tva", "tva_val"])} />
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right align-middle tabular-nums">
                        <span className="inline-flex items-center justify-end gap-1">
                          {row.paid ? "Paid" : amount(row.unpaidAmount, row.currency)}
                          <OriginalInfo title={originalTitle(row, ["neachitat"])} />
                        </span>
                      </td>
                      <td className="px-3 py-2.5 align-middle">{row.articleCount}</td>
                      <td className="max-w-[18rem] px-3 py-2.5 align-middle">
                        <span className="line-clamp-2 text-xs text-muted-foreground" title={row.servicesPreview ?? undefined}>
                          {row.servicesPreview ?? "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 align-middle">
                        {row.errors.length > 0 ? (
                          <Badge variant="destructive">error</Badge>
                        ) : row.warnings.length > 0 ? (
                          <Badge variant="warning">warning</Badge>
                        ) : (
                          <Badge variant="success">ready</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filteredInvoices.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-3 py-8 text-center align-middle text-sm text-muted-foreground">
                        No preview rows match this status.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={!preview || hasBlockingErrors(preview) || busy != null} onClick={onApply}>
            {busy === "apply" && <Loader2 className="h-4 w-4 animate-spin" />}
            Apply import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
