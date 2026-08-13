"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Handshake, ListPlus, Loader2, Share2 } from "lucide-react";
import { quickUpdateDealAction } from "@/server/quick-actions";
import { deleteDealAction } from "@/server/deal-actions";
import { loadStageDealsAction } from "@/server/deal-load-actions";
import type { DealFilterParams, StageTotal } from "@/lib/deal-filter-params";
import { useToast } from "@/components/ui/toast";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { TagView } from "@/components/shared/tag-badge";
import { InlineInput, InlineSelect, InlineTagEditor } from "@/components/shared/inline-edit";
import { ConfirmDeleteButton } from "@/components/shared/confirm-delete-button";
import { ShareControl } from "@/components/deals/share-control";
import { TableEmpty } from "@/components/shared/empty-state";
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

const EMPTY_TOTAL: StageTotal = { count: 0, value: 0 };

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
  deals: initial,
  stages,
  stageTotals: initialTotals = {},
  paginated = false,
  filterParams = {},
  pageSize = 10,
  owners,
  tags,
  admin,
  shareUsers,
  sharedMap: initialSharedMap,
  currentUserId,
}: {
  deals: DealRow[];
  stages: TableStage[];
  stageTotals?: Record<string, StageTotal>;
  paginated?: boolean;
  filterParams?: DealFilterParams;
  pageSize?: number;
  owners: { id: string; name: string }[];
  tags: TagView[];
  admin: boolean;
  shareUsers: ShareUserRow[];
  sharedMap: Record<string, string[]>;
  currentUserId?: string;
}) {
  const { toast } = useToast();
  // Actions column is always present now (delete lives here for admins and deal
  // owners); the extra share control inside it stays admin-only.
  const colCount = 9;

  const [rows, setRows] = useState(initial);
  const [totals, setTotals] = useState<Record<string, StageTotal>>(initialTotals);
  const [sharedMap, setSharedMap] = useState<Record<string, string[]>>(initialSharedMap);
  const [loadingStages, setLoadingStages] = useState<Set<string>>(new Set());

  // Re-seed on navigation (filter/search/sort change hands down a fresh page).
  useEffect(() => setRows(initial), [initial]);
  useEffect(() => setTotals(initialTotals), [initialTotals]);
  useEffect(() => setSharedMap(initialSharedMap), [initialSharedMap]);

  // Collapse state for the grouped sections, shared with the kanban board via
  // localStorage so a section collapsed in one view stays collapsed in the
  // other (and across reloads). A stage is collapsed here if it's collapsed on
  // the board directly, or its whole phase band is collapsed. Empty on the
  // server/first client render (all expanded) to avoid a hydration mismatch.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const readCollapsed = useCallback(() => {
    const collapsedStages = loadSet(STAGE_KEY);
    const collapsedPhases = loadSet(PHASE_KEY);
    const next = new Set<string>();
    for (const s of stages) {
      if (collapsedStages.has(s.id) || collapsedPhases.has(phaseKeyOf(s))) next.add(s.id);
    }
    return next;
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
      saveSet(STAGE_KEY, next);
      return next;
    });

  // Group loaded rows by stage (order preserved = current sort within section).
  const byStage = useMemo(() => {
    const map = new Map<string, DealRow[]>();
    for (const s of stages) map.set(s.id, []);
    const orphans: DealRow[] = [];
    for (const d of rows) {
      const bucket = map.get(d.stageId);
      if (bucket) bucket.push(d);
      else orphans.push(d);
    }
    return { map, orphans };
  }, [rows, stages]);

  const orderedStages = useMemo(() => orderStagesLikeBoard(stages), [stages]);

  function adjustTotal(stageId: string, dCount: number, dValue: number) {
    setTotals((prev) => {
      const cur = prev[stageId] ?? EMPTY_TOTAL;
      return {
        ...prev,
        [stageId]: { count: Math.max(0, cur.count + dCount), value: cur.value + dValue },
      };
    });
  }

  const hasMore = (stageId: string) =>
    paginated && (byStage.map.get(stageId)?.length ?? 0) < (totals[stageId]?.count ?? 0);

  async function loadMore(stageId: string, all = false) {
    if (!paginated || loadingStages.has(stageId)) return;
    const offset = byStage.map.get(stageId)?.length ?? 0;
    const total = totals[stageId]?.count ?? 0;
    if (offset >= total) return;
    const limit = all ? total - offset : pageSize;

    setLoadingStages((prev) => new Set(prev).add(stageId));
    const res = await loadStageDealsAction({ filters: filterParams, stageId, offset, limit });
    setLoadingStages((prev) => {
      const next = new Set(prev);
      next.delete(stageId);
      return next;
    });

    if ("error" in res) {
      toast({ title: res.error, variant: "error" });
      return;
    }
    setRows((prev) => {
      const seen = new Set(prev.map((d) => d.id));
      return [...prev, ...res.rows.filter((d) => !seen.has(d.id))];
    });
    if (Object.keys(res.sharedMap).length) {
      setSharedMap((prev) => ({ ...prev, ...res.sharedMap }));
    }
  }

  // --- Optimistic local mutations (keep totals + section membership in sync) ---
  function removeRow(id: string) {
    const gone = rows.find((d) => d.id === id);
    if (gone) adjustTotal(gone.stageId, -1, -(gone.amountEur ?? 0));
    setRows((prev) => prev.filter((d) => d.id !== id));
  }
  function moveRowStage(id: string, stageId: string) {
    const row = rows.find((d) => d.id === id);
    if (!row || row.stageId === stageId) return;
    const amount = row.amountEur ?? 0;
    adjustTotal(row.stageId, -1, -amount);
    adjustTotal(stageId, 1, amount);
    setRows((prev) => prev.map((d) => (d.id === id ? { ...d, stageId } : d)));
  }
  function changeRowAmount(id: string, amount: number | null) {
    const row = rows.find((d) => d.id === id);
    if (row) adjustTotal(row.stageId, 0, (amount ?? 0) - (row.amountEur ?? 0));
    setRows((prev) => prev.map((d) => (d.id === id ? { ...d, amountEur: amount } : d)));
  }
  function patchRow(id: string, patch: Partial<DealRow>) {
    setRows((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  const anyRows = rows.length > 0 || Object.values(totals).some((t) => t.count > 0);

  return (
    <div className="surface-panel">
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
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orderedStages.map((stage) => {
            const total = totals[stage.id] ?? EMPTY_TOTAL;
            // Skip stages with no matching deals — no header clutter for empty
            // statuses in the current filter/search.
            if (total.count === 0) return null;
            const loaded = byStage.map.get(stage.id) ?? [];
            const isCollapsed = collapsed.has(stage.id);
            const more = hasMore(stage.id);
            const loading = loadingStages.has(stage.id);
            return (
              <Fragment key={stage.id}>
                <TableRow className="border-t hover:bg-transparent">
                  <TableCell colSpan={colCount} className="p-0">
                    <div
                      className="flex w-full items-center gap-2 px-3 py-2 text-sm font-semibold"
                      style={{ backgroundColor: hexAlpha(stage.color, 0.12) }}
                    >
                      <button
                        type="button"
                        onClick={() => toggle(stage.id)}
                        aria-expanded={!isCollapsed}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left transition-colors hover:brightness-105"
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
                          {total.count}
                        </span>
                        <span className="ml-auto text-xs font-medium text-muted-foreground tabular-nums">
                          {formatCurrency(total.value)}
                        </span>
                      </button>
                      {!isCollapsed && more && (
                        <button
                          type="button"
                          onClick={() => loadMore(stage.id, true)}
                          disabled={loading}
                          className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground disabled:opacity-50"
                          title={`Load all ${total.count} deals`}
                        >
                          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListPlus className="h-3.5 w-3.5" />}
                          Load all
                        </button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
                {!isCollapsed &&
                  loaded.map((d) => (
                    <DealTableRow
                      key={d.id}
                      deal={d}
                      stages={stages}
                      owners={owners}
                      tags={tags}
                      admin={admin}
                      paginated={paginated}
                      shareUsers={shareUsers}
                      sharedMap={sharedMap}
                      currentUserId={currentUserId}
                      onStageChange={moveRowStage}
                      onAmountChange={changeRowAmount}
                      onPatch={patchRow}
                      onDeleted={removeRow}
                    />
                  ))}
                {!isCollapsed && more && (
                  <LoadMoreRow
                    colSpan={colCount}
                    remaining={total.count - loaded.length}
                    loading={loading}
                    onLoadMore={() => loadMore(stage.id)}
                  />
                )}
              </Fragment>
            );
          })}

          {/* Deals whose stage isn't in the current pipeline (defensive). */}
          {byStage.orphans.map((d) => (
            <DealTableRow
              key={d.id}
              deal={d}
              stages={stages}
              owners={owners}
              tags={tags}
              admin={admin}
              paginated={paginated}
              shareUsers={shareUsers}
              sharedMap={sharedMap}
              currentUserId={currentUserId}
              onStageChange={moveRowStage}
              onAmountChange={changeRowAmount}
              onPatch={patchRow}
              onDeleted={removeRow}
            />
          ))}

          {!anyRows && (
            <TableEmpty
              colSpan={colCount}
              icon={Handshake}
              title="No deals found"
              description="Adjust filters or create a deal to start filling the pipeline."
            />
          )}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * A section footer row with an explicit "load more" button. Unlike the board's
 * columns, the table never auto-loads on scroll — the next page is fetched only
 * when the user clicks this button under the status section.
 */
function LoadMoreRow({
  colSpan,
  remaining,
  loading,
  onLoadMore,
}: {
  colSpan: number;
  remaining: number;
  loading: boolean;
  onLoadMore: () => void;
}) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={colSpan} className="p-0">
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loading}
          className="flex w-full items-center justify-center gap-1.5 py-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:opacity-50"
        >
          {loading ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </>
          ) : (
            `Load more (${remaining} left)`
          )}
        </button>
      </TableCell>
    </TableRow>
  );
}

function DealTableRow({
  deal: d,
  stages,
  owners,
  tags,
  admin,
  paginated,
  shareUsers,
  sharedMap,
  currentUserId,
  onStageChange,
  onAmountChange,
  onPatch,
  onDeleted,
}: {
  deal: DealRow;
  stages: TableStage[];
  owners: { id: string; name: string }[];
  tags: TagView[];
  admin: boolean;
  paginated: boolean;
  shareUsers: ShareUserRow[];
  sharedMap: Record<string, string[]>;
  currentUserId?: string;
  onStageChange: (id: string, stageId: string) => void;
  onAmountChange: (id: string, amount: number | null) => void;
  onPatch: (id: string, patch: Partial<DealRow>) => void;
  onDeleted: (id: string) => void;
}) {
  const canDelete = admin || (!!currentUserId && d.ownerId === currentUserId);
  // In paginated mode we keep loaded pages by suppressing the inline editors'
  // built-in refresh and syncing via the optimistic callbacks instead.
  const refreshOnSave = !paginated;
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

      {/* Stage — inline select (moves the row to the new section on save) */}
      <TableCell>
        <InlineSelect
          value={d.stageId}
          refreshOnSave={refreshOnSave}
          options={stages.map((s) => ({ value: s.id, label: s.name }))}
          onSave={async (stageId) => {
            const res = await quickUpdateDealAction(d.id, { stageId });
            if (!res.error) onStageChange(d.id, stageId);
            return res;
          }}
        />
      </TableCell>

      {/* Amount — click to edit number */}
      <TableCell className="tabular-nums text-sm">
        <InlineInput
          type="number"
          align="right"
          refreshOnSave={refreshOnSave}
          value={d.amountEur != null ? String(d.amountEur) : ""}
          display={<span className="tabular-nums">{formatCurrency(d.amountEur)}</span>}
          onSave={async (raw) => {
            const trimmed = raw.trim();
            const amountEur = trimmed === "" ? null : Number(trimmed);
            if (amountEur != null && !Number.isFinite(amountEur))
              return { error: "Invalid amount." };
            const res = await quickUpdateDealAction(d.id, { amountEur });
            if (!res.error) onAmountChange(d.id, amountEur);
            return res;
          }}
        />
      </TableCell>

      {/* Tags — inline popover */}
      <TableCell>
        <InlineTagEditor
          allTags={tags}
          value={d.tagIds}
          refreshOnSave={refreshOnSave}
          onSave={async (tagIds) => {
            const res = await quickUpdateDealAction(d.id, { tagIds });
            if (!res.error) onPatch(d.id, { tagIds });
            return res;
          }}
        />
      </TableCell>

      {/* Owner — admin only inline select */}
      <TableCell>
        {admin ? (
          <InlineSelect
            value={d.ownerId ?? ""}
            placeholder="Unassigned"
            refreshOnSave={refreshOnSave}
            options={owners.map((o) => ({ value: o.id, label: o.name }))}
            onSave={async (ownerId) => {
              const res = await quickUpdateDealAction(d.id, { ownerId: ownerId || null });
              if (!res.error)
                onPatch(d.id, {
                  ownerId: ownerId || null,
                  ownerName: owners.find((o) => o.id === ownerId)?.name ?? null,
                  ownerColor: null,
                });
              return res;
            }}
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
          refreshOnSave={refreshOnSave}
          value={d.dueDate ?? ""}
          display={
            d.dueDate ? (
              <span className={cn(d.overdue && "font-medium text-destructive")}>{formatDate(d.dueDate)}</span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )
          }
          onSave={async (dueDate) => {
            const res = await quickUpdateDealAction(d.id, { dueDate: dueDate || null });
            if (!res.error) onPatch(d.id, { dueDate: dueDate || null });
            return res;
          }}
        />
      </TableCell>

      {/* Actions: inline share (admin) + confirm-to-delete (admin or owner) */}
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-1">
          {admin && (
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
          )}
          {canDelete && (
            <ConfirmDeleteButton
              onDelete={() => deleteDealAction(d.id)}
              onDeleted={() => onDeleted(d.id)}
              idleTitle="Delete deal"
              title="Delete deal?"
              description="Tasks, comments and files will be hidden with the deal."
            />
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
