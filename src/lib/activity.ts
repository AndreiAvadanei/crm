import "server-only";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import type { ActivityAction } from "@/lib/activity-format";

export type { ActivityAction };

type LogActivityInput = {
  actorId?: string | null;
  action: ActivityAction;
  entity: string;
  entityId?: string | null;
  meta?: Record<string, unknown>;
};

/**
 * Write an AuditLog entry. Never throws — a logging failure must never break
 * the underlying mutation that triggered it.
 */
export async function logActivity({ actorId, action, entity, entityId, meta }: LogActivityInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: actorId ?? null,
        action,
        entity,
        entityId: entityId ?? null,
        meta: meta ? (meta as Prisma.InputJsonValue) : undefined,
      },
    });
  } catch (err) {
    console.error(`[activity] failed to log "${action}"`, err);
  }
}
