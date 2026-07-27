"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { prepareGenerateInvoiceAction } from "@/server/invoice-actions";

export type OrganizationBillingInfo = {
  legalName: string | null;
  taxId: string | null;
  regNumber: string | null;
  bankName: string | null;
  iban: string | null;
  address: string | null;
  country: string | null;
};

export type GenerateInvoiceInfo = {
  id: string;
  number: string | null;
  externalRef: string | null;
  organizationName: string;
  clientName: string | null;
  salesId: string | null;
  issuerName: string | null;
  totalBaseAmount: number | null;
  vatAmount: number | null;
  totalAmount: number | null;
  predictedBaseAmount: number | null;
  predictedTotalAmount: number | null;
  articlesSummary: string | null;
  articleCount: number;
  currency: string | null;
  paymentTermDays: number | null;
  org: OrganizationBillingInfo;
};

function fmtMoney(value: number | null, currency: string | null): string {
  if (value == null) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: (currency || "RON").toUpperCase(), maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency ?? ""}`.trim();
  }
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

export function GenerateInvoiceDialog({ invoice, trigger }: { invoice: GenerateInvoiceInfo; trigger?: React.ReactNode }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function onConfirm() {
    setBusy(true);
    const res = await prepareGenerateInvoiceAction(invoice.id);
    setBusy(false);
    if (res.error) return toast({ title: res.error, variant: "error" });
    toast({ title: "Invoice email sent", variant: "success" });
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button type="button" variant="outline" size="sm">
            Generate invoice
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Generate invoice?</DialogTitle>
          <DialogDescription>Confirm the invoice data before sending the billing request through Postmark.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-2 rounded-lg border p-3 text-sm">
            <InfoRow label="Organization" value={invoice.organizationName} />
            <InfoRow label="Client" value={invoice.clientName ?? "—"} />
            <InfoRow label="Deal" value={invoice.salesId ?? "—"} />
            <InfoRow label="Issuer" value={invoice.issuerName ?? "—"} />
            <InfoRow label="Currency" value={invoice.currency ?? "—"} />
            <InfoRow label="Payment term" value={invoice.paymentTermDays ? `${invoice.paymentTermDays} days` : "—"} />
            {(() => {
              const base = invoice.totalBaseAmount ?? invoice.predictedBaseAmount;
              const total = invoice.totalAmount ?? invoice.predictedTotalAmount;
              const vat = invoice.vatAmount ?? (total != null && base != null ? Math.round((total - base) * 100) / 100 : null);
              const predicted = invoice.totalBaseAmount == null;
              return (
                <>
                  <InfoRow label="Articles" value={invoice.articleCount} />
                  <InfoRow label="Net total" value={fmtMoney(base, invoice.currency)} />
                  <InfoRow label="VAT" value={fmtMoney(vat, invoice.currency)} />
                  <InfoRow
                    label="Total (incl. VAT)"
                    value={
                      <>
                        {fmtMoney(total, invoice.currency)}
                        {predicted && total != null && (
                          <span className="ml-1 text-xs font-normal text-muted-foreground">(from articles)</span>
                        )}
                      </>
                    }
                  />
                </>
              );
            })()}
            {invoice.articlesSummary && (
              <div className="pt-2">
                <div className="text-xs font-medium text-muted-foreground">Services</div>
                <div className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap rounded bg-muted/40 p-2 text-xs">
                  {invoice.articlesSummary}
                </div>
              </div>
            )}
          </div>
          <div className="grid gap-2 rounded-lg border p-3 text-sm">
            <div className="text-xs font-medium text-muted-foreground">Organization billing details</div>
            <InfoRow label="Legal name" value={invoice.org.legalName || invoice.organizationName} />
            <InfoRow label="Tax ID (CUI)" value={invoice.org.taxId ?? "—"} />
            <InfoRow label="Reg. number" value={invoice.org.regNumber ?? "—"} />
            <InfoRow label="Bank" value={invoice.org.bankName ?? "—"} />
            <InfoRow label="IBAN" value={invoice.org.iban ?? "—"} />
            <InfoRow label="Address" value={invoice.org.address ?? "—"} />
            <InfoRow label="Country" value={invoice.org.country ?? "—"} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" onClick={onConfirm} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Send
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
