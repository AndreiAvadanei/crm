"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  CalendarClock,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Plus,
  SquarePen,
} from "lucide-react";
import { moveDealStageAction } from "@/server/deal-actions";
import { quickCreateDealAction } from "@/server/board-actions";
import { quickUpdateDealAction } from "@/server/quick-actions";
import { useToast } from "@/components/ui/toast";
import { Avatar } from "@/components/ui/avatar";
import { TagBadge, type TagView } from "@/components/shared/tag-badge";
import { InlineInput, InlineTagEditor } from "@/components/shared/inline-edit";
import { DealFormDialog } from "@/components/deals/deal-form-dialog";
import type { FieldDefView } from "@/components/shared/custom-field-inputs";
import { formatCurrency, formatDate, cn } from "@/lib/utils";

export type KanbanStage = {
  id: string;
  name: string;
  color: string;
  probability: number;
  phase: string | null;
};
export type KanbanDeal = {
  id: string;
  salesId: string;
  title: string;
  amountEur: number | null;
  stageId: string;
  clientName: string | null;
  ownerName: string | null;
  ownerColor: string | null;
  dueDate: string | null;
  overdue: boolean;
  tags: TagView[];
  openTasks: number;
};

// Data needed to render the full New-deal dialog prefilled to a stage.
type NewDealProps = {
  isAdmin: boolean;
  clients: { id: string; name: string }[];
  tags: TagView[];
  fieldDefs: FieldDefView[];
  owners: { id: string; name: string }[];
};

// ---------------------------------------------------------------------------
// localStorage-backed collapse state (per stage / per phase)
// ---------------------------------------------------------------------------
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

/** Derive an rgba() tint from a #rrggbb hex (used for accents/backgrounds). */
function hexAlpha(hex: string, alpha: number): string | undefined {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return undefined;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// ---------------------------------------------------------------------------
// Deal card
// ---------------------------------------------------------------------------
function DealCard({
  deal,
  overlay = false,
  stageColor,
  stageOptions,
  allTags,
  onStageChange,
  onTagsChange,
  onAmountChange,
}: {
  deal: KanbanDeal;
  overlay?: boolean;
  // Color of the deal's current stage (used for the status dot).
  stageColor?: string;
  // Full stage list for the inline status selector.
  stageOptions?: { id: string; name: string }[];
  // Full tag list for the inline tag editor.
  allTags?: TagView[];
  // Optimistic local-state callbacks owned by the board.
  onStageChange?: (dealId: string, stageId: string) => void;
  onTagsChange?: (dealId: string, tags: TagView[]) => void;
  onAmountChange?: (dealId: string, amount: number | null) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: deal.id });
  const overdue = deal.overdue;
  // Inline editors are interactive; only render them on real cards (not the
  // drag overlay) and when the board supplied the necessary data.
  const interactive = !overlay && !!stageOptions && !!onStageChange;

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        "group rounded-lg border bg-card p-3 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md cursor-grab active:cursor-grabbing",
        // Overdue deals get a red left accent + tinted surface.
        overdue && "border-l-2 border-l-destructive bg-destructive/5",
        overlay && "rotate-1 shadow-lg ring-1 ring-primary/30",
        isDragging && !overlay && "opacity-30"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[11px] font-medium tracking-tight text-muted-foreground">
            {deal.salesId}
          </span>
          {overdue && (
            <span className="rounded bg-destructive/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-destructive">
              Overdue
            </span>
          )}
        </div>
        {deal.ownerName && <Avatar name={deal.ownerName} color={deal.ownerColor} className="h-5 w-5 text-[9px]" />}
      </div>
      <Link
        href={`/deals/${deal.salesId}`}
        className="mt-1.5 block text-sm font-semibold leading-snug hover:text-primary"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {deal.title}
      </Link>
      {deal.clientName && <div className="mt-0.5 truncate text-xs text-muted-foreground">{deal.clientName}</div>}

      {/* Inline status (stage) selector — changes the deal's status without DnD. */}
      {interactive ? (
        <CardStageSelect
          dealId={deal.id}
          stageId={deal.stageId}
          stageColor={stageColor}
          options={stageOptions!}
          onStageChange={onStageChange!}
        />
      ) : (
        deal.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {deal.tags.slice(0, 3).map((t) => (
              <TagBadge key={t.id} tag={t} />
            ))}
            {deal.tags.length > 3 && (
              <span className="text-[10px] text-muted-foreground">+{deal.tags.length - 3}</span>
            )}
          </div>
        )
      )}

      {/* Inline tag editor (only on real cards). */}
      {interactive && allTags && (
        <div
          className="mt-2"
          // Prevent the drag sensor from hijacking clicks on the tag popover.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <InlineTagEditor
            allTags={allTags}
            value={deal.tags.map((t) => t.id)}
            onSave={async (tagIds) => {
              const res = await quickUpdateDealAction(deal.id, { tagIds });
              if (!res.error) {
                onTagsChange?.(
                  deal.id,
                  tagIds.map((id) => allTags.find((t) => t.id === id)!).filter(Boolean)
                );
              }
              return res;
            }}
          />
        </div>
      )}

      <div className="mt-2.5 flex items-center justify-between border-t pt-2 text-xs text-muted-foreground">
        {interactive ? (
          <span
            // Keep the drag sensor from hijacking clicks on the amount field.
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <InlineInput
              type="number"
              align="right"
              value={deal.amountEur != null ? String(deal.amountEur) : ""}
              display={
                <span className="text-sm font-semibold text-foreground tabular-nums">
                  {formatCurrency(deal.amountEur)}
                </span>
              }
              inputClassName="text-sm font-semibold tabular-nums"
              triggerClassName="w-auto"
              onSave={async (next) => {
                const trimmed = next.trim();
                const amount = trimmed === "" ? null : Number(trimmed);
                if (amount != null && Number.isNaN(amount)) return { error: "Invalid amount." };
                const res = await quickUpdateDealAction(deal.id, { amountEur: amount });
                if (!res.error) onAmountChange?.(deal.id, amount);
                return res;
              }}
            />
          </span>
        ) : (
          <span className="text-sm font-semibold text-foreground tabular-nums">{formatCurrency(deal.amountEur)}</span>
        )}
        <div className="flex items-center gap-2.5">
          {deal.openTasks > 0 && (
            <span className="flex items-center gap-0.5" title={`${deal.openTasks} open tasks`}>
              <CheckSquare className="h-3 w-3" /> {deal.openTasks}
            </span>
          )}
          {deal.dueDate && (
            <span
              className={cn(
                "flex items-center gap-0.5",
                overdue && "font-medium text-destructive"
              )}
              title={overdue ? "Overdue" : "Due date"}
            >
              <CalendarClock className="h-3 w-3" /> {formatDate(deal.dueDate)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline status selector used on a card. Optimistically moves the card to the
// chosen stage's column via the board callback, then persists the change.
// ---------------------------------------------------------------------------
function CardStageSelect({
  dealId,
  stageId,
  stageColor,
  options,
  onStageChange,
}: {
  dealId: string;
  stageId: string;
  stageColor?: string;
  options: { id: string; name: string }[];
  onStageChange: (dealId: string, stageId: string) => void;
}) {
  return (
    <span
      className="mt-2 flex items-center gap-1.5"
      // Stop drag/click from firing while interacting with the native select.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: stageColor }} />
      <select
        value={stageId}
        onChange={(e) => {
          const next = e.target.value;
          if (next !== stageId) onStageChange(dealId, next);
        }}
        title="Change status"
        className="form-control h-7 w-full cursor-pointer px-1.5 text-xs transition-colors hover:bg-accent/60"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Inline quick-add (title only → server action)
// ---------------------------------------------------------------------------
function QuickAdd({ stageId, onCreated }: { stageId: string; onCreated: (deal: KanbanDeal) => void }) {
  const { toast } = useToast();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    const res = await quickCreateDealAction(stageId, t);
    setBusy(false);
    if (res.error || !res.id || !res.salesId) {
      return toast({ title: res.error ?? "Could not create deal.", variant: "error" });
    }
    onCreated({
      id: res.id,
      salesId: res.salesId,
      title: t,
      amountEur: null,
      stageId,
      clientName: null,
      ownerName: null,
      ownerColor: null,
      dueDate: null,
      overdue: false,
      tags: [],
      openTasks: 0,
    });
    setTitle("");
    // Keep server data (owner/avatar) in sync without a full reload jank.
    router.refresh();
  }

  return (
    <input
      autoFocus
      value={title}
      disabled={busy}
      onChange={(e) => setTitle(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          submit();
        }
      }}
      onBlur={submit}
      placeholder="Deal title, then Enter…"
      className="form-control h-8 w-full px-2 text-sm"
    />
  );
}

// ---------------------------------------------------------------------------
// Full stage column
// ---------------------------------------------------------------------------
function StageColumn({
  stage,
  deals,
  newDeal,
  stageOptions,
  allTags,
  onCollapse,
  onCreated,
  onStageChange,
  onTagsChange,
  onAmountChange,
}: {
  stage: KanbanStage;
  deals: KanbanDeal[];
  newDeal?: NewDealProps;
  stageOptions: { id: string; name: string }[];
  allTags: TagView[];
  onCollapse: () => void;
  onCreated: (deal: KanbanDeal) => void;
  onStageChange: (dealId: string, stageId: string) => void;
  onTagsChange: (dealId: string, tags: TagView[]) => void;
  onAmountChange: (dealId: string, amount: number | null) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const [adding, setAdding] = useState(false);
  const total = deals.reduce((s, d) => s + (d.amountEur ?? 0), 0);
  // Stage-color tints used to make each column clearly distinguishable.
  const headerTint = hexAlpha(stage.color, 0.16);
  const listTint = hexAlpha(stage.color, 0.07);
  const colBorder = hexAlpha(stage.color, 0.45);

  return (
    <div className="flex h-full w-72 shrink-0 flex-col">
      <div
        className="mb-2 rounded-lg border px-2.5 py-2"
        style={{
          borderTop: `4px solid ${stage.color}`,
          borderColor: colBorder,
          backgroundColor: headerTint,
        }}
      >
        <div className="flex items-center justify-between gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: stage.color }} />
            <span className="truncate text-sm font-semibold">{stage.name}</span>
            <span
              className="rounded-full px-1.5 text-xs font-semibold text-white"
              style={{ backgroundColor: stage.color }}
            >
              {deals.length}
            </span>
          </div>
          <div className="flex shrink-0 items-center">
            {newDeal && (
              <DealFormDialog
                isAdmin={newDeal.isAdmin}
                stages={stageOptions}
                clients={newDeal.clients}
                tags={newDeal.tags}
                fieldDefs={newDeal.fieldDefs}
                owners={newDeal.owners}
                defaultStageId={stage.id}
                trigger={
                  <button
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    title="New deal (full form)"
                  >
                    <SquarePen className="h-3.5 w-3.5" />
                  </button>
                }
              />
            )}
            <button
              onClick={() => setAdding((v) => !v)}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Quick add deal"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              onClick={onCollapse}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Collapse column"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="mt-1 px-0.5 text-xs text-muted-foreground tabular-nums">
          {formatCurrency(total)} · weighted {formatCurrency((total * stage.probability) / 100)}
        </div>
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-xl border p-2 transition-colors",
          isOver && "border-primary bg-primary/5"
        )}
        style={
          isOver
            ? undefined
            : { backgroundColor: listTint, borderColor: colBorder }
        }
      >
        {adding && <QuickAdd stageId={stage.id} onCreated={onCreated} />}
        {deals.map((d) => (
          <DealCard
            key={d.id}
            deal={d}
            stageColor={stage.color}
            stageOptions={stageOptions}
            allTags={allTags}
            onStageChange={onStageChange}
            onTagsChange={onTagsChange}
            onAmountChange={onAmountChange}
          />
        ))}
        {deals.length === 0 && !adding && (
          <button
            onClick={() => setAdding(true)}
            className="rounded-lg border border-dashed py-6 text-center text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            + Add a deal
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collapsed stage strip
// ---------------------------------------------------------------------------
function CollapsedStage({
  stage,
  deals,
  onExpand,
}: {
  stage: KanbanStage;
  deals: KanbanDeal[];
  onExpand: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const total = deals.reduce((s, d) => s + (d.amountEur ?? 0), 0);
  return (
    <button
      ref={setNodeRef}
      onClick={onExpand}
      title={`${stage.name} — expand`}
      className={cn(
        "flex h-full min-h-[60vh] w-11 shrink-0 flex-col items-center gap-2 rounded-xl border py-2 transition-colors hover:brightness-105",
        isOver && "border-primary bg-primary/5"
      )}
      style={
        isOver
          ? { borderTop: `4px solid ${stage.color}` }
          : {
              borderTop: `4px solid ${stage.color}`,
              borderColor: hexAlpha(stage.color, 0.45),
              backgroundColor: hexAlpha(stage.color, 0.12),
            }
      }
    >
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
      <span
        className="rounded-full px-1.5 text-[10px] font-semibold text-white"
        style={{ backgroundColor: stage.color }}
      >
        {deals.length}
      </span>
      <span
        className="flex-1 text-xs font-semibold [writing-mode:vertical-rl]"
        style={{ textOrientation: "mixed" }}
      >
        {stage.name}
      </span>
      <span className="text-[9px] text-muted-foreground [writing-mode:vertical-rl] tabular-nums">
        {formatCurrency(total)}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Phase group (header band + its stage columns)
// ---------------------------------------------------------------------------
type PhaseGroupData = { key: string; label: string; stages: KanbanStage[] };

function PhaseGroup({
  group,
  byStage,
  collapsedStages,
  newDeal,
  stageOptions,
  allTags,
  collapsed,
  onTogglePhase,
  onToggleStage,
  onCreated,
  onStageChange,
  onTagsChange,
  onAmountChange,
}: {
  group: PhaseGroupData;
  byStage: Record<string, KanbanDeal[]>;
  collapsedStages: Set<string>;
  newDeal?: NewDealProps;
  stageOptions: { id: string; name: string }[];
  allTags: TagView[];
  collapsed: boolean;
  onTogglePhase: () => void;
  onToggleStage: (stageId: string) => void;
  onCreated: (deal: KanbanDeal) => void;
  onStageChange: (dealId: string, stageId: string) => void;
  onTagsChange: (dealId: string, tags: TagView[]) => void;
  onAmountChange: (dealId: string, amount: number | null) => void;
}) {
  const groupDeals = group.stages.flatMap((s) => byStage[s.id] ?? []);
  const total = groupDeals.reduce((s, d) => s + (d.amountEur ?? 0), 0);
  // Accent the band from the first stage's color.
  const accent = group.stages[0]?.color ?? "#64748b";
  const tint = hexAlpha(accent, 0.06);
  const borderTint = hexAlpha(accent, 0.35);

  if (collapsed) {
    return (
      <button
        onClick={onTogglePhase}
        title={`${group.label} — expand phase`}
        className="flex h-full min-h-[64vh] w-12 shrink-0 flex-col items-center gap-2 rounded-xl border py-3 transition-colors hover:bg-muted"
        style={{ backgroundColor: tint, borderColor: borderTint }}
      >
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
        <span className="rounded-full bg-background/70 px-1.5 text-[10px] text-muted-foreground">
          {groupDeals.length}
        </span>
        <span className="flex-1 text-sm font-bold uppercase tracking-wide [writing-mode:vertical-rl]">
          {group.label}
        </span>
        <span className="text-[9px] text-muted-foreground [writing-mode:vertical-rl] tabular-nums">
          {formatCurrency(total)}
        </span>
      </button>
    );
  }

  return (
    <div
      className="flex h-full min-h-0 shrink-0 flex-col rounded-xl border p-2"
      style={{ backgroundColor: tint, borderColor: borderTint }}
    >
      <div className="mb-2 flex items-center justify-between gap-3 px-1">
        <button
          onClick={onTogglePhase}
          className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide hover:text-primary"
          title="Collapse phase"
        >
          <ChevronLeft className="h-4 w-4 text-muted-foreground" />
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: accent }} />
          {group.label}
        </button>
        <div className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
          <span className="rounded-full bg-background/70 px-1.5">{groupDeals.length}</span>
          <span className="font-medium text-foreground">{formatCurrency(total)}</span>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 gap-3">
        {group.stages.map((stage) =>
          collapsedStages.has(stage.id) ? (
            <CollapsedStage
              key={stage.id}
              stage={stage}
              deals={byStage[stage.id] ?? []}
              onExpand={() => onToggleStage(stage.id)}
            />
          ) : (
            <StageColumn
              key={stage.id}
              stage={stage}
              deals={byStage[stage.id] ?? []}
              newDeal={newDeal}
              stageOptions={stageOptions}
              allTags={allTags}
              onCollapse={() => onToggleStage(stage.id)}
              onCreated={onCreated}
              onStageChange={onStageChange}
              onTagsChange={onTagsChange}
              onAmountChange={onAmountChange}
            />
          )
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------
export function KanbanBoard({
  stages,
  deals: initial,
  newDeal,
}: {
  stages: KanbanStage[];
  deals: KanbanDeal[];
  newDeal?: NewDealProps;
}) {
  const { toast } = useToast();
  const [deals, setDeals] = useState(initial);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [collapsedStages, setCollapsedStages] = useState<Set<string>>(new Set());
  const [collapsedPhases, setCollapsedPhases] = useState<Set<string>>(new Set());
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => setDeals(initial), [initial]);

  // Hydrate persisted collapse state after mount (avoids SSR mismatch).
  useEffect(() => {
    setCollapsedStages(loadSet(STAGE_KEY));
    setCollapsedPhases(loadSet(PHASE_KEY));
  }, []);

  const stageOptions = useMemo(() => stages.map((s) => ({ id: s.id, name: s.name })), [stages]);
  const allTags = newDeal?.tags ?? [];

  const byStage = useMemo(() => {
    const map: Record<string, KanbanDeal[]> = {};
    for (const s of stages) map[s.id] = [];
    for (const d of deals) (map[d.stageId] ??= []).push(d);
    return map;
  }, [deals, stages]);

  // Group stages into phase bands; order phases by their min stage order.
  // Stages with no phase fall into an "Other" band rendered last.
  const phaseGroups = useMemo<PhaseGroupData[]>(() => {
    const groups = new Map<string, KanbanStage[]>();
    for (const s of stages) {
      const key = s.phase?.trim() || "__other__";
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(s);
    }
    const ordered = [...groups.entries()]
      .filter(([key]) => key !== "__other__")
      .map(([key, ss]) => ({ key, label: key, stages: ss }))
      .sort(
        (a, b) =>
          Math.min(...a.stages.map((s) => stages.indexOf(s))) -
          Math.min(...b.stages.map((s) => stages.indexOf(s)))
      );
    const other = groups.get("__other__");
    if (other?.length) ordered.push({ key: "__other__", label: "Other", stages: other });
    return ordered;
  }, [stages]);

  const activeDeal = deals.find((d) => d.id === activeId) ?? null;

  function toggleStage(stageId: string) {
    setCollapsedStages((prev) => {
      const next = new Set(prev);
      next.has(stageId) ? next.delete(stageId) : next.add(stageId);
      saveSet(STAGE_KEY, next);
      return next;
    });
  }
  function togglePhase(key: string) {
    setCollapsedPhases((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      saveSet(PHASE_KEY, next);
      return next;
    });
  }
  function addDeal(deal: KanbanDeal) {
    setDeals((ds) => [deal, ...ds]);
  }

  // Inline status change from a card: optimistically move the card to the new
  // stage's column, persist via quick-update, and revert on failure.
  async function changeStage(dealId: string, stageId: string) {
    const prev = deals;
    setDeals((ds) => ds.map((d) => (d.id === dealId ? { ...d, stageId } : d)));
    const res = await quickUpdateDealAction(dealId, { stageId });
    if (res.error) {
      setDeals(prev);
      toast({ title: res.error, variant: "error" });
    }
  }

  // Inline tag change from a card: keep local state in sync (server persistence
  // is handled by InlineTagEditor's onSave before this fires).
  function changeTags(dealId: string, tags: TagView[]) {
    setDeals((ds) => ds.map((d) => (d.id === dealId ? { ...d, tags } : d)));
  }

  // Inline amount change from a card: keep local state in sync (server
  // persistence is handled by InlineInput's onSave before this fires).
  function changeAmount(dealId: string, amount: number | null) {
    setDeals((ds) => ds.map((d) => (d.id === dealId ? { ...d, amountEur: amount } : d)));
  }

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  async function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const dealId = String(e.active.id);
    const overId = e.over?.id ? String(e.over.id) : null;
    if (!overId) return;
    const deal = deals.find((d) => d.id === dealId);
    if (!deal || deal.stageId === overId) return;

    const prev = deals;
    setDeals((ds) => ds.map((d) => (d.id === dealId ? { ...d, stageId: overId } : d)));
    const res = await moveDealStageAction(dealId, overId);
    if (res.error) {
      setDeals(prev);
      toast({ title: res.error, variant: "error" });
    }
  }

  return (
    <DndContext id="deals-kanban" sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="flex h-full items-stretch gap-4 overflow-x-auto px-4 pb-4 md:px-6">
        {phaseGroups.map((group) => (
          <PhaseGroup
            key={group.key}
            group={group}
            byStage={byStage}
            collapsedStages={collapsedStages}
            newDeal={newDeal}
            stageOptions={stageOptions}
            allTags={allTags}
            collapsed={collapsedPhases.has(group.key)}
            onTogglePhase={() => togglePhase(group.key)}
            onToggleStage={toggleStage}
            onCreated={addDeal}
            onStageChange={changeStage}
            onTagsChange={changeTags}
            onAmountChange={changeAmount}
          />
        ))}
      </div>
      <DragOverlay>
        {activeDeal ? (
          <DealCard
            deal={activeDeal}
            overlay
            stageColor={stages.find((s) => s.id === activeDeal.stageId)?.color}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
