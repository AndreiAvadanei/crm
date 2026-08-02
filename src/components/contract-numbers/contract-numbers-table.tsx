"use client";

import { Pencil, Lock } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DeleteButton } from "@/components/shared/delete-button";
import {
  ContractNumberFormDialog,
  type IssuerOption,
  type OrgOption,
} from "@/components/contract-numbers/contract-number-form-dialog";
import { deleteContractNumberAction } from "@/server/contract-number-actions";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { ContractNumberRow } from "@/lib/contract-number-stats";

export function ContractNumbersTable({
  contractNumbers,
  issuers,
  organizations,
}: {
  contractNumbers: ContractNumberRow[];
  issuers: IssuerOption[];
  organizations: OrgOption[];
}) {
  const now = Date.now();
  return (
    <div className="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Contract number</TableHead>
            <TableHead>Company</TableHead>
            <TableHead>Client</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Frame</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead>Comment</TableHead>
            <TableHead>Created by</TableHead>
            <TableHead className="w-px text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {contractNumbers.map((c) => {
            const expired = c.expiresAt ? new Date(c.expiresAt).getTime() < now : false;
            return (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.number}</TableCell>
                <TableCell className="text-sm">{c.issuerName}</TableCell>
                {c.canManage ? (
                  <>
                    <TableCell className="text-sm">{c.clientName || "—"}</TableCell>
                    <TableCell>
                      {c.type ? (
                        <Badge variant={c.type === "OUT" ? "default" : "secondary"}>
                          {c.type === "OUT" ? "Out" : "In"}
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      {c.isFrameAgreement ? <Badge variant="outline">Frame</Badge> : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className={cn("text-sm", expired && "text-destructive")}>
                      {c.expiresAt ? formatDate(c.expiresAt) : "—"}
                    </TableCell>
                    <TableCell className="max-w-[16rem] truncate text-sm text-muted-foreground" title={c.comment ?? undefined}>
                      {c.comment || "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{c.createdByName ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <ContractNumberFormDialog
                          contractId={c.id}
                          issuers={issuers}
                          organizations={organizations}
                          trigger={
                            <Button variant="ghost" size="icon" aria-label="Edit contract number">
                              <Pencil className="h-4 w-4" />
                            </Button>
                          }
                        />
                        <DeleteButton
                          iconOnly
                          onDelete={deleteContractNumberAction.bind(null, c.id)}
                          title="Delete contract number?"
                          description="This action cannot be undone."
                        />
                      </div>
                    </TableCell>
                  </>
                ) : (
                  <>
                    <TableCell colSpan={6} className="text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <Lock className="h-3.5 w-3.5" /> Private — created by {c.createdByName ?? "another user"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">—</TableCell>
                  </>
                )}
              </TableRow>
            );
          })}
          {contractNumbers.length === 0 && (
            <TableRow>
              <TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                No contract numbers found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
