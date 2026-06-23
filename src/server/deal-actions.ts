"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/guards";
import { isAdmin, canViewDeal, canEditDeal } from "@/lib/rbac";
import { nextSalesId } from "@/lib/sequence";
import { saveCustomFieldsFromForm } from "@/lib/custom-fields";
import { saveFile, deleteFile } from "@/lib/storage";
import { logActivity } from "@/lib/activity";
import { sanitizeCommentHtml, htmlToPlainText } from "@/lib/sanitize";
import { notifyNewDeal, notifyNewComment } from "@/lib/notifications";
import {
  changeList,
  diffText,
  diffPlain,
  diffCurrency,
  diffDate,
  diffList,
  type ActivityChange,
} from "@/lib/activity-diff";

type Result = { ok?: boolean; error?: string; id?: string; salesId?: string };

/** Minimal deal identifier (salesId + title) for linkable/named audit lines. */
async function dealIdent(dealId: string): Promise<{ salesId?: string; title?: string }> {
  try {
    const d = await prisma.deal.findUnique({ where: { id: dealId }, select: { salesId: true, title: true } });
    return d ? { salesId: d.salesId, title: d.title } : {};
  } catch {
    return {};
  }
}

function str(fd: FormData, k: string) {
  const v = fd.get(k);
  return v == null ? undefined : String(v).trim() || undefined;
}
function decimal(fd: FormData, k: string) {
  const v = str(fd, k);
  if (v == null) return undefined;
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}
function date(fd: FormData, k: string) {
  const v = str(fd, k);
  return v ? new Date(v) : undefined;
}

async function defaultStageId(): Promise<{ pipelineId: string; stageId: string }> {
  const pipeline = await prisma.pipeline.findFirst({
    where: { isDefault: true },
    include: { stages: { orderBy: { order: "asc" }, take: 1 } },
  });
  if (!pipeline || pipeline.stages.length === 0) throw new Error("No pipeline configured");
  return { pipelineId: pipeline.id, stageId: pipeline.stages[0].id };
}

export async function createDealAction(formData: FormData): Promise<Result> {
  const user = await requireUser();
  const title = str(formData, "title");
  if (!title) return { error: "Title is required." };

  const def = await defaultStageId();
  const stageId = str(formData, "stageId") ?? def.stageId;
  const stage = await prisma.stage.findUnique({ where: { id: stageId } });
  const pipelineId = stage?.pipelineId ?? def.pipelineId;

  const ownerId = isAdmin(user) ? str(formData, "ownerId") ?? user.id : user.id;
  const tagIds = formData.getAll("tagIds").map(String).filter(Boolean);

  // Inline new-customer creation: when no existing client is picked but a
  // company name is provided, create the client and link it in the same tx.
  let clientId = str(formData, "clientId");
  const newClientName = str(formData, "newClientName");
  let createdClientId: string | undefined;

  const deal = await prisma.$transaction(async (tx) => {
    if (!clientId && newClientName) {
      const client = await tx.client.create({
        data: {
          name: newClientName,
          contactName: str(formData, "newClientContactName"),
          contactEmail: str(formData, "newClientContactEmail"),
          ownerId,
        },
      });
      clientId = client.id;
      createdClientId = client.id;
    }

    const salesId = await nextSalesId(tx);
    return tx.deal.create({
      data: {
        salesId,
        title,
        description: str(formData, "description"),
        amountEur: decimal(formData, "amountEur"),
        clientId,
        pipelineId,
        stageId,
        ownerId,
        dueDate: date(formData, "dueDate"),
        closedAt: stage?.isWon || stage?.isLost ? new Date() : null,
        tags: tagIds.length ? { connect: tagIds.map((id) => ({ id })) } : undefined,
      },
    });
  });

  await saveCustomFieldsFromForm("DEAL", deal.id, formData);

  // Summarize key initial values as "— → value" changes for the feed.
  let changes: ActivityChange[] = [];
  try {
    const [clientRow, ownerRow] = await Promise.all([
      clientId ? prisma.client.findUnique({ where: { id: clientId }, select: { name: true } }) : null,
      ownerId ? prisma.user.findUnique({ where: { id: ownerId }, select: { name: true } }) : null,
    ]);
    changes = changeList(
      diffCurrency("amount", "Amount", null, decimal(formData, "amountEur") ?? null),
      diffPlain("stage", "Stage", null, stage?.name ?? null),
      diffPlain("client", "Client", null, clientRow?.name ?? newClientName ?? null),
      diffPlain("owner", "Owner", null, ownerRow?.name ?? null),
      diffDate("dueDate", "Due date", null, date(formData, "dueDate") ?? null),
      diffText("description", "Description", null, str(formData, "description") ?? null)
    );
  } catch {
    // Diff is best-effort; never block the create.
  }

  await logActivity({
    actorId: user.id,
    action: "deal_created",
    entity: "Deal",
    entityId: deal.id,
    meta: { title: deal.title, salesId: deal.salesId, changes },
  });
  if (createdClientId) {
    await logActivity({
      actorId: user.id,
      action: "client_created",
      entity: "Client",
      entityId: createdClientId,
      meta: { name: newClientName },
    });
    revalidatePath("/clients");
  }
  revalidatePath("/deals");
  await notifyNewDeal(deal.id, user.id);
  return { ok: true, id: deal.id, salesId: deal.salesId };
}

export async function updateDealAction(dealId: string, formData: FormData): Promise<Result> {
  const user = await requireUser();
  if (!(await canEditDeal(user, dealId))) return { error: "Not allowed." };

  const stageId = str(formData, "stageId");
  const stage = stageId ? await prisma.stage.findUnique({ where: { id: stageId } }) : null;
  const tagIds = formData.getAll("tagIds").map(String).filter(Boolean);

  // Snapshot the current row (with FK relations) so we can diff field changes.
  const before = await prisma.deal.findUnique({
    where: { id: dealId },
    include: { stage: true, client: true, owner: true, tags: true },
  });

  const newTitle = str(formData, "title");
  const newDescription = str(formData, "description") ?? null;
  const newAmount = decimal(formData, "amountEur") ?? null;
  const newClientId = str(formData, "clientId") ?? null;
  const newOwnerId = isAdmin(user) ? str(formData, "ownerId") ?? null : undefined;
  const newDueDate = date(formData, "dueDate") ?? null;

  await prisma.deal.update({
    where: { id: dealId },
    data: {
      title: newTitle,
      description: newDescription,
      amountEur: newAmount,
      clientId: newClientId,
      stageId: stageId ?? undefined,
      pipelineId: stage?.pipelineId,
      ownerId: newOwnerId,
      dueDate: newDueDate,
      closedAt: stage ? (stage.isWon || stage.isLost ? new Date() : null) : undefined,
      tags: { set: tagIds.map((id) => ({ id })) },
    },
  });

  await saveCustomFieldsFromForm("DEAL", dealId, formData);

  let changes: ActivityChange[] = [];
  const finalTitle = newTitle ?? before?.title;
  try {
    if (before) {
      const [newClient, newOwner, newTags] = await Promise.all([
        newClientId && newClientId !== before.clientId
          ? prisma.client.findUnique({ where: { id: newClientId }, select: { name: true } })
          : null,
        newOwnerId !== undefined && newOwnerId
          ? prisma.user.findUnique({ where: { id: newOwnerId }, select: { name: true } })
          : null,
        tagIds.length ? prisma.tag.findMany({ where: { id: { in: tagIds } }, select: { name: true } }) : [],
      ]);
      const newClientName = newClientId
        ? newClientId === before.clientId
          ? before.client?.name ?? null
          : newClient?.name ?? null
        : null;
      const newOwnerName =
        newOwnerId === undefined
          ? before.owner?.name ?? null // owner unchanged (non-admin)
          : newOwnerId
            ? newOwner?.name ?? null
            : null;
      changes = changeList(
        diffText("title", "Title", before.title, finalTitle),
        diffText("description", "Description", before.description, newDescription),
        diffCurrency("amount", "Amount", before.amountEur != null ? Number(before.amountEur) : null, newAmount),
        diffPlain("client", "Client", before.client?.name ?? null, newClientName),
        diffPlain("stage", "Stage", before.stage?.name ?? null, stage?.name ?? before.stage?.name ?? null),
        diffPlain("owner", "Owner", before.owner?.name ?? null, newOwnerName),
        diffDate("dueDate", "Due date", before.dueDate, newDueDate),
        diffList(
          "tags",
          "Tags",
          before.tags.map((t) => t.name),
          newTags.map((t) => t.name)
        )
      );
    }
  } catch {
    // Diff is best-effort.
  }

  await logActivity({
    actorId: user.id,
    action: "deal_updated",
    entity: "Deal",
    entityId: dealId,
    meta: { title: finalTitle, salesId: before?.salesId, stageName: stage?.name, changes },
  });
  revalidatePath("/deals");
  revalidatePath("/deals/[salesId]", "page");
  return { ok: true };
}

export async function moveDealStageAction(dealId: string, stageId: string, boardOrder?: number): Promise<Result> {
  const user = await requireUser();
  if (!(await canEditDeal(user, dealId))) return { error: "Not allowed." };
  const stage = await prisma.stage.findUnique({ where: { id: stageId } });
  if (!stage) return { error: "Invalid stage." };
  const before = await prisma.deal.findUnique({
    where: { id: dealId },
    include: { stage: true },
  });
  await prisma.deal.update({
    where: { id: dealId },
    data: {
      stageId,
      pipelineId: stage.pipelineId,
      boardOrder: boardOrder ?? 0,
      closedAt: stage.isWon || stage.isLost ? new Date() : null,
    },
  });
  const changes = changeList(diffPlain("stage", "Stage", before?.stage?.name ?? null, stage.name));
  await logActivity({
    actorId: user.id,
    action: "deal_stage_moved",
    entity: "Deal",
    entityId: dealId,
    meta: { stageId, stageName: stage.name, title: before?.title, salesId: before?.salesId, changes },
  });
  revalidatePath("/deals");
  return { ok: true };
}

export async function deleteDealAction(dealId: string): Promise<Result> {
  const user = await requireUser();
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: { stage: true, client: true },
  });
  if (!deal) return { error: "Not found." };
  if (!isAdmin(user) && deal.ownerId !== user.id) return { error: "Not allowed." };
  const atts = await prisma.attachment.findMany({ where: { dealId } });
  await Promise.all(atts.map((a) => deleteFile(a.storageKey)));
  await prisma.deal.delete({ where: { id: dealId } });
  // For deletes, surface the key values that were removed ("value → —").
  const changes = changeList(
    diffCurrency("amount", "Amount", deal.amountEur != null ? Number(deal.amountEur) : null, null),
    diffPlain("stage", "Stage", deal.stage?.name ?? null, null),
    diffPlain("client", "Client", deal.client?.name ?? null, null)
  );
  await logActivity({
    actorId: user.id,
    action: "deal_deleted",
    entity: "Deal",
    entityId: dealId,
    meta: { title: deal.title, salesId: deal.salesId, changes },
  });
  revalidatePath("/deals");
  return { ok: true };
}

// --- Tasks ---
export async function createTaskAction(dealId: string, formData: FormData): Promise<Result> {
  const user = await requireUser();
  if (!(await canEditDeal(user, dealId))) return { error: "Not allowed." };
  const title = str(formData, "title");
  if (!title) return { error: "Task title required." };
  await prisma.task.create({
    data: {
      dealId,
      title,
      type: (str(formData, "type") as never) ?? "TASK",
      assigneeId: str(formData, "assigneeId") ?? user.id,
      dueDate: date(formData, "dueDate"),
    },
  });
  await logActivity({
    actorId: user.id,
    action: "task_created",
    entity: "Deal",
    entityId: dealId,
    meta: { taskTitle: title, ...(await dealIdent(dealId)) },
  });
  revalidatePath("/deals/[salesId]", "page");
  revalidatePath("/tasks");
  return { ok: true };
}

export async function toggleTaskAction(taskId: string): Promise<Result> {
  const user = await requireUser();
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task || !(await canEditDeal(user, task.dealId))) return { error: "Not allowed." };
  const done = task.status === "OPEN";
  await prisma.task.update({
    where: { id: taskId },
    data: { status: done ? "DONE" : "OPEN", completedAt: done ? new Date() : null },
  });
  await logActivity({
    actorId: user.id,
    action: done ? "task_completed" : "task_reopened",
    entity: "Deal",
    entityId: task.dealId,
    meta: { taskTitle: task.title, ...(await dealIdent(task.dealId)) },
  });
  revalidatePath("/deals/[salesId]", "page");
  revalidatePath("/tasks");
  return { ok: true };
}

export async function deleteTaskAction(taskId: string): Promise<Result> {
  const user = await requireUser();
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task || !(await canEditDeal(user, task.dealId))) return { error: "Not allowed." };
  await prisma.task.delete({ where: { id: taskId } });
  await logActivity({
    actorId: user.id,
    action: "task_deleted",
    entity: "Deal",
    entityId: task.dealId,
    meta: { taskTitle: task.title, ...(await dealIdent(task.dealId)) },
  });
  revalidatePath("/deals/[salesId]", "page");
  revalidatePath("/tasks");
  return { ok: true };
}

// --- Comments ---
export async function addCommentAction(
  dealId: string,
  body: string,
  notifyUserIds: string[] = []
): Promise<Result> {
  const user = await requireUser();
  if (!(await canViewDeal(user, dealId))) return { error: "Not allowed." };
  // Comment body is rich HTML from the editor — sanitize to a safe allowlist
  // before persisting, and reject comments with no visible content.
  const clean = sanitizeCommentHtml(body);
  if (!htmlToPlainText(clean)) return { error: "Comment is empty." };

  // Persist only ids that resolve to real ACTIVE users, so the stored list can
  // be safely re-used to pre-select recipients on the next comment.
  const requestedIds = [...new Set(notifyUserIds.filter(Boolean))];
  const validIds = requestedIds.length
    ? (
        await prisma.user.findMany({
          where: { id: { in: requestedIds }, status: "ACTIVE" },
          select: { id: true },
        })
      ).map((u) => u.id)
    : [];

  const comment = await prisma.comment.create({
    data: { dealId, authorId: user.id, body: clean, notifiedUserIds: validIds },
  });
  await logActivity({
    actorId: user.id,
    action: "comment_added",
    entity: "Deal",
    entityId: dealId,
    meta: {
      ...(await dealIdent(dealId)),
      changes: changeList(diffText("comment", "Comment", null, htmlToPlainText(clean))),
    },
  });
  revalidatePath("/deals/[salesId]", "page");
  await notifyNewComment(dealId, comment.id, user.id, validIds);
  return { ok: true };
}

export async function deleteCommentAction(commentId: string): Promise<Result> {
  const user = await requireUser();
  const comment = await prisma.comment.findUnique({ where: { id: commentId } });
  if (!comment) return { error: "Not found." };
  if (!isAdmin(user) && comment.authorId !== user.id) return { error: "Not allowed." };
  await prisma.comment.delete({ where: { id: commentId } });
  await logActivity({
    actorId: user.id,
    action: "comment_deleted",
    entity: "Deal",
    entityId: comment.dealId,
    meta: { ...(await dealIdent(comment.dealId)) },
  });
  revalidatePath("/deals/[salesId]", "page");
  return { ok: true };
}

// --- Attachments ---
export async function uploadAttachmentAction(dealId: string, formData: FormData): Promise<Result> {
  const user = await requireUser();
  if (!(await canEditDeal(user, dealId))) return { error: "Not allowed." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "No file selected." };
  if (file.size > 25 * 1024 * 1024) return { error: "File exceeds 25MB." };
  const buffer = Buffer.from(await file.arrayBuffer());
  const { storageKey, size } = await saveFile(buffer, file.name);
  await prisma.attachment.create({
    data: { dealId, filename: file.name, storageKey, size, mimeType: file.type || null, uploadedById: user.id },
  });
  await logActivity({
    actorId: user.id,
    action: "file_uploaded",
    entity: "Deal",
    entityId: dealId,
    meta: { filename: file.name, ...(await dealIdent(dealId)) },
  });
  revalidatePath("/deals/[salesId]", "page");
  return { ok: true };
}

export async function deleteAttachmentAction(attachmentId: string): Promise<Result> {
  const user = await requireUser();
  const att = await prisma.attachment.findUnique({ where: { id: attachmentId } });
  if (!att || !(await canEditDeal(user, att.dealId))) return { error: "Not allowed." };
  await deleteFile(att.storageKey);
  await prisma.attachment.delete({ where: { id: attachmentId } });
  await logActivity({
    actorId: user.id,
    action: "file_deleted",
    entity: "Deal",
    entityId: att.dealId,
    meta: { filename: att.filename, ...(await dealIdent(att.dealId)) },
  });
  revalidatePath("/deals/[salesId]", "page");
  return { ok: true };
}

// --- Sharing (admin) ---
export async function shareDealAction(dealId: string, userId: string): Promise<Result> {
  const admin = await requireUser();
  if (!isAdmin(admin)) return { error: "Admins only." };
  await prisma.share.upsert({
    where: { subject_subjectId_userId: { subject: "DEAL", subjectId: dealId, userId } },
    update: {},
    create: { subject: "DEAL", subjectId: dealId, userId },
  });
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  await logActivity({
    actorId: admin.id,
    action: "deal_shared",
    entity: "Deal",
    entityId: dealId,
    meta: { userId, userName: target?.name, ...(await dealIdent(dealId)) },
  });
  revalidatePath("/deals/[salesId]", "page");
  return { ok: true };
}

export async function unshareDealAction(dealId: string, userId: string): Promise<Result> {
  const admin = await requireUser();
  if (!isAdmin(admin)) return { error: "Admins only." };
  await prisma.share.deleteMany({ where: { subject: "DEAL", subjectId: dealId, userId } });
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  await logActivity({
    actorId: admin.id,
    action: "deal_unshared",
    entity: "Deal",
    entityId: dealId,
    meta: { userId, userName: target?.name, ...(await dealIdent(dealId)) },
  });
  revalidatePath("/deals/[salesId]", "page");
  return { ok: true };
}
