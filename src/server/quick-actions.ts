"use server";

// Granular single-field "quick update" server actions used by the inline-editing
// UI on the Deals / Clients / Tasks list pages. These are intentionally lighter
// than the FormData-based create/update actions in deal-actions.ts /
// client-actions.ts so the list views can persist one field at a time.
//
// NOTE: kept in a dedicated file to avoid merge conflicts with concurrent
// audit-logging work in the existing action files. Audit entries are written
// inline here (wrapped in try/catch) so inline edits still show up in activity.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma";
import { requireUser } from "@/lib/auth/guards";
import { isAdmin, canEditDeal, canViewClient } from "@/lib/rbac";
import {
  changeList,
  diffText,
  diffPlain,
  diffCurrency,
  diffDate,
  diffList,
  displayValue,
  type ActivityChange,
} from "@/lib/activity-diff";

type Result = { ok?: boolean; error?: string };

/** Best-effort audit log; never let logging failures break the mutation. */
async function audit(
  actorId: string,
  action: string,
  entity: string,
  entityId: string,
  meta?: Record<string, unknown>
) {
  try {
    await prisma.auditLog.create({
      data: {
        actorId,
        action,
        entity,
        entityId,
        meta: meta ? (JSON.parse(JSON.stringify(meta)) as Prisma.InputJsonValue) : undefined,
      },
    });
  } catch {
    // ignore audit failures
  }
}

// --- Deals -----------------------------------------------------------------
export type DealPatch = {
  title?: string;
  description?: string | null;
  stageId?: string;
  clientId?: string | null;
  ownerId?: string | null;
  amountEur?: number | null;
  dueDate?: string | null; // yyyy-mm-dd or ISO; empty/null clears
  tagIds?: string[];
};

export async function quickUpdateDealAction(dealId: string, patch: DealPatch): Promise<Result> {
  const user = await requireUser();
  if (!(await canEditDeal(user, dealId))) return { error: "Not allowed." };

  const before = await prisma.deal.findUnique({
    where: { id: dealId },
    include: { stage: true, client: true, owner: true, tags: true },
  });

  const data: Prisma.DealUncheckedUpdateInput = {};
  let stageMoved = false;
  let newStageName: string | undefined;

  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (!title) return { error: "Title is required." };
    data.title = title;
  }
  if (patch.description !== undefined) {
    data.description = patch.description?.trim() || null;
  }
  if (patch.stageId !== undefined) {
    const stage = await prisma.stage.findUnique({ where: { id: patch.stageId } });
    if (!stage) return { error: "Invalid stage." };
    // Mirror moveDealStageAction: keep pipeline in sync, set closedAt on won/lost.
    data.stageId = stage.id;
    data.pipelineId = stage.pipelineId;
    data.closedAt = stage.isWon || stage.isLost ? new Date() : null;
    newStageName = stage.name;
    stageMoved = true;
  }
  if (patch.clientId !== undefined) {
    data.clientId = patch.clientId || null;
  }
  if (patch.ownerId !== undefined) {
    if (!isAdmin(user)) return { error: "Only admins can reassign owners." };
    data.ownerId = patch.ownerId ?? null;
  }
  if (patch.amountEur !== undefined) {
    data.amountEur = patch.amountEur ?? null;
  }
  if (patch.dueDate !== undefined) {
    data.dueDate = patch.dueDate ? new Date(patch.dueDate) : null;
  }
  if (patch.tagIds !== undefined) {
    data.tags = { set: patch.tagIds.map((id) => ({ id })) };
  }

  if (Object.keys(data).length === 0) return { ok: true };

  await prisma.deal.update({ where: { id: dealId }, data });

  let changes: ActivityChange[] = [];
  try {
    if (before) {
      const [newClient, newOwner, newTags] = await Promise.all([
        patch.clientId ? prisma.client.findUnique({ where: { id: patch.clientId }, select: { name: true } }) : null,
        patch.ownerId ? prisma.user.findUnique({ where: { id: patch.ownerId }, select: { name: true } }) : null,
        patch.tagIds?.length
          ? prisma.tag.findMany({ where: { id: { in: patch.tagIds } }, select: { name: true } })
          : [],
      ]);
      changes = changeList(
        patch.title !== undefined ? diffText("title", "Title", before.title, patch.title.trim()) : null,
        patch.description !== undefined
          ? diffText("description", "Description", before.description, patch.description?.trim() || null)
          : null,
        patch.stageId !== undefined ? diffPlain("stage", "Stage", before.stage?.name ?? null, newStageName) : null,
        patch.clientId !== undefined
          ? diffPlain("client", "Client", before.client?.name ?? null, patch.clientId ? newClient?.name ?? null : null)
          : null,
        patch.ownerId !== undefined
          ? diffPlain("owner", "Owner", before.owner?.name ?? null, patch.ownerId ? newOwner?.name ?? null : null)
          : null,
        patch.amountEur !== undefined
          ? diffCurrency("amount", "Amount", before.amountEur != null ? Number(before.amountEur) : null, patch.amountEur ?? null)
          : null,
        patch.dueDate !== undefined
          ? diffDate("dueDate", "Due date", before.dueDate, patch.dueDate ? new Date(patch.dueDate) : null)
          : null,
        patch.tagIds !== undefined
          ? diffList("tags", "Tags", before.tags.map((t) => t.name), newTags.map((t) => t.name))
          : null
      );
    }
  } catch {
    // best-effort
  }

  await audit(user.id, stageMoved ? "deal_stage_moved" : "deal_updated", "Deal", dealId, {
    title: before?.title,
    salesId: before?.salesId,
    stageName: newStageName,
    changes,
  });

  revalidatePath("/deals");
  revalidatePath("/deals/[salesId]", "page");
  return { ok: true };
}

/** Set/clear a single custom field value on a deal (inline editing). */
export async function quickUpdateDealCustomFieldAction(
  dealId: string,
  definitionId: string,
  value: unknown
): Promise<Result> {
  const user = await requireUser();
  if (!(await canEditDeal(user, dealId))) return { error: "Not allowed." };

  const def = await prisma.customFieldDefinition.findUnique({ where: { id: definitionId } });
  if (!def || def.entity !== "DEAL") return { error: "Invalid field." };

  const prev = await prisma.customFieldValue.findUnique({
    where: { definitionId_entityId: { definitionId, entityId: dealId } },
    select: { value: true },
  });

  const isEmpty =
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0);

  if (isEmpty) {
    await prisma.customFieldValue.deleteMany({ where: { definitionId, entityId: dealId } });
  } else {
    await prisma.customFieldValue.upsert({
      where: { definitionId_entityId: { definitionId, entityId: dealId } },
      update: { value: value as Prisma.InputJsonValue },
      create: { definitionId, entity: "DEAL", entityId: dealId, value: value as Prisma.InputJsonValue },
    });
  }

  // Render the value change for this custom field (arrays joined, others stringified).
  const fmtCf = (v: unknown) =>
    v == null || v === "" ? null : Array.isArray(v) ? v.map(String).join(", ") : String(v);
  const change: ActivityChange = {
    field: def.key,
    label: def.label,
    from: displayValue("plain", fmtCf(prev?.value)),
    to: displayValue("plain", fmtCf(isEmpty ? null : value)),
  };
  const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { salesId: true, title: true } });
  await audit(user.id, "deal_updated", "Deal", dealId, {
    title: deal?.title,
    salesId: deal?.salesId,
    changes: change.from === change.to ? [] : [change],
  });
  revalidatePath("/deals/[salesId]", "page");
  return { ok: true };
}

/** Inline share toggle from the deals list (admin only). */
export async function quickShareDealAction(dealId: string, userId: string, on: boolean): Promise<Result> {
  const admin = await requireUser();
  if (!isAdmin(admin)) return { error: "Admins only." };
  if (on) {
    await prisma.share.upsert({
      where: { subject_subjectId_userId: { subject: "DEAL", subjectId: dealId, userId } },
      update: {},
      create: { subject: "DEAL", subjectId: dealId, userId },
    });
  } else {
    await prisma.share.deleteMany({ where: { subject: "DEAL", subjectId: dealId, userId } });
  }
  const [target, deal] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
    prisma.deal.findUnique({ where: { id: dealId }, select: { salesId: true, title: true } }),
  ]);
  await audit(admin.id, on ? "deal_shared" : "deal_unshared", "Deal", dealId, {
    userId,
    userName: target?.name,
    salesId: deal?.salesId,
    title: deal?.title,
  });
  revalidatePath("/deals");
  revalidatePath("/deals/[salesId]", "page");
  return { ok: true };
}

// --- Clients ---------------------------------------------------------------
export type ClientPatch = {
  ownerId?: string | null;
  tagIds?: string[];
  country?: string | null;
  contactName?: string | null;
};

export async function quickUpdateClientAction(clientId: string, patch: ClientPatch): Promise<Result> {
  const user = await requireUser();
  if (!(await canViewClient(user, clientId))) return { error: "Not allowed." };

  const before = await prisma.client.findUnique({
    where: { id: clientId },
    include: { owner: true, tags: true },
  });

  const data: Prisma.ClientUncheckedUpdateInput = {};
  if (patch.ownerId !== undefined) {
    if (!isAdmin(user)) return { error: "Only admins can reassign owners." };
    data.ownerId = patch.ownerId ?? null;
  }
  if (patch.tagIds !== undefined) {
    data.tags = { set: patch.tagIds.map((id) => ({ id })) };
  }
  if (patch.country !== undefined) {
    data.country = patch.country?.trim() || null;
  }
  if (patch.contactName !== undefined) {
    data.contactName = patch.contactName?.trim() || null;
  }

  if (Object.keys(data).length === 0) return { ok: true };

  await prisma.client.update({ where: { id: clientId }, data });

  let changes: ActivityChange[] = [];
  try {
    if (before) {
      const [newOwner, newTags] = await Promise.all([
        patch.ownerId ? prisma.user.findUnique({ where: { id: patch.ownerId }, select: { name: true } }) : null,
        patch.tagIds?.length
          ? prisma.tag.findMany({ where: { id: { in: patch.tagIds } }, select: { name: true } })
          : [],
      ]);
      changes = changeList(
        patch.ownerId !== undefined
          ? diffPlain("owner", "Owner", before.owner?.name ?? null, patch.ownerId ? newOwner?.name ?? null : null)
          : null,
        patch.country !== undefined ? diffPlain("country", "Country", before.country, patch.country?.trim() || null) : null,
        patch.contactName !== undefined
          ? diffPlain("contactName", "Contact", before.contactName, patch.contactName?.trim() || null)
          : null,
        patch.tagIds !== undefined
          ? diffList("tags", "Tags", before.tags.map((t) => t.name), newTags.map((t) => t.name))
          : null
      );
    }
  } catch {
    // best-effort
  }

  await audit(user.id, "client_updated", "Client", clientId, { name: before?.name, changes });

  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
  return { ok: true };
}

// --- Tasks -----------------------------------------------------------------
export type TaskPatch = {
  title?: string;
  dueDate?: string | null;
  assigneeId?: string | null;
  status?: "OPEN" | "DONE";
};

export async function quickUpdateTaskAction(taskId: string, patch: TaskPatch): Promise<Result> {
  const user = await requireUser();
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { deal: { select: { salesId: true, title: true } }, assignee: true },
  });
  if (!task || !(await canEditDeal(user, task.dealId))) return { error: "Not allowed." };

  const data: Prisma.TaskUncheckedUpdateInput = {};
  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (!title) return { error: "Task title required." };
    data.title = title;
  }
  if (patch.dueDate !== undefined) {
    data.dueDate = patch.dueDate ? new Date(patch.dueDate) : null;
  }
  if (patch.assigneeId !== undefined) {
    // Only admins reassign tasks across users; owners keep their own.
    if (!isAdmin(user)) return { error: "Only admins can reassign tasks." };
    data.assigneeId = patch.assigneeId ?? null;
  }
  if (patch.status !== undefined) {
    data.status = patch.status;
    data.completedAt = patch.status === "DONE" ? new Date() : null;
  }

  if (Object.keys(data).length === 0) return { ok: true };

  await prisma.task.update({ where: { id: taskId }, data });

  let changes: ActivityChange[] = [];
  try {
    const newAssignee = patch.assigneeId
      ? await prisma.user.findUnique({ where: { id: patch.assigneeId }, select: { name: true } })
      : null;
    const statusLabel = (st?: string) => (st === "DONE" ? "Done" : st === "OPEN" ? "Open" : null);
    changes = changeList(
      patch.title !== undefined ? diffText("title", "Title", task.title, patch.title.trim()) : null,
      patch.dueDate !== undefined
        ? diffDate("dueDate", "Due date", task.dueDate, patch.dueDate ? new Date(patch.dueDate) : null)
        : null,
      patch.assigneeId !== undefined
        ? diffPlain("assignee", "Assignee", task.assignee?.name ?? null, patch.assigneeId ? newAssignee?.name ?? null : null)
        : null,
      patch.status !== undefined ? diffPlain("status", "Status", statusLabel(task.status), statusLabel(patch.status)) : null
    );
  } catch {
    // best-effort
  }

  // Logged against the parent Deal so the feed can link to it.
  await audit(user.id, "task_updated", "Deal", task.dealId, {
    taskTitle: patch.title?.trim() || task.title,
    salesId: task.deal?.salesId,
    title: task.deal?.title,
    changes,
  });

  revalidatePath("/tasks");
  revalidatePath("/deals/[salesId]", "page");
  return { ok: true };
}
