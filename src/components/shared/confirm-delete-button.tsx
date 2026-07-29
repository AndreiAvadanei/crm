"use client";

import { useState, type SyntheticEvent } from "react";
import { Loader2, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/**
 * Inline delete control that opens an "Are you sure?" confirmation dialog before
 * running the delete. The trigger stays a small icon button so it can live in
 * dense rows / cards; all pointer/click events on it are stopped so it works
 * safely inside draggable or linked containers. The dialog itself is portaled,
 * so its buttons never bubble back into those containers.
 */
export function ConfirmDeleteButton({
  onDelete,
  onDeleted,
  idleTitle = "Delete",
  title = "Delete this item?",
  description = "This action cannot be undone.",
  confirmLabel = "Delete",
  className,
  iconClassName,
}: {
  onDelete: () => Promise<{ ok?: boolean; error?: string }>;
  onDeleted?: () => void;
  idleTitle?: string;
  title?: string;
  description?: string;
  confirmLabel?: string;
  className?: string;
  iconClassName?: string;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const stop = (e: SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  async function confirm(e: SyntheticEvent) {
    stop(e);
    if (busy) return;
    setBusy(true);
    const res = await onDelete();
    setBusy(false);
    if (res?.error) {
      toast({ title: res.error, variant: "error" });
      return;
    }
    setOpen(false);
    toast({ title: "Deleted", variant: "success" });
    onDeleted?.();
  }

  return (
    <>
      <button
        type="button"
        onPointerDown={stop}
        onClick={(e) => {
          stop(e);
          setOpen(true);
        }}
        title={idleTitle}
        className={cn(
          "rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive",
          className
        )}
      >
        <Trash2 className={cn("h-3.5 w-3.5", iconClassName)} />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm" onClick={stop} onPointerDown={stop}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={(e) => { stop(e); setOpen(false); }} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirm} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} {confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
