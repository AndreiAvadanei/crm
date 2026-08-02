"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { ContractType } from "@/generated/prisma";
import { requireUser } from "@/lib/auth/guards";
import { isAdmin } from "@/lib/rbac";
import { logActivity } from "@/lib/activity";
import type { User } from "@/generated/prisma";

type Result = { ok?: boolean; error?: string; id?: string };

function str(fd: FormData, k: string) {
  const v = fd.get(k);
  return v == null ? undefined : String(v).trim() || undefined;
}
function bool(fd: FormData, k: string) {
  const v = fd.get(k);
  return v === "on" || v === "true" || v === "1";
}
function dateval(fd: FormData, k: string): Date | null {
  const v = str(fd, k);
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
function contractType(fd: FormData): ContractType {
  return str(fd, "type") === "OUT" ? ContractType.OUT : ContractType.IN;
}

/** SALES users may only manage records they created; admins manage everything. */
function canManage(user: User, createdById: string | null) {
  return isAdmin(user) || createdById === user.id;
}

/** Resolve the counterparty: a linked Organization (validated) or free text. */
async function resolveClient(fd: FormData): Promise<{ organizationId: string | null; clientName: string } | { error: string }> {
  const organizationId = str(fd, "organizationId") ?? null;
  let clientName = str(fd, "clientName");
  if (organizationId) {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { sourceName: true },
    });
    if (!org) return { error: "Selected organization was not found." };
    // Keep the display name in sync with the linked organization.
    clientName = clientName || org.sourceName;
  }
  if (!clientName) return { error: "Client name is required." };
  return { organizationId, clientName };
}

export async function createContractNumberAction(formData: FormData): Promise<Result> {
  const user = await requireUser();

  const issuerId = str(formData, "issuerId");
  const number = str(formData, "number");
  if (!issuerId) return { error: "Company is required." };
  if (!number) return { error: "Contract number is required." };

  const issuer = await prisma.issuer.findUnique({ where: { id: issuerId }, select: { id: true } });
  if (!issuer) return { error: "Selected company was not found." };

  const client = await resolveClient(formData);
  if ("error" in client) return { error: client.error };

  const contract = await prisma.contractNumber.create({
    data: {
      issuerId,
      number,
      organizationId: client.organizationId,
      clientName: client.clientName,
      type: contractType(formData),
      isFrameAgreement: bool(formData, "isFrameAgreement"),
      expiresAt: dateval(formData, "expiresAt"),
      comment: str(formData, "comment") ?? null,
      createdById: user.id,
      createdByName: user.name,
    },
  });

  await logActivity({
    actorId: user.id,
    action: "contract_number_created",
    entity: "ContractNumber",
    entityId: contract.id,
    meta: { number: contract.number },
  });
  revalidatePath("/contract-numbers");
  return { ok: true, id: contract.id };
}

export async function updateContractNumberAction(id: string, formData: FormData): Promise<Result> {
  const user = await requireUser();
  const existing = await prisma.contractNumber.findUnique({ where: { id } });
  if (!existing) return { error: "Not found." };
  if (!canManage(user, existing.createdById)) return { error: "Not allowed." };

  const issuerId = str(formData, "issuerId");
  const number = str(formData, "number");
  if (!issuerId) return { error: "Company is required." };
  if (!number) return { error: "Contract number is required." };

  const issuer = await prisma.issuer.findUnique({ where: { id: issuerId }, select: { id: true } });
  if (!issuer) return { error: "Selected company was not found." };

  const client = await resolveClient(formData);
  if ("error" in client) return { error: client.error };

  await prisma.contractNumber.update({
    where: { id },
    data: {
      issuerId,
      number,
      organizationId: client.organizationId,
      clientName: client.clientName,
      type: contractType(formData),
      isFrameAgreement: bool(formData, "isFrameAgreement"),
      expiresAt: dateval(formData, "expiresAt"),
      comment: str(formData, "comment") ?? null,
    },
  });

  await logActivity({
    actorId: user.id,
    action: "contract_number_updated",
    entity: "ContractNumber",
    entityId: id,
    meta: { number },
  });
  revalidatePath("/contract-numbers");
  return { ok: true };
}

export async function deleteContractNumberAction(id: string): Promise<Result> {
  const user = await requireUser();
  const existing = await prisma.contractNumber.findUnique({ where: { id } });
  if (!existing) return { error: "Not found." };
  if (!canManage(user, existing.createdById)) return { error: "Not allowed." };

  await prisma.contractNumber.delete({ where: { id } });
  await logActivity({
    actorId: user.id,
    action: "contract_number_deleted",
    entity: "ContractNumber",
    entityId: id,
    meta: { number: existing.number },
  });
  revalidatePath("/contract-numbers");
  return { ok: true };
}

/** Serializable field set for the edit dialog (Date -> YYYY-MM-DD). */
export type ContractNumberEditData = {
  issuerId: string;
  number: string;
  organizationId: string;
  clientName: string;
  type: ContractType;
  isFrameAgreement: boolean;
  expiresAt: string;
  comment: string;
};

export async function getContractNumberForEditAction(
  id: string
): Promise<{ ok?: boolean; error?: string; contract?: ContractNumberEditData }> {
  const user = await requireUser();
  const c = await prisma.contractNumber.findUnique({ where: { id } });
  if (!c) return { error: "Not found." };
  if (!canManage(user, c.createdById)) return { error: "Not allowed." };
  return {
    ok: true,
    contract: {
      issuerId: c.issuerId,
      number: c.number,
      organizationId: c.organizationId ?? "",
      clientName: c.clientName,
      type: c.type,
      isFrameAgreement: c.isFrameAgreement,
      expiresAt: c.expiresAt ? c.expiresAt.toISOString().slice(0, 10) : "",
      comment: c.comment ?? "",
    },
  };
}
