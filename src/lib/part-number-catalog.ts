import "server-only";
import { prisma } from "@/lib/db";
import type { PartNumberOption } from "@/lib/part-numbers";

/** Active part numbers offered in the invoice wizard (matrix order, then code). */
export async function getActivePartNumbers(): Promise<PartNumberOption[]> {
  return prisma.partNumber.findMany({
    where: { active: true },
    orderBy: [{ order: "asc" }, { code: "asc" }],
    select: {
      id: true,
      code: true,
      group: true,
      title: true,
      limitations: true,
      category: true,
      subCategory: true,
      subSubCategory: true,
      type: true,
    },
  });
}
