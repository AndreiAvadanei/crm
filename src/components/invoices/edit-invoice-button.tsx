"use client";

import * as React from "react";
import { Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { InvoiceFormDialog, type InvoiceData } from "@/components/invoices/invoice-form-dialog";
import { getInvoiceForEditAction } from "@/server/invoice-actions";
import type { PartNumberOption } from "@/lib/part-numbers";

/**
 * Row action that opens the invoice edit dialog in place. The full record
 * (including articles) is only loaded when the button is clicked, so listing a
 * page of invoices stays cheap.
 */
export function EditInvoiceButton({
  invoiceId,
  organizations,
  deals,
  issuers,
  series,
  partNumbers,
  finalClients,
}: {
  invoiceId: string;
  organizations: { id: string; name: string; defaultVatPercent?: number; configuredTvaPercent?: number }[];
  deals: { salesId: string; title: string }[];
  issuers?: { id: string; name: string }[];
  series?: { id: string; prefix: string; nextNumber: number }[];
  partNumbers?: PartNumberOption[];
  finalClients?: { id: string; name: string }[];
}) {
  const { toast } = useToast();
  const [loading, setLoading] = React.useState(false);
  const [invoice, setInvoice] = React.useState<InvoiceData | null>(null);

  async function onClick() {
    setLoading(true);
    const res = await getInvoiceForEditAction(invoiceId);
    setLoading(false);
    if (res.error || !res.invoice) {
      return toast({ title: res.error ?? "Could not load invoice.", variant: "error" });
    }
    setInvoice(res.invoice);
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onClick}
        disabled={loading}
        title="Edit invoice"
        aria-label="Edit invoice"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
      </Button>
      {invoice && (
        <InvoiceFormDialog
          autoOpen
          invoice={invoice}
          organizations={organizations}
          deals={deals}
          issuers={issuers}
          series={series}
          partNumbers={partNumbers}
          finalClients={finalClients}
          onClose={() => setInvoice(null)}
        />
      )}
    </>
  );
}
