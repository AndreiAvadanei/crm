"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InvoiceFormDialog } from "@/components/invoices/invoice-form-dialog";
import { INVOICE_STATUS_LABELS } from "@/lib/invoice-constants";
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
}: {
  title?: string;
  invoices: InvoiceListItem[];
  /** Provide to show an "Add invoice" action. */
  add?: {
    organizations: { id: string; name: string }[];
    deals: { salesId: string; title: string }[];
    defaultSalesId?: string;
    defaultOrganizationId?: string;
  };
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>
          {title} ({invoices.length})
        </CardTitle>
        {add && add.organizations.length > 0 && (
          <InvoiceFormDialog
            organizations={add.organizations}
            deals={add.deals}
            defaultSalesId={add.defaultSalesId}
            defaultOrganizationId={add.defaultOrganizationId}
            trigger={
              <Button variant="ghost" size="icon" aria-label="Add invoice">
                <Plus className="h-4 w-4" />
              </Button>
            }
          />
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {invoices.map((i) => (
          <Link
            key={i.id}
            href={`/invoices/${i.id}`}
            className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 hover:bg-accent"
          >
            <div className="min-w-0">
              <div className="font-medium">{i.number || i.externalRef || "(no number)"}</div>
              <div className="truncate text-xs text-muted-foreground">{i.organizationName}</div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <Badge variant="secondary">{INVOICE_STATUS_LABELS[i.status]}</Badge>
              <span className="tabular-nums text-sm">{fmt(i.totalAmount, i.currency)}</span>
              <span className="hidden text-xs text-muted-foreground sm:inline">{formatDate(i.issueDate)}</span>
            </div>
          </Link>
        ))}
        {invoices.length === 0 && <p className="text-sm text-muted-foreground">No invoices yet.</p>}
      </CardContent>
    </Card>
  );
}
