"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { setTaskWebhookDefaultsAction } from "@/server/admin-actions";
import { TASK_URGENCY_OPTIONS, type TaskUrgency } from "@/lib/task-urgency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";

export function TaskWebhookDefaultsForm({
  title: initialTitle,
  dueDays: initialDueDays,
  urgency: initialUrgency,
}: {
  title: string;
  dueDays: number;
  urgency: TaskUrgency;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [title, setTitle] = React.useState(initialTitle);
  const [dueDays, setDueDays] = React.useState(String(initialDueDays));
  const [urgency, setUrgency] = React.useState<TaskUrgency>(initialUrgency);
  const [busy, setBusy] = React.useState(false);

  const dirty =
    title !== initialTitle || dueDays !== String(initialDueDays) || urgency !== initialUrgency;

  async function onSave() {
    const fd = new FormData();
    fd.set("title", title);
    fd.set("dueDays", dueDays);
    fd.set("urgency", urgency);
    setBusy(true);
    const res = await setTaskWebhookDefaultsAction(fd);
    setBusy(false);
    if (res.error) return toast({ title: res.error, variant: "error" });
    toast({ title: "Task defaults saved", variant: "success" });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="taskWebhookTitle">Task text</Label>
        <Textarea
          id="taskWebhookTitle"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={busy}
          maxLength={500}
          rows={2}
          placeholder="e.g. Follow up on this deal"
        />
        <p className="text-xs text-muted-foreground">
          The title used for tasks created by this webhook. A request may override it by sending a{" "}
          <code>title</code> field.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="taskWebhookDueDays">Due date (days from today)</Label>
          <Input
            id="taskWebhookDueDays"
            type="number"
            min={0}
            max={365}
            step={1}
            value={dueDays}
            onChange={(e) => setDueDays(e.target.value)}
            disabled={busy}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="taskWebhookUrgency">Priority</Label>
          <select
            id="taskWebhookUrgency"
            value={urgency}
            onChange={(e) => setUrgency(e.target.value as TaskUrgency)}
            disabled={busy}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {TASK_URGENCY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <Button onClick={onSave} disabled={busy || !dirty}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        Save task defaults
      </Button>
    </div>
  );
}
