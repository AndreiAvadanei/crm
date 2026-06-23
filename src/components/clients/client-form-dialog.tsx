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
import { useToast } from "@/components/ui/toast";
import { TagPicker } from "@/components/shared/tag-picker";
import { CustomFieldInputs, type FieldDefView } from "@/components/shared/custom-field-inputs";
import type { TagView } from "@/components/shared/tag-badge";
import { createClientAction, updateClientAction } from "@/server/client-actions";

type ClientData = {
  id: string;
  name: string;
  website: string | null;
  country: string | null;
  size: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  ownerId: string | null;
  tagIds: string[];
};

export function ClientFormDialog({
  trigger,
  client,
  tags,
  fieldDefs,
  fieldValues,
  owners,
  isAdmin,
}: {
  trigger: React.ReactNode;
  client?: ClientData;
  tags: TagView[];
  fieldDefs: FieldDefView[];
  fieldValues?: Record<string, unknown>;
  owners?: { id: string; name: string }[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const editing = !!client;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formRef.current) return;
    setBusy(true);
    const fd = new FormData(formRef.current);
    const res = editing ? await updateClientAction(client!.id, fd) : await createClientAction(fd);
    setBusy(false);
    if (res.error) return toast({ title: res.error, variant: "error" });
    toast({ title: editing ? "Client updated" : "Client created", variant: "success" });
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit client" : "New client"}</DialogTitle>
          <DialogDescription>Company and primary contact details.</DialogDescription>
        </DialogHeader>
        <form ref={formRef} onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="name">Company name *</Label>
              <Input id="name" name="name" defaultValue={client?.name ?? ""} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="website">Website</Label>
              <Input id="website" name="website" defaultValue={client?.website ?? ""} placeholder="https://" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="country">Country</Label>
              <Input id="country" name="country" defaultValue={client?.country ?? ""} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="size">Company size</Label>
              <Input id="size" name="size" defaultValue={client?.size ?? ""} placeholder="1-10, 11-50…" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contactName">Contact name</Label>
              <Input id="contactName" name="contactName" defaultValue={client?.contactName ?? ""} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contactEmail">Contact email</Label>
              <Input id="contactEmail" name="contactEmail" type="email" defaultValue={client?.contactEmail ?? ""} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contactPhone">Contact phone</Label>
              <Input id="contactPhone" name="contactPhone" defaultValue={client?.contactPhone ?? ""} />
            </div>
            {isAdmin && owners && (
              <div className="space-y-2">
                <Label htmlFor="ownerId">Owner</Label>
                <select
                  id="ownerId"
                  name="ownerId"
                  defaultValue={client?.ownerId ?? ""}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Unassigned</option>
                  {owners.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Tags</Label>
            <TagPicker tags={tags} defaultSelected={client?.tagIds ?? []} />
          </div>

          <CustomFieldInputs defs={fieldDefs} values={fieldValues} />

          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? "Save changes" : "Create client"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
