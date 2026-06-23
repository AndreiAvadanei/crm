"use client";

import Link from "next/link";
import { Banknote, CalendarClock, ExternalLink } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { type TagView } from "@/components/shared/tag-badge";
import {
  InlineInput,
  InlineSelect,
  InlineTagEditor,
  InlineTextarea,
} from "@/components/shared/inline-edit";
import { quickUpdateDealAction } from "@/server/quick-actions";
import { formatCurrency, formatDate } from "@/lib/utils";

type Props = {
  dealId: string;
  salesId: string;
  title: string;
  description: string | null;
  stageId: string;
  stages: { id: string; name: string }[];
  amountEur: number | null;
  clientId: string | null;
  clients: { id: string; name: string }[];
  dueDate: string | null; // yyyy-mm-dd
  ownerId: string | null;
  owner: { name: string; color: string | null } | null;
  owners: { id: string; name: string }[];
  selectedTagIds: string[];
  allTags: TagView[];
  isAdmin: boolean;
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="pt-1 text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1 text-right">{children}</div>
    </div>
  );
}

export function DealInlineSettings({
  dealId,
  salesId,
  title,
  description,
  stageId,
  stages,
  amountEur,
  clientId,
  clients,
  dueDate,
  ownerId,
  owner,
  owners,
  selectedTagIds,
  allTags,
  isAdmin,
}: Props) {
  return (
    <Card>
      <CardContent className="space-y-3 pt-6 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-xs text-muted-foreground">{salesId}</span>
          <InlineSelect
            value={stageId}
            options={stages.map((s) => ({ value: s.id, label: s.name }))}
            onSave={(next) => quickUpdateDealAction(dealId, { stageId: next })}
          />
        </div>

        <Row label="Title">
          <InlineInput
            value={title}
            align="right"
            triggerClassName="font-semibold"
            onSave={(next) => quickUpdateDealAction(dealId, { title: next })}
          />
        </Row>

        <Row label="Amount">
          <InlineInput
            value={amountEur != null ? String(amountEur) : ""}
            type="number"
            align="right"
            display={
              <span className="inline-flex items-center gap-1.5 font-medium">
                <Banknote className="h-4 w-4 text-muted-foreground" />
                {formatCurrency(amountEur)}
              </span>
            }
            onSave={(next) => {
              const n = next.trim() === "" ? null : Number(next.replace(/,/g, ""));
              if (n !== null && !Number.isFinite(n)) {
                return Promise.resolve({ error: "Invalid amount." });
              }
              return quickUpdateDealAction(dealId, { amountEur: n });
            }}
          />
        </Row>

        <Row label="Client">
          <div className="flex items-center justify-end gap-1.5">
            {clientId && (
              <Link
                href={`/clients/${clientId}`}
                title="Open client"
                className="text-muted-foreground hover:text-primary"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            )}
            <InlineSelect
              value={clientId ?? ""}
              placeholder="No client"
              options={clients.map((c) => ({ value: c.id, label: c.name }))}
              onSave={(next) => quickUpdateDealAction(dealId, { clientId: next })}
            />
          </div>
        </Row>

        <Row label="Due date">
          <InlineInput
            value={dueDate ?? ""}
            type="date"
            align="right"
            display={
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock className="h-4 w-4 text-muted-foreground" />
                {dueDate ? formatDate(dueDate) : <span className="text-muted-foreground">Set date</span>}
              </span>
            }
            onSave={(next) => quickUpdateDealAction(dealId, { dueDate: next || null })}
          />
        </Row>

        <Row label="Owner">
          {isAdmin ? (
            <InlineSelect
              value={ownerId ?? ""}
              placeholder="Unassigned"
              options={owners.map((o) => ({ value: o.id, label: o.name }))}
              onSave={(next) => quickUpdateDealAction(dealId, { ownerId: next || null })}
            />
          ) : owner ? (
            <span className="inline-flex items-center gap-1.5">
              <Avatar name={owner.name} color={owner.color} className="h-6 w-6 text-[10px]" />
              {owner.name}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </Row>

        <Row label="Tags">
          <InlineTagEditor
            allTags={allTags}
            value={selectedTagIds}
            onSave={(ids) => quickUpdateDealAction(dealId, { tagIds: ids })}
          />
        </Row>

        <div className="space-y-1 border-t pt-3">
          <span className="text-muted-foreground">Description</span>
          <InlineTextarea
            value={description ?? ""}
            placeholder="Add a description…"
            onSave={(next) => quickUpdateDealAction(dealId, { description: next || null })}
          />
        </div>
      </CardContent>
    </Card>
  );
}
