"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogOpenTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { ClientCombobox } from "@/components/shared/client-combobox";
import {
  createContractNumberAction,
  updateContractNumberAction,
  getContractNumberForEditAction,
} from "@/server/contract-number-actions";

export type IssuerOption = { id: string; name: string };
export type OrgOption = { id: string; name: string };

// Sentinel used so a free-text client name (no linked organization) still shows
// as the selected value inside the organization combobox.
const FREE_TEXT = "__free_text__";

type FormState = {
  issuerId: string;
  number: string;
  organizationId: string;
  clientName: string;
  type: "IN" | "OUT";
  isFrameAgreement: boolean;
  expiresAt: string;
  comment: string;
};

const EMPTY: FormState = {
  issuerId: "",
  number: "",
  organizationId: "",
  clientName: "",
  type: "IN",
  isFrameAgreement: false,
  expiresAt: "",
  comment: "",
};

export function ContractNumberFormDialog({
  trigger,
  contractId,
  issuers,
  organizations,
}: {
  trigger: React.ReactNode;
  /** When provided the dialog edits that record (fields loaded on open). */
  contractId?: string;
  issuers: IssuerOption[];
  organizations: OrgOption[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const editing = !!contractId;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((s) => ({ ...s, [key]: value }));

  useEffect(() => {
    if (!open) {
      setReady(false);
      return;
    }
    if (!editing) {
      setForm({ ...EMPTY, issuerId: issuers.length === 1 ? issuers[0].id : "" });
      setReady(true);
      return;
    }
    let cancelled = false;
    setReady(false);
    getContractNumberForEditAction(contractId!).then((res) => {
      if (cancelled) return;
      if (res.error || !res.contract) {
        return toast({ title: res.error ?? "Load failed", variant: "error" });
      }
      setForm(res.contract);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  function onPickClient(next: { organizationId: string; clientName: string }) {
    setForm((s) => ({ ...s, ...next }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.issuerId) return toast({ title: "Select a company", variant: "error" });
    if (!form.number.trim()) return toast({ title: "Contract number is required", variant: "error" });
    if (!form.clientName.trim()) return toast({ title: "Client name is required", variant: "error" });
    setBusy(true);
    const fd = new FormData();
    fd.set("issuerId", form.issuerId);
    fd.set("number", form.number);
    fd.set("organizationId", form.organizationId);
    fd.set("clientName", form.clientName);
    fd.set("type", form.type);
    if (form.isFrameAgreement) fd.set("isFrameAgreement", "on");
    fd.set("expiresAt", form.expiresAt);
    fd.set("comment", form.comment);
    const res = editing
      ? await updateContractNumberAction(contractId!, fd)
      : await createContractNumberAction(fd);
    setBusy(false);
    if (res.error) return toast({ title: res.error, variant: "error" });
    toast({ title: editing ? "Contract number updated" : "Contract number created", variant: "success" });
    setOpen(false);
    router.refresh();
  }

  // Options for the organization combobox, injecting the current free-text name
  // (if any) so it renders as the selected value.
  const orgOptions = organizations.map((o) => ({ value: o.id, label: o.name, searchText: o.name }));
  const freeSelected = !form.organizationId && !!form.clientName;
  const comboOptions = freeSelected
    ? [{ value: FREE_TEXT, label: `${form.clientName} (free text)` }, ...orgOptions]
    : orgOptions;
  const comboValue = form.organizationId || (freeSelected ? FREE_TEXT : "");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogOpenTrigger trigger={trigger} onOpen={() => setOpen(true)} />
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit contract number" : "New contract number"}</DialogTitle>
          <DialogDescription>Track a contract number against one of our companies.</DialogDescription>
        </DialogHeader>

        {!ready ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label>Company *</Label>
              <ClientCombobox
                value={form.issuerId}
                options={issuers.map((i) => ({ value: i.id, label: i.name }))}
                onChange={(v) => set("issuerId", v)}
                placeholder="Select company"
                searchPlaceholder="Search companies…"
                emptyText="No companies found."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="number">Contract number *</Label>
              <Input
                id="number"
                value={form.number}
                onChange={(e) => set("number", e.target.value)}
                placeholder="e.g. CTR-2026-014"
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Client name *</Label>
              <ClientCombobox
                value={comboValue}
                options={comboOptions}
                onChange={(next) => {
                  if (next === "" || next === FREE_TEXT) {
                    if (next === "") onPickClient({ organizationId: "", clientName: "" });
                    return;
                  }
                  const org = organizations.find((o) => o.id === next);
                  onPickClient({ organizationId: next, clientName: org?.name ?? "" });
                }}
                onCreate={(name) => onPickClient({ organizationId: "", clientName: name })}
                createLabel="Use as free text"
                placeholder="Search organizations or type a name"
                searchPlaceholder="Search organizations…"
                emptyText="No organization found — type to use as free text."
                wrapLabels
              />
              <p className="text-xs text-muted-foreground">
                Pick an organization from the list, or type a name and choose “Use as free text”.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="type">Type *</Label>
                <select
                  id="type"
                  value={form.type}
                  onChange={(e) => set("type", e.target.value as "IN" | "OUT")}
                  className="form-control h-9 w-full px-3"
                >
                  <option value="IN">In (we are the client)</option>
                  <option value="OUT">Out (we issue to a customer)</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="expiresAt">Expires</Label>
                <Input
                  id="expiresAt"
                  type="date"
                  value={form.expiresAt}
                  onChange={(e) => set("expiresAt", e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                id="isFrameAgreement"
                type="checkbox"
                checked={form.isFrameAgreement}
                onChange={(e) => set("isFrameAgreement", e.target.checked)}
                className="h-4 w-4"
              />
              <Label htmlFor="isFrameAgreement">Frame agreement</Label>
            </div>

            <div className="space-y-2">
              <Label htmlFor="comment">Comment</Label>
              <Textarea
                id="comment"
                value={form.comment}
                onChange={(e) => set("comment", e.target.value)}
                placeholder="Short note to remember about this contract…"
              />
            </div>

            <DialogFooter>
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {editing ? "Save changes" : "Create contract number"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
