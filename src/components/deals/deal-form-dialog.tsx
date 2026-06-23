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
import { TagPicker } from "@/components/shared/tag-picker";
import { CustomFieldInputs, type FieldDefView } from "@/components/shared/custom-field-inputs";
import type { TagView } from "@/components/shared/tag-badge";
import { createDealAction, updateDealAction } from "@/server/deal-actions";

type DealData = {
  id: string;
  title: string;
  description: string | null;
  amountEur: number | null;
  clientId: string | null;
  stageId: string;
  ownerId: string | null;
  dueDate: string | null;
  tagIds: string[];
};

export function DealFormDialog({
  trigger,
  deal,
  stages,
  clients,
  tags,
  fieldDefs,
  fieldValues,
  owners,
  isAdmin,
  defaultStageId,
  defaultClientId,
  lockClient,
}: {
  trigger: React.ReactNode;
  deal?: DealData;
  stages: { id: string; name: string }[];
  clients: { id: string; name: string }[];
  tags: TagView[];
  fieldDefs: FieldDefView[];
  fieldValues?: Record<string, unknown>;
  owners?: { id: string; name: string }[];
  isAdmin: boolean;
  defaultStageId?: string;
  // When creating a new deal, pre-select this client in the client picker.
  defaultClientId?: string;
  // When true (and creating new), lock the picker to defaultClientId.
  lockClient?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newClient, setNewClient] = useState(false);
  const editing = !!deal;
  const locked = !editing && !!lockClient && !!defaultClientId;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formRef.current) return;
    setBusy(true);
    const fd = new FormData(formRef.current);
    const res = editing ? await updateDealAction(deal!.id, fd) : await createDealAction(fd);
    setBusy(false);
    if (res.error) return toast({ title: res.error, variant: "error" });
    toast({ title: editing ? "Deal updated" : `Deal created (${res.salesId})`, variant: "success" });
    setOpen(false);
    router.refresh();
    if (!editing && res.salesId) router.push(`/deals/${res.salesId}`);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit deal" : "New deal"}</DialogTitle>
          <DialogDescription>A unique SAL id is assigned automatically.</DialogDescription>
        </DialogHeader>
        <form ref={formRef} onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title *</Label>
            <Input id="title" name="title" defaultValue={deal?.title ?? ""} required />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="stageId">Stage</Label>
              <select
                id="stageId"
                name="stageId"
                defaultValue={deal?.stageId ?? defaultStageId ?? stages[0]?.id}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="clientId">Client</Label>
                {!locked && (
                  <button
                    type="button"
                    onClick={() => setNewClient((v) => !v)}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    {newClient ? "Pick existing" : "+ New customer"}
                  </button>
                )}
              </div>
              {newClient ? (
                <div className="space-y-2 rounded-md border border-dashed border-input p-3">
                  <Input name="newClientName" placeholder="Company name *" required={newClient} autoFocus />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input name="newClientContactName" placeholder="Contact name (optional)" />
                    <Input name="newClientContactEmail" type="email" placeholder="Contact email (optional)" />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    A new customer is created and linked to this deal.
                  </p>
                </div>
              ) : (
                <select
                  id="clientId"
                  name="clientId"
                  defaultValue={deal?.clientId ?? defaultClientId ?? ""}
                  disabled={locked}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-70"
                >
                  <option value="">No client</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
              {/* A disabled select submits no value, so mirror it as hidden. */}
              {locked && !newClient && (
                <input type="hidden" name="clientId" value={defaultClientId} />
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="amountEur">Amount (EUR)</Label>
              <Input
                id="amountEur"
                name="amountEur"
                type="number"
                step="any"
                defaultValue={deal?.amountEur ?? ""}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dueDate">Due date</Label>
              <Input id="dueDate" name="dueDate" type="date" defaultValue={deal?.dueDate?.slice(0, 10) ?? ""} />
            </div>
            {isAdmin && owners && (
              <div className="space-y-2">
                <Label htmlFor="ownerId">Owner</Label>
                <select
                  id="ownerId"
                  name="ownerId"
                  defaultValue={deal?.ownerId ?? ""}
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
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" name="description" defaultValue={deal?.description ?? ""} />
          </div>

          <div className="space-y-2">
            <Label>Tags</Label>
            <TagPicker tags={tags} defaultSelected={deal?.tagIds ?? []} />
          </div>

          <CustomFieldInputs defs={fieldDefs} values={fieldValues} />

          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? "Save changes" : "Create deal"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
