"use server";

import { requireFullAuth } from "@/lib/auth/guards";
import { isAdmin } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { startOfDay } from "@/lib/filter-helpers";
import { LIST_FETCH_CAP } from "@/lib/app-constants";
import {
  buildDealListQuery,
  fetchStageDeals,
  makeOverdueChecker,
  toKanbanDeal,
  toDealRow,
  type DealFilterParams,
} from "@/lib/deal-query";
import type { KanbanDeal } from "@/components/deals/kanban-board";
import type { DealRow } from "@/components/deals/deals-table";

type LoadResult =
  | { error: string }
  | {
      kanban: KanbanDeal[];
      rows: DealRow[];
      sharedMap: Record<string, string[]>;
      hasMore: boolean;
      nextOffset: number;
    };

/**
 * Load a slice of deals for one stage column/section (infinite scroll + "Load
 * all"). Re-applies the caller's RBAC scope and the current filters/sort so the
 * appended rows are exactly what a fresh page render would show — the client
 * never gets to widen visibility by passing a raw stageId.
 */
export async function loadStageDealsAction(params: {
  filters: DealFilterParams;
  stageId: string;
  offset: number;
  limit: number;
}): Promise<LoadResult> {
  const user = await requireFullAuth();
  const { where, sort, dir, fullScan } = await buildDealListQuery(params.filters, user);

  // The stale/activity views load everything up front — nothing to page here.
  if (fullScan) return { error: "This view is not paginated." };

  const offset = Math.max(0, Math.floor(params.offset));
  const limit = Math.min(Math.max(1, Math.floor(params.limit)), LIST_FETCH_CAP);

  const stage = await prisma.stage.findUnique({
    where: { id: params.stageId },
    select: { isWon: true, isLost: true },
  });
  if (!stage) return { error: "Unknown stage." };

  const deals = await fetchStageDeals(where, params.stageId, sort, dir, offset, limit);

  const isOverdue = makeOverdueChecker(
    new Map([[params.stageId, { isWon: stage.isWon, isLost: stage.isLost }]]),
    startOfDay(new Date())
  );

  const kanban = deals.map((d) => toKanbanDeal(d, isOverdue(d.dueDate, d.stageId)));
  const rows = deals.map((d) => toDealRow(d, isOverdue(d.dueDate, d.stageId)));

  // Admins see per-deal share badges; fetch share state for just these rows so
  // lazily loaded cards match the ones rendered on first paint.
  const sharedMap: Record<string, string[]> = {};
  if (isAdmin(user) && deals.length) {
    const shares = await prisma.share.findMany({
      where: { subject: "DEAL", subjectId: { in: deals.map((d) => d.id) } },
      select: { subjectId: true, userId: true },
    });
    for (const s of shares) (sharedMap[s.subjectId] ??= []).push(s.userId);
  }

  return {
    kanban,
    rows,
    sharedMap,
    // A short page means the stage is drained; a full page *might* have more.
    hasMore: deals.length === limit,
    nextOffset: offset + deals.length,
  };
}
