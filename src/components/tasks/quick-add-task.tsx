"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { ClientCombobox } from "@/components/shared/client-combobox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { quickCreateTaskAction } from "@/server/quick-actions";
import { TASK_TYPE_OPTIONS } from "@/components/tasks/task-common";
import { TASK_URGENCY_OPTIONS, type TaskUrgency } from "@/lib/task-urgency";

export type QuickAddDeal = { id: string; salesId: string; title: string };

/**
 * Compact one-line composer at the top of the Tasks board. The fast path is
 * type a title, pick a deal, press Enter. Type / priority / due / assignee all
 * default sensibly and can be tweaked inline. The chosen deal sticks after
 * saving so several tasks can be added to the same deal in a row.
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

  const [title, setTitle] = useState("");
  const [dealId, setDealId] = useState("");
  const [type, setType] = useState("TASK");
  const [urgency, setUrgency] = useState<TaskUrgency>("MEDIUM");
  const [dueDate, setDueDate] = useState("");
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
      setDueDate("");
      titleRef.current?.focus();
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border bg-card p-2.5">
      <div className="flex flex-wrap items-center gap-2">
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
          placeholder="Add a task…"
          aria-label="New task title"
          className="h-9 min-w-0 flex-1 sm:min-w-[16rem]"
        />
        <div className="w-full sm:w-64">
          <ClientCombobox
            value={dealId}
            options={dealOptions}
            onChange={setDealId}
            placeholder="Select deal"
            searchPlaceholder="Search SAL id or deal…"
            emptyText="No deals found."
            triggerClassName="h-9"
          />
        </div>
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          aria-label="Task type"
          className="form-control h-9 cursor-pointer px-2 text-sm"
        >
          {TASK_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          value={urgency}
          onChange={(e) => setUrgency(e.target.value as TaskUrgency)}
          aria-label="Priority"
          className="form-control h-9 cursor-pointer px-2 text-sm"
        >
          {TASK_URGENCY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <Input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          aria-label="Due date"
          className="h-9 w-[9.5rem]"
        />
        {admin && (
          <select
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            aria-label="Assignee"
            className="form-control h-9 cursor-pointer px-2 text-sm"
          >
            <option value="">Assign to me</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        )}
        <Button type="button" onClick={submit} disabled={pending} className="ml-auto">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Add task
        </Button>
      </div>
    </div>
  );
}
