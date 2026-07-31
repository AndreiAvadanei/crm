"use client";

import { useEffect, useState } from "react";
import { BarChart3, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "dashboard:showAnalytics";

/**
 * Collapsible wrapper for the numeric analytics section. Dashboard opens in a
 * "focused" mode (just My work) with everything below hidden until the user
 * toggles it on. The choice is persisted to localStorage so it sticks across
 * reloads. We start collapsed on the server/first render to avoid a hydration
 * mismatch, then hydrate the stored preference in an effect.
 */
export function DashboardAnalytics({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      setOpen(window.localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      /* ignore private-mode errors */
    }
  }, []);

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore quota / private-mode errors */
      }
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-t pt-4">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <BarChart3 className="h-4 w-4" />
          Analytics &amp; numbers
        </div>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {open ? "Hide numbers" : "Show numbers"}
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
        </button>
      </div>

      {open && <div className="space-y-6">{children}</div>}
    </div>
  );
}
