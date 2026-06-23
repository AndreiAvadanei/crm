"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { ClientCombobox } from "@/components/shared/client-combobox";
import { createOrganizationAction, updateOrganizationAction } from "@/server/organization-actions";

export type OrgData = {
  id: string;
  sourceName: string;
  legalName: string | null;
  country: string | null;
  taxId: string | null;
  regNumber: string | null;
  bankName: string | null;
  iban: string | null;
  address: string | null;
  isDefault: boolean;
  clientId: string;
};

export function OrgFormDialog({
  trigger,
  organization,
  clients,
  fixedClient,
}: {
  trigger: React.ReactNode;
  organization?: OrgData;
  /** Selectable clients for the picker (omit when fixedClient is provided). */
  clients?: { id: string; name: string }[];
  /** Lock the org to a specific client (e.g. when adding from a client page). */
  fixedClient?: { id: string; name: string };
}) {
  const router = useRouter();
  const { toast } = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [clientId, setClientId] = useState(organization?.clientId ?? fixedClient?.id ?? "");
  const editing = !!organization;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formRef.current) return;
    if (!clientId) return toast({ title: "Select a client", variant: "error" });
    setBusy(true);
    const fd = new FormData(formRef.current);
    fd.set("clientId", clientId);
    const res = editing ? await updateOrganizationAction(organization!.id, fd) : await createOrganizationAction(fd);
    setBusy(false);
    if (res.error) return toast({ title: res.error, variant: "error" });
    toast({ title: editing ? "Organization updated" : "Organization created", variant: "success" });
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit organization" : "New organization"}</DialogTitle>
          <DialogDescription>Billing legal entity (CUI, registration, bank).</DialogDescription>
        </DialogHeader>
        <form ref={formRef} onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>Client *</Label>
              {fixedClient ? (
                <Input value={fixedClient.name} disabled />
              ) : (
                <ClientCombobox
                  value={clientId}
                  options={(clients ?? []).map((c) => ({ value: c.id, label: c.name }))}
                  onChange={setClientId}
                  placeholder="Select client"
                />
              )}
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="sourceName">Organization name *</Label>
              <Input id="sourceName" name="sourceName" defaultValue={organization?.sourceName ?? ""} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="legalName">Legal name</Label>
              <Input id="legalName" name="legalName" defaultValue={organization?.legalName ?? ""} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="country">Country</Label>
              <Input id="country" name="country" defaultValue={organization?.country ?? ""} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="taxId">Tax id (CUI / VAT)</Label>
              <Input id="taxId" name="taxId" defaultValue={organization?.taxId ?? ""} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="regNumber">Reg. number (J)</Label>
              <Input id="regNumber" name="regNumber" defaultValue={organization?.regNumber ?? ""} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bankName">Bank</Label>
              <Input id="bankName" name="bankName" defaultValue={organization?.bankName ?? ""} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="iban">IBAN</Label>
              <Input id="iban" name="iban" defaultValue={organization?.iban ?? ""} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="address">Address</Label>
              <Textarea id="address" name="address" defaultValue={organization?.address ?? ""} />
            </div>
            <div className="flex items-center gap-2 sm:col-span-2">
              <input
                id="isDefault"
                name="isDefault"
                type="checkbox"
                defaultChecked={organization?.isDefault ?? false}
                className="h-4 w-4"
              />
              <Label htmlFor="isDefault">Default billing entity for this client</Label>
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? "Save changes" : "Create organization"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
