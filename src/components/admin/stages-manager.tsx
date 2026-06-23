"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, ArrowDown, Pencil, Plus } from "lucide-react";
import { reorderStagesAction, deleteStageAction } from "@/server/admin-actions";
import { setStagePhaseAction } from "@/server/board-actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StageDialog } from "@/components/admin/stage-dialog";
import { DeleteButton } from "@/components/shared/delete-button";
import { useToast } from "@/components/ui/toast";

// Suggested board grouping bands; an empty value clears the phase.
const PHASES = ["Lead", "Active", "Closing", "Won", "Lost"];

export type StageItem = {
  id: string;
  name: string;
  color: string;
  probability: number;
  phase: string | null;
  isWon: boolean;
  isLost: boolean;
  dealCount: number;
};

export function StagesManager({ stages: initial }: { stages: StageItem[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [stages, setStages] = useState(initial);

  async function move(index: number, dir: -1 | 1) {
    const next = [...stages];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setStages(next);
    const res = await reorderStagesAction(next.map((s) => s.id));
    if (res.error) toast({ title: res.error, variant: "error" });
    router.refresh();
  }

  async function setPhase(stageId: string, phase: string) {
    setStages((prev) => prev.map((s) => (s.id === stageId ? { ...s, phase: phase || null } : s)));
    const res = await setStagePhaseAction(stageId, phase || null);
    if (res.error) toast({ title: res.error, variant: "error" });
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <StageDialog
          trigger={
            <Button size="sm">
              <Plus /> New stage
            </Button>
          }
        />
      </div>
      {stages.map((s, i) => (
        <div key={s.id} className="flex items-center gap-3 rounded-lg border px-3 py-2">
          <div className="flex flex-col">
            <button onClick={() => move(i, -1)} disabled={i === 0} className="text-muted-foreground hover:text-foreground disabled:opacity-30">
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => move(i, 1)}
              disabled={i === stages.length - 1}
              className="text-muted-foreground hover:text-foreground disabled:opacity-30"
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
          </div>
          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: s.color }} />
          <div className="flex-1">
            <div className="flex items-center gap-2 text-sm font-medium">
              {s.name}
              {s.isWon && <Badge variant="success">won</Badge>}
              {s.isLost && <Badge variant="destructive">lost</Badge>}
            </div>
            <div className="text-xs text-muted-foreground">
              {s.probability}% · {s.dealCount} deals
            </div>
          </div>
          <select
            value={s.phase ?? ""}
            onChange={(e) => setPhase(s.id, e.target.value)}
            title="Board phase"
            className="form-control h-8 px-2 text-xs"
          >
            <option value="">No phase</option>
            {PHASES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
            {/* Preserve a custom phase value not in the suggested list. */}
            {s.phase && !PHASES.includes(s.phase) && <option value={s.phase}>{s.phase}</option>}
          </select>
          <StageDialog
            stage={s}
            trigger={
              <Button variant="ghost" size="icon">
                <Pencil className="h-4 w-4" />
              </Button>
            }
          />
          <DeleteButton iconOnly onDelete={deleteStageAction.bind(null, s.id)} title="Delete stage?" />
        </div>
      ))}
    </div>
  );
}
