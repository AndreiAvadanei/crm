"use client";

import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/**
 * Inline delete control with a two-step confirmation. The first click "arms"
 * the button, showing an "Are you sure?" confirm state that stays disabled for
 * `confirmDelayMs` (default 5s) — a deliberate cooling-off window so the delete
 * can't be fired by accident. A live countdown ticks down; once it reaches zero
 * the confirm becomes clickable and the second click runs the delete. All
 * pointer/click events are stopped so it can live safely inside draggable /
 * linked containers.
 */
export function ConfirmDeleteButton({
  onDelete,
  onDeleted,
  confirmDelayMs = 5000,
  idleTitle = "Delete",
  confirmLabel = "Are you sure?",
  className,
  iconClassName,
}: {
  onDelete: () => Promise<{ ok?: boolean; error?: string }>;
  onDeleted?: () => void;
  confirmDelayMs?: number;
  idleTitle?: string;
  confirmLabel?: string;
  className?: string;
  iconClassName?: string;
}) {
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  // Seconds left before the confirm becomes clickable (0 = ready).
  const [secondsLeft, setSecondsLeft] = useState(0);
  const interval = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = useCallback(() => {
    if (interval.current) {
      clearInterval(interval.current);
      interval.current = null;
    }
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const stop = (e: SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  async function handleClick(e: SyntheticEvent) {
    stop(e);
    if (busy) return;

    // First click: arm the confirm state and start the cooling-off countdown.
    if (!confirming) {
      const total = Math.ceil(confirmDelayMs / 1000);
      setConfirming(true);
      setSecondsLeft(total);
      clearTimer();
      interval.current = setInterval(() => {
        setSecondsLeft((s) => {
          if (s <= 1) {
            clearTimer();
            return 0;
          }
          return s - 1;
        });
      }, 1000);
      return;
    }

    // Armed but still in the cooling-off window — ignore clicks.
    if (secondsLeft > 0) return;

    // Second click (armed + ready): perform the delete.
    clearTimer();
    setBusy(true);
    const res = await onDelete();
    setBusy(false);
    if (res?.error) {
      setConfirming(false);
      toast({ title: res.error, variant: "error" });
      return;
    }
    toast({ title: "Deleted", variant: "success" });
    onDeleted?.();
  }

  if (confirming) {
    const waiting = secondsLeft > 0;
    return (
      <button
        type="button"
        onPointerDown={stop}
        onClick={handleClick}
        disabled={busy || waiting}
        title={waiting ? `Wait ${secondsLeft}s…` : `${confirmLabel} — click to delete`}
        className={cn(
          "flex items-center gap-1 rounded bg-destructive px-1.5 py-0.5 text-[11px] font-semibold text-destructive-foreground transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60",
          className
        )}
      >
        {busy ? <Loader2 className={cn("h-3 w-3 animate-spin", iconClassName)} /> : <Trash2 className={cn("h-3 w-3", iconClassName)} />}
        {waiting ? `${confirmLabel} (${secondsLeft})` : confirmLabel}
      </button>
    );
  }

  return (
    <button
      type="button"
      onPointerDown={stop}
      onClick={handleClick}
      title={idleTitle}
      className={cn(
        "rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive",
        className
      )}
    >
      <Trash2 className={cn("h-3.5 w-3.5", iconClassName)} />
    </button>
  );
}
