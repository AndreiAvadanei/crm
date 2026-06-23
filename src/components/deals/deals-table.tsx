"use client";

import Link from "next/link";
import { Share2 } from "lucide-react";
import { quickUpdateDealAction } from "@/server/quick-actions";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { TagView } from "@/components/shared/tag-badge";
import { InlineInput, InlineSelect, InlineTagEditor } from "@/components/shared/inline-edit";
import { ShareControl } from "@/components/deals/share-control";
import { formatCurrency, formatDate, cn } from "@/lib/utils";

export type DealRow = {
  id: string;
  salesId: string;
  title: string;
  clientName: string | null;
  stageId: string;
  amountEur: number | null;
  dueDate: string | null; // yyyy-mm-dd
  overdue: boolean;
  ownerId: string | null;
  ownerName: string | null;
  ownerColor: string | null;
  tagIds: string[];
};

export type ShareUserRow = { id: string; name: string; color: string };

export function DealsTable({
  deals,
  stages,
  owners,
  tags,
  admin,
  shareUsers,
  sharedMap,
}: {
  deals: DealRow[];
  stages: { id: string; name: string; color: string }[];
  owners: { id: string; name: string }[];
  tags: TagView[];
  admin: boolean;
  shareUsers: ShareUserRow[];
  sharedMap: Record<string, string[]>;
}) {
  const stageById = new Map(stages.map((s) => [s.id, s]));

  return (
    <div className="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>SAL</TableHead>
            <TableHead>Title</TableHead>
            <TableHead>Client</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Tags</TableHead>
            <TableHead>Owner</TableHead>
            <TableHead>Due</TableHead>
            {admin && <TableHead className="text-right">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {deals.map((d) => {
            const stage = stageById.get(d.stageId);
            return (
              <TableRow
                key={d.id}
                className={cn(d.overdue && "bg-destructive/5 hover:bg-destructive/10")}
              >
                <TableCell className="font-mono text-xs text-muted-foreground">
                  <span className={cn(d.overdue && "border-l-2 border-l-destructive pl-1.5")}>
                    {d.salesId}
                  </span>
                </TableCell>
                <TableCell>
                  <Link href={`/deals/${d.salesId}`} className="font-medium hover:text-primary">
                    {d.title}
                  </Link>
                  {d.overdue && (
                    <span className="ml-2 rounded bg-destructive/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-destructive">
                      Overdue
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-sm">{d.clientName ?? "—"}</TableCell>

                {/* Stage — inline select */}
                <TableCell>
                  <InlineSelect
                    value={d.stageId}
                    options={stages.map((s) => ({ value: s.id, label: s.name }))}
                    onSave={(stageId) => quickUpdateDealAction(d.id, { stageId })}
                  />
                </TableCell>

                {/* Amount — click to edit number */}
                <TableCell className="tabular-nums text-sm">
                  <InlineInput
                    type="number"
                    align="right"
                    value={d.amountEur != null ? String(d.amountEur) : ""}
                    display={
                      <span className="tabular-nums">{formatCurrency(d.amountEur)}</span>
                    }
                    onSave={(raw) => {
                      const trimmed = raw.trim();
                      const amountEur = trimmed === "" ? null : Number(trimmed);
                      if (amountEur != null && !Number.isFinite(amountEur))
                        return Promise.resolve({ error: "Invalid amount." });
                      return quickUpdateDealAction(d.id, { amountEur });
                    }}
                  />
                </TableCell>

                {/* Tags — inline popover */}
                <TableCell>
                  <InlineTagEditor
                    allTags={tags}
                    value={d.tagIds}
                    onSave={(tagIds) => quickUpdateDealAction(d.id, { tagIds })}
                  />
                </TableCell>

                {/* Owner — admin only inline select */}
                <TableCell>
                  {admin ? (
                    <InlineSelect
                      value={d.ownerId ?? ""}
                      placeholder="Unassigned"
                      options={owners.map((o) => ({ value: o.id, label: o.name }))}
                      onSave={(ownerId) => quickUpdateDealAction(d.id, { ownerId: ownerId || null })}
                    />
                  ) : d.ownerName ? (
                    <Avatar name={d.ownerName} color={d.ownerColor} />
                  ) : (
                    "—"
                  )}
                </TableCell>

                {/* Due — click to edit date */}
                <TableCell className={cn("text-xs text-muted-foreground", d.overdue && "font-medium text-destructive")}>
                  <InlineInput
                    type="date"
                    value={d.dueDate ?? ""}
                    display={
                      d.dueDate ? (
                        <span className={cn(d.overdue && "font-medium text-destructive")}>{formatDate(d.dueDate)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )
                    }
                    onSave={(dueDate) => quickUpdateDealAction(d.id, { dueDate: dueDate || null })}
                  />
                </TableCell>

                {/* Inline share (admin) */}
                {admin && (
                  <TableCell className="text-right">
                    <ShareControl
                      dealId={d.id}
                      users={shareUsers.map((u) => ({
                        id: u.id,
                        name: u.name,
                        color: u.color,
                        shared: (sharedMap[d.id] ?? []).includes(u.id),
                      }))}
                      trigger={
                        <Button variant="ghost" size="icon" title="Share deal">
                          <Share2 className="h-4 w-4" />
                        </Button>
                      }
                    />
                  </TableCell>
                )}
              </TableRow>
            );
          })}
          {deals.length === 0 && (
            <TableRow>
              <TableCell colSpan={admin ? 9 : 8} className="py-10 text-center text-sm text-muted-foreground">
                No deals found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
