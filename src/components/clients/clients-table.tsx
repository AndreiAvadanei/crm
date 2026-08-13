"use client";

import Link from "next/link";
import { quickUpdateClientAction } from "@/server/quick-actions";
import { Avatar } from "@/components/ui/avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { TagView } from "@/components/shared/tag-badge";
import type { FieldDefView } from "@/components/shared/custom-field-inputs";
import { InlineInput, InlineSelect, InlineTagEditor } from "@/components/shared/inline-edit";
import { DealBreakdownCell, ActivityCell } from "@/components/clients/client-stats-cells";
import { NewDealButton } from "@/components/clients/new-deal-button";
import type { ClientStats } from "@/lib/client-stats";
import { TableEmpty } from "@/components/shared/empty-state";
import { formatDate } from "@/lib/utils";
import { Building2 } from "lucide-react";

export type ClientRow = {
  id: string;
  name: string;
  website: string | null;
  contactName: string | null;
  contactEmail: string | null;
  country: string | null;
  ownerId: string | null;
  ownerName: string | null;
  ownerColor: string | null;
  tagIds: string[];
  stats: ClientStats;
  createdAt: string;
};

export function ClientsTable({
  clients,
  owners,
  tags,
  admin,
  dealForm,
}: {
  clients: ClientRow[];
  owners: { id: string; name: string }[];
  tags: TagView[];
  admin: boolean;
  // Data for the per-row quick "New deal" action (omit to hide it).
  dealForm?: {
    stages: { id: string; name: string }[];
    clients: { id: string; name: string }[];
    fieldDefs: FieldDefView[];
    defaultStageId?: string;
  };
}) {
  return (
    <div className="surface-panel">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Company</TableHead>
            <TableHead>Contact</TableHead>
            <TableHead>Country</TableHead>
            <TableHead>Tags</TableHead>
            <TableHead>Deals</TableHead>
            <TableHead>Activity</TableHead>
            <TableHead>Owner</TableHead>
            <TableHead>Added</TableHead>
            {dealForm && <TableHead className="w-px text-right">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {clients.map((c) => (
            <TableRow key={c.id}>
              <TableCell>
                <Link href={`/clients/${c.id}`} className="font-medium hover:text-primary">
                  {c.name}
                </Link>
                {c.website && <div className="text-xs text-muted-foreground">{c.website}</div>}
              </TableCell>

              {/* Contact name — inline editable */}
              <TableCell>
                <InlineInput
                  value={c.contactName ?? ""}
                  placeholder="Add contact"
                  onSave={(contactName) => quickUpdateClientAction(c.id, { contactName })}
                />
                {c.contactEmail && <div className="px-1.5 text-xs text-muted-foreground">{c.contactEmail}</div>}
              </TableCell>

              {/* Country — inline editable */}
              <TableCell className="text-sm">
                <InlineInput
                  value={c.country ?? ""}
                  placeholder="Add country"
                  onSave={(country) => quickUpdateClientAction(c.id, { country })}
                />
              </TableCell>

              {/* Tags — inline popover */}
              <TableCell>
                <InlineTagEditor
                  allTags={tags}
                  value={c.tagIds}
                  onSave={(tagIds) => quickUpdateClientAction(c.id, { tagIds })}
                />
              </TableCell>

              <TableCell>
                <DealBreakdownCell stats={c.stats} />
              </TableCell>
              <TableCell>
                <ActivityCell stats={c.stats} />
              </TableCell>

              {/* Owner — admin only inline select */}
              <TableCell>
                {admin ? (
                  <InlineSelect
                    value={c.ownerId ?? ""}
                    placeholder="Unassigned"
                    options={owners.map((o) => ({ value: o.id, label: o.name }))}
                    onSave={(ownerId) => quickUpdateClientAction(c.id, { ownerId: ownerId || null })}
                  />
                ) : c.ownerName ? (
                  <Avatar name={c.ownerName} color={c.ownerColor} />
                ) : (
                  "—"
                )}
              </TableCell>

              <TableCell className="text-xs text-muted-foreground">{formatDate(c.createdAt)}</TableCell>

              {dealForm && (
                <TableCell className="text-right">
                  <NewDealButton
                    clientId={c.id}
                    clientName={c.name}
                    stages={dealForm.stages}
                    clients={dealForm.clients}
                    tags={tags}
                    fieldDefs={dealForm.fieldDefs}
                    owners={owners}
                    isAdmin={admin}
                    defaultStageId={dealForm.defaultStageId}
                    variant="icon"
                  />
                </TableCell>
              )}
            </TableRow>
          ))}
          {clients.length === 0 && (
            <TableEmpty
              colSpan={dealForm ? 9 : 8}
              icon={Building2}
              title="No clients found"
              description="Try a different search or clear filters to see everyone in your workspace."
            />
          )}
        </TableBody>
      </Table>
    </div>
  );
}
