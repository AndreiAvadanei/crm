"use client";

import { useCallback, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** Shared filter controls; drive everything through URL search params. */
export function DashboardFilters({
  showComparison = true,
  sellerOptions = [],
}: {
  showComparison?: boolean;
  sellerOptions?: { value: string; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const update = useCallback(
    (mut: (p: URLSearchParams) => void) => {
      const next = new URLSearchParams(params.toString());
      mut(next);
      startTransition(() =>
        router.replace(`${pathname}?${next.toString()}`, { scroll: false })
      );
    },
    [params, pathname, router]
  );

  const setParam = (key: string, value: string | null) =>
    update((p) => (value ? p.set(key, value) : p.delete(key)));

  const active = params.get("active") === "1";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const cmp = params.get("cmp") === "1";
  const cmpMonths = params.get("cmpMonths") ?? "3";
  const cmpCount = params.get("cmpCount") ?? "4";
  const seller = params.get("seller") ?? "all";

  return (
    <div className={cn("flex flex-wrap items-end gap-3", pending && "opacity-70")}>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">From</label>
        <input
          type="date"
          value={from}
          onChange={(e) => setParam("from", e.target.value || null)}
          className="form-control h-9 px-3"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">To</label>
        <input
          type="date"
          value={to}
          onChange={(e) => setParam("to", e.target.value || null)}
          className="form-control h-9 px-3"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">Scope</label>
        <div className="segment-track h-9">
          <button
            type="button"
            onClick={() => setParam("active", null)}
            className={cn(
              "rounded-full px-3 text-xs font-medium transition-colors",
              !active ? "segment-active" : "segment-inactive"
            )}
          >
            All deals
          </button>
          <button
            type="button"
            onClick={() => setParam("active", "1")}
            className={cn(
              "rounded-full px-3 text-xs font-medium transition-colors",
              active ? "segment-active" : "segment-inactive"
            )}
          >
            Active only
          </button>
        </div>
      </div>

      {sellerOptions.length > 0 && (
        <div className="flex w-48 flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Sales</label>
          <Select
            value={seller}
            onValueChange={(v) => setParam("seller", v === "all" ? null : v)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sales</SelectItem>
              {sellerOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {(from || to || active || seller !== "all") && (
        <button
          type="button"
          onClick={() =>
            update((p) => {
              p.delete("from");
              p.delete("to");
              p.delete("active");
              p.delete("seller");
            })
          }
          className="h-9 rounded-full px-3 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          Reset
        </button>
      )}

      {showComparison && (
        <div className="ml-auto flex items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Compare</label>
            <div className="segment-track h-9">
              <button
                type="button"
                onClick={() => setParam("cmp", null)}
                className={cn(
                  "rounded-full px-3 text-xs font-medium transition-colors",
                  !cmp ? "segment-active" : "segment-inactive"
                )}
              >
                Off
              </button>
              <button
                type="button"
                onClick={() => setParam("cmp", "1")}
                className={cn(
                  "rounded-full px-3 text-xs font-medium transition-colors",
                  cmp ? "segment-active" : "segment-inactive"
                )}
              >
                On
              </button>
            </div>
          </div>

          {cmp && (
            <>
              <div className="flex w-28 flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">Every</label>
                <Select value={cmpMonths} onValueChange={(v) => setParam("cmpMonths", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 month</SelectItem>
                    <SelectItem value="3">3 months</SelectItem>
                    <SelectItem value="6">6 months</SelectItem>
                    <SelectItem value="12">12 months</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex w-24 flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">Periods</label>
                <Select value={cmpCount} onValueChange={(v) => setParam("cmpCount", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[2, 3, 4, 6, 8].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
