import "server-only";
import { prisma } from "@/lib/db";
import { TASK_URGENCY_VALUES, type TaskUrgency } from "@/lib/task-urgency";

// Stable keys for the AppSetting key/value store.
export const SETTING_KEYS = {
  defaultDealOwnerId: "default_deal_owner_id",
  defaultOrganizationTvaPercent: "default_organization_tva_percent",
  inboundWebhookSecret: "inbound_webhook_secret",
  invoiceWebhookSecret: "invoice_webhook_secret",
  taskWebhookSecret: "task_webhook_secret",
  taskWebhookTitle: "task_webhook_title",
  taskWebhookDueDays: "task_webhook_due_days",
  taskWebhookUrgency: "task_webhook_urgency",
  dailyDigestSecret: "daily_digest_secret",
  dailyDigestLastRun: "daily_digest_last_run",
} as const;

export const DEFAULT_ORGANIZATION_TVA_PERCENT = "21";

// Defaults applied to tasks created by the create-task webhook when the admin
// has not customized them (or a stored value is invalid).
export const TASK_WEBHOOK_DEFAULTS = {
  title: "Follow up",
  dueDays: 3,
  urgency: "MEDIUM" as TaskUrgency,
} as const;

/** Read a raw setting value, or null when unset. */
export async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}

/** Upsert a setting; passing null/empty deletes it (reverts to default behavior). */
export async function setSetting(key: string, value: string | null): Promise<void> {
  if (value == null || value === "") {
    await prisma.appSetting.deleteMany({ where: { key } });
    return;
  }
  await prisma.appSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

/**
 * Resolve the configured default deal owner, returning the id only when the
 * referenced user still exists and is ACTIVE. Returns null otherwise so callers
 * can safely fall back (e.g. to the creator).
 */
export async function getDefaultDealOwnerId(): Promise<string | null> {
  const id = await getSetting(SETTING_KEYS.defaultDealOwnerId);
  if (!id) return null;
  const user = await prisma.user.findFirst({
    where: { id, status: "ACTIVE" },
    select: { id: true },
  });
  return user?.id ?? null;
}

/** Read the default VAT percent for newly-created organizations. */
export async function getDefaultOrganizationTvaPercent(): Promise<string> {
  const raw = await getSetting(SETTING_KEYS.defaultOrganizationTvaPercent);
  const n = Number(raw);
  if (!raw || !Number.isFinite(n) || n < 0 || n > 100) return DEFAULT_ORGANIZATION_TVA_PERCENT;
  return raw;
}

/** Read the configured inbound-email webhook secret, or null when unset. */
export async function getInboundWebhookSecret(): Promise<string | null> {
  return getSetting(SETTING_KEYS.inboundWebhookSecret);
}

/** Read the configured inbound-invoice (PDF reply) webhook secret, or null when unset. */
export async function getInvoiceWebhookSecret(): Promise<string | null> {
  return getSetting(SETTING_KEYS.invoiceWebhookSecret);
}

/** Read the configured create-task webhook secret, or null when unset. */
export async function getTaskWebhookSecret(): Promise<string | null> {
  return getSetting(SETTING_KEYS.taskWebhookSecret);
}

/**
 * Read the secret that guards the daily-digest cron endpoint. Falls back to the
 * `CRON_SECRET` env var so platform schedulers (e.g. Vercel Cron, which sends
 * `Authorization: Bearer $CRON_SECRET`) work without a DB round-trip.
 */
export async function getDailyDigestSecret(): Promise<string | null> {
  return (await getSetting(SETTING_KEYS.dailyDigestSecret)) ?? process.env.CRON_SECRET ?? null;
}

export type TaskWebhookDefaults = {
  title: string;
  dueDays: number;
  urgency: TaskUrgency;
};

/**
 * Resolve the configured defaults for tasks created via the create-task webhook,
 * falling back to sane values when a setting is unset or invalid.
 */
export async function getTaskWebhookDefaults(): Promise<TaskWebhookDefaults> {
  const [title, dueDaysRaw, urgencyRaw] = await Promise.all([
    getSetting(SETTING_KEYS.taskWebhookTitle),
    getSetting(SETTING_KEYS.taskWebhookDueDays),
    getSetting(SETTING_KEYS.taskWebhookUrgency),
  ]);

  const dueDaysNum = Number(dueDaysRaw);
  const dueDays =
    dueDaysRaw && Number.isInteger(dueDaysNum) && dueDaysNum >= 0 && dueDaysNum <= 365
      ? dueDaysNum
      : TASK_WEBHOOK_DEFAULTS.dueDays;

  const urgency =
    urgencyRaw && (TASK_URGENCY_VALUES as string[]).includes(urgencyRaw)
      ? (urgencyRaw as TaskUrgency)
      : TASK_WEBHOOK_DEFAULTS.urgency;

  return {
    title: title?.trim() || TASK_WEBHOOK_DEFAULTS.title,
    dueDays,
    urgency,
  };
}
