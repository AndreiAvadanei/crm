import "server-only";
import { prisma } from "@/lib/db";
import type { CustomEntity } from "@/generated/prisma";
import { fieldOptions } from "@/lib/custom-fields";
import type { TagView } from "@/components/shared/tag-badge";
import type { FieldDefView } from "@/components/shared/custom-field-inputs";

export async function getTagViews(): Promise<TagView[]> {
  const tags = await prisma.tag.findMany({ orderBy: { name: "asc" } });
  return tags.map((t) => ({ id: t.id, name: t.name, color: t.color }));
}

export async function getFieldDefViews(entity: CustomEntity): Promise<FieldDefView[]> {
  const defs = await prisma.customFieldDefinition.findMany({
    where: { entity, active: true },
    orderBy: { order: "asc" },
  });
  return defs.map((d) => ({
    id: d.id,
    label: d.label,
    type: d.type,
    required: d.required,
    options: fieldOptions(d).map((o) => o.value),
  }));
}

export async function getOwners(): Promise<{ id: string; name: string }[]> {
  const users = await prisma.user.findMany({
    where: { status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return users;
}
