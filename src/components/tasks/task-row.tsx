"use client";

import Link from "next/link";
import { quickUpdateTaskAction } from "@/server/quick-actions";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { InlineInput, InlineSelect } from "@/components/shared/inline-edit";
import { TASK_URGENCY_OPTIONS, URGENCY_TEXT_CLASS, type TaskUrgency } from "@/lib/task-urgency";
import { useToast } from "@/components/ui/toast";
import { useRouter } from "next/navigation";
import { formatDate } from "@/lib/utils";

export type TaskRowData = {
  id: string;
  title: string;
  type: string;
  urgency: TaskUrgency;
  dueDate: string | null; // yyyy-mm-dd
  overdue: boolean;
  dealSalesId: string;
  dealTitle: string;
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeColor: string | null;
};

export function TaskRow({
  task,
  owners,
  admin,
  selected,
  onSelectChange,
}: {
  task: TaskRowData;
  owners: { id: string; name: string }[];
  admin: boolean;
  /** When provided, the checkbox toggles selection instead of completing. */
  selected?: boolean;
  onSelectChange?: (checked: boolean) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const selectable = onSelectChange !== undefined;

  async function complete() {
    const res = await quickUpdateTaskAction(task.id, { status: "DONE" });
    if (res.error) return toast({ title: res.error, variant: "error" });
    toast({ title: "Task completed", variant: "success" });
    router.refresh();
  }

  return (
    <div
      className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
        selected ? "border-primary bg-primary/5" : ""
      }`}
    >
      <Checkbox
        checked={selectable ? !!selected : false}
        onCheckedChange={(c) =>
          selectable ? onSelectChange?.(c === true) : complete()
        }
        aria-label={selectable ? "Select task" : "Complete task"}
      />
      <div className="min-w-0 flex-1">
        <InlineInput
          value={task.title}
          triggerClassName="font-medium"
          onSave={(title) => quickUpdateTaskAction(task.id, { title })}
        />
        <Link
          href={`/deals/${task.dealSalesId}`}
          className="block px-1.5 text-xs text-muted-foreground hover:text-primary"
        >
          <span className="font-mono">{task.dealSalesId}</span> · {task.dealTitle}
        </Link>
      </div>
      <Badge variant="secondary">{task.type}</Badge>

      {/* Urgency / criticality — inline editable, colored by level */}
      <div className="w-24 shrink-0">
        <InlineSelect
          value={task.urgency}
          options={TASK_URGENCY_OPTIONS}
          className={`font-medium ${URGENCY_TEXT_CLASS[task.urgency]}`}
          onSave={(urgency) =>
            quickUpdateTaskAction(task.id, { urgency: urgency as TaskUrgency })
          }
        />
      </div>

      {/* Due date — inline */}
      <div className="w-32 shrink-0">
        <InlineInput
          type="date"
          value={task.dueDate ?? ""}
          display={
            task.dueDate ? (
              <span className={task.overdue ? "text-xs font-medium text-destructive" : "text-xs text-muted-foreground"}>
                {formatDate(task.dueDate)}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">No date</span>
            )
          }
          onSave={(dueDate) => quickUpdateTaskAction(task.id, { dueDate: dueDate || null })}
        />
      </div>

      {/* Assignee — admins can reassign inline */}
      {admin ? (
        <div className="w-36 shrink-0">
          <InlineSelect
            value={task.assigneeId ?? ""}
            placeholder="Unassigned"
            options={owners.map((o) => ({ value: o.id, label: o.name }))}
            onSave={(assigneeId) => quickUpdateTaskAction(task.id, { assigneeId: assigneeId || null })}
          />
        </div>
      ) : (
        task.assigneeName && <Avatar name={task.assigneeName} color={task.assigneeColor} className="h-6 w-6 text-[10px]" />
      )}
    </div>
  );
}
