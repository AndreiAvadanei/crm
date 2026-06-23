"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/guards";
import { isAdmin, canEditClient } from "@/lib/rbac";
import { saveCustomFieldsFromForm } from "@/lib/custom-fields";
import { logActivity } from "@/lib/activity";
import { changeList, diffText, diffPlain, diffList, type ActivityChange } from "@/lib/activity-diff";

type Result = { ok?: boolean; error?: string; id?: string };

function str(fd: FormData, k: string) {
  const v = fd.get(k);
  return v == null ? undefined : String(v).trim() || undefined;
}

export async function createClientAction(formData: FormData): Promise<Result> {
  const user = await requireUser();
  const name = str(formData, "name");
  if (!name) return { error: "Company name is required." };
  const tagIds = formData.getAll("tagIds").map(String).filter(Boolean);

  const client = await prisma.client.create({
    data: {
      name,
      website: str(formData, "website"),
      country: str(formData, "country"),
      size: str(formData, "size"),
      contactName: str(formData, "contactName"),
      contactEmail: str(formData, "contactEmail"),
      contactPhone: str(formData, "contactPhone"),
      ownerId: isAdmin(user) ? str(formData, "ownerId") ?? user.id : user.id,
      tags: tagIds.length ? { connect: tagIds.map((id) => ({ id })) } : undefined,
    },
  });
  await saveCustomFieldsFromForm("CLIENT", client.id, formData);
  let changes: ActivityChange[] = [];
  try {
    const ownerRow = client.ownerId
      ? await prisma.user.findUnique({ where: { id: client.ownerId }, select: { name: true } })
      : null;
    changes = changeList(
      diffPlain("country", "Country", null, client.country),
      diffPlain("contactName", "Contact", null, client.contactName),
      diffText("website", "Website", null, client.website),
      diffPlain("owner", "Owner", null, ownerRow?.name ?? null)
    );
  } catch {
    // best-effort
  }
  await logActivity({
    actorId: user.id,
    action: "client_created",
    entity: "Client",
    entityId: client.id,
    meta: { name: client.name, changes },
  });
  revalidatePath("/clients");
  return { ok: true, id: client.id };
}

export async function updateClientAction(clientId: string, formData: FormData): Promise<Result> {
  const user = await requireUser();
  if (!(await canEditClient(user, clientId))) return { error: "Not allowed." };
  const tagIds = formData.getAll("tagIds").map(String).filter(Boolean);

  const before = await prisma.client.findUnique({
    where: { id: clientId },
    include: { owner: true, tags: true },
  });

  const newName = str(formData, "name");
  const newWebsite = str(formData, "website") ?? null;
  const newCountry = str(formData, "country") ?? null;
  const newSize = str(formData, "size") ?? null;
  const newContactName = str(formData, "contactName") ?? null;
  const newContactEmail = str(formData, "contactEmail") ?? null;
  const newContactPhone = str(formData, "contactPhone") ?? null;
  const newOwnerId = isAdmin(user) ? str(formData, "ownerId") ?? null : undefined;

  await prisma.client.update({
    where: { id: clientId },
    data: {
      name: newName,
      website: newWebsite,
      country: newCountry,
      size: newSize,
      contactName: newContactName,
      contactEmail: newContactEmail,
      contactPhone: newContactPhone,
      ownerId: newOwnerId,
      tags: { set: tagIds.map((id) => ({ id })) },
    },
  });
  await saveCustomFieldsFromForm("CLIENT", clientId, formData);

  let changes: ActivityChange[] = [];
  try {
    if (before) {
      const [newOwner, newTags] = await Promise.all([
        newOwnerId !== undefined && newOwnerId
          ? prisma.user.findUnique({ where: { id: newOwnerId }, select: { name: true } })
          : null,
        tagIds.length ? prisma.tag.findMany({ where: { id: { in: tagIds } }, select: { name: true } }) : [],
      ]);
      const newOwnerName =
        newOwnerId === undefined ? before.owner?.name ?? null : newOwnerId ? newOwner?.name ?? null : null;
      changes = changeList(
        diffText("name", "Name", before.name, newName ?? before.name),
        diffText("website", "Website", before.website, newWebsite),
        diffPlain("country", "Country", before.country, newCountry),
        diffPlain("size", "Size", before.size, newSize),
        diffPlain("contactName", "Contact", before.contactName, newContactName),
        diffPlain("contactEmail", "Email", before.contactEmail, newContactEmail),
        diffPlain("contactPhone", "Phone", before.contactPhone, newContactPhone),
        diffPlain("owner", "Owner", before.owner?.name ?? null, newOwnerName),
        diffList(
          "tags",
          "Tags",
          before.tags.map((t) => t.name),
          newTags.map((t) => t.name)
        )
      );
    }
  } catch {
    // best-effort
  }

  await logActivity({
    actorId: user.id,
    action: "client_updated",
    entity: "Client",
    entityId: clientId,
    meta: { name: newName ?? before?.name, changes },
  });
  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
  return { ok: true };
}

export async function deleteClientAction(clientId: string): Promise<Result> {
  const user = await requireUser();
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) return { error: "Not found." };
  if (!isAdmin(user) && client.ownerId !== user.id) return { error: "Not allowed." };
  await prisma.client.delete({ where: { id: clientId } });
  const changes = changeList(
    diffPlain("country", "Country", client.country, null),
    diffPlain("contactName", "Contact", client.contactName, null)
  );
  await logActivity({
    actorId: user.id,
    action: "client_deleted",
    entity: "Client",
    entityId: clientId,
    meta: { name: client.name, changes },
  });
  revalidatePath("/clients");
  return { ok: true };
}
