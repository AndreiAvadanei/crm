"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOpenTrigger,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/components/ui/toast";
import { ClientCombobox } from "@/components/shared/client-combobox";
import { PartNumberPicker } from "@/components/invoices/part-number-picker";
import { RelatedInvoicePicker } from "@/components/invoices/related-invoice-picker";
import type { RelatedInvoiceOption } from "@/server/part-number-actions";
import { createInvoiceAction, updateInvoiceAction } from "@/server/invoice-actions";
import { resolvePartNumberCode, type PartNumberOption } from "@/lib/part-numbers";
import {
  computeInvoiceTotals,
  lineGrossTotal,
  round2,
  DEFAULT_INVOICE_VAT_PERCENT,
} from "@/lib/invoice-totals";
import {
  DEFAULT_INVOICE_CURRENCY,
  DEFAULT_INVOICE_PAYMENT_TERM,
  DEFAULT_INVOICE_STATUS,
  INVOICE_CURRENCY_OPTIONS,
  INVOICE_ISSUER_OPTIONS,
  INVOICE_PAYMENT_TERM_OPTIONS,
  INVOICE_STATUS_OPTIONS,
} from "@/lib/invoice-constants";

const MAX_SERVICE_LEN = 500;
const MAX_SUPPLEMENT_LEN = 2000;
const MAX_UM_LEN = 16;

const fmtNum = (n: number): string => {
  if (!Number.isFinite(n)) return "";
  return String(Math.round((n + Number.EPSILON) * 1e4) / 1e4);
};

const parseNum = (v: string): number | null => {
  if (!v || !v.trim()) return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: (currency || "RON").toUpperCase(), maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`.trim();
  }
}

export type InvoiceData = {
  id: string;
  organizationId: string;
  salesId: string | null;
  number: string | null;
  status: string;
  currency: string | null;
  totalAmount: number | null;
  paymentTermDays: number | null;
  issueDate: string | null; // yyyy-mm-dd
  expectedInvoiceDate: string | null; // yyyy-mm-dd
  issuerName: string | null;
  issuerId: string | null;
  partNumberId: string | null;
  partNumberValues: Record<string, string> | null;
  relatedInvoiceId: string | null;
  selfIssued: boolean;
  seriesId: string | null;
  contractRef: string | null;
  fileUrls: string | null;
  paid: boolean;
  /** Locked VAT % for this invoice; omitted on create (defaults from org). */
  vatPercent?: number;
  lines?: InvoiceLineData[];
};

type InvoiceLineData = {
  serviceDescription: string;
  textSupplement: string;
  unitOfMeasure: string;
  quantity: string;
  unitPrice: string;
  value: string;
  total: string;
};

type DealOption = { salesId: string; title: string };

const blankLine = (): InvoiceLineData => ({
  serviceDescription: "",
  textSupplement: "",
  unitOfMeasure: "buc",
  quantity: "1",
  unitPrice: "",
  value: "",
  total: "",
});

/** Validation errors for a single article (empty object = valid). */
function lineErrors(line: InvoiceLineData): { serviceDescription?: string; unitOfMeasure?: string; quantity?: string; unitPrice?: string; textSupplement?: string } {
  const errors: ReturnType<typeof lineErrors> = {};
  if (!line.serviceDescription.trim()) errors.serviceDescription = "Required";
  else if (line.serviceDescription.length > MAX_SERVICE_LEN) errors.serviceDescription = `Max ${MAX_SERVICE_LEN} characters`;
  if (line.textSupplement.length > MAX_SUPPLEMENT_LEN) errors.textSupplement = `Max ${MAX_SUPPLEMENT_LEN} characters`;
  if (line.unitOfMeasure.length > MAX_UM_LEN) errors.unitOfMeasure = `Max ${MAX_UM_LEN} characters`;
  const q = parseNum(line.quantity);
  if (line.quantity.trim() && (q == null || q < 0)) errors.quantity = "Invalid";
  const up = parseNum(line.unitPrice);
  if (line.unitPrice.trim() && (up == null || up < 0)) errors.unitPrice = "Invalid";
  return errors;
}

export function InvoiceFormDialog({
  trigger,
  invoice,
  organizations,
  deals,
  issuers,
  series = [],
  partNumbers = [],
  defaultSalesId,
  defaultOrganizationId,
}: {
  trigger: React.ReactNode;
  invoice?: InvoiceData;
  /** Billable organizations; `defaultVatPercent` is the country-based default. */
  organizations: { id: string; name: string; defaultVatPercent?: number; configuredTvaPercent?: number }[];
  deals: DealOption[];
  /** Configured seller entities; falls back to legacy constants when empty. */
  issuers?: { id: string; name: string }[];
  /** Invoice number series offered for FacturaNumar assignment. */
  series?: { id: string; prefix: string; nextNumber: number }[];
  /** Billable part-number catalog offered in the wizard. */
  partNumbers?: PartNumberOption[];
  /** Pre-fill the SAL id (e.g. when creating from a deal). */
  defaultSalesId?: string;
  /** Pre-select the organization (e.g. when creating from a client/org). */
  defaultOrganizationId?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const formRef = React.useRef<HTMLFormElement>(null);
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [organizationId, setOrganizationId] = React.useState(invoice?.organizationId ?? defaultOrganizationId ?? "");
  const [salesId, setSalesId] = React.useState(invoice?.salesId ?? defaultSalesId ?? "");
  const [paid, setPaid] = React.useState(invoice?.paid ?? false);
  const [recurrent, setRecurrent] = React.useState(false);
  const [currency, setCurrency] = React.useState(invoice?.currency ?? DEFAULT_INVOICE_CURRENCY);
  const [lines, setLines] = React.useState<InvoiceLineData[]>(invoice?.lines?.length ? invoice.lines : [blankLine()]);
  const [partNumberId, setPartNumberId] = React.useState(invoice?.partNumberId ?? "");
  const [partNumberValues, setPartNumberValues] = React.useState<Record<string, string>>(invoice?.partNumberValues ?? {});
  const [relatedInvoiceId, setRelatedInvoiceId] = React.useState(invoice?.relatedInvoiceId ?? "");
  // When a related invoice is linked, its part number is inherited and the picker is locked.
  const [inheritsPartNumber, setInheritsPartNumber] = React.useState(!!invoice?.relatedInvoiceId);
  const [selfIssued, setSelfIssued] = React.useState(invoice?.selfIssued ?? false);
  const [seriesId, setSeriesId] = React.useState(invoice?.seriesId ?? "");
  const editing = !!invoice;

  const defaultVatPercent = React.useMemo(() => {
    const org = organizations.find((o) => o.id === organizationId);
    return org?.defaultVatPercent ?? DEFAULT_INVOICE_VAT_PERCENT;
  }, [organizations, organizationId]);

  const configuredTvaPercent = React.useMemo(() => {
    const org = organizations.find((o) => o.id === organizationId);
    return org?.configuredTvaPercent ?? DEFAULT_INVOICE_VAT_PERCENT;
  }, [organizations, organizationId]);

  const [vatPercent, setVatPercent] = React.useState(
    () => invoice?.vatPercent ?? defaultVatPercent
  );

  React.useEffect(() => {
    if (editing) return;
    setVatPercent(defaultVatPercent);
  }, [defaultVatPercent, editing]);

  const invoiceTotals = React.useMemo(() => computeInvoiceTotals(lines, vatPercent), [lines, vatPercent]);
  const lineErrorList = React.useMemo(() => lines.map(lineErrors), [lines]);
  const hasLineErrors = lineErrorList.some((e) => Object.keys(e).length > 0);

  React.useEffect(() => {
    setLines((prev) =>
      prev.map((line) => {
        const hasAmount = parseNum(line.quantity) != null || parseNum(line.unitPrice) != null || parseNum(line.value) != null;
        if (!hasAmount) return line;
        return { ...line, total: fmtNum(lineGrossTotal(line, vatPercent)) };
      })
    );
  }, [vatPercent]);

  function onRelatedInvoiceChange(id: string, option: RelatedInvoiceOption | null) {
    setRelatedInvoiceId(id);
    if (id && option?.partNumberId) {
      setPartNumberId(option.partNumberId);
      setPartNumberValues(option.partNumberValues ?? {});
      setInheritsPartNumber(true);
    } else if (id) {
      // Related invoice has no part number to inherit; keep the picker usable.
      setInheritsPartNumber(false);
    } else {
      setInheritsPartNumber(false);
    }
  }

  // Configured issuers (id-based) when available, else legacy name-based constants.
  const issuerOptions = React.useMemo(
    () =>
      issuers && issuers.length
        ? issuers.map((i) => ({ value: i.id, name: i.name }))
        : INVOICE_ISSUER_OPTIONS.map((n) => ({ value: n, name: n })),
    [issuers]
  );
  const usingConfigured = !!(issuers && issuers.length);
  const [issuerValue, setIssuerValue] = React.useState(() => {
    if (usingConfigured && invoice?.issuerId && issuers!.some((i) => i.id === invoice.issuerId)) return invoice.issuerId;
    const byName = issuerOptions.find((o) => o.name === invoice?.issuerName);
    return byName?.value ?? issuerOptions[0]?.value ?? "";
  });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formRef.current) return;
    if (!organizationId) return toast({ title: "Select an organization", variant: "error" });
    if (hasLineErrors) return toast({ title: "Fix the highlighted articles before saving", variant: "error" });
    setBusy(true);
    const fd = new FormData(formRef.current);
    fd.set("organizationId", organizationId);
    fd.set("salesId", salesId);
    fd.set("paid", paid ? "1" : "");
    fd.set("recurrent", !editing && recurrent ? "1" : "");
    fd.set("linesJson", JSON.stringify(lines));
    const selectedIssuer = issuerOptions.find((o) => o.value === issuerValue);
    fd.set("issuerId", usingConfigured ? issuerValue : "");
    fd.set("issuerName", selectedIssuer?.name ?? "");
    const selectedPartNumber = partNumbers.find((p) => p.id === partNumberId);
    fd.set("partNumberId", partNumberId);
    fd.set("partNumberValues", partNumberId ? JSON.stringify(partNumberValues) : "");
    fd.set("partNumberCode", selectedPartNumber ? resolvePartNumberCode(selectedPartNumber.code, partNumberValues) : "");
    fd.set("relatedInvoiceId", relatedInvoiceId);
    fd.set("selfIssued", selfIssued ? "1" : "");
    fd.set("seriesId", selfIssued ? seriesId : "");
    fd.set("vatPercent", String(vatPercent));
    const res = editing ? await updateInvoiceAction(invoice!.id, fd) : await createInvoiceAction(fd);
    setBusy(false);
    if (res.error) return toast({ title: res.error, variant: "error" });
    toast({ title: editing ? "Invoice updated" : "Invoice created", variant: "success" });
    setOpen(false);
    router.refresh();
  }

  function updateLine(index: number, patch: Partial<InvoiceLineData>) {
    setLines((prev) =>
      prev.map((line, i) => {
        if (i !== index) return line;
        const next = { ...line, ...patch };
        // Derive net value from quantity × unit price (unless the user typed a value directly).
        if (("quantity" in patch || "unitPrice" in patch) && !("value" in patch)) {
          const q = parseNum(next.quantity);
          const up = parseNum(next.unitPrice);
          next.value = q != null && up != null ? fmtNum(round2(q * up)) : "";
        }
        // Total is always VAT-inclusive and derived from the line's net value.
        const hasAmount = parseNum(next.value) != null || parseNum(next.unitPrice) != null;
        next.total = hasAmount ? fmtNum(lineGrossTotal(next, vatPercent)) : "";
        return next;
      })
    );
  }

  function removeLine(index: number) {
    setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : [blankLine()]));
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogOpenTrigger trigger={trigger} onOpen={() => setOpen(true)} />
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit invoice" : "New invoice"}</DialogTitle>
          <DialogDescription>Bill a deal to one of the client&apos;s legal entities.</DialogDescription>
        </DialogHeader>
        <form ref={formRef} onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>Organization *</Label>
              <ClientCombobox
                value={organizationId}
                options={organizations.map((o) => ({ value: o.id, label: o.name }))}
                onChange={setOrganizationId}
                placeholder="Select organization"
                searchPlaceholder="Search organizations…"
                emptyText="No organizations found."
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Deal (SAL id)</Label>
              <ClientCombobox
                value={salesId}
                options={deals.map((d) => ({ value: d.salesId, label: `${d.salesId} - ${d.title}` }))}
                onChange={setSalesId}
                placeholder="No deal"
                searchPlaceholder="Search SAL id or deal title..."
                emptyText="No deals found."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <select
                id="status"
                name="status"
                defaultValue={invoice?.status ?? DEFAULT_INVOICE_STATUS}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {INVOICE_STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="expectedInvoiceDate">Date expected to invoice</Label>
              <Input
                id="expectedInvoiceDate"
                name="expectedInvoiceDate"
                type="date"
                defaultValue={invoice?.expectedInvoiceDate ?? ""}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="currency">Currency</Label>
              <select
                id="currency"
                name="currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {INVOICE_CURRENCY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="paymentTermDays">Payment term</Label>
              <select
                id="paymentTermDays"
                name="paymentTermDays"
                defaultValue={String(invoice?.paymentTermDays ?? DEFAULT_INVOICE_PAYMENT_TERM)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {INVOICE_PAYMENT_TERM_OPTIONS.map((days) => (
                  <option key={days} value={days}>
                    {days} days
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="issuer">Issuer</Label>
              <select
                id="issuer"
                value={issuerValue}
                onChange={(e) => setIssuerValue(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {issuerOptions.map((issuer) => (
                  <option key={issuer.value} value={issuer.value}>
                    {issuer.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2 rounded-md border bg-muted/30 p-3 sm:col-span-2">
              <div className="flex items-start gap-2">
                <Checkbox
                  id="selfIssued"
                  checked={selfIssued}
                  onCheckedChange={(v) => setSelfIssued(v === true)}
                />
                <div className="space-y-1">
                  <Label htmlFor="selfIssued" className="cursor-pointer">Generate this invoice ourselves</Label>
                  <p className="text-xs text-muted-foreground">
                    By default the accounting firm generates the invoice and assigns its number. Tick this to
                    issue it from our own series instead.
                  </p>
                </div>
              </div>
              {selfIssued && (
                <div className="space-y-2 pl-6">
                  <Label htmlFor="series">Number series</Label>
                  <select
                    id="series"
                    value={seriesId}
                    onChange={(e) => setSeriesId(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">Default series</option>
                    {series.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.prefix} (next {s.nextNumber})
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    FacturaNumar is assigned from this series when the invoice is issued.
                  </p>
                </div>
              )}
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Related invoice (same customer)</Label>
              <RelatedInvoicePicker
                organizationId={organizationId}
                value={relatedInvoiceId}
                onChange={onRelatedInvoiceChange}
                excludeInvoiceId={invoice?.id}
              />
              <p className="text-xs text-muted-foreground">
                Link a split-project or follow-up invoice from the same customer. Its part number is inherited.
              </p>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Part number</Label>
              {partNumbers.length > 0 ? (
                <PartNumberPicker
                  partNumbers={partNumbers}
                  value={partNumberId}
                  values={partNumberValues}
                  disabled={inheritsPartNumber}
                  disabledHint="Inherited from the related invoice. Clear the related invoice to choose a different part number."
                  onChange={({ id, values }) => {
                    setPartNumberId(id);
                    setPartNumberValues(values);
                  }}
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  No part numbers configured yet. Add them in Settings → Part numbers.
                </p>
              )}
            </div>
            <div className="space-y-3 sm:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label>Articles *</Label>
                  <p className="text-xs text-muted-foreground">
                    The invoice amount is derived from these lines. Value = quantity × unit price; Total includes VAT.
                  </p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, blankLine()])}>
                  <Plus className="h-4 w-4" /> Add article
                </Button>
              </div>
              <div className="space-y-3">
                {lines.map((line, index) => {
                  const errs = lineErrorList[index] ?? {};
                  return (
                  <div key={index} className="rounded-md border bg-muted/20 p-3">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-sm font-medium">Article {index + 1}</span>
                      <Button type="button" variant="ghost" size="icon" aria-label="Remove article" onClick={() => removeLine(index)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-6">
                      <div className="space-y-1 sm:col-span-4">
                        <Label>Service</Label>
                        <Input
                          value={line.serviceDescription}
                          maxLength={MAX_SERVICE_LEN}
                          aria-invalid={!!errs.serviceDescription}
                          onChange={(e) => updateLine(index, { serviceDescription: e.target.value })}
                          placeholder="Service description"
                        />
                        {errs.serviceDescription && <p className="text-xs text-destructive">{errs.serviceDescription}</p>}
                      </div>
                      <div className="space-y-1 sm:col-span-2">
                        <Label>UM</Label>
                        <Input
                          value={line.unitOfMeasure}
                          maxLength={MAX_UM_LEN}
                          aria-invalid={!!errs.unitOfMeasure}
                          onChange={(e) => updateLine(index, { unitOfMeasure: e.target.value.toLowerCase() })}
                          placeholder="buc, zile, ore"
                        />
                      </div>
                      <div className="space-y-1 sm:col-span-6">
                        <Label>Text supl.</Label>
                        <Textarea
                          value={line.textSupplement}
                          maxLength={MAX_SUPPLEMENT_LEN}
                          onChange={(e) => updateLine(index, { textSupplement: e.target.value })}
                          rows={2}
                        />
                      </div>
                      <div className="space-y-1 sm:col-span-2">
                        <Label>Quantity</Label>
                        <Input
                          value={line.quantity}
                          inputMode="decimal"
                          aria-invalid={!!errs.quantity}
                          onChange={(e) => updateLine(index, { quantity: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1 sm:col-span-2">
                        <Label>Unit price</Label>
                        <Input
                          value={line.unitPrice}
                          inputMode="decimal"
                          aria-invalid={!!errs.unitPrice}
                          onChange={(e) => updateLine(index, { unitPrice: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1 sm:col-span-1">
                        <Label>Value</Label>
                        <Input
                          value={line.value}
                          inputMode="decimal"
                          title="Net value (before VAT). Auto-filled from quantity × unit price; you can override it."
                          onChange={(e) => updateLine(index, { value: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1 sm:col-span-1">
                        <Label>Total (VAT)</Label>
                        <Input
                          value={line.total}
                          readOnly
                          tabIndex={-1}
                          title="Total including VAT (computed)."
                          className="bg-muted/50 text-muted-foreground"
                        />
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>

              <div className="flex flex-col items-end gap-1 rounded-md border bg-muted/30 p-3 text-sm">
                <div className="flex w-full max-w-xs items-center justify-between gap-2">
                  <span className="text-muted-foreground">VAT %</span>
                  <Input
                    name="vatPercent"
                    type="number"
                    min={0}
                    step={0.01}
                    className="h-8 w-24 text-right tabular-nums"
                    value={vatPercent}
                    onChange={(e) => {
                      const n = Number(e.target.value.replace(",", "."));
                      setVatPercent(Number.isFinite(n) && n >= 0 ? n : 0);
                    }}
                  />
                </div>
                <div className="flex w-full max-w-xs justify-between">
                  <span className="text-muted-foreground">Net total</span>
                  <span className="tabular-nums">{formatMoney(invoiceTotals.base, currency)}</span>
                </div>
                <div className="flex w-full max-w-xs justify-between">
                  <span className="text-muted-foreground">VAT ({vatPercent}%)</span>
                  <span className="tabular-nums">{formatMoney(invoiceTotals.vat, currency)}</span>
                </div>
                <div className="flex w-full max-w-xs justify-between border-t pt-1 font-medium">
                  <span>Total (incl. VAT)</span>
                  <span className="tabular-nums">{formatMoney(invoiceTotals.total, currency)}</span>
                </div>
                <p className="w-full pt-1 text-right text-xs text-muted-foreground">
                  {defaultVatPercent === 0
                    ? vatPercent > 0
                      ? `Exception: foreign client normally 0% VAT; org configured rate is ${configuredTvaPercent}%.`
                      : `Foreign client: 0% by default (EU reverse charge / export). Override VAT % above if needed.`
                    : vatPercent !== defaultVatPercent
                      ? `Default for this client is ${defaultVatPercent}%; you are using an override.`
                      : `Default ${defaultVatPercent}% for this client.`}
                </p>
              </div>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="contractRef">Contract reference</Label>
              <Input id="contractRef" name="contractRef" defaultValue={invoice?.contractRef ?? ""} placeholder="Nr. 234/15.11.2022" />
            </div>
            <div className="flex items-center gap-2 sm:col-span-2">
              <Checkbox id="paid" checked={paid} onCheckedChange={(v) => setPaid(v === true)} />
              <Label htmlFor="paid" className="cursor-pointer">Paid</Label>
            </div>
          </div>

          {!editing && (
            <div className="space-y-3 rounded-md border bg-muted/30 p-3">
              <div className="flex items-center gap-2">
                <Checkbox id="recurrent" checked={recurrent} onCheckedChange={(v) => setRecurrent(v === true)} />
                <Label htmlFor="recurrent" className="cursor-pointer">Recurrent invoice</Label>
              </div>
              {recurrent && (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="repetitions">Repetitions</Label>
                      <Input id="repetitions" name="repetitions" type="number" min={1} max={60} defaultValue={12} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="intervalMonths">Every (months)</Label>
                      <Input id="intervalMonths" name="intervalMonths" type="number" min={1} max={24} defaultValue={1} />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Creates one invoice per repetition, keeping the same day-of-month and shifting the expected
                    invoice date. Requires an expected invoice date.
                  </p>
                </>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="submit" disabled={busy || hasLineErrors}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? "Save changes" : "Create invoice"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
