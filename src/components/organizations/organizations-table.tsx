"use client";

import Link from "next/link";
import { Pencil } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DeleteButton } from "@/components/shared/delete-button";
import { OrgFormDialog, type OrgData } from "@/components/organizations/org-form-dialog";
import { deleteOrganizationAction } from "@/server/organization-actions";
import type { OrganizationRow } from "@/lib/organization-stats";

export function OrganizationsTable({
  organizations,
  clients,
  canManage,
}: {
  organizations: OrganizationRow[];
  clients: { id: string; name: string }[];
  canManage: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Organization</TableHead>
            <TableHead>Client</TableHead>
            <TableHead>Tax id</TableHead>
            <TableHead>Country</TableHead>
            <TableHead>IBAN</TableHead>
            <TableHead className="text-right">Invoices</TableHead>
            {canManage && <TableHead className="w-px text-right">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {organizations.map((o) => {
            const orgData: OrgData = {
              id: o.id,
              sourceName: o.sourceName,
              legalName: o.legalName,
              country: o.country,
              taxId: o.taxId,
              regNumber: o.regNumber,
              bankName: o.bankName,
              iban: o.iban,
              address: o.address,
              isDefault: o.isDefault,
              clientId: o.clientId,
            };
            return (
              <TableRow key={o.id}>
                <TableCell>
                  <div className="font-medium">{o.sourceName}</div>
                  {o.isDefault && <Badge variant="secondary" className="mt-1">Default</Badge>}
                </TableCell>
                <TableCell>
                  <Link href={`/clients/${o.clientId}`} className="hover:text-primary">
                    {o.clientName}
                  </Link>
                </TableCell>
                <TableCell className="text-sm">{o.taxId ?? "—"}</TableCell>
                <TableCell className="text-sm">{o.country ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs">{o.iban ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">
                  <Link href={`/invoices?organization=${o.id}`} className="hover:text-primary">
                    {o.invoiceCount}
                  </Link>
                </TableCell>
                {canManage && (
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <OrgFormDialog
                        organization={orgData}
                        clients={clients}
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
                    </div>
                  </TableCell>
                )}
              </TableRow>
            );
          })}
          {organizations.length === 0 && (
            <TableRow>
              <TableCell colSpan={canManage ? 7 : 6} className="py-10 text-center text-sm text-muted-foreground">
                No organizations found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
