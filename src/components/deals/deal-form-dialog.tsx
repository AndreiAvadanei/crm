"use client";

import { cloneElement, isValidElement, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { TagPicker } from "@/components/shared/tag-picker";
import { ClientCombobox } from "@/components/shared/client-combobox";
import { CustomFieldInputs, type FieldDefView } from "@/components/shared/custom-field-inputs";
import type { TagView } from "@/components/shared/tag-badge";
import { createDealAction, updateDealAction } from "@/server/deal-actions";
import { quickCreateClientAction } from "@/server/client-actions";

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

type TriggerProps = {
  onClick?: React.MouseEventHandler<HTMLElement>;
  type?: "button" | "submit" | "reset";
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
  const [clientId, setClientId] = useState(deal?.clientId ?? defaultClientId ?? "");
  // Clients created on the fly via the combobox "create" row, so they show as
  // selectable options immediately (before the page revalidates).
  const [extraClients, setExtraClients] = useState<{ id: string; name: string }[]>([]);
  const editing = !!deal;
  const locked = !editing && !!lockClient && !!defaultClientId;
  const triggerEl = isValidElement<TriggerProps>(trigger)
    ? cloneElement(trigger, {
        type: trigger.props.type ?? "button",
        onClick: (e) => {
          trigger.props.onClick?.(e);
          if (!e.defaultPrevented) setOpen(true);
        },
      })
    : (
        <span className="inline-flex" onClick={() => setOpen(true)}>
          {trigger}
        </span>
      );

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
      {triggerEl}
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
                <>
                  <ClientCombobox
                    value={clientId}
                    onChange={setClientId}
                    options={[...extraClients, ...clients].map((c) => ({ value: c.id, label: c.name }))}
                    placeholder="No client"
                    disabled={locked}
                    createLabel="Create client"
                    onCreate={async (name) => {
                      const res = await quickCreateClientAction(name);
                      if (res.error || !res.id) {
                        return toast({ title: res.error ?? "Could not create client.", variant: "error" });
                      }
                      setExtraClients((prev) => [{ id: res.id!, name: res.name ?? name }, ...prev]);
                      setClientId(res.id);
                    }}
                  />
                  {/* The combobox is not a form control, so submit via hidden input. */}
                  <input type="hidden" name="clientId" value={clientId} />
                </>
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
