"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";

export type CurrencyTotalItem = { currency: string; total: number };
export type IssuerTotalItem = { issuerName: string | null; count: number; totals: CurrencyTotalItem[] };

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

function CurrencyLines({ totals }: { totals: CurrencyTotalItem[] }) {
  if (totals.length === 0) return <div className="text-base font-semibold tabular-nums">—</div>;
  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      {totals.map((t) => (
        <div key={t.currency} className="text-base font-semibold leading-tight tabular-nums">
          {fmt(t.total)} <span className="text-xs font-normal text-muted-foreground">{t.currency}</span>
        </div>
      ))}
    </div>
  );
}

export function IssuerTotals({ totals }: { totals: IssuerTotalItem[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const active = params.get("issuer") ?? "";

  if (totals.length === 0) return null;

  function select(name: string) {
    const sp = new URLSearchParams(Array.from(params.entries()));
    if (active === name || !name) sp.delete("issuer");
    else sp.set("issuer", name);
    sp.delete("page");
    startTransition(() => router.replace(`${pathname}?${sp.toString()}`));
  }

  // Aggregate every issuer's per-currency totals for the "All issuers" card.
  const allMap = new Map<string, number>();
  let allCount = 0;
  for (const issuer of totals) {
    allCount += issuer.count;
    for (const t of issuer.totals) allMap.set(t.currency, (allMap.get(t.currency) ?? 0) + t.total);
  }
  const allTotals = Array.from(allMap.entries())
    .map(([currency, total]) => ({ currency, total }))
    .sort((a, b) => b.total - a.total);

  const cardClass = (isActive: boolean) =>
    `flex items-center gap-3 rounded-lg border px-3 py-1.5 text-left transition-colors ${
      isActive ? "border-primary/50 bg-primary/5" : "border-border hover:bg-muted/50"
    }`;

  return (
    <div className="flex flex-wrap items-stretch gap-2">
      <button type="button" onClick={() => select("")} className={cardClass(active === "")}>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">All issuers · {allCount}</div>
          <CurrencyLines totals={allTotals} />
        </div>
      </button>
      {totals.map((t) => {
        const name = t.issuerName ?? "";
        const label = t.issuerName ?? "No issuer";
        const isActive = active === name && name !== "";
        return (
          <button key={label} type="button" onClick={() => select(name)} className={cardClass(isActive)} title={label}>
            <div className="min-w-0">
              <div className="truncate text-xs text-muted-foreground" style={{ maxWidth: 200 }}>{label} · {t.count}</div>
              <CurrencyLines totals={t.totals} />
            </div>
          </button>
        );
      })}
    </div>
  );
}
