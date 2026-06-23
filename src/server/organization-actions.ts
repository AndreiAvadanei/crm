"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma";
import { requireUser } from "@/lib/auth/guards";
import { canEditClient } from "@/lib/rbac";
import { logActivity } from "@/lib/activity";

type Result = { ok?: boolean; error?: string; id?: string };

function str(fd: FormData, k: string) {
  const v = fd.get(k);
  return v == null ? undefined : String(v).trim() || undefined;
}
function bool(fd: FormData, k: string) {
  const v = fd.get(k);
  return v === "on" || v === "true" || v === "1";
}

/** Build the writable column set shared by create/update. */
function orgData(fd: FormData) {
  return {
    legalName: str(fd, "legalName") ?? null,
    country: str(fd, "country") ?? null,
    taxId: str(fd, "taxId") ?? null,
    regNumber: str(fd, "regNumber") ?? null,
    bankName: str(fd, "bankName") ?? null,
    iban: str(fd, "iban") ?? null,
    address: str(fd, "address") ?? null,
  };
}

async function setSoleDefault(clientId: string, orgId: string) {
  await prisma.organization.updateMany({
    where: { clientId, NOT: { id: orgId } },
    data: { isDefault: false },
  });
}

export async function createOrganizationAction(formData: FormData): Promise<Result> {
  const user = await requireUser();
  const clientId = str(formData, "clientId");
  const sourceName = str(formData, "sourceName");
  if (!clientId) return { error: "Client is required." };
  if (!sourceName) return { error: "Organization name is required." };
  if (!(await canEditClient(user, clientId))) return { error: "Not allowed." };

  const isDefault = bool(formData, "isDefault");
  try {
    const org = await prisma.organization.create({
      data: { clientId, sourceName, isDefault, ...orgData(formData) },
    });
    if (isDefault) await setSoleDefault(clientId, org.id);
    await logActivity({
      actorId: user.id,
      action: "organization_created",
      entity: "Organization",
      entityId: org.id,
      meta: { name: org.sourceName, clientId },
    });
    revalidatePath("/organizations");
    revalidatePath(`/clients/${clientId}`);
    return { ok: true, id: org.id };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { error: `An organization named "${sourceName}" already exists.` };
    }
    throw e;
  }
}

export async function updateOrganizationAction(orgId: string, formData: FormData): Promise<Result> {
  const user = await requireUser();
  const existing = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!existing) return { error: "Not found." };
  if (!(await canEditClient(user, existing.clientId))) return { error: "Not allowed." };

  const clientId = str(formData, "clientId") ?? existing.clientId;
  if (clientId !== existing.clientId && !(await canEditClient(user, clientId))) {
    return { error: "Not allowed to move to that client." };
  }
  const sourceName = str(formData, "sourceName") ?? existing.sourceName;
  const isDefault = bool(formData, "isDefault");

  try {
    await prisma.organization.update({
      where: { id: orgId },
      data: { clientId, sourceName, isDefault, ...orgData(formData) },
    });
    if (isDefault) await setSoleDefault(clientId, orgId);
    await logActivity({
      actorId: user.id,
      action: "organization_updated",
      entity: "Organization",
      entityId: orgId,
      meta: { name: sourceName, clientId },
    });
    revalidatePath("/organizations");
    revalidatePath(`/clients/${existing.clientId}`);
    if (clientId !== existing.clientId) revalidatePath(`/clients/${clientId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { error: `An organization named "${sourceName}" already exists.` };
    }
    throw e;
  }
}

export async function deleteOrganizationAction(orgId: string): Promise<Result> {
  const user = await requireUser();
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    include: { _count: { select: { invoices: true } } },
  });
  if (!org) return { error: "Not found." };
  if (!(await canEditClient(user, org.clientId))) return { error: "Not allowed." };
  if (org._count.invoices > 0) {
    return { error: `Cannot delete: ${org._count.invoices} invoice(s) reference this organization.` };
  }
  await prisma.organization.delete({ where: { id: orgId } });
  await logActivity({
    actorId: user.id,
    action: "organization_deleted",
    entity: "Organization",
    entityId: orgId,
    meta: { name: org.sourceName, clientId: org.clientId },
  });
  revalidatePath("/organizations");
  revalidatePath(`/clients/${org.clientId}`);
  return { ok: true };
}
