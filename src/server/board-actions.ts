"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/guards";
import { isAdmin } from "@/lib/rbac";
import { nextSalesId } from "@/lib/sequence";
import { logActivity } from "@/lib/activity";

type QuickCreateResult = { ok?: boolean; id?: string; salesId?: string; error?: string };
type Result = { ok?: boolean; error?: string };

/**
 * Lightweight quick-create used by the Kanban per-column "+" affordance.
 * Mirrors createDealAction's SAL-counter + owner + default-visibility logic
 * with minimal input: the deal lands directly in `stageId`.
 */
export async function quickCreateDealAction(stageId: string, title?: string): Promise<QuickCreateResult> {
  const user = await requireUser();

  const stage = await prisma.stage.findUnique({ where: { id: stageId } });
  if (!stage) return { error: "Invalid stage." };

  // Non-admins always own deals they create; admins default to themselves too.
  const ownerId = user.id;
  const cleanTitle = title?.trim() || "Untitled deal";

  const deal = await prisma.$transaction(async (tx) => {
    const salesId = await nextSalesId(tx);
    return tx.deal.create({
      data: {
        salesId,
        title: cleanTitle,
        pipelineId: stage.pipelineId,
        stageId: stage.id,
        ownerId,
        closedAt: stage.isWon || stage.isLost ? new Date() : null,
      },
    });
  });

  await logActivity({
    actorId: user.id,
    action: "deal_created",
    entity: "Deal",
    entityId: deal.id,
    meta: { title: deal.title, salesId: deal.salesId, stageName: stage.name },
  });
  revalidatePath("/deals");
  return { ok: true, id: deal.id, salesId: deal.salesId };
}

/** Admin-only: set (or clear) the grouping phase band of a stage. */
export async function setStagePhaseAction(stageId: string, phase: string | null): Promise<Result> {
  const user = await requireUser();
  if (!isAdmin(user)) return { error: "Admins only." };

  const cleanPhase = phase?.trim() || null;
  const stage = await prisma.stage.update({
    where: { id: stageId },
    data: { phase: cleanPhase },
  });

  await logActivity({
    actorId: user.id,
    action: "stage_updated",
    entity: "Stage",
    entityId: stageId,
    meta: { name: stage.name, phase: cleanPhase },
  });
  revalidatePath("/deals");
  revalidatePath("/admin/pipeline");
  return { ok: true };
}
