import "server-only";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma";

/**
 * Atomically increment the deal SAL counter and return the next id, e.g. "SAL-1234".
 * Uses a transactional read-modify-write to avoid duplicate numbers under concurrency.
 */
export async function nextSalesId(tx?: Prisma.TransactionClient): Promise<string> {
  const client = tx ?? prisma;
  const counter = await client.counter.update({
    where: { name: "deal_sal" },
    data: { value: { increment: 1 } },
  });
  return `SAL-${counter.value}`;
}

/** Ensure the SAL counter is at least `min` (used by the importer to avoid collisions). */
export async function bumpSalesCounterTo(min: number): Promise<void> {
  await prisma.counter.upsert({
    where: { name: "deal_sal" },
    update: {},
    create: { name: "deal_sal", value: 0 },
  });
  await prisma.$executeRaw`UPDATE Counter SET value = ${min} WHERE name = 'deal_sal' AND value < ${min}`;
}
