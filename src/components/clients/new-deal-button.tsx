"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DealFormDialog } from "@/components/deals/deal-form-dialog";
import type { TagView } from "@/components/shared/tag-badge";
import type { FieldDefView } from "@/components/shared/custom-field-inputs";

// Reusable trigger that opens the deal dialog pre-filled (and locked) for a
// specific client. Server pages pass the DealFormDialog data down to it.
export function NewDealButton({
  clientId,
  clientName,
  stages,
  clients,
  tags,
  fieldDefs,
  owners,
  isAdmin,
  defaultStageId,
  variant = "default",
}: {
  clientId: string;
  clientName?: string;
  stages: { id: string; name: string }[];
  clients: { id: string; name: string }[];
  tags: TagView[];
  fieldDefs: FieldDefView[];
  owners?: { id: string; name: string }[];
  isAdmin: boolean;
  defaultStageId?: string;
  // "default" = full button (page header); "icon" = compact per-row action.
  variant?: "default" | "icon";
}) {
  const label = clientName ? `New deal for ${clientName}` : "New deal";
  const trigger =
    variant === "icon" ? (
      <Button variant="ghost" size="icon" aria-label={label} title={label}>
        <Plus />
      </Button>
    ) : (
      <Button>
        <Plus /> New deal
      </Button>
    );

  return (
    <DealFormDialog
      isAdmin={isAdmin}
      stages={stages}
      clients={clients}
      tags={tags}
      fieldDefs={fieldDefs}
      owners={owners}
      defaultStageId={defaultStageId}
      defaultClientId={clientId}
      lockClient
      trigger={trigger}
    />
  );
}
