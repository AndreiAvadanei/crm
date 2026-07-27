"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2, ChevronRight, SlidersHorizontal } from "lucide-react";
import { createTaskAction } from "@/server/deal-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { TaskItem } from "@/components/tasks/task-item";
import { TaskSheet } from "@/components/tasks/task-sheet";
import { TASK_TYPE_OPTIONS, type TaskItemData } from "@/components/tasks/task-common";
import { TASK_URGENCY_OPTIONS, type TaskUrgency } from "@/lib/task-urgency";
import { cn } from "@/lib/utils";

export type TaskView = {
  id: string;
  title: string;
  type: string;
  status: string;
  urgency: TaskUrgency;
  dueDate: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeColor: string | null;
};

export function TasksPanel({
  dealId,
  tasks,
  owners = [],
  admin = false,
}: {
  dealId: string;
  tasks: TaskView[];
  owners?: { id: string; name: string }[];
  admin?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!formRef.current) return;
    setBusy(true);
    try {
      const res = await createTaskAction(dealId, new FormData(formRef.current));
      if (res.error) return toast({ title: res.error, variant: "error" });
      formRef.current.reset();
      router.refresh();
    } catch {
      toast({ title: "Could not add task. Refresh the page and try again.", variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  const open = tasks.filter((t) => t.status === "OPEN");
  const done = tasks.filter((t) => t.status === "DONE");
  const active = tasks.find((t) => t.id === activeId) ?? null;

  const selectCls = "form-control h-9 w-full cursor-pointer px-2.5 text-sm";

  return (
    <div className="space-y-4">
      <form ref={formRef} onSubmit={add} className="space-y-2">
        <div className="flex items-center gap-2">
          <Input name="title" placeholder="Add a next action…" required />
          <Button type="submit" disabled={busy} className="shrink-0">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus />}
            <span className="hidden sm:inline">Add</span>
          </Button>
        </div>

        <button
          type="button"
          onClick={() => setShowOptions((v) => !v)}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          {showOptions ? "Hide options" : "Options"}
        </button>

        <div className={cn("grid grid-cols-1 gap-2 sm:grid-cols-3", !showOptions && "hidden")}>
          <select name="type" defaultValue="TASK" className={selectCls} aria-label="Type">
            {TASK_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select name="urgency" defaultValue="MEDIUM" className={selectCls} aria-label="Priority">
            {TASK_URGENCY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <Input name="dueDate" type="date" aria-label="Due date" />
        </div>
      </form>

      <div className="space-y-1.5">
        {open.map((t) => (
          <TaskItem key={t.id} task={t as TaskItemData} onOpen={() => setActiveId(t.id)} />
        ))}
        {open.length === 0 && done.length === 0 && (
          <p className="text-sm text-muted-foreground">No tasks yet. Add a next action above.</p>
        )}
        {open.length === 0 && done.length > 0 && (
          <p className="text-sm text-muted-foreground">All caught up — no open tasks.</p>
        )}
      </div>

      {done.length > 0 && (
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", showDone && "rotate-90")} />
            Completed ({done.length})
          </button>
          {showDone &&
            done.map((t) => (
              <TaskItem key={t.id} task={t as TaskItemData} onOpen={() => setActiveId(t.id)} />
            ))}
        </div>
      )}

      <TaskSheet
        task={active as TaskItemData | null}
        owners={owners}
        admin={admin}
        open={activeId !== null && active !== null}
        onOpenChange={(o) => !o && setActiveId(null)}
      />
    </div>
  );
}
