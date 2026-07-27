"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Share2 } from "lucide-react";
import { quickUpdateDealAction } from "@/server/quick-actions";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { TagView } from "@/components/shared/tag-badge";
import { InlineInput, InlineSelect, InlineTagEditor } from "@/components/shared/inline-edit";
import { ShareControl } from "@/components/deals/share-control";
import { formatCurrency, formatDate, cn } from "@/lib/utils";

export type DealRow = {
  id: string;
  salesId: string;
  title: string;
  clientName: string | null;
  stageId: string;
  amountEur: number | null;
  dueDate: string | null; // yyyy-mm-dd
  overdue: boolean;
  ownerId: string | null;
  ownerName: string | null;
  ownerColor: string | null;
  tagIds: string[];
};

export type ShareUserRow = { id: string; name: string; color: string };

export type TableStage = { id: string; name: string; color: string; phase: string | null };

// Kept in sync with the kanban board so the table's grouped sections share the
// board's per-stage / per-phase collapse state (localStorage-backed).
const STAGE_KEY = "kanban:collapsedStages";
const PHASE_KEY = "kanban:collapsedPhases";

function loadSet(key: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(key);
    return new Set<string>(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}
function saveSet(key: string, set: Set<string>) {
  try {
    window.localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    /* ignore quota / private-mode errors */
  }
}

/** Derive an rgba() tint from a #rrggbb hex (used for the section header band). */
function hexAlpha(hex: string, alpha: number): string | undefined {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return undefined;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

const phaseKeyOf = (s: TableStage) => s.phase?.trim() || "__other__";

/**
 * Order stages exactly as the board flattens its columns: phase bands ordered
 * by their earliest stage, stages within a band in stage order, and no-phase
 * ("Other") stages last. Keeps the table's section order identical to the board.
 */
function orderStagesLikeBoard(stages: TableStage[]): TableStage[] {
  const groups = new Map<string, TableStage[]>();
  for (const s of stages) {
    const key = phaseKeyOf(s);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(s);
  }
  const ordered = [...groups.entries()]
    .filter(([key]) => key !== "__other__")
    .sort(
      (a, b) =>
        Math.min(...a[1].map((s) => stages.indexOf(s))) -
        Math.min(...b[1].map((s) => stages.indexOf(s)))
    )
    .flatMap(([, ss]) => ss);
  const other = groups.get("__other__");
  return other?.length ? [...ordered, ...other] : ordered;
}

export function DealsTable({
  deals,
  stages,
  owners,
  tags,
  admin,
  shareUsers,
  sharedMap,
}: {
  deals: DealRow[];
  stages: TableStage[];
  owners: { id: string; name: string }[];
  tags: TagView[];
  admin: boolean;
  shareUsers: ShareUserRow[];
  sharedMap: Record<string, string[]>;
}) {
  const colCount = admin ? 9 : 8;

  // Collapse state for the grouped sections, shared with the kanban board via
  // localStorage so a section collapsed in one view stays collapsed in the
  // other (and across reloads). A stage is collapsed here if it's collapsed on
  // the board directly, or its whole phase band is collapsed. Empty on the
  // server/first client render (all expanded) to avoid a hydration mismatch.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const readCollapsed = useCallback(() => {
    const collapsedStages = loadSet(STAGE_KEY);
    const collapsedPhases = loadSet(PHASE_KEY);
    const initial = new Set<string>();
    for (const s of stages) {
      if (collapsedStages.has(s.id) || collapsedPhases.has(phaseKeyOf(s))) initial.add(s.id);
    }
    return initial;
  }, [stages]);

  useEffect(() => {
    setCollapsed(readCollapsed());
    // Reflect collapses made elsewhere (e.g. the board in another tab) live.
    const onStorage = (e: StorageEvent) => {
      if (e.key === STAGE_KEY || e.key === PHASE_KEY) setCollapsed(readCollapsed());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [readCollapsed]);

  const toggle = (stageId: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(stageId) ? next.delete(stageId) : next.add(stageId);
      // Persist to the board's per-stage key so the two views stay in sync.
      // Any phase-derived collapses get materialized as explicit per-stage
      // entries here — harmless, and keeps both views agreeing at stage level.
      saveSet(STAGE_KEY, next);
      return next;
    });

  // Group deals by stage (order preserved = current sort within each section).
  const byStage = new Map<string, DealRow[]>();
  for (const s of stages) byStage.set(s.id, []);
  const orphanDeals: DealRow[] = [];
  for (const d of deals) {
    const bucket = byStage.get(d.stageId);
    if (bucket) bucket.push(d);
    else orphanDeals.push(d);
  }

  const orderedStages = orderStagesLikeBoard(stages);

  return (
    <div className="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>SAL</TableHead>
            <TableHead>Title</TableHead>
            <TableHead>Client</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Tags</TableHead>
            <TableHead>Owner</TableHead>
            <TableHead>Due</TableHead>
            {admin && <TableHead className="text-right">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {orderedStages.map((stage) => {
            const rows = byStage.get(stage.id) ?? [];
            // Skip empty stages entirely — no header clutter for statuses with
            // no deals in the current filter/search.
            if (rows.length === 0) return null;
            const isCollapsed = collapsed.has(stage.id);
            const total = rows.reduce((s, d) => s + (d.amountEur ?? 0), 0);
            return (
              <Fragment key={stage.id}>
                <TableRow className="border-t hover:bg-transparent">
                  <TableCell colSpan={colCount} className="p-0">
                    <button
                      type="button"
                      onClick={() => toggle(stage.id)}
                      aria-expanded={!isCollapsed}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold transition-colors hover:brightness-105"
                      style={{ backgroundColor: hexAlpha(stage.color, 0.12) }}
                    >
                      {isCollapsed ? (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: stage.color }} />
                      <span className="truncate">{stage.name}</span>
                      <span
                        className="rounded-full px-1.5 text-xs font-semibold text-white"
                        style={{ backgroundColor: stage.color }}
                      >
                        {rows.length}
                      </span>
                      <span className="ml-auto text-xs font-medium text-muted-foreground tabular-nums">
                        {formatCurrency(total)}
                      </span>
                    </button>
                  </TableCell>
                </TableRow>
                {!isCollapsed &&
                  rows.map((d) => (
                    <DealTableRow
                      key={d.id}
                      deal={d}
                      stages={stages}
                      owners={owners}
                      tags={tags}
                      admin={admin}
                      shareUsers={shareUsers}
                      sharedMap={sharedMap}
                    />
                  ))}
              </Fragment>
            );
          })}

          {/* Deals whose stage isn't in the current pipeline (defensive). */}
          {orphanDeals.map((d) => (
            <DealTableRow
              key={d.id}
              deal={d}
              stages={stages}
              owners={owners}
              tags={tags}
              admin={admin}
              shareUsers={shareUsers}
              sharedMap={sharedMap}
            />
          ))}

          {deals.length === 0 && (
            <TableRow>
              <TableCell colSpan={colCount} className="py-10 text-center text-sm text-muted-foreground">
                No deals found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function DealTableRow({
  deal: d,
  stages,
  owners,
  tags,
  admin,
  shareUsers,
  sharedMap,
}: {
  deal: DealRow;
  stages: TableStage[];
  owners: { id: string; name: string }[];
  tags: TagView[];
  admin: boolean;
  shareUsers: ShareUserRow[];
  sharedMap: Record<string, string[]>;
}) {
  return (
    <TableRow className={cn(d.overdue && "bg-destructive/5 hover:bg-destructive/10")}>
      <TableCell className="font-mono text-xs text-muted-foreground">
        <span className={cn(d.overdue && "border-l-2 border-l-destructive pl-1.5")}>{d.salesId}</span>
      </TableCell>
      <TableCell>
        <Link href={`/deals/${d.salesId}`} className="font-medium hover:text-primary">
          {d.title}
        </Link>
        {d.overdue && (
          <span className="ml-2 rounded bg-destructive/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-destructive">
            Overdue
          </span>
        )}
      </TableCell>
      <TableCell className="text-sm">{d.clientName ?? "—"}</TableCell>

      {/* Stage — inline select */}
      <TableCell>
        <InlineSelect
          value={d.stageId}
          options={stages.map((s) => ({ value: s.id, label: s.name }))}
          onSave={(stageId) => quickUpdateDealAction(d.id, { stageId })}
        />
      </TableCell>

      {/* Amount — click to edit number */}
      <TableCell className="tabular-nums text-sm">
        <InlineInput
          type="number"
          align="right"
          value={d.amountEur != null ? String(d.amountEur) : ""}
          display={<span className="tabular-nums">{formatCurrency(d.amountEur)}</span>}
          onSave={(raw) => {
            const trimmed = raw.trim();
            const amountEur = trimmed === "" ? null : Number(trimmed);
            if (amountEur != null && !Number.isFinite(amountEur))
              return Promise.resolve({ error: "Invalid amount." });
            return quickUpdateDealAction(d.id, { amountEur });
          }}
        />
      </TableCell>

      {/* Tags — inline popover */}
      <TableCell>
        <InlineTagEditor
          allTags={tags}
          value={d.tagIds}
          onSave={(tagIds) => quickUpdateDealAction(d.id, { tagIds })}
        />
      </TableCell>

      {/* Owner — admin only inline select */}
      <TableCell>
        {admin ? (
          <InlineSelect
            value={d.ownerId ?? ""}
            placeholder="Unassigned"
            options={owners.map((o) => ({ value: o.id, label: o.name }))}
            onSave={(ownerId) => quickUpdateDealAction(d.id, { ownerId: ownerId || null })}
          />
        ) : d.ownerName ? (
          <Avatar name={d.ownerName} color={d.ownerColor} />
        ) : (
          "—"
        )}
      </TableCell>

      {/* Due — click to edit date */}
      <TableCell className={cn("text-xs text-muted-foreground", d.overdue && "font-medium text-destructive")}>
        <InlineInput
          type="date"
          value={d.dueDate ?? ""}
          display={
            d.dueDate ? (
              <span className={cn(d.overdue && "font-medium text-destructive")}>{formatDate(d.dueDate)}</span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )
          }
          onSave={(dueDate) => quickUpdateDealAction(d.id, { dueDate: dueDate || null })}
        />
      </TableCell>

      {/* Inline share (admin) */}
      {admin && (
        <TableCell className="text-right">
          <ShareControl
            dealId={d.id}
            users={shareUsers.map((u) => ({
              id: u.id,
              name: u.name,
              color: u.color,
              shared: (sharedMap[d.id] ?? []).includes(u.id),
            }))}
            trigger={
              <Button variant="ghost" size="icon" title="Share deal">
                <Share2 className="h-4 w-4" />
              </Button>
            }
          />
        </TableCell>
      )}
    </TableRow>
  );
}
