"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";

export function InsightsIssuerSwitcher({
  issuers,
  selected,
}: {
  issuers: { id: string; name: string }[];
  /** Active value: "all" for overall, otherwise the issuer name. */
  selected: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  if (issuers.length === 0) return null;

  function go(value: string) {
    const sp = new URLSearchParams(Array.from(params.entries()));
    sp.set("issuer", value);
    startTransition(() => router.replace(`${pathname}?${sp.toString()}`));
  }

  const options = [{ key: "all", label: "Overall" }, ...issuers.map((i) => ({ key: i.name, label: i.name }))];

  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg border bg-card p-1">
      {options.map((opt) => {
        const active = selected === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => go(opt.key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
