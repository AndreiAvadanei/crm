"use client";

import { useCallback, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn, formatCurrency } from "@/lib/utils";
import type { Granularity, Scorecard, ScorecardCell } from "@/lib/analytics";

const GRAN_OPTIONS: { value: Granularity; label: string }[] = [
  { value: "quarter", label: "Trimestrial" },
  { value: "semester", label: "Semestrial" },
  { value: "year", label: "Anual" },
];

function Cell({ cell, total }: { cell: ScorecardCell; total?: boolean }) {
  if (cell.empty) {
    return <span className="text-xs text-muted-foreground/50">—</span>;
  }
  const win = cell.winRate ?? 0;
  const winColor =
    win >= 50 ? "text-[var(--success)]" : win >= 25 ? "text-[var(--warning)]" : "text-destructive";
  return (
    <div className="space-y-0.5">
      <div className="flex items-baseline gap-1">
        <span className={cn("text-sm font-semibold tabular-nums", winColor)}>
          {Math.round(win)}%
        </span>
        <span className="text-[10px] text-muted-foreground">win</span>
      </div>
      <div className={cn("tabular-nums", total ? "text-sm font-semibold" : "text-sm font-medium")}>
        {formatCurrency(cell.totalValue)}
      </div>
      <div className="text-[11px] text-muted-foreground tabular-nums">
        {cell.wonCount}W / {cell.lostCount}L
      </div>
      {cell.lostValue > 0 && (
        <div className="text-[11px] text-destructive/80 tabular-nums">
          −{formatCurrency(cell.lostValue)} · {Math.round(cell.lossRate ?? 0)}% loss
        </div>
      )}
    </div>
  );
}

export function ScorecardTable({
  scorecard,
  granularity,
}: {
  scorecard: Scorecard;
  granularity: Granularity;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const setGran = useCallback(
    (g: Granularity) => {
      const next = new URLSearchParams(params.toString());
      next.set("gran", g);
      startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
    },
    [params, pathname, router]
  );

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Scorecard</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Win rate, value, counts &amp; loss rate by year × period.
          </p>
        </div>
        <div className="inline-flex rounded-md border p-0.5">
          {GRAN_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setGran(o.value)}
              className={cn(
                "rounded px-3 py-1 text-xs font-medium transition-colors",
                granularity === o.value
                  ? "segment-active"
                  : "segment-inactive"
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className={cn(pending && "opacity-60 transition-opacity")}>
        {scorecard.rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No closed deals yet to build the scorecard.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Year</TableHead>
                {scorecard.periods.map((p) => (
                  <TableHead key={p}>{p}</TableHead>
                ))}
                <TableHead className="bg-muted/30">Total year</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scorecard.rows.map((row) => (
                <TableRow key={row.year}>
                  <TableCell className="font-semibold tabular-nums">{row.year}</TableCell>
                  {row.cells.map((c, i) => (
                    <TableCell key={i} className="align-top">
                      <Cell cell={c} />
                    </TableCell>
                  ))}
                  <TableCell className="bg-muted/30 align-top">
                    <Cell cell={row.total} total />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
