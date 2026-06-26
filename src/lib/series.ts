import "server-only";
import { prisma } from "@/lib/db";

/** Active invoice number series for selection in the invoice form (default first). */
export async function getActiveSeries(): Promise<{ id: string; prefix: string; nextNumber: number }[]> {
  return prisma.invoiceSeries.findMany({
    where: { isActive: true },
    orderBy: [{ isDefault: "desc" }, { prefix: "asc" }],
    select: { id: true, prefix: true, nextNumber: true },
  });
}
