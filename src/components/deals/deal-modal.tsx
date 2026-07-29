"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

/**
 * Dialog shell for the intercepted deal route. Opens immediately, and dismissing
 * it (overlay click, Esc, or the close button) navigates back so the deals list
 * — with its filters and scroll position — is restored without a full reload.
 */
export function DealModal({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(true);

  function onOpenChange(next: boolean) {
    setOpen(next);
    // Wait for the close animation to start before unwinding the intercepted
    // route, then fall back to the deals list if there's no history to pop.
    if (!next) router.back();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[98vw] max-w-[1600px]">
        <DialogTitle className="sr-only">Deal details</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  );
}
