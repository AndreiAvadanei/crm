import "server-only";
import { prisma } from "@/lib/db";
import type { CustomEntity, CustomFieldDefinition } from "@/generated/prisma";

export type CustomFieldOption = { label: string; value: string };

export function fieldOptions(def: CustomFieldDefinition): CustomFieldOption[] {
  if (!def.options) return [];
  try {
    const arr = Array.isArray(def.options) ? def.options : JSON.parse(String(def.options));
    return (arr as unknown[]).map((o) =>
      typeof o === "string" ? { label: o, value: o } : (o as CustomFieldOption)
    );
  } catch {
    return [];
  }
}

export function listFieldDefs(entity: CustomEntity) {
  return prisma.customFieldDefinition.findMany({
    where: { entity, active: true },
    orderBy: { order: "asc" },
  });
}

export async function loadValues(entity: CustomEntity, entityId: string) {
  const rows = await prisma.customFieldValue.findMany({ where: { entity, entityId } });
  const map = new Map<string, unknown>();
  for (const r of rows) map.set(r.definitionId, r.value);
  return map;
}

function coerce(type: string, raw: FormDataEntryValue[] | null): unknown {
  if (!raw || raw.length === 0) return null;
  const first = String(raw[0] ?? "");
  switch (type) {
    case "NUMBER":
      return first === "" ? null : Number(first);
    case "BOOLEAN":
      return first === "on" || first === "true" || first === "1";
    case "MULTISELECT":
      return raw.map((v) => String(v)).filter(Boolean);
    default:
      return first === "" ? null : first;
  }
}

/** Persist custom field values submitted via form inputs named `cf:<definitionId>`. */
export async function saveCustomFieldsFromForm(
  entity: CustomEntity,
  entityId: string,
  formData: FormData
) {
  const defs = await listFieldDefs(entity);
  for (const def of defs) {
    const raw = formData.getAll(`cf:${def.id}`);
    const value = coerce(def.type, raw.length ? raw : null);
    if (value === null || (Array.isArray(value) && value.length === 0)) {
      await prisma.customFieldValue.deleteMany({ where: { definitionId: def.id, entityId } });
      continue;
    }
    await prisma.customFieldValue.upsert({
      where: { definitionId_entityId: { definitionId: def.id, entityId } },
      update: { value: value as never },
      create: { definitionId: def.id, entity, entityId, value: value as never },
    });
  }
}

/** Directly set a single custom field value (used by the importer). */
export async function setCustomFieldValue(
  entity: CustomEntity,
  entityId: string,
  definitionId: string,
  value: unknown
) {
  if (value === null || value === undefined || value === "") return;
  await prisma.customFieldValue.upsert({
    where: { definitionId_entityId: { definitionId, entityId } },
    update: { value: value as never },
    create: { definitionId, entity, entityId, value: value as never },
  });
}
