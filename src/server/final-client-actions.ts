"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/guards";

type CreateResult = { ok?: boolean; error?: string; id?: string; name?: string };

/**
 * Create (or reuse) a Final Client by name for the invoice "create from search"
 * flow. Names are deduped case-insensitively so repeated typing of the same end
 * customer doesn't spawn duplicates. Returns the id/name so the caller can
 * immediately select it in a picker.
 */
export async function quickCreateFinalClientAction(name: string): Promise<CreateResult> {
  await requireUser();
  const trimmed = name.trim();
  if (!trimmed) return { error: "Final client name is required." };

  // Reuse an existing entry with the same name (case-insensitive via the DB's
  // default collation) instead of creating a duplicate.
  const existing = await prisma.finalClient.findFirst({
    where: { name: trimmed },
    select: { id: true, name: true },
  });
  if (existing) return { ok: true, id: existing.id, name: existing.name };

  const created = await prisma.finalClient.create({ data: { name: trimmed } });
  revalidatePath("/invoices");
  return { ok: true, id: created.id, name: created.name };
}
