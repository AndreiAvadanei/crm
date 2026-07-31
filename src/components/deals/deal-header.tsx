"use client";

import Link from "next/link";
import { Banknote, CalendarClock, ExternalLink } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { type TagView } from "@/components/shared/tag-badge";
import {
  InlineCombobox,
  InlineInput,
  InlineSelect,
  InlineTagEditor,
} from "@/components/shared/inline-edit";
import { quickUpdateDealAction } from "@/server/quick-actions";
import { quickCreateClientAction } from "@/server/client-actions";
import { formatCurrency, formatDate, cn } from "@/lib/utils";

type Props = {
  dealId: string;
  salesId: string;
  title: string;
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

function Cell({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="min-w-0 text-sm">{children}</div>
    </div>
  );
}

/** Deal properties (all inline-editable), stacked for the right sidebar. */
export function DealHeader({
  dealId,
  salesId,
  title,
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
      <CardContent className="space-y-4 p-4 md:p-5">
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-xs text-muted-foreground">{salesId}</span>
          <InlineSelect
            value={stageId}
            options={stages.map((s) => ({ value: s.id, label: s.name }))}
            className="font-medium"
            onSave={(next) => quickUpdateDealAction(dealId, { stageId: next })}
          />
        </div>

        <Cell label="Title">
          <InlineInput
            value={title}
            triggerClassName="font-semibold text-base"
            onSave={(next) => quickUpdateDealAction(dealId, { title: next })}
          />
        </Cell>

        <Cell label="Amount">
          <InlineInput
            value={amountEur != null ? String(amountEur) : ""}
            type="number"
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
        </Cell>

        <Cell label="Client">
          <div className="flex items-center gap-1.5">
            <InlineCombobox
              value={clientId ?? ""}
              placeholder="No client"
              align="start"
              options={clients.map((c) => ({ value: c.id, label: c.name }))}
              onSave={(next) => quickUpdateDealAction(dealId, { clientId: next })}
              createLabel="Create client"
              onCreate={async (name) => {
                const res = await quickCreateClientAction(name);
                if (res.error || !res.id) return { error: res.error ?? "Could not create client." };
                return quickUpdateDealAction(dealId, { clientId: res.id });
              }}
            />
            {clientId && (
              <Link
                href={`/clients/${clientId}`}
                title="Open client"
                className="shrink-0 text-muted-foreground hover:text-primary"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
        </Cell>

        <Cell label="Due date">
          <InlineInput
            value={dueDate ?? ""}
            type="date"
            display={
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock className="h-4 w-4 text-muted-foreground" />
                {dueDate ? formatDate(dueDate) : <span className="text-muted-foreground">Set date</span>}
              </span>
            }
            onSave={(next) => quickUpdateDealAction(dealId, { dueDate: next || null })}
          />
        </Cell>

        <Cell label="Owner">
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
        </Cell>

        <Cell label="Tags">
          <InlineTagEditor
            allTags={allTags}
            value={selectedTagIds}
            onSave={(ids) => quickUpdateDealAction(dealId, { tagIds: ids })}
          />
        </Cell>
      </CardContent>
    </Card>
  );
}
