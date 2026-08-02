"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { downloadInvoiceSagaXmlAction } from "@/server/saga-actions";
import { PERSONALIZATION_BLOCK_MESSAGE } from "@/lib/invoice-issue-guard";

/** Save an in-memory XML string to the user's machine as a file download. */
export function saveXmlFile(filename: string, xml: string) {
  const blob = new Blob([xml], { type: "application/xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Single-invoice "Download XML" button. Assigns the FacturaNumar on first issue. */
export function SagaXmlDownloadButton({ invoiceId, needsPersonalization = false }: { invoiceId: string; needsPersonalization?: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);

  async function onClick() {
    setBusy(true);
    const res = await downloadInvoiceSagaXmlAction(invoiceId);
    setBusy(false);
    if (res.error || !res.xml || !res.filename) {
      return toast({ title: res.error || "Could not generate XML", variant: "error" });
    }
    saveXmlFile(res.filename, res.xml);
    if (res.warnings && res.warnings.length) {
      toast({ title: `Downloaded with ${res.warnings.length} note(s)`, description: res.warnings.join(" · "), variant: "info" });
    }
    router.refresh();
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      disabled={busy || needsPersonalization}
      title={needsPersonalization ? PERSONALIZATION_BLOCK_MESSAGE : undefined}
    >
      {busy ? <Loader2 className="animate-spin" /> : <Download />} Download XML
    </Button>
  );
}
