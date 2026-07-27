"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlarmClock } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";
import { snoozeTaskAction } from "@/server/quick-actions";

const PRESETS = [
  { days: 1, label: "Tomorrow" },
  { days: 3, label: "In 3 days" },
  { days: 7, label: "In 1 week" },
  { days: 14, label: "In 2 weeks" },
];

/**
 * Dropdown that pushes a task's due date out by a preset (or custom) number of
 * days. The trigger is provided by the caller so it can be an icon button in a
 * list row or a labelled button in the editor sheet.
 */
export function SnoozeMenu({
  taskId,
  children,
  align = "end",
}: {
  taskId: string;
  children: React.ReactNode;
  align?: "start" | "end" | "center";
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [custom, setCustom] = useState("");
  const [open, setOpen] = useState(false);

  function snooze(days: number) {
    if (!Number.isFinite(days) || days <= 0) return;
    startTransition(async () => {
      const res = await snoozeTaskAction(taskId, days);
      if (res.error) return toast({ title: res.error, variant: "error" });
      toast({
        title: `Snoozed ${days} day${days === 1 ? "" : "s"}${res.dueDate ? ` · due ${res.dueDate}` : ""}`,
        variant: "success",
      });
      setOpen(false);
      setCustom("");
      router.refresh();
    });
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-52">
        <DropdownMenuLabel className="flex items-center gap-2 text-xs text-muted-foreground">
          <AlarmClock className="h-3.5 w-3.5" /> Snooze until
        </DropdownMenuLabel>
        {PRESETS.map((p) => (
          <DropdownMenuItem
            key={p.days}
            disabled={pending}
            onSelect={(e) => {
              e.preventDefault();
              snooze(p.days);
            }}
          >
            {p.label}
            <span className="ml-auto text-xs text-muted-foreground">{p.days}d</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <div className="flex items-center gap-1.5 p-1">
          <input
            type="number"
            min={1}
            inputMode="numeric"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                e.preventDefault();
                snooze(Number.parseInt(custom, 10));
              }
            }}
            placeholder="Days"
            aria-label="Snooze days"
            className="form-control h-8 w-full px-2 text-sm"
          />
          <button
            type="button"
            disabled={pending || !custom}
            onClick={() => snooze(Number.parseInt(custom, 10))}
            className="inline-flex h-8 items-center rounded-md border border-input px-2.5 text-sm font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            Go
          </button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
