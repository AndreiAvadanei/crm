import "server-only";
import { prisma } from "@/lib/db";

/** Active issuers for selection in the invoice wizard (default first). */
export async function getActiveIssuers(): Promise<{ id: string; name: string }[]> {
  return prisma.issuer.findMany({
    where: { isActive: true },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    select: { id: true, name: true },
  });
}

/** Distinct issuer names used as filter options (configured + legacy free-text). */
export async function getIssuerFilterNames(): Promise<string[]> {
  const [configured, used] = await Promise.all([
    prisma.issuer.findMany({ orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { name: true } }),
    prisma.invoice.findMany({ where: { issuerName: { not: null } }, distinct: ["issuerName"], select: { issuerName: true } }),
  ]);
  const names = new Set<string>();
  for (const c of configured) names.add(c.name);
  for (const u of used) if (u.issuerName) names.add(u.issuerName);
  return Array.from(names).sort();
}
