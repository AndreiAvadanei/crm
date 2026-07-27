"use client";

import { useState } from "react";
import { TaskItem } from "@/components/tasks/task-item";
import { TaskSheet } from "@/components/tasks/task-sheet";
import { type TaskItemData } from "@/components/tasks/task-common";

/** Dashboard "my work" task list: compact rows that open the shared editor. */
export function DashboardTaskList({
  tasks,
  owners,
  admin,
}: {
  tasks: TaskItemData[];
  owners: { id: string; name: string }[];
  admin: boolean;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = tasks.find((t) => t.id === activeId) ?? null;

  return (
    <>
      {tasks.map((t) => (
        <TaskItem key={t.id} task={t} showDeal compact onOpen={() => setActiveId(t.id)} />
      ))}
      <TaskSheet
        task={active}
        owners={owners}
        admin={admin}
        open={activeId !== null && active !== null}
        onOpenChange={(o) => !o && setActiveId(null)}
      />
    </>
  );
}
