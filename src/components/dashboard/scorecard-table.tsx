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

const GROWTH_COLOR = "text-[var(--success)]";
const LOSS_COLOR = "text-destructive";

const GRAN_OPTIONS: { value: Granularity; label: string }[] = [
  { value: "quarter", label: "Trimestrial" },
  { value: "semester", label: "Semestrial" },
  { value: "year", label: "Anual" },
];

/**
 * URL-driven granularity switch (writes `gran` to the query string). Reusable
 * across the dashboard scorecard and the seller insights page.
 */
export function GranularityToggle({
  granularity,
  size = "md",
}: {
  granularity: Granularity;
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const setGran = useCallback(
    (g: Granularity) => {
      const next = new URLSearchParams(params.toString());
      next.set("gran", g);
      startTransition(() =>
        router.replace(`${pathname}?${next.toString()}`, { scroll: false })
      );
    },
    [params, pathname, router]
  );

  return (
    <div className={cn("inline-flex rounded-md border p-0.5", pending && "opacity-60")}>
      {GRAN_OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => setGran(o.value)}
          className={cn(
            "rounded font-medium transition-colors",
            size === "sm" ? "px-2.5 py-1 text-[11px]" : "px-3 py-1 text-xs",
            granularity === o.value ? "segment-active" : "segment-inactive"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Cell({ cell, total }: { cell: ScorecardCell; total?: boolean }) {
  if (cell.empty) {
    return <span className="text-xs text-muted-foreground/50">—</span>;
  }
  const win = cell.winRate ?? 0;
  const winColor =
    win >= 50 ? GROWTH_COLOR : win >= 25 ? "text-[var(--warning)]" : LOSS_COLOR;
  return (
    <div className="space-y-0.5">
      <div className="flex items-baseline gap-1">
        <span className={cn("text-sm font-semibold tabular-nums", winColor)}>
          {Math.round(win)}%
        </span>
        <span className="text-[10px] text-muted-foreground">win</span>
      </div>
      <div
        className={cn(
          "tabular-nums",
          GROWTH_COLOR,
          total ? "text-sm font-semibold" : "text-sm font-medium"
        )}
      >
        {formatCurrency(cell.totalValue)}
      </div>
      <div className="flex gap-1 text-[11px] tabular-nums">
        <span className={GROWTH_COLOR}>{cell.wonCount}W</span>
        <span className="text-muted-foreground">/</span>
        <span className={LOSS_COLOR}>{cell.lostCount}L</span>
      </div>
      {cell.lostValue > 0 && (
        <div className={cn("text-[11px] font-medium tabular-nums", LOSS_COLOR)}>
          −{formatCurrency(cell.lostValue)} · {Math.round(cell.lossRate ?? 0)}% loss
        </div>
      )}
    </div>
  );
}

/**
 * Presentational year × period grid. Stateless so it can be rendered many
 * times (e.g. once per seller) without each instance owning a control.
 */
export function ScorecardGrid({
  scorecard,
  emptyLabel = "No closed deals yet to build the scorecard.",
}: {
  scorecard: Scorecard;
  emptyLabel?: string;
}) {
  if (scorecard.rows.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }
  return (
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
  );
}

export function ScorecardTable({
  scorecard,
  granularity,
}: {
  scorecard: Scorecard;
  granularity: Granularity;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Scorecard</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Win rate, value, counts &amp; loss rate by year × period.
          </p>
        </div>
        <GranularityToggle granularity={granularity} />
      </CardHeader>
      <CardContent>
        <ScorecardGrid scorecard={scorecard} />
      </CardContent>
    </Card>
  );
}
