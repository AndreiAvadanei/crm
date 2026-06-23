"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";
import { X } from "lucide-react";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "GENERATA", label: "Generated" },
  { value: "TRIMISA_LA_CONTABILITATE", label: "Sent to accounting" },
  { value: "IN_ASTEPTARE", label: "Pending" },
  { value: "OTHER", label: "Other" },
];

export function InvoiceFilters({
  currencies,
  appliedOrgName,
}: {
  currencies: string[];
  appliedOrgName?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  function setParam(key: string, value: string) {
    const sp = new URLSearchParams(Array.from(params.entries()));
    if (value) sp.set(key, value);
    else sp.delete(key);
    sp.delete("page");
    startTransition(() => router.replace(`${pathname}?${sp.toString()}`));
  }

  const selectClass = "h-9 rounded-md border border-input bg-background px-3 text-sm";
  const orgApplied = params.get("organization");

  return (
    <div className="flex flex-wrap items-center gap-3">
      {orgApplied && (
        <span className="inline-flex h-9 items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 text-sm text-primary">
          <span className="text-muted-foreground">Organization:</span>
          <span className="font-medium">{appliedOrgName ?? orgApplied}</span>
          <button
            type="button"
            aria-label="Remove organization filter"
            className="-mr-1 rounded p-0.5 hover:bg-primary/20"
            onClick={() => setParam("organization", "")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      )}
      <select className={selectClass} value={params.get("status") ?? ""} onChange={(e) => setParam("status", e.target.value)}>
        {STATUS_OPTIONS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      {currencies.length > 0 && (
        <select className={selectClass} value={params.get("currency") ?? ""} onChange={(e) => setParam("currency", e.target.value)}>
          <option value="">All currencies</option>
          {currencies.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
