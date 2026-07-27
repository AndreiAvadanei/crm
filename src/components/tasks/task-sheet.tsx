"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlarmClock, CheckCircle2, Circle, Loader2, Trash2, ExternalLink } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { quickUpdateTaskAction, type TaskPatch } from "@/server/quick-actions";
import { deleteTaskAction } from "@/server/deal-actions";
import { SnoozeMenu } from "@/components/tasks/snooze-menu";
import { TASK_URGENCY_OPTIONS, URGENCY_META, type TaskUrgency } from "@/lib/task-urgency";
import { TASK_TYPE_META, TASK_TYPE_OPTIONS, TaskTypeIcon, type TaskItemData } from "@/components/tasks/task-common";
import { cn } from "@/lib/utils";

/**
 * Full-room task editor in a right-hand drawer. Editing a task from a cramped
 * sidebar (or a small screen) opens here where every field has space. Each field
 * commits immediately so there's no separate save step.
 */
export function TaskSheet({
  task,
  owners,
  admin,
  open,
  onOpenChange,
}: {
  task: TaskItemData | null;
  owners: { id: string; name: string }[];
  admin: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(task?.title ?? "");
  const titleRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setTitle(task?.title ?? ""), [task?.id, task?.title]);
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [title, open]);

  if (!task) return null;
  const isDone = task.status === "DONE";

  function save(patch: TaskPatch) {
    startTransition(async () => {
      const res = await quickUpdateTaskAction(task!.id, patch);
      if (res.error) return toast({ title: res.error, variant: "error" });
      router.refresh();
    });
  }

  function commitTitle() {
    const next = title.trim();
    if (!next || next === task!.title) {
      setTitle(task!.title);
      return;
    }
    save({ title: next });
  }

  function toggleStatus() {
    save({ status: isDone ? "OPEN" : "DONE" });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 p-0">
        <SheetHeader className="border-b p-5 pr-12">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <TaskTypeIcon type={task.type} className="h-3.5 w-3.5" />
            {TASK_TYPE_META[task.type]?.label ?? task.type}
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          </div>
          <SheetTitle className="sr-only">Edit task</SheetTitle>
          <textarea
            ref={titleRef}
            value={title}
            rows={1}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                titleRef.current?.blur();
              }
            }}
            placeholder="Task title"
            className={cn(
              "w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-lg font-semibold leading-snug outline-none placeholder:text-muted-foreground focus-visible:ring-0",
              isDone && "text-muted-foreground line-through"
            )}
          />
          {task.dealSalesId && (
            <Link
              href={`/deals/${task.dealSalesId}`}
              className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-primary"
            >
              <span className="font-mono">{task.dealSalesId}</span>
              {task.dealTitle ? <span className="truncate">· {task.dealTitle}</span> : null}
              <ExternalLink className="h-3 w-3" />
            </Link>
          )}
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          <Button
            variant={isDone ? "outline" : "default"}
            className="w-full justify-center"
            onClick={toggleStatus}
            disabled={pending}
          >
            {isDone ? <Circle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
            {isDone ? "Reopen task" : "Mark complete"}
          </Button>

          <Field label="Priority">
            <div className="grid grid-cols-4 gap-1.5">
              {TASK_URGENCY_OPTIONS.map((o) => {
                const active = task.urgency === o.value;
                const meta = URGENCY_META[o.value as TaskUrgency];
                return (
                  <button
                    key={o.value}
                    type="button"
                    disabled={pending}
                    onClick={() => !active && save({ urgency: o.value })}
                    className={cn(
                      "inline-flex items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors",
                      active
                        ? cn(meta.badgeClass, "border-transparent ring-1 ring-inset ring-current")
                        : "border-input text-muted-foreground hover:bg-accent/60"
                    )}
                  >
                    <span className={cn("h-1.5 w-1.5 rounded-full", meta.dotClass)} />
                    {o.label}
                  </button>
                );
              })}
            </div>
          </Field>

          <Field label="Type">
            <select
              value={task.type}
              disabled={pending}
              onChange={(e) => save({ type: e.target.value as TaskPatch["type"] })}
              className="form-control h-9 w-full cursor-pointer px-3"
            >
              {TASK_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Due date">
            <div className="flex items-center gap-2">
              <Input
                type="date"
                defaultValue={task.dueDate ?? ""}
                disabled={pending}
                onChange={(e) => save({ dueDate: e.target.value || null })}
              />
              {!isDone && (
                <SnoozeMenu taskId={task.id}>
                  <Button type="button" variant="outline" size="sm" disabled={pending} className="shrink-0">
                    <AlarmClock className="h-4 w-4" /> Snooze
                  </Button>
                </SnoozeMenu>
              )}
            </div>
          </Field>

          <Field label="Assignee">
            {admin ? (
              <select
                value={task.assigneeId ?? ""}
                disabled={pending}
                onChange={(e) => save({ assigneeId: e.target.value || null })}
                className="form-control h-9 w-full cursor-pointer px-3"
              >
                <option value="">Unassigned</option>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            ) : task.assigneeName ? (
              <div className="flex items-center gap-2 text-sm">
                <Avatar name={task.assigneeName} color={task.assigneeColor} className="h-6 w-6 text-[10px]" />
                {task.assigneeName}
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">Unassigned</span>
            )}
          </Field>
        </div>

        <div className="border-t p-5">
          <ConfirmDialog
            onConfirm={() => deleteTaskAction(task.id)}
            title="Delete task?"
            successMessage="Task deleted"
          >
            <Button variant="ghost" className="w-full justify-center text-destructive hover:text-destructive">
              <Trash2 className="h-4 w-4" /> Delete task
            </Button>
          </ConfirmDialog>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
