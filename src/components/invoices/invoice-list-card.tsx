"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InvoiceFormDialog } from "@/components/invoices/invoice-form-dialog";
import { INVOICE_STATUS_LABELS, invoiceStatusVariant } from "@/lib/invoice-constants";
import { formatDate } from "@/lib/utils";

export type InvoiceListItem = {
  id: string;
  number: string | null;
  externalRef: string | null;
  organizationName: string;
  status: keyof typeof INVOICE_STATUS_LABELS;
  totalAmount: number | null;
  currency: string | null;
  issueDate: string | null;
};

function fmt(value: number | null, currency: string | null): string {
  if (value == null) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: (currency || "RON").toUpperCase(), maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency ?? ""}`.trim();
  }
}

export function InvoiceListCard({
  title = "Invoices",
  invoices,
  add,
  bare = false,
}: {
  title?: string;
  invoices: InvoiceListItem[];
  /** Provide to show an "Add invoice" action. */
  add?: {
    organizations: { id: string; name: string; defaultVatPercent?: number; configuredTvaPercent?: number }[];
    deals: { salesId: string; title: string }[];
    finalClients?: { id: string; name: string }[];
    defaultSalesId?: string;
    defaultOrganizationId?: string;
  };
  /** Render without the surrounding Card/header (e.g. inside a tab). */
  bare?: boolean;
}) {
  const list = (
    <div className="min-w-0 space-y-2">
      {invoices.map((i) => (
        <Link
          key={i.id}
          href={`/invoices/${i.id}`}
          className="flex min-w-0 items-start justify-between gap-3 rounded-lg border px-3 py-2 hover:bg-accent sm:items-center"
        >
          <div className="min-w-0 overflow-hidden">
            <div className="truncate font-medium">{i.number || i.externalRef || "(no number)"}</div>
            <div className="truncate text-xs text-muted-foreground">{i.organizationName}</div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 sm:hidden">
              <Badge variant={invoiceStatusVariant(i.status)}>{INVOICE_STATUS_LABELS[i.status]}</Badge>
              <span
                className={`tabular-nums text-sm ${i.totalAmount != null && i.totalAmount < 0 ? "text-destructive" : ""}`}
              >
                {fmt(i.totalAmount, i.currency)}
              </span>
            </div>
          </div>
          <div className="hidden shrink-0 items-center gap-3 sm:flex">
            <Badge variant={invoiceStatusVariant(i.status)}>{INVOICE_STATUS_LABELS[i.status]}</Badge>
            <span
              className={`tabular-nums text-sm ${i.totalAmount != null && i.totalAmount < 0 ? "text-destructive" : ""}`}
            >
              {fmt(i.totalAmount, i.currency)}
            </span>
            <span className="text-xs text-muted-foreground">{formatDate(i.issueDate)}</span>
          </div>
        </Link>
      ))}
      {invoices.length === 0 && <p className="text-sm text-muted-foreground">No invoices yet.</p>}
    </div>
  );

  const addButton = add && add.organizations.length > 0 && (
    <InvoiceFormDialog
      organizations={add.organizations}
      deals={add.deals}
      finalClients={add.finalClients}
      defaultSalesId={add.defaultSalesId}
      defaultOrganizationId={add.defaultOrganizationId}
      trigger={
        bare ? (
          <Button variant="outline" size="sm">
            <Plus className="h-4 w-4" /> Add invoice
          </Button>
        ) : (
          <Button variant="ghost" size="icon" aria-label="Add invoice">
            <Plus className="h-4 w-4" />
          </Button>
        )
      }
    />
  );

  if (bare) {
    return (
      <div className="space-y-3">
        {addButton && <div className="flex justify-end">{addButton}</div>}
        {list}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>
          {title} ({invoices.length})
        </CardTitle>
        {addButton}
      </CardHeader>
      <CardContent>{list}</CardContent>
    </Card>
  );
}
