"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Phone, Mail, StickyNote, CalendarDays, CheckSquare, Loader2 } from "lucide-react";
import { createTaskAction, toggleTaskAction, deleteTaskAction } from "@/server/deal-actions";
import { quickUpdateTaskAction } from "@/server/quick-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar } from "@/components/ui/avatar";
import { useToast } from "@/components/ui/toast";
import { InlineInput, InlineSelect } from "@/components/shared/inline-edit";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { TASK_URGENCY_OPTIONS, URGENCY_TEXT_CLASS, type TaskUrgency } from "@/lib/task-urgency";
import { cn, formatDate } from "@/lib/utils";

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

const typeIcon: Record<string, React.ElementType> = {
  TASK: CheckSquare,
  CALL: Phone,
  EMAIL: Mail,
  NOTE: StickyNote,
  MEETING: CalendarDays,
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

  async function toggle(id: string) {
    try {
      const res = await toggleTaskAction(id);
      if (res.error) return toast({ title: res.error, variant: "error" });
      router.refresh();
    } catch {
      toast({ title: "Action failed. Refresh and retry.", variant: "error" });
    }
  }
  const open = tasks.filter((t) => t.status === "OPEN");
  const done = tasks.filter((t) => t.status === "DONE");

  return (
    <div className="space-y-4">
      <form ref={formRef} onSubmit={add} className="flex flex-wrap items-end gap-2">
        <Input name="title" placeholder="Add a next action…" className="min-w-[200px] flex-1" required />
        <select name="type" className="h-9 rounded-md border border-input bg-background px-3 text-sm">
          <option value="TASK">Task</option>
          <option value="CALL">Call</option>
          <option value="EMAIL">Email</option>
          <option value="MEETING">Meeting</option>
          <option value="NOTE">Note</option>
        </select>
        <select
          name="urgency"
          defaultValue="MEDIUM"
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          aria-label="Urgency"
        >
          {TASK_URGENCY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <Input name="dueDate" type="date" className="w-40" />
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus />} Add
        </Button>
      </form>

      <div className="space-y-1.5">
        {[...open, ...done].map((t) => {
          const Icon = typeIcon[t.type] ?? CheckSquare;
          const isDone = t.status === "DONE";
          return (
            <div key={t.id} className="flex items-center gap-2 rounded-lg border px-2 py-2">
              <Checkbox checked={isDone} onCheckedChange={() => toggle(t.id)} />
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <InlineInput
                  value={t.title}
                  triggerClassName={cn("font-medium", isDone && "text-muted-foreground line-through")}
                  onSave={(title) => quickUpdateTaskAction(t.id, { title })}
                />
                <div className="px-1.5">
                  <InlineInput
                    type="date"
                    value={t.dueDate ?? ""}
                    display={
                      t.dueDate ? (
                        <span className="text-xs text-muted-foreground">Due {formatDate(t.dueDate)}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Set due date</span>
                      )
                    }
                    onSave={(dueDate) => quickUpdateTaskAction(t.id, { dueDate: dueDate || null })}
                  />
                </div>
              </div>
              <div className="w-24 shrink-0">
                <InlineSelect
                  value={t.urgency}
                  options={TASK_URGENCY_OPTIONS}
                  className={cn("font-medium", URGENCY_TEXT_CLASS[t.urgency], isDone && "opacity-60")}
                  onSave={(urgency) => quickUpdateTaskAction(t.id, { urgency: urgency as TaskUrgency })}
                />
              </div>
              {admin ? (
                <div className="w-32 shrink-0">
                  <InlineSelect
                    value={t.assigneeId ?? ""}
                    placeholder="Unassigned"
                    options={owners.map((o) => ({ value: o.id, label: o.name }))}
                    onSave={(assigneeId) => quickUpdateTaskAction(t.id, { assigneeId: assigneeId || null })}
                  />
                </div>
              ) : (
                t.assigneeName && (
                  <Avatar name={t.assigneeName} color={t.assigneeColor} className="h-6 w-6 text-[10px]" />
                )
              )}
              <ConfirmDialog
                onConfirm={() => deleteTaskAction(t.id)}
                title="Delete task?"
                successMessage="Task deleted"
              >
                <Button variant="ghost" size="icon">
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </ConfirmDialog>
            </div>
          );
        })}
        {tasks.length === 0 && <p className="text-sm text-muted-foreground">No tasks yet. Add a next action above.</p>}
      </div>
    </div>
  );
}
