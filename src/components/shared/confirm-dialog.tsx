"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

type ActionResult = { ok?: boolean; error?: string } | void;

/**
 * Wraps any single trigger element with a confirmation modal. Use it to gate
 * destructive actions while keeping the caller's existing trigger styling.
 * The child is rendered via Radix `asChild`, so it must be a single element
 * (and must NOT carry its own onClick that performs the action).
 */
export function ConfirmDialog({
  children,
  onConfirm,
  title = "Are you sure?",
  description = "This action cannot be undone.",
  confirmLabel = "Delete",
  successMessage,
  variant = "destructive",
}: {
  children: React.ReactNode;
  onConfirm: () => Promise<ActionResult>;
  title?: string;
  description?: string;
  confirmLabel?: string;
  successMessage?: string;
  variant?: "destructive" | "default";
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      const res = await onConfirm();
      // Keep the dialog open so the user can read the error and retry.
      if (res?.error) return toast({ title: res.error, variant: "error" });
      if (successMessage) toast({ title: successMessage, variant: "success" });
      setOpen(false);
      router.refresh();
    } catch {
      toast({ title: "Something went wrong. Please try again.", variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant={variant} onClick={confirm} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
