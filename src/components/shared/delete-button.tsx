"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

export function DeleteButton({
  onDelete,
  redirectTo,
  back = false,
  label = "Delete",
  title = "Delete this item?",
  description = "This action cannot be undone.",
  variant = "ghost",
  iconOnly = false,
}: {
  onDelete: () => Promise<{ ok?: boolean; error?: string }>;
  redirectTo?: string;
  // When true, close by navigating back instead of pushing `redirectTo`. Used
  // for the deal modal so deleting dismisses the dialog and returns to the list
  // (with its filters intact) rather than refreshing the now-deleted route,
  // which would render a 404.
  back?: boolean;
  label?: string;
  title?: string;
  description?: string;
  variant?: "ghost" | "outline" | "destructive";
  iconOnly?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    const res = await onDelete();
    setBusy(false);
    if (res?.error) return toast({ title: res.error, variant: "error" });
    toast({ title: "Deleted", variant: "success" });
    setOpen(false);
    // `back` closes the modal without refreshing the deleted route (the delete
    // action already revalidates the list). Otherwise redirect + refresh.
    if (back) {
      router.back();
      return;
    }
    if (redirectTo) router.push(redirectTo);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant={variant} size={iconOnly ? "icon" : "default"} onClick={() => setOpen(true)}>
        <Trash2 className={iconOnly ? "h-4 w-4 text-destructive" : "h-4 w-4"} />
        {!iconOnly && label}
      </Button>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
