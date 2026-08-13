"use client";

import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
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
  Loader2,
  ListPlus,
  Share2,
  SquarePen,
} from "lucide-react";
import { moveDealStageAction, deleteDealAction } from "@/server/deal-actions";
import { quickCreateDealAction } from "@/server/board-actions";
import { quickUpdateDealAction } from "@/server/quick-actions";
import { loadStageDealsAction } from "@/server/deal-load-actions";
import type { DealFilterParams, StageTotal } from "@/lib/deal-filter-params";
import { useToast } from "@/components/ui/toast";
import { Avatar } from "@/components/ui/avatar";
import { TagBadge, type TagView } from "@/components/shared/tag-badge";
import { InlineInput, InlineTagEditor } from "@/components/shared/inline-edit";
import { ConfirmDeleteButton } from "@/components/shared/confirm-delete-button";
import { DealFormDialog } from "@/components/deals/deal-form-dialog";
import { ShareControl } from "@/components/deals/share-control";
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
  ownerId: string | null;
  ownerName: string | null;
  ownerColor: string | null;
  dueDate: string | null;
  overdue: boolean;
  tags: TagView[];
  openTasks: number;
};

export type ShareUserView = { id: string; name: string; color: string };

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

// Pointer travel (px) before a press on a card becomes a drag rather than a
// click. Shared by the drag sensor and the card's click-suppression guard.
const DRAG_ACTIVATION = 6;

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
  paginated = false,
  stageColor,
  stageOptions,
  allTags,
  owners,
  canAssign,
  shareUsers,
  canShare,
  sharedUserIds,
  canDelete,
  onDelete,
  onDeleted,
  onStageChange,
  onTagsChange,
  onAmountChange,
  onOwnerChange,
  onDueDateChange,
}: {
  deal: KanbanDeal;
  overlay?: boolean;
  // When true the board owns optimistic state; inline editors skip their own
  // router.refresh() so loaded pages aren't discarded.
  paginated?: boolean;
  // Color of the deal's current stage (used for the status dot).
  stageColor?: string;
  // Full stage list for the inline status selector.
  stageOptions?: { id: string; name: string }[];
  // Full tag list for the inline tag editor.
  allTags?: TagView[];
  // Full owner list for the inline assignee selector (admins only).
  owners?: { id: string; name: string }[];
  // Whether the current user may reassign owners (admin only).
  canAssign?: boolean;
  // Sales users this deal can be shared with (admin only).
  shareUsers?: ShareUserView[];
  // Whether the current user may share the deal (admin only).
  canShare?: boolean;
  // Ids of users this specific deal is currently shared with.
  sharedUserIds?: string[];
  // Whether the current user may delete this deal (admin or owner).
  canDelete?: boolean;
  // Runs the delete server action for this deal.
  onDelete?: () => Promise<{ ok?: boolean; error?: string }>;
  // Removes the deal from the board once the delete succeeds.
  onDeleted?: () => void;
  // Optimistic local-state callbacks owned by the board.
  onStageChange?: (dealId: string, stageId: string) => void;
  onTagsChange?: (dealId: string, tags: TagView[]) => void;
  onAmountChange?: (dealId: string, amount: number | null) => void;
  onOwnerChange?: (dealId: string, ownerId: string | null) => void;
  onDueDateChange?: (dealId: string, dueDate: string | null) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: deal.id });
  const overdue = deal.overdue;
  // Inline editors are interactive; only render them on real cards (not the
  // drag overlay) and when the board supplied the necessary data.
  const interactive = !overlay && !!stageOptions && !!onStageChange;

  // The whole card is a drag handle. Because dnd-kit only activates after the
  // pointer travels DRAG_ACTIVATION px, a plain click still reaches the child
  // controls (title link, inline editors). We record where the press started
  // and, if the pointer moved far enough to be a drag, swallow the trailing
  // click so it doesn't navigate the title link or open an inline editor.
  const pressStart = useRef<{ x: number; y: number } | null>(null);

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onPointerDownCapture={(e) => {
        pressStart.current = { x: e.clientX, y: e.clientY };
      }}
      onClickCapture={(e) => {
        const start = pressStart.current;
        pressStart.current = null;
        if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > DRAG_ACTIVATION) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      className={cn(
        "group rounded-2xl border border-border/80 bg-card p-3.5 shadow-[var(--shadow-sm)] transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-[var(--shadow-md)] cursor-grab active:cursor-grabbing",
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
            <span className="rounded-full bg-destructive/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-destructive">
              Overdue
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {interactive && canDelete && onDelete && (
            <ConfirmDeleteButton
              onDelete={onDelete}
              onDeleted={onDeleted}
              idleTitle="Delete deal"
              title="Delete deal?"
              description="Tasks, comments and files will be hidden with the deal."
            />
          )}
          {interactive && canShare && shareUsers && (
            <span onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
              <ShareControl
                dealId={deal.id}
                users={shareUsers.map((u) => ({
                  id: u.id,
                  name: u.name,
                  color: u.color,
                  shared: (sharedUserIds ?? []).includes(u.id),
                }))}
                trigger={
                  <button
                    type="button"
                    title="Share deal"
                    className={cn(
                      "rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                      (sharedUserIds?.length ?? 0) > 0 && "text-primary"
                    )}
                  >
                    <Share2 className="h-3.5 w-3.5" />
                  </button>
                }
              />
            </span>
          )}
          {interactive && canAssign && owners ? (
            <CardOwnerSelect
              dealId={deal.id}
              ownerId={deal.ownerId}
              ownerName={deal.ownerName}
              ownerColor={deal.ownerColor}
              owners={owners}
              onOwnerChange={onOwnerChange!}
            />
          ) : (
            deal.ownerName && <Avatar name={deal.ownerName} color={deal.ownerColor} className="h-5 w-5 text-[9px]" />
          )}
        </div>
      </div>
      <Link
        href={`/deals/${deal.salesId}`}
        className="mt-1.5 block text-sm font-semibold leading-snug hover:text-primary"
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
            refreshOnSave={!paginated}
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
              refreshOnSave={!paginated}
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
          {interactive ? (
            <CardDueDate
              dealId={deal.id}
              dueDate={deal.dueDate}
              overdue={overdue}
              onDueDateChange={onDueDateChange!}
            />
          ) : (
            deal.dueDate && (
              <span
                className={cn(
                  "flex items-center gap-0.5",
                  overdue && "font-medium text-destructive"
                )}
                title={overdue ? "Overdue" : "Due date"}
              >
                <CalendarClock className="h-3 w-3" /> {formatDate(deal.dueDate)}
              </span>
            )
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline status selector used on a card. Renders the stage name as plain text;
// clicking turns it into a native select. Optimistically moves the card to the
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
  const [editing, setEditing] = useState(false);
  const selectRef = useRef<HTMLSelectElement>(null);
  const stageName = options.find((o) => o.id === stageId)?.name ?? "—";

  // Focus + open the picker as soon as we enter edit mode.
  useEffect(() => {
    if (!editing) return;
    selectRef.current?.focus();
    try {
      (selectRef.current as unknown as { showPicker?: () => void })?.showPicker?.();
    } catch {
      /* showPicker unsupported — focus is enough */
    }
  }, [editing]);

  // Stop drag/click from bubbling to the card's drag sensor.
  const stop = (e: SyntheticEvent) => e.stopPropagation();

  if (!editing) {
    return (
      <button
        type="button"
        onClick={(e) => {
          stop(e);
          setEditing(true);
        }}
        title="Change status"
        className="mt-2 flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left text-xs transition-colors hover:bg-accent/60 hover:ring-1 hover:ring-border"
      >
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: stageColor }} />
        <span className="truncate font-medium">{stageName}</span>
      </button>
    );
  }

  return (
    <span className="mt-2 flex items-center gap-1.5" onPointerDown={stop} onClick={stop}>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: stageColor }} />
      <select
        ref={selectRef}
        value={stageId}
        onChange={(e) => {
          const next = e.target.value;
          setEditing(false);
          if (next !== stageId) onStageChange(dealId, next);
        }}
        onBlur={() => setEditing(false)}
        title="Change status"
        className="form-control h-7 w-full cursor-pointer px-1.5 text-xs"
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
// Inline owner (assignee) selector used on a card. Shows the owner avatar;
// clicking turns it into a native select of active users. Optimistically
// reassigns via the board callback, then persists the change. Admins only.
// ---------------------------------------------------------------------------
function CardOwnerSelect({
  dealId,
  ownerId,
  ownerName,
  ownerColor,
  owners,
  onOwnerChange,
}: {
  dealId: string;
  ownerId: string | null;
  ownerName: string | null;
  ownerColor: string | null;
  owners: { id: string; name: string }[];
  onOwnerChange: (dealId: string, ownerId: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (!editing) return;
    selectRef.current?.focus();
    try {
      (selectRef.current as unknown as { showPicker?: () => void })?.showPicker?.();
    } catch {
      /* showPicker unsupported — focus is enough */
    }
  }, [editing]);

  const stop = (e: SyntheticEvent) => e.stopPropagation();

  if (editing) {
    return (
      <span onPointerDown={stop} onClick={stop}>
        <select
          ref={selectRef}
          value={ownerId ?? ""}
          onChange={(e) => {
            const next = e.target.value;
            setEditing(false);
            onOwnerChange(dealId, next || null);
          }}
          onBlur={() => setEditing(false)}
          title="Reassign owner"
          className="form-control h-6 max-w-[9rem] cursor-pointer px-1 text-[11px]"
        >
          <option value="">Unassigned</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        stop(e);
        setEditing(true);
      }}
      title={ownerName ? `Assigned to ${ownerName} — click to reassign` : "Assign owner"}
      className="rounded-full transition-opacity hover:opacity-80"
    >
      {ownerName ? (
        <Avatar name={ownerName} color={ownerColor} className="h-5 w-5 text-[9px]" />
      ) : (
        <span className="flex h-5 w-5 items-center justify-center rounded-full border border-dashed text-[10px] text-muted-foreground">
          +
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Inline due-date editor used on a card. Shows the formatted date (or a "Due"
// placeholder); clicking turns it into a native date input. Optimistically
// updates via the board callback, then persists the change.
// ---------------------------------------------------------------------------
function CardDueDate({
  dealId,
  dueDate,
  overdue,
  onDueDateChange,
}: {
  dealId: string;
  dueDate: string | null;
  overdue: boolean;
  onDueDateChange: (dealId: string, dueDate: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const value = dueDate ? dueDate.slice(0, 10) : "";

  useEffect(() => {
    if (!editing) return;
    setDraft(value);
    inputRef.current?.focus();
    try {
      (inputRef.current as unknown as { showPicker?: () => void })?.showPicker?.();
    } catch {
      /* showPicker unsupported — focus is enough */
    }
    // Only re-run when entering edit mode, not on every `value` change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const stop = (e: SyntheticEvent) => e.stopPropagation();

  // Commit the pending draft (if changed) and leave edit mode. Called on blur
  // so the user can pick a date and still change their mind before clicking
  // away — the value is only persisted once focus leaves the input.
  const commit = () => {
    setEditing(false);
    if (draft !== value) onDueDateChange(dealId, draft || null);
  };

  if (editing) {
    return (
      <span onPointerDown={stop} onClick={stop}>
        <input
          ref={inputRef}
          type="date"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
            }
          }}
          title="Change due date"
          className="form-control h-6 px-1 text-[11px]"
        />
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        stop(e);
        setEditing(true);
      }}
      title={overdue ? "Overdue — click to change" : "Change due date"}
      className={cn(
        "flex items-center gap-0.5 rounded px-1 py-0.5 transition-colors hover:bg-accent/60 hover:ring-1 hover:ring-border",
        overdue && "font-medium text-destructive"
      )}
    >
      <CalendarClock className="h-3 w-3" />
      {dueDate ? formatDate(dueDate) : <span className="text-muted-foreground">Due</span>}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Inline quick-add (title only → server action)
// ---------------------------------------------------------------------------
function QuickAdd({
  stageId,
  onCreated,
  refreshOnCreate = true,
}: {
  stageId: string;
  onCreated: (deal: KanbanDeal) => void;
  // The paginated board skips the post-create refresh so loaded pages survive.
  refreshOnCreate?: boolean;
}) {
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
      ownerId: null,
      ownerName: null,
      ownerColor: null,
      dueDate: null,
      overdue: false,
      tags: [],
      openTasks: 0,
    });
    setTitle("");
    // Keep server data (owner/avatar) in sync without a full reload jank.
    if (refreshOnCreate) router.refresh();
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
  total,
  paginated,
  hasMore,
  loading,
  onLoadMore,
  onLoadAll,
  newDeal,
  stageOptions,
  allTags,
  owners,
  canAssign,
  shareUsers,
  canShare,
  sharedMap,
  currentUserId,
  onCollapse,
  onCreated,
  onDeleteDeal,
  onDealDeleted,
  onStageChange,
  onTagsChange,
  onAmountChange,
  onOwnerChange,
  onDueDateChange,
}: {
  stage: KanbanStage;
  deals: KanbanDeal[];
  // Full matching rollup for this stage (independent of loaded card count).
  total: StageTotal;
  paginated: boolean;
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
  onLoadAll: () => void;
  newDeal?: NewDealProps;
  stageOptions: { id: string; name: string }[];
  allTags: TagView[];
  owners: { id: string; name: string }[];
  canAssign: boolean;
  shareUsers: ShareUserView[];
  canShare: boolean;
  sharedMap: Record<string, string[]>;
  currentUserId?: string;
  onCollapse: () => void;
  onCreated: (deal: KanbanDeal) => void;
  onDeleteDeal: (dealId: string) => Promise<{ ok?: boolean; error?: string }>;
  onDealDeleted: (dealId: string) => void;
  onStageChange: (dealId: string, stageId: string) => void;
  onTagsChange: (dealId: string, tags: TagView[]) => void;
  onAmountChange: (dealId: string, amount: number | null) => void;
  onOwnerChange: (dealId: string, ownerId: string | null) => void;
  onDueDateChange: (dealId: string, dueDate: string | null) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const [adding, setAdding] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  // Stage-color tints used to make each column clearly distinguishable.
  const headerTint = hexAlpha(stage.color, 0.16);
  const listTint = hexAlpha(stage.color, 0.07);
  const colBorder = hexAlpha(stage.color, 0.45);
  const remaining = Math.max(0, total.count - deals.length);

  // Infinite scroll: load the next page as the sentinel nears the bottom of
  // this column's own scroll area. Re-armed whenever more remains / a load ends.
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;
  useEffect(() => {
    if (!hasMore || loading) return;
    const root = scrollRef.current;
    const target = sentinelRef.current;
    if (!root || !target) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onLoadMoreRef.current();
      },
      { root, rootMargin: "200px" }
    );
    io.observe(target);
    return () => io.disconnect();
  }, [hasMore, loading, deals.length]);

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
              {total.count}
            </span>
          </div>
          <div className="flex shrink-0 items-center">
            {paginated && hasMore && (
              <button
                onClick={onLoadAll}
                disabled={loading}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                title={`Load all ${total.count} deals`}
              >
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListPlus className="h-3.5 w-3.5" />}
              </button>
            )}
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
              onClick={onCollapse}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Collapse column"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="mt-1 px-0.5 text-xs text-muted-foreground tabular-nums">
          {formatCurrency(total.value)} · weighted {formatCurrency((total.value * stage.probability) / 100)}
        </div>
      </div>

      <div
        ref={(node) => {
          setNodeRef(node);
          scrollRef.current = node;
        }}
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
        {adding && <QuickAdd stageId={stage.id} onCreated={onCreated} refreshOnCreate={!paginated} />}
        {deals.map((d) => (
          <DealCard
            key={d.id}
            deal={d}
            paginated={paginated}
            stageColor={stage.color}
            stageOptions={stageOptions}
            allTags={allTags}
            owners={owners}
            canAssign={canAssign}
            shareUsers={shareUsers}
            canShare={canShare}
            sharedUserIds={sharedMap[d.id]}
            canDelete={!!newDeal?.isAdmin || (!!currentUserId && d.ownerId === currentUserId)}
            onDelete={() => onDeleteDeal(d.id)}
            onDeleted={() => onDealDeleted(d.id)}
            onStageChange={onStageChange}
            onTagsChange={onTagsChange}
            onAmountChange={onAmountChange}
            onOwnerChange={onOwnerChange}
            onDueDateChange={onDueDateChange}
          />
        ))}

        {paginated && hasMore && (
          <div ref={sentinelRef} className="flex flex-col gap-1.5 py-1">
            <button
              onClick={onLoadMore}
              disabled={loading}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed py-2 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading…
                </>
              ) : (
                `Load more (${remaining} left)`
              )}
            </button>
          </div>
        )}

        {total.count === 0 && !adding && (
          <button
            onClick={() => setAdding(true)}
            className="rounded-2xl border border-dashed py-8 text-center text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
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
  total,
  onExpand,
}: {
  stage: KanbanStage;
  total: StageTotal;
  onExpand: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
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
        {total.count}
      </span>
      <span
        className="flex-1 text-xs font-semibold [writing-mode:vertical-rl]"
        style={{ textOrientation: "mixed" }}
      >
        {stage.name}
      </span>
      <span className="text-[9px] text-muted-foreground [writing-mode:vertical-rl] tabular-nums">
        {formatCurrency(total.value)}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Phase group (header band + its stage columns)
// ---------------------------------------------------------------------------
type PhaseGroupData = { key: string; label: string; stages: KanbanStage[] };

const EMPTY_TOTAL: StageTotal = { count: 0, value: 0 };

function PhaseGroup({
  group,
  byStage,
  totals,
  paginated,
  loadingStages,
  hasMore,
  onLoadMore,
  onLoadAll,
  collapsedStages,
  newDeal,
  stageOptions,
  allTags,
  owners,
  canAssign,
  shareUsers,
  canShare,
  sharedMap,
  currentUserId,
  collapsed,
  onTogglePhase,
  onToggleStage,
  onCreated,
  onDeleteDeal,
  onDealDeleted,
  onStageChange,
  onTagsChange,
  onAmountChange,
  onOwnerChange,
  onDueDateChange,
}: {
  group: PhaseGroupData;
  byStage: Record<string, KanbanDeal[]>;
  totals: Record<string, StageTotal>;
  paginated: boolean;
  loadingStages: Set<string>;
  hasMore: (stageId: string) => boolean;
  onLoadMore: (stageId: string) => void;
  onLoadAll: (stageId: string) => void;
  collapsedStages: Set<string>;
  newDeal?: NewDealProps;
  stageOptions: { id: string; name: string }[];
  allTags: TagView[];
  owners: { id: string; name: string }[];
  canAssign: boolean;
  shareUsers: ShareUserView[];
  canShare: boolean;
  sharedMap: Record<string, string[]>;
  currentUserId?: string;
  collapsed: boolean;
  onTogglePhase: () => void;
  onToggleStage: (stageId: string) => void;
  onCreated: (deal: KanbanDeal) => void;
  onDeleteDeal: (dealId: string) => Promise<{ ok?: boolean; error?: string }>;
  onDealDeleted: (dealId: string) => void;
  onStageChange: (dealId: string, stageId: string) => void;
  onTagsChange: (dealId: string, tags: TagView[]) => void;
  onAmountChange: (dealId: string, amount: number | null) => void;
  onOwnerChange: (dealId: string, ownerId: string | null) => void;
  onDueDateChange: (dealId: string, dueDate: string | null) => void;
}) {
  // Phase-band totals roll up the *full* per-stage counts/values, not just the
  // loaded cards.
  const groupCount = group.stages.reduce((s, st) => s + (totals[st.id]?.count ?? 0), 0);
  const groupValue = group.stages.reduce((s, st) => s + (totals[st.id]?.value ?? 0), 0);
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
          {groupCount}
        </span>
        <span className="flex-1 text-sm font-bold uppercase tracking-wide [writing-mode:vertical-rl]">
          {group.label}
        </span>
        <span className="text-[9px] text-muted-foreground [writing-mode:vertical-rl] tabular-nums">
          {formatCurrency(groupValue)}
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
          <span className="rounded-full bg-background/70 px-1.5">{groupCount}</span>
          <span className="font-medium text-foreground">{formatCurrency(groupValue)}</span>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 gap-3">
        {group.stages.map((stage) =>
          collapsedStages.has(stage.id) ? (
            <CollapsedStage
              key={stage.id}
              stage={stage}
              total={totals[stage.id] ?? EMPTY_TOTAL}
              onExpand={() => onToggleStage(stage.id)}
            />
          ) : (
            <StageColumn
              key={stage.id}
              stage={stage}
              deals={byStage[stage.id] ?? []}
              total={totals[stage.id] ?? EMPTY_TOTAL}
              paginated={paginated}
              hasMore={hasMore(stage.id)}
              loading={loadingStages.has(stage.id)}
              onLoadMore={() => onLoadMore(stage.id)}
              onLoadAll={() => onLoadAll(stage.id)}
              newDeal={newDeal}
              stageOptions={stageOptions}
              allTags={allTags}
              owners={owners}
              canAssign={canAssign}
              shareUsers={shareUsers}
              canShare={canShare}
              sharedMap={sharedMap}
              currentUserId={currentUserId}
              onCollapse={() => onToggleStage(stage.id)}
              onCreated={onCreated}
              onDeleteDeal={onDeleteDeal}
              onDealDeleted={onDealDeleted}
              onStageChange={onStageChange}
              onTagsChange={onTagsChange}
              onAmountChange={onAmountChange}
              onOwnerChange={onOwnerChange}
              onDueDateChange={onDueDateChange}
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
  stageTotals: initialTotals = {},
  paginated = false,
  filterParams = {},
  pageSize = 10,
  newDeal,
  shareUsers = [],
  sharedMap: initialSharedMap = {},
  currentUserId,
}: {
  stages: KanbanStage[];
  deals: KanbanDeal[];
  // Per-stage {count, value} for the *full* matching set (drives the column
  // header count + totals independently of how many cards are loaded).
  stageTotals?: Record<string, StageTotal>;
  // When true, only the first page of each column is loaded; the rest stream in
  // via infinite scroll / "Load all". When false (stale filter / activity sort)
  // every matching deal is already present.
  paginated?: boolean;
  filterParams?: DealFilterParams;
  pageSize?: number;
  newDeal?: NewDealProps;
  shareUsers?: ShareUserView[];
  sharedMap?: Record<string, string[]>;
  currentUserId?: string;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [deals, setDeals] = useState(initial);
  const [totals, setTotals] = useState<Record<string, StageTotal>>(initialTotals);
  const [sharedMap, setSharedMap] = useState<Record<string, string[]>>(initialSharedMap);
  const [loadingStages, setLoadingStages] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [collapsedStages, setCollapsedStages] = useState<Set<string>>(new Set());
  const [collapsedPhases, setCollapsedPhases] = useState<Set<string>>(new Set());
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_ACTIVATION } })
  );

  // Re-seed from the server whenever a navigation (filter/search/sort change)
  // hands down a fresh first page. Deliberately keyed on the incoming props so
  // client-side "load more" appends aren't clobbered between navigations.
  useEffect(() => setDeals(initial), [initial]);
  useEffect(() => setTotals(initialTotals), [initialTotals]);
  useEffect(() => setSharedMap(initialSharedMap), [initialSharedMap]);

  // Hydrate persisted collapse state after mount (avoids SSR mismatch).
  useEffect(() => {
    setCollapsedStages(loadSet(STAGE_KEY));
    setCollapsedPhases(loadSet(PHASE_KEY));
  }, []);

  const stageOptions = useMemo(() => stages.map((s) => ({ id: s.id, name: s.name })), [stages]);
  const allTags = newDeal?.tags ?? [];
  // Owner reassignment from cards is admin-only (matches quickUpdateDealAction).
  const owners = newDeal?.owners ?? [];
  const canAssign = !!newDeal?.isAdmin && owners.length > 0;
  // Sharing is admin-only (matches quickShareDealAction).
  const canShare = !!newDeal?.isAdmin && shareUsers.length > 0;

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
  // Nudge a stage's server-authoritative rollup after an optimistic mutation so
  // the header/column totals stay right without a round-trip. `dCount`/`dValue`
  // are signed deltas.
  function adjustTotal(stageId: string, dCount: number, dValue: number) {
    setTotals((prev) => {
      const cur = prev[stageId] ?? { count: 0, value: 0 };
      return {
        ...prev,
        [stageId]: { count: Math.max(0, cur.count + dCount), value: cur.value + dValue },
      };
    });
  }

  const loadedByStage = useMemo(() => {
    const m: Record<string, number> = {};
    for (const d of deals) m[d.stageId] = (m[d.stageId] ?? 0) + 1;
    return m;
  }, [deals]);

  const hasMore = (stageId: string) =>
    paginated && (loadedByStage[stageId] ?? 0) < (totals[stageId]?.count ?? 0);

  // Fetch the next slice (or all remaining) of a column, re-applying the exact
  // filters/sort server-side. Dedupes against cards already present (optimistic
  // moves/creates can shift offsets) and folds in any admin share badges.
  async function loadMore(stageId: string, all = false) {
    if (!paginated || loadingStages.has(stageId)) return;
    const offset = loadedByStage[stageId] ?? 0;
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
    setDeals((ds) => {
      const seen = new Set(ds.map((d) => d.id));
      return [...ds, ...res.kanban.filter((d) => !seen.has(d.id))];
    });
    if (Object.keys(res.sharedMap).length) {
      setSharedMap((prev) => ({ ...prev, ...res.sharedMap }));
    }
  }

  function addDeal(deal: KanbanDeal) {
    setDeals((ds) => [deal, ...ds]);
    adjustTotal(deal.stageId, 1, deal.amountEur ?? 0);
  }

  // Delete a deal via the server action; the card is removed from local state
  // by the ConfirmDeleteButton's onDeleted callback only after success.
  async function deleteDeal(dealId: string) {
    return deleteDealAction(dealId);
  }
  function removeDeal(dealId: string) {
    const gone = deals.find((d) => d.id === dealId);
    if (gone) adjustTotal(gone.stageId, -1, -(gone.amountEur ?? 0));
    setDeals((ds) => ds.filter((d) => d.id !== dealId));
  }

  // Inline status change from a card: optimistically move the card to the new
  // stage's column, persist via quick-update, and revert on failure.
  async function changeStage(dealId: string, stageId: string) {
    const prev = deals;
    const deal = deals.find((d) => d.id === dealId);
    const fromStage = deal?.stageId;
    const amount = deal?.amountEur ?? 0;
    setDeals((ds) => ds.map((d) => (d.id === dealId ? { ...d, stageId } : d)));
    if (fromStage && fromStage !== stageId) {
      adjustTotal(fromStage, -1, -amount);
      adjustTotal(stageId, 1, amount);
    }
    const res = await quickUpdateDealAction(dealId, { stageId });
    if (res.error) {
      setDeals(prev);
      if (fromStage && fromStage !== stageId) {
        adjustTotal(stageId, -1, -amount);
        adjustTotal(fromStage, 1, amount);
      }
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
    const deal = deals.find((d) => d.id === dealId);
    if (deal) adjustTotal(deal.stageId, 0, (amount ?? 0) - (deal.amountEur ?? 0));
    setDeals((ds) => ds.map((d) => (d.id === dealId ? { ...d, amountEur: amount } : d)));
  }

  // Inline owner reassignment from a card: optimistically update the avatar,
  // persist via quick-update, revert on failure, and refresh on success so the
  // real avatar color (not carried in the owners list) is synced from server.
  async function changeOwner(dealId: string, ownerId: string | null) {
    const prev = deals;
    const name = ownerId ? owners.find((o) => o.id === ownerId)?.name ?? null : null;
    setDeals((ds) =>
      ds.map((d) => (d.id === dealId ? { ...d, ownerId, ownerName: name, ownerColor: null } : d))
    );
    const res = await quickUpdateDealAction(dealId, { ownerId });
    if (res.error) {
      setDeals(prev);
      toast({ title: res.error, variant: "error" });
    } else if (!paginated) {
      // A full refresh would discard the columns' loaded pages, so in the
      // paginated view we keep the optimistic avatar (color syncs on next nav).
      router.refresh();
    }
  }

  // Inline due-date change from a card: optimistically update the date (with a
  // naive overdue recompute for instant feedback), persist via quick-update,
  // revert on failure, and refresh on success so overdue reflects stage flags.
  async function changeDueDate(dealId: string, dueDate: string | null) {
    const prev = deals;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const overdue = dueDate ? new Date(dueDate) < startOfToday : false;
    setDeals((ds) =>
      ds.map((d) =>
        d.id === dealId
          ? { ...d, dueDate: dueDate ? new Date(dueDate).toISOString() : null, overdue }
          : d
      )
    );
    const res = await quickUpdateDealAction(dealId, { dueDate });
    if (res.error) {
      setDeals(prev);
      toast({ title: res.error, variant: "error" });
    } else if (!paginated) {
      // See changeOwner: avoid clobbering loaded pages in the paginated view.
      router.refresh();
    }
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
    const fromStage = deal.stageId;
    const amount = deal.amountEur ?? 0;
    setDeals((ds) => ds.map((d) => (d.id === dealId ? { ...d, stageId: overId } : d)));
    adjustTotal(fromStage, -1, -amount);
    adjustTotal(overId, 1, amount);
    const res = await moveDealStageAction(dealId, overId);
    if (res.error) {
      setDeals(prev);
      adjustTotal(overId, -1, -amount);
      adjustTotal(fromStage, 1, amount);
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
            totals={totals}
            paginated={paginated}
            loadingStages={loadingStages}
            hasMore={hasMore}
            onLoadMore={(stageId) => loadMore(stageId, false)}
            onLoadAll={(stageId) => loadMore(stageId, true)}
            collapsedStages={collapsedStages}
            newDeal={newDeal}
            stageOptions={stageOptions}
            allTags={allTags}
            owners={owners}
            canAssign={canAssign}
            shareUsers={shareUsers}
            canShare={canShare}
            sharedMap={sharedMap}
            currentUserId={currentUserId}
            collapsed={collapsedPhases.has(group.key)}
            onTogglePhase={() => togglePhase(group.key)}
            onToggleStage={toggleStage}
            onCreated={addDeal}
            onDeleteDeal={deleteDeal}
            onDealDeleted={removeDeal}
            onStageChange={changeStage}
            onTagsChange={changeTags}
            onAmountChange={changeAmount}
            onOwnerChange={changeOwner}
            onDueDateChange={changeDueDate}
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
