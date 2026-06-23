"use server";

// Admin-driven CLIENT sharing — mirrors the DEAL sharing actions in
// deal-actions.ts. Kept in a dedicated file to avoid merge conflicts with
// concurrent audit-logging work in client-actions.ts.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma";
import { requireUser } from "@/lib/auth/guards";
import { isAdmin } from "@/lib/rbac";

type Result = { ok?: boolean; error?: string };

/** Best-effort audit log; never let logging failures break the mutation. */
async function audit(
  actorId: string,
  action: string,
  entityId: string,
  meta?: Record<string, unknown>
) {
  try {
    await prisma.auditLog.create({
      data: {
        actorId,
        action,
        entity: "Client",
        entityId,
        meta: meta ? (JSON.parse(JSON.stringify(meta)) as Prisma.InputJsonValue) : undefined,
      },
    });
  } catch {
    // ignore audit failures
  }
}

/** Grant a SALES user explicit access to a client (admin only). */
export async function shareClientAction(clientId: string, userId: string): Promise<Result> {
  const admin = await requireUser();
  if (!isAdmin(admin)) return { error: "Admins only." };
  await prisma.share.upsert({
    where: { subject_subjectId_userId: { subject: "CLIENT", subjectId: clientId, userId } },
    update: {},
    create: { subject: "CLIENT", subjectId: clientId, userId },
  });
  const [target, client] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
    prisma.client.findUnique({ where: { id: clientId }, select: { name: true } }),
  ]);
  await audit(admin.id, "client_shared", clientId, { userId, userName: target?.name, name: client?.name });
  revalidatePath("/clients");
  revalidatePath("/clients/[id]", "page");
  return { ok: true };
}

/** Revoke a SALES user's explicit access to a client (admin only). */
export async function unshareClientAction(clientId: string, userId: string): Promise<Result> {
  const admin = await requireUser();
  if (!isAdmin(admin)) return { error: "Admins only." };
  await prisma.share.deleteMany({ where: { subject: "CLIENT", subjectId: clientId, userId } });
  const [target, client] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
    prisma.client.findUnique({ where: { id: clientId }, select: { name: true } }),
  ]);
  await audit(admin.id, "client_unshared", clientId, { userId, userName: target?.name, name: client?.name });
  revalidatePath("/clients");
  revalidatePath("/clients/[id]", "page");
  return { ok: true };
}
