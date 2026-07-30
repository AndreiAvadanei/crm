"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { ClientCombobox } from "@/components/shared/client-combobox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { quickCreateTaskAction } from "@/server/quick-actions";
import { TASK_TYPE_OPTIONS } from "@/components/tasks/task-common";
import { TASK_URGENCY_OPTIONS, type TaskUrgency } from "@/lib/task-urgency";

export type QuickAddDeal = { id: string; salesId: string; title: string };

// Default due date: same day next week (today + 7 days), as a local YYYY-MM-DD.
function defaultDueDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 10);
}

/**
 * "Add task" button that opens a modal composer. Type a title, pick a deal, set
 * type / priority / due / assignee, then save. The chosen deal sticks after
 * saving and the dialog stays open so several tasks can be added to the same
 * deal in a row.
 */
export function QuickAddTask({
  deals,
  owners,
  admin,
}: {
  deals: QuickAddDeal[];
  owners: { id: string; name: string }[];
  admin: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const titleRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [dealId, setDealId] = useState("");
  const [type, setType] = useState("TASK");
  const [urgency, setUrgency] = useState<TaskUrgency>("MEDIUM");
  const [dueDate, setDueDate] = useState(defaultDueDate);
  const [assigneeId, setAssigneeId] = useState("");

  const dealOptions = deals.map((d) => ({
    value: d.id,
    label: `${d.salesId} — ${d.title}`,
    searchText: `${d.salesId} ${d.title}`,
  }));

  function submit() {
    const t = title.trim();
    if (!t) {
      titleRef.current?.focus();
      return;
    }
    if (!dealId) {
      toast({ title: "Pick a deal for this task.", variant: "error" });
      return;
    }
    startTransition(async () => {
      const res = await quickCreateTaskAction({
        dealId,
        title: t,
        type: type as never,
        urgency,
        dueDate: dueDate || null,
        assigneeId: admin && assigneeId ? assigneeId : null,
      });
      if (res.error) return toast({ title: res.error, variant: "error" });
      toast({ title: "Task created", variant: "success" });
      // Keep the deal selected so several tasks can be added in a row.
      setTitle("");
      setDueDate(defaultDueDate());
      titleRef.current?.focus();
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button">
          <Plus className="h-4 w-4" />
          Add task
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-w-md"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          titleRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Add task</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="Title">
            <Input
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder="What needs to be done?"
              aria-label="New task title"
              className="h-9"
            />
          </Field>

          <Field label="Deal">
            <ClientCombobox
              value={dealId}
              options={dealOptions}
              onChange={setDealId}
              placeholder="Select deal"
              searchPlaceholder="Search SAL id or deal…"
              emptyText="No deals found."
              triggerClassName="h-9"
              wrapLabels
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                aria-label="Task type"
                className="form-control h-9 w-full cursor-pointer px-2 text-sm"
              >
                {TASK_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Priority">
              <select
                value={urgency}
                onChange={(e) => setUrgency(e.target.value as TaskUrgency)}
                aria-label="Priority"
                className="form-control h-9 w-full cursor-pointer px-2 text-sm"
              >
                {TASK_URGENCY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className={admin ? "grid grid-cols-2 gap-3" : ""}>
            <Field label="Due date">
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                aria-label="Due date"
                className="h-9 w-full"
              />
            </Field>

            {admin && (
              <Field label="Assignee">
                <select
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                  aria-label="Assignee"
                  className="form-control h-9 w-full cursor-pointer px-2 text-sm"
                >
                  <option value="">Assign to me</option>
                  {owners.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Close
          </Button>
          <Button type="button" onClick={submit} disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
