"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Pencil, Lock, ArrowUp, ArrowDown, ChevronsUpDown } from "lucide-react";
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

/** Clickable column header that cycles asc -> desc -> default via URL params. */
function SortHeader({
  label,
  sortKey,
  className,
}: {
  label: string;
  sortKey: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get("sort");
  const dir = params.get("dir") === "asc" ? "asc" : "desc";
  const active = current === sortKey;

  function toggle() {
    const sp = new URLSearchParams(Array.from(params.entries()));
    if (!active) {
      sp.set("sort", sortKey);
      sp.set("dir", "asc");
    } else if (dir === "asc") {
      sp.set("sort", sortKey);
      sp.set("dir", "desc");
    } else {
      sp.delete("sort");
      sp.delete("dir");
    }
    sp.delete("page");
    router.replace(`${pathname}?${sp.toString()}`);
  }

  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={toggle}
        className={cn("inline-flex w-full items-center gap-1 hover:text-foreground", active && "text-foreground")}
      >
        {label}
        {active ? (
          dir === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" />
        )}
      </button>
    </TableHead>
  );
}

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
            <SortHeader label="Contract number" sortKey="number" />
            <SortHeader label="Company" sortKey="company" />
            <SortHeader label="Client" sortKey="client" />
            <SortHeader label="Type" sortKey="type" />
            <SortHeader label="Frame" sortKey="frame" />
            <SortHeader label="Expires" sortKey="expires" />
            <TableHead>Comment</TableHead>
            <SortHeader label="Created by" sortKey="created" />
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
