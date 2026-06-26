"use client";

import * as React from "react";
import { ClientCombobox } from "@/components/shared/client-combobox";
import { getRelatedInvoiceOptionsAction, type RelatedInvoiceOption } from "@/server/part-number-actions";

function label(o: RelatedInvoiceOption): string {
  const parts = [o.number || "(no number)"];
  if (o.issueDate) parts.push(o.issueDate);
  if (o.amount) parts.push(`${o.amount}${o.currency ? ` ${o.currency}` : ""}`);
  return parts.join(" · ");
}

export function RelatedInvoicePicker({
  organizationId,
  value,
  onChange,
  excludeInvoiceId,
}: {
  organizationId: string;
  value: string;
  onChange: (next: string, option: RelatedInvoiceOption | null) => void;
  excludeInvoiceId?: string;
}) {
  const [options, setOptions] = React.useState<RelatedInvoiceOption[]>([]);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    if (!organizationId) {
      setOptions([]);
      return;
    }
    setBusy(true);
    getRelatedInvoiceOptionsAction(organizationId, excludeInvoiceId)
      .then((res) => {
        if (!active) return;
        setOptions(res.options ?? []);
      })
      .finally(() => active && setBusy(false));
    return () => {
      active = false;
    };
  }, [organizationId, excludeInvoiceId]);

  return (
    <ClientCombobox
      value={value}
      busy={busy}
      options={options.map((o) => ({
        value: o.id,
        label: label(o),
        searchText: [o.number, o.organizationName, o.amount].filter(Boolean).join(" "),
      }))}
      onChange={(next) => onChange(next, options.find((o) => o.id === next) ?? null)}
      placeholder={organizationId ? "No related invoice" : "Select an organization first"}
      searchPlaceholder="Search this customer's invoices…"
      emptyText={organizationId ? "No other invoices for this customer." : "Select an organization first."}
    />
  );
}
