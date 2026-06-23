import "server-only";
import { prisma } from "@/lib/db";

// Stable keys for the AppSetting key/value store.
export const SETTING_KEYS = {
  defaultDealOwnerId: "default_deal_owner_id",
  inboundWebhookSecret: "inbound_webhook_secret",
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

/** Read the configured inbound-email webhook secret, or null when unset. */
export async function getInboundWebhookSecret(): Promise<string | null> {
  return getSetting(SETTING_KEYS.inboundWebhookSecret);
}
