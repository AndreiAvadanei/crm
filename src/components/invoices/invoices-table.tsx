"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DeleteButton } from "@/components/shared/delete-button";
import { HintPopover } from "@/components/shared/hint-popover";
import { GenerateInvoiceDialog } from "@/components/invoices/generate-invoice-dialog";
import { deleteInvoiceAction } from "@/server/invoice-actions";
import type { InvoiceRow } from "@/lib/invoice-stats";
import { INVOICE_STATUS_LABELS } from "@/lib/invoice-constants";
import { formatDate } from "@/lib/utils";

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

function statusVariant(status: InvoiceRow["status"]): "default" | "success" | "warning" | "secondary" {
  switch (status) {
    case "GENERATA":
      return "default";
    case "TRIMISA_LA_CONTABILITATE":
      return "success";
    case "IN_ASTEPTARE":
      return "warning";
    default:
      return "secondary";
  }
}

function formatAmount(value: number | null, currency: string | null): string {
  if (value == null) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: (currency || "RON").toUpperCase(), maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency ?? ""}`.trim();
  }
}

export function InvoicesTable({ invoices, canManage }: { invoices: InvoiceRow[]; canManage: boolean }) {
  return (
    <div className="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Number</TableHead>
            <TableHead>Organization</TableHead>
            <TableHead>Client</TableHead>
            <TableHead>Deal</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead>Issued</TableHead>
            <TableHead>Expected</TableHead>
            <TableHead className="text-right">Documents</TableHead>
            {canManage && <TableHead className="w-px text-right">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.map((i) => (
            <TableRow key={i.id}>
              <TableCell>
                <div className="flex items-center gap-1.5">
                  <Link href={`/invoices/${i.id}`} className="font-medium hover:text-primary">
                    {i.number || i.externalRef || "(no number)"}
                  </Link>
                  {i.servicesDescription && (
                    <HintPopover label="Show services">
                      <span className="font-medium">Services</span>
                      <div className="mt-1">{i.servicesDescription}</div>
                    </HintPopover>
                  )}
                </div>
              </TableCell>
              <TableCell className="max-w-[16rem] truncate">
                <Link
                  href={`/organizations?q=${encodeURIComponent(i.organizationName)}`}
                  className="hover:text-primary"
                  title={`Go to ${i.organizationName}`}
                >
                  {i.organizationName}
                </Link>
              </TableCell>
              <TableCell>
                {i.clientId ? (
                  <Link href={`/clients/${i.clientId}`} className="hover:text-primary">
                    {i.clientName}
                  </Link>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {i.salesId ? (
                  i.hasDeal ? (
                    <Link href={`/deals/${i.salesId}`} className="hover:text-primary">
                      {i.salesId}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground" title="Deal not found in CRM">
                      {i.salesId}
                    </span>
                  )
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell>
                <Badge variant={statusVariant(i.status)}>{INVOICE_STATUS_LABELS[i.status]}</Badge>
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatAmount(i.totalAmount, i.currency)}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{formatDate(i.issueDate)}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{formatDate(i.expectedInvoiceDate)}</TableCell>
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
          ))}
          {invoices.length === 0 && (
            <TableRow>
              <TableCell colSpan={canManage ? 10 : 9} className="py-10 text-center text-sm text-muted-foreground">
                No invoices found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
