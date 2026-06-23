"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";
import { ArrowUpDown } from "lucide-react";
import { CLIENT_SORT_OPTIONS, type ClientSort } from "@/lib/client-sort";

const VALID = new Set<string>(CLIENT_SORT_OPTIONS.map((o) => o.value));

export function ClientSortSelect() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const raw = params.get("sort") ?? "recent";
  const current: ClientSort = (VALID.has(raw) ? raw : "recent") as ClientSort;

  function update(next: string) {
    const sp = new URLSearchParams(Array.from(params.entries()));
    if (next && next !== "recent") sp.set("sort", next);
    else sp.delete("sort");
    sp.delete("page");
    startTransition(() => router.replace(`${pathname}?${sp.toString()}`));
  }

  return (
    <div className="relative">
      <ArrowUpDown className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <select
        value={current}
        onChange={(e) => update(e.target.value)}
        aria-label="Sort clients"
        className="form-control h-9 cursor-pointer pl-8 pr-8"
      >
        {CLIENT_SORT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
