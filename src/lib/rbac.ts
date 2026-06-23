import "server-only";
import { prisma } from "@/lib/db";
import { Prisma, type User } from "@/generated/prisma";

export function isAdmin(user: Pick<User, "role">) {
  return user.role === "ADMIN";
}

/**
 * Build the set of OR conditions describing which records a SALES user may see,
 * shared between deals and clients (tags are common to both).
 *
 *  - records they own
 *  - records explicitly shared with them (Share)
 *  - records matching one of their AccessRules: has tag X created on/after date Y
 *    (a rule with no tag = all tags; date falls back to the user's default visibleFrom)
 */
async function scopeForUser(user: User, subject: "DEAL" | "CLIENT") {
  const [rules, shares] = await Promise.all([
    prisma.accessRule.findMany({ where: { userId: user.id } }),
    prisma.share.findMany({ where: { userId: user.id, subject } }),
  ]);

  const sharedIds = shares.map((s) => s.subjectId);
  const ruleConditions = rules.map((rule) => {
    const cond: Record<string, unknown> = {};
    if (rule.tagId) cond.tags = { some: { id: rule.tagId } };
    const from = rule.visibleFrom ?? user.visibleFrom;
    if (from) cond.createdAt = { gte: from };
    return cond;
  });

  return { sharedIds, ruleConditions };
}

export async function dealVisibilityWhere(user: User): Promise<Prisma.DealWhereInput> {
  if (isAdmin(user)) return {};
  const { sharedIds, ruleConditions } = await scopeForUser(user, "DEAL");
  const or: Prisma.DealWhereInput[] = [{ ownerId: user.id }];
  if (sharedIds.length) or.push({ id: { in: sharedIds } });
  for (const c of ruleConditions) or.push(c as Prisma.DealWhereInput);
  return { OR: or };
}

export async function clientVisibilityWhere(user: User): Promise<Prisma.ClientWhereInput> {
  if (isAdmin(user)) return {};
  const { sharedIds, ruleConditions } = await scopeForUser(user, "CLIENT");
  const or: Prisma.ClientWhereInput[] = [{ ownerId: user.id }];
  if (sharedIds.length) or.push({ id: { in: sharedIds } });
  for (const c of ruleConditions) or.push(c as Prisma.ClientWhereInput);
  return { OR: or };
}

export async function canViewDeal(user: User, dealId: string): Promise<boolean> {
  if (isAdmin(user)) return true;
  const where = await dealVisibilityWhere(user);
  const found = await prisma.deal.findFirst({ where: { AND: [{ id: dealId }, where] }, select: { id: true } });
  return !!found;
}

export async function canEditDeal(user: User, dealId: string): Promise<boolean> {
  if (isAdmin(user)) return true;
  // Sales users may edit deals they can see (owned/shared/tag-scoped).
  return canViewDeal(user, dealId);
}

export async function canViewClient(user: User, clientId: string): Promise<boolean> {
  if (isAdmin(user)) return true;
  const where = await clientVisibilityWhere(user);
  const found = await prisma.client.findFirst({
    where: { AND: [{ id: clientId }, where] },
    select: { id: true },
  });
  return !!found;
}
