"use client";

import * as React from "react";
import { Copy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { InvoiceFormDialog, type InvoiceData } from "@/components/invoices/invoice-form-dialog";
import { getInvoiceForDuplicateAction } from "@/server/invoice-actions";
import type { PartNumberOption } from "@/lib/part-numbers";

/**
 * Row action that copies an existing invoice's settings + articles into a fresh
 * "New invoice" dialog. The full template (including articles) is loaded on demand,
 * then the create form opens pre-filled so the user can tweak and save a new record.
 */
export function DuplicateInvoiceButton({
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
  const [template, setTemplate] = React.useState<InvoiceData | null>(null);

  async function onClick() {
    setLoading(true);
    const res = await getInvoiceForDuplicateAction(invoiceId);
    setLoading(false);
    if (res.error || !res.invoice) {
      return toast({ title: res.error ?? "Could not load invoice.", variant: "error" });
    }
    setTemplate(res.invoice);
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onClick}
        disabled={loading}
        title="Duplicate to new invoice"
        aria-label="Duplicate to new invoice"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
      </Button>
      {template && (
        <InvoiceFormDialog
          duplicate
          autoOpen
          invoice={template}
          organizations={organizations}
          deals={deals}
          issuers={issuers}
          series={series}
          partNumbers={partNumbers}
          finalClients={finalClients}
          onClose={() => setTemplate(null)}
        />
      )}
    </>
  );
}
