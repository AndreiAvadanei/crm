"use client";

import Link from "next/link";
import { Plus, Pencil } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DeleteButton } from "@/components/shared/delete-button";
import { OrgFormDialog, type OrgData } from "@/components/organizations/org-form-dialog";
import { deleteOrganizationAction } from "@/server/organization-actions";
import { formatPercent } from "@/lib/utils";

export type ClientOrg = OrgData & { invoiceCount: number };

export function ClientOrganizationsCard({
  client,
  organizations,
  canManage,
  defaultTvaPercent,
}: {
  client: { id: string; name: string };
  organizations: ClientOrg[];
  canManage: boolean;
  defaultTvaPercent: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Billing organizations ({organizations.length})</CardTitle>
        {canManage && (
          <OrgFormDialog
            fixedClient={client}
            defaultTvaPercent={defaultTvaPercent}
            trigger={
              <Button variant="ghost" size="icon" aria-label="Add organization">
                <Plus className="h-4 w-4" />
              </Button>
            }
          />
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {organizations.map((o) => (
          <div key={o.id} className="flex items-start justify-between gap-3 rounded-lg border px-3 py-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium">{o.sourceName}</span>
                {o.isDefault && <Badge variant="secondary">Default</Badge>}
              </div>
              <div className="text-xs text-muted-foreground">
                {o.taxId ? `CUI ${o.taxId}` : "No tax id"}
                {o.country ? ` · ${o.country}` : ""}
                {` · TVA ${formatPercent(o.tvaPercent)}`}
              </div>
              {o.iban && <div className="font-mono text-xs text-muted-foreground">{o.iban}</div>}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Link
                href={`/invoices?organization=${o.id}`}
                className="px-1 text-xs text-muted-foreground hover:text-primary"
              >
                {o.invoiceCount} inv.
              </Link>
              {canManage && (
                <>
                  <OrgFormDialog
                    organization={o}
                    fixedClient={client}
                    defaultTvaPercent={defaultTvaPercent}
                    trigger={
                      <Button variant="ghost" size="icon" aria-label="Edit organization">
                        <Pencil className="h-4 w-4" />
                      </Button>
                    }
                  />
                  <DeleteButton
                    iconOnly
                    onDelete={deleteOrganizationAction.bind(null, o.id)}
                    title="Delete organization?"
                    description="Only allowed when no invoices reference it."
                  />
                </>
              )}
            </div>
          </div>
        ))}
        {organizations.length === 0 && <p className="text-sm text-muted-foreground">No billing organizations yet.</p>}
      </CardContent>
    </Card>
  );
}
