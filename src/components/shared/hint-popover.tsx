"use client";

// Lightweight tooltip-style hint: a help icon that reveals content on hover
// (and click, for touch) using Radix Popover, since no Radix Tooltip is installed.

import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export function HintPopover({
  children,
  label = "Show details",
  className,
  contentClassName,
}: {
  children: React.ReactNode;
  label?: string;
  className?: string;
  contentClassName?: string;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen((o) => !o);
          }}
          className={cn("text-muted-foreground transition-colors hover:text-foreground", className)}
        >
          <HelpCircle className="h-4 w-4" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={6}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className={cn(
            "z-50 max-h-72 max-w-sm overflow-y-auto whitespace-pre-wrap rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md",
            contentClassName
          )}
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
