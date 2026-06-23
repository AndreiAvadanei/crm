"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { ClientCombobox } from "@/components/shared/client-combobox";
import { createInvoiceAction, updateInvoiceAction } from "@/server/invoice-actions";
import {
  DEFAULT_INVOICE_CURRENCY,
  DEFAULT_INVOICE_ISSUER,
  DEFAULT_INVOICE_PAYMENT_TERM,
  DEFAULT_INVOICE_STATUS,
  INVOICE_CURRENCY_OPTIONS,
  INVOICE_ISSUER_OPTIONS,
  INVOICE_PAYMENT_TERM_OPTIONS,
  INVOICE_STATUS_OPTIONS,
} from "@/lib/invoice-constants";

export type InvoiceData = {
  id: string;
  organizationId: string;
  salesId: string | null;
  number: string | null;
  status: string;
  currency: string | null;
  totalAmount: number | null;
  amountRaw: string | null;
  paymentTermDays: number | null;
  issueDate: string | null; // yyyy-mm-dd
  expectedInvoiceDate: string | null; // yyyy-mm-dd
  issuerName: string | null;
  servicesDescription: string | null;
  contractRef: string | null;
  fileUrls: string | null;
};

type DealOption = { salesId: string; title: string };

export function InvoiceFormDialog({
  trigger,
  invoice,
  organizations,
  deals,
  defaultSalesId,
  defaultOrganizationId,
}: {
  trigger: React.ReactNode;
  invoice?: InvoiceData;
  organizations: { id: string; name: string }[];
  deals: DealOption[];
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
  const editing = !!invoice;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formRef.current) return;
    if (!organizationId) return toast({ title: "Select an organization", variant: "error" });
    setBusy(true);
    const fd = new FormData(formRef.current);
    fd.set("organizationId", organizationId);
    fd.set("salesId", salesId);
    const res = editing ? await updateInvoiceAction(invoice!.id, fd) : await createInvoiceAction(fd);
    setBusy(false);
    if (res.error) return toast({ title: res.error, variant: "error" });
    toast({ title: editing ? "Invoice updated" : "Invoice created", variant: "success" });
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
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
                defaultValue={invoice?.currency ?? DEFAULT_INVOICE_CURRENCY}
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
              <Label htmlFor="issuerName">Issuer</Label>
              <select
                id="issuerName"
                name="issuerName"
                defaultValue={invoice?.issuerName ?? DEFAULT_INVOICE_ISSUER}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {INVOICE_ISSUER_OPTIONS.map((issuer) => (
                  <option key={issuer} value={issuer}>
                    {issuer}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="amountRaw">Amount (free text)</Label>
              <Input id="amountRaw" name="amountRaw" defaultValue={invoice?.amountRaw ?? ""} placeholder="e.g. 2750 USD + TVA" />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="servicesDescription">Services</Label>
              <Textarea id="servicesDescription" name="servicesDescription" defaultValue={invoice?.servicesDescription ?? ""} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="contractRef">Contract reference</Label>
              <Input id="contractRef" name="contractRef" defaultValue={invoice?.contractRef ?? ""} placeholder="Nr. 234/15.11.2022" />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? "Save changes" : "Create invoice"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
