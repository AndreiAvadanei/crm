"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/guards";
import { isAdmin } from "@/lib/rbac";
import { hashPassword, isStrongPassword } from "@/lib/auth/password";
import { logActivity } from "@/lib/activity";
import { changeList, diffText, diffPlain, diffBool, diffDate } from "@/lib/activity-diff";
import { SETTING_KEYS, getSetting, setSetting } from "@/lib/settings";

type Result = { ok?: boolean; error?: string; id?: string; tempPassword?: string; secret?: string };

function str(fd: FormData, k: string) {
  const v = fd.get(k);
  return v == null ? undefined : String(v).trim() || undefined;
}

function percent(fd: FormData, k: string) {
  const raw = str(fd, k);
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return String(Math.round(n * 100) / 100);
}

async function ensureAdmin() {
  const user = await requireUser();
  if (!isAdmin(user)) throw new Error("Admins only");
  return user;
}

const COLORS = ["#6366f1", "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#14b8a6", "#ec4899"];

// --------------------------------------------------------------------------
// Users
// --------------------------------------------------------------------------
export async function createUserAction(formData: FormData): Promise<Result> {
  const admin = await ensureAdmin();
  const email = str(formData, "email")?.toLowerCase();
  const name = str(formData, "name");
  const role = (str(formData, "role") as "ADMIN" | "SALES") ?? "SALES";
  if (!email || !name) return { error: "Name and email are required." };
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) return { error: "A user with this email already exists." };

  const tempPassword = str(formData, "password") ?? `Crm-${Math.random().toString(36).slice(2, 8)}A1`;
  if (!isStrongPassword(tempPassword)) return { error: "Temp password too weak (8+ chars, mixed case, number)." };

  const passwordHash = await hashPassword(tempPassword);
  const user = await prisma.user.create({
    data: {
      email,
      name,
      role,
      passwordHash,
      mustChangePassword: true,
      twoFactorEnabled: false,
      avatarColor: COLORS[Math.floor(Math.random() * COLORS.length)],
      visibleFrom: str(formData, "visibleFrom") ? new Date(str(formData, "visibleFrom")!) : null,
      invoiceVisibleFrom: str(formData, "invoiceVisibleFrom") ? new Date(str(formData, "invoiceVisibleFrom")!) : null,
    },
  });
  await logActivity({
    actorId: admin.id,
    action: "user_created",
    entity: "User",
    entityId: user.id,
    meta: { email, name, role },
  });
  revalidatePath("/admin/users");
  return { ok: true, id: user.id, tempPassword };
}

export async function updateUserAction(userId: string, formData: FormData): Promise<Result> {
  const admin = await ensureAdmin();
  const before = await prisma.user.findUnique({ where: { id: userId } });
  const newName = str(formData, "name");
  const newRole = str(formData, "role") as "ADMIN" | "SALES" | undefined;
  const newVisibleFrom = str(formData, "visibleFrom") ? new Date(str(formData, "visibleFrom")!) : null;
  const newInvoiceVisibleFrom = str(formData, "invoiceVisibleFrom") ? new Date(str(formData, "invoiceVisibleFrom")!) : null;
  await prisma.user.update({
    where: { id: userId },
    data: { name: newName, role: newRole, visibleFrom: newVisibleFrom, invoiceVisibleFrom: newInvoiceVisibleFrom },
  });
  const changes = before
    ? changeList(
        diffText("name", "Name", before.name, newName ?? before.name),
        diffPlain("role", "Role", before.role, newRole ?? before.role),
        diffDate("visibleFrom", "Visible from", before.visibleFrom, newVisibleFrom),
        diffDate("invoiceVisibleFrom", "Invoices visible from", before.invoiceVisibleFrom, newInvoiceVisibleFrom)
      )
    : [];
  await logActivity({
    actorId: admin.id,
    action: "user_updated",
    entity: "User",
    entityId: userId,
    meta: { name: newName ?? before?.name, changes },
  });
  revalidatePath("/admin/users");
  return { ok: true };
}

export async function setUserStatusAction(userId: string, status: "ACTIVE" | "DISABLED"): Promise<Result> {
  const admin = await ensureAdmin();
  if (userId === admin.id) return { error: "You cannot disable your own account." };
  const target = await prisma.user.update({ where: { id: userId }, data: { status }, select: { name: true } });
  if (status === "DISABLED") await prisma.session.deleteMany({ where: { userId } });
  await logActivity({
    actorId: admin.id,
    action: "user_status_changed",
    entity: "User",
    entityId: userId,
    meta: { status, name: target.name },
  });
  revalidatePath("/admin/users");
  return { ok: true };
}

export async function resetUserPasswordAction(userId: string): Promise<Result> {
  const admin = await ensureAdmin();
  const tempPassword = `Crm-${Math.random().toString(36).slice(2, 8)}A1`;
  const passwordHash = await hashPassword(tempPassword);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash, mustChangePassword: true },
  });
  await prisma.session.deleteMany({ where: { userId } });
  await logActivity({ actorId: admin.id, action: "user_password_reset", entity: "User", entityId: userId });
  revalidatePath("/admin/users");
  return { ok: true, tempPassword };
}

export async function resetUser2faAction(userId: string): Promise<Result> {
  const admin = await ensureAdmin();
  await prisma.webAuthnCredential.deleteMany({ where: { userId } });
  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorEnabled: false, totpSecret: null, currentChallenge: null },
  });
  await prisma.session.deleteMany({ where: { userId } });
  await logActivity({ actorId: admin.id, action: "user_2fa_reset", entity: "User", entityId: userId });
  revalidatePath("/admin/users");
  return { ok: true };
}

// Replace a user's tag/date access rules.
export async function setAccessRulesAction(
  userId: string,
  rules: { tagId: string | null; visibleFrom: string | null }[]
): Promise<Result> {
  const admin = await ensureAdmin();
  await prisma.$transaction([
    prisma.accessRule.deleteMany({ where: { userId } }),
    prisma.accessRule.createMany({
      data: rules.map((r) => ({
        userId,
        tagId: r.tagId,
        visibleFrom: r.visibleFrom ? new Date(r.visibleFrom) : null,
      })),
    }),
  ]);
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  await logActivity({
    actorId: admin.id,
    action: "access_rule_changed",
    entity: "User",
    entityId: userId,
    meta: { count: rules.length, name: target?.name },
  });
  revalidatePath("/admin/users");
  return { ok: true };
}

// --------------------------------------------------------------------------
// Custom fields
// --------------------------------------------------------------------------
function parseOptions(raw?: string): string[] | undefined {
  if (!raw) return undefined;
  const arr = raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return arr.length ? arr : undefined;
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export async function createFieldDefAction(formData: FormData): Promise<Result> {
  const admin = await ensureAdmin();
  const entity = (str(formData, "entity") as "DEAL" | "CLIENT") ?? "DEAL";
  const label = str(formData, "label");
  const type = (str(formData, "type") as never) ?? "TEXT";
  if (!label) return { error: "Label is required." };
  const key = slugify(label);
  const dupe = await prisma.customFieldDefinition.findUnique({ where: { entity_key: { entity, key } } });
  if (dupe) return { error: "A field with a similar name already exists." };

  const count = await prisma.customFieldDefinition.count({ where: { entity } });
  const def = await prisma.customFieldDefinition.create({
    data: {
      entity,
      key,
      label,
      type,
      required: formData.get("required") === "on",
      options: parseOptions(str(formData, "options")) ?? undefined,
      order: count,
    },
  });
  await logActivity({
    actorId: admin.id,
    action: "custom_field_created",
    entity: "CustomFieldDefinition",
    entityId: def.id,
    meta: { label, entity },
  });
  revalidatePath("/admin/custom-fields");
  return { ok: true };
}

export async function updateFieldDefAction(id: string, formData: FormData): Promise<Result> {
  const admin = await ensureAdmin();
  const before = await prisma.customFieldDefinition.findUnique({ where: { id } });
  const newLabel = str(formData, "label");
  const newType = str(formData, "type");
  const newRequired = formData.get("required") === "on";
  const newOptions = parseOptions(str(formData, "options"));
  await prisma.customFieldDefinition.update({
    where: { id },
    data: {
      label: newLabel,
      type: newType as never,
      required: newRequired,
      options: newOptions ?? undefined,
    },
  });
  const optStr = (v: unknown) => (Array.isArray(v) ? v.join(", ") : null);
  const changes = before
    ? changeList(
        diffText("label", "Label", before.label, newLabel ?? before.label),
        diffPlain("type", "Type", before.type, newType ?? before.type),
        diffBool("required", "Required", before.required, newRequired),
        diffText("options", "Options", optStr(before.options), optStr(newOptions))
      )
    : [];
  await logActivity({
    actorId: admin.id,
    action: "custom_field_updated",
    entity: "CustomFieldDefinition",
    entityId: id,
    meta: { label: newLabel ?? before?.label, changes },
  });
  revalidatePath("/admin/custom-fields");
  return { ok: true };
}

export async function deleteFieldDefAction(id: string): Promise<Result> {
  const admin = await ensureAdmin();
  const def = await prisma.customFieldDefinition.findUnique({ where: { id }, select: { label: true } });
  await prisma.customFieldDefinition.delete({ where: { id } });
  await logActivity({
    actorId: admin.id,
    action: "custom_field_deleted",
    entity: "CustomFieldDefinition",
    entityId: id,
    meta: { label: def?.label },
  });
  revalidatePath("/admin/custom-fields");
  return { ok: true };
}

// --------------------------------------------------------------------------
// Pipeline stages
// --------------------------------------------------------------------------
export async function createStageAction(formData: FormData): Promise<Result> {
  const admin = await ensureAdmin();
  const name = str(formData, "name");
  if (!name) return { error: "Stage name required." };
  const pipeline = await prisma.pipeline.findFirst({ where: { isDefault: true } });
  if (!pipeline) return { error: "No pipeline." };
  const count = await prisma.stage.count({ where: { pipelineId: pipeline.id } });
  const stage = await prisma.stage.create({
    data: {
      pipelineId: pipeline.id,
      name,
      color: str(formData, "color") ?? "#64748b",
      probability: Number(str(formData, "probability") ?? "0") || 0,
      isWon: formData.get("isWon") === "on",
      isLost: formData.get("isLost") === "on",
      order: count,
    },
  });
  await logActivity({ actorId: admin.id, action: "stage_created", entity: "Stage", entityId: stage.id, meta: { name } });
  revalidatePath("/admin/pipeline");
  revalidatePath("/deals");
  return { ok: true };
}

export async function updateStageAction(id: string, formData: FormData): Promise<Result> {
  const admin = await ensureAdmin();
  const before = await prisma.stage.findUnique({ where: { id } });
  const newName = str(formData, "name");
  const newColor = str(formData, "color");
  const newProbability = Number(str(formData, "probability") ?? "0") || 0;
  const newIsWon = formData.get("isWon") === "on";
  const newIsLost = formData.get("isLost") === "on";
  await prisma.stage.update({
    where: { id },
    data: { name: newName, color: newColor, probability: newProbability, isWon: newIsWon, isLost: newIsLost },
  });
  const changes = before
    ? changeList(
        diffText("name", "Name", before.name, newName ?? before.name),
        diffPlain("color", "Color", before.color, newColor ?? before.color),
        diffPlain("probability", "Probability", before.probability, newProbability),
        diffBool("isWon", "Won", before.isWon, newIsWon),
        diffBool("isLost", "Lost", before.isLost, newIsLost)
      )
    : [];
  await logActivity({
    actorId: admin.id,
    action: "stage_updated",
    entity: "Stage",
    entityId: id,
    meta: { name: newName ?? before?.name, changes },
  });
  revalidatePath("/admin/pipeline");
  revalidatePath("/deals");
  return { ok: true };
}

export async function deleteStageAction(id: string): Promise<Result> {
  const admin = await ensureAdmin();
  const count = await prisma.deal.count({ where: { stageId: id } });
  if (count > 0) return { error: `Stage has ${count} deals. Move them first.` };
  const stage = await prisma.stage.findUnique({ where: { id }, select: { name: true } });
  await prisma.stage.delete({ where: { id } });
  await logActivity({ actorId: admin.id, action: "stage_deleted", entity: "Stage", entityId: id, meta: { name: stage?.name } });
  revalidatePath("/admin/pipeline");
  revalidatePath("/deals");
  return { ok: true };
}

export async function reorderStagesAction(ids: string[]): Promise<Result> {
  const admin = await ensureAdmin();
  await prisma.$transaction(ids.map((id, i) => prisma.stage.update({ where: { id }, data: { order: i } })));
  await logActivity({ actorId: admin.id, action: "stage_reordered", entity: "Stage", meta: { count: ids.length } });
  revalidatePath("/admin/pipeline");
  revalidatePath("/deals");
  return { ok: true };
}

// --------------------------------------------------------------------------
// Tags
// --------------------------------------------------------------------------
export async function createTagAction(formData: FormData): Promise<Result> {
  const admin = await ensureAdmin();
  const name = str(formData, "name");
  if (!name) return { error: "Tag name required." };
  const exists = await prisma.tag.findUnique({ where: { name } });
  if (exists) return { error: "Tag already exists." };
  const tag = await prisma.tag.create({ data: { name, color: str(formData, "color") ?? "#64748b" } });
  await logActivity({ actorId: admin.id, action: "tag_created", entity: "Tag", entityId: tag.id, meta: { name } });
  revalidatePath("/admin/pipeline");
  return { ok: true };
}

export async function updateTagAction(id: string, formData: FormData): Promise<Result> {
  const admin = await ensureAdmin();
  const before = await prisma.tag.findUnique({ where: { id } });
  const newName = str(formData, "name");
  const newColor = str(formData, "color");
  await prisma.tag.update({ where: { id }, data: { name: newName, color: newColor } });
  const changes = before
    ? changeList(
        diffText("name", "Name", before.name, newName ?? before.name),
        diffPlain("color", "Color", before.color, newColor ?? before.color)
      )
    : [];
  await logActivity({
    actorId: admin.id,
    action: "tag_updated",
    entity: "Tag",
    entityId: id,
    meta: { name: newName ?? before?.name, changes },
  });
  revalidatePath("/admin/pipeline");
  return { ok: true };
}

export async function deleteTagAction(id: string): Promise<Result> {
  const admin = await ensureAdmin();
  const tag = await prisma.tag.findUnique({ where: { id }, select: { name: true } });
  await prisma.tag.delete({ where: { id } });
  await logActivity({ actorId: admin.id, action: "tag_deleted", entity: "Tag", entityId: id, meta: { name: tag?.name } });
  revalidatePath("/admin/pipeline");
  return { ok: true };
}

// --------------------------------------------------------------------------
// App settings
// --------------------------------------------------------------------------
/**
 * Set (or clear) the default deal assignee used when a deal is created without
 * an explicit owner. An empty value clears the setting (reverts to assigning
 * the creating admin).
 */
export async function setDefaultDealOwnerAction(formData: FormData): Promise<Result> {
  const admin = await ensureAdmin();
  const userId = str(formData, "userId");

  let name: string | null = null;
  if (userId) {
    const target = await prisma.user.findFirst({
      where: { id: userId, status: "ACTIVE" },
      select: { name: true },
    });
    if (!target) return { error: "Selected user is not an active account." };
    name = target.name;
  }

  const before = await getSetting(SETTING_KEYS.defaultDealOwnerId);
  await setSetting(SETTING_KEYS.defaultDealOwnerId, userId ?? null);

  await logActivity({
    actorId: admin.id,
    action: "settings_updated",
    entity: "Setting",
    entityId: SETTING_KEYS.defaultDealOwnerId,
    meta: { setting: "Default deal owner", value: name ?? "Deal creator", changed: before !== (userId ?? null) },
  });
  revalidatePath("/admin/settings");
  return { ok: true };
}

/** Set the default VAT percent applied to newly-created organizations. */
export async function setDefaultOrganizationTvaPercentAction(formData: FormData): Promise<Result> {
  const admin = await ensureAdmin();
  const value = percent(formData, "tvaPercent");
  if (value === null) return { error: "VAT percent must be a number between 0 and 100." };

  const before = await getSetting(SETTING_KEYS.defaultOrganizationTvaPercent);
  await setSetting(SETTING_KEYS.defaultOrganizationTvaPercent, value ?? null);

  await logActivity({
    actorId: admin.id,
    action: "settings_updated",
    entity: "Setting",
    entityId: SETTING_KEYS.defaultOrganizationTvaPercent,
    meta: {
      setting: "Default organization VAT percent",
      value: value ? `${value}%` : "21%",
      changed: before !== (value ?? null),
    },
  });
  revalidatePath("/admin/settings");
  return { ok: true };
}

/**
 * Set or regenerate the inbound-email webhook secret. When `regenerate` is set
 * (or no explicit `secret` is provided) a new cryptographically-random token is
 * generated. An empty `secret` with no regenerate flag clears it (disabling the
 * webhook). The secret value itself is never written to the audit log.
 */
export async function setInboundWebhookSecretAction(formData: FormData): Promise<Result> {
  const admin = await ensureAdmin();
  const provided = str(formData, "secret");
  const regenerate = str(formData, "regenerate") === "1";

  let value: string | null;
  if (regenerate) {
    value = randomBytes(32).toString("base64url");
  } else if (provided) {
    if (provided.length < 16) return { error: "Secret must be at least 16 characters." };
    value = provided;
  } else {
    value = null; // clear / disable
  }

  await setSetting(SETTING_KEYS.inboundWebhookSecret, value);
  await logActivity({
    actorId: admin.id,
    action: "settings_updated",
    entity: "Setting",
    entityId: SETTING_KEYS.inboundWebhookSecret,
    meta: { setting: "Inbound webhook secret", value: value ? "(updated)" : "(cleared)" },
  });
  revalidatePath("/admin/settings");
  return { ok: true, secret: value ?? undefined };
}

/**
 * Set or regenerate the inbound-invoice (PDF reply) webhook secret. Same logic as
 * the inbound-email webhook: `regenerate` (or no `secret`) mints a new random
 * token; an empty `secret` clears it (disabling the webhook). The secret value
 * itself is never written to the audit log.
 */
export async function setInvoiceWebhookSecretAction(formData: FormData): Promise<Result> {
  const admin = await ensureAdmin();
  const provided = str(formData, "secret");
  const regenerate = str(formData, "regenerate") === "1";

  let value: string | null;
  if (regenerate) {
    value = randomBytes(32).toString("base64url");
  } else if (provided) {
    if (provided.length < 16) return { error: "Secret must be at least 16 characters." };
    value = provided;
  } else {
    value = null; // clear / disable
  }

  await setSetting(SETTING_KEYS.invoiceWebhookSecret, value);
  await logActivity({
    actorId: admin.id,
    action: "settings_updated",
    entity: "Setting",
    entityId: SETTING_KEYS.invoiceWebhookSecret,
    meta: { setting: "Invoice webhook secret", value: value ? "(updated)" : "(cleared)" },
  });
  revalidatePath("/admin/settings");
  return { ok: true, secret: value ?? undefined };
}
