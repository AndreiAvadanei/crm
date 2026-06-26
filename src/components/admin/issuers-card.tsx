"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { ClientCombobox } from "@/components/shared/client-combobox";
import { COUNTRIES, RO_COUNTIES, ROMANIA, DEFAULT_COUNTY, countryCodeForName, isRomania, normalizeCountryValue } from "@/lib/ro-geo";
import { createIssuerAction, updateIssuerAction, deleteIssuerAction } from "@/server/issuer-actions";

export type IssuerData = {
  id: string;
  name: string;
  legalName: string | null;
  taxId: string | null;
  regCom: string | null;
  country: string | null;
  county: string | null;
  city: string | null;
  address: string | null;
  bankName: string | null;
  iban: string | null;
  phone: string | null;
  email: string | null;
  capital: string | null;
  infSupl: string | null;
  isActive: boolean;
  isDefault: boolean;
};

type FormState = {
  name: string;
  legalName: string;
  taxId: string;
  regCom: string;
  country: string;
  county: string;
  city: string;
  address: string;
  bankName: string;
  iban: string;
  phone: string;
  email: string;
  capital: string;
  infSupl: string;
  isActive: boolean;
  isDefault: boolean;
};

function toForm(issuer?: IssuerData): FormState {
  return {
    name: issuer?.name ?? "",
    legalName: issuer?.legalName ?? "",
    taxId: issuer?.taxId ?? "",
    regCom: issuer?.regCom ?? "",
    country: issuer?.country ?? ROMANIA,
    county: issuer?.county ?? DEFAULT_COUNTY,
    city: issuer?.city ?? "",
    address: issuer?.address ?? "",
    bankName: issuer?.bankName ?? "",
    iban: issuer?.iban ?? "",
    phone: issuer?.phone ?? "",
    email: issuer?.email ?? "",
    capital: issuer?.capital ?? "",
    infSupl: issuer?.infSupl ?? "",
    isActive: issuer?.isActive ?? true,
    isDefault: issuer?.isDefault ?? false,
  };
}

export function IssuersManager({ issuers }: { issuers: IssuerData[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  async function onDelete(issuer: IssuerData) {
    if (!confirm(`Delete issuer "${issuer.name}"? Linked invoices keep their issuer name but are unlinked.`)) return;
    setDeletingId(issuer.id);
    const res = await deleteIssuerAction(issuer.id);
    setDeletingId(null);
    if (res.error) return toast({ title: res.error, variant: "error" });
    toast({ title: "Issuer deleted", variant: "success" });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Entities you issue invoices from. Available in the new-invoice wizard and as an invoice filter.
        </p>
        <IssuerFormDialog
          trigger={
            <Button size="sm">
              <Plus className="h-4 w-4" /> Add issuer
            </Button>
          }
        />
      </div>

      {issuers.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No issuers yet. Add one to use it on invoices.
        </p>
      ) : (
        <div className="divide-y rounded-md border">
          {issuers.map((issuer) => (
            <div key={issuer.id} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{issuer.name}</span>
                  {issuer.isDefault && <Badge variant="success">Default</Badge>}
                  {!issuer.isActive && <Badge variant="secondary">Inactive</Badge>}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {[issuer.taxId, issuer.regCom, issuer.city || issuer.county].filter(Boolean).join(" · ") || "No tax details"}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <IssuerFormDialog
                  issuer={issuer}
                  trigger={
                    <Button variant="ghost" size="icon" aria-label="Edit issuer">
                      <Pencil className="h-4 w-4" />
                    </Button>
                  }
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Delete issuer"
                  disabled={deletingId === issuer.id}
                  onClick={() => onDelete(issuer)}
                >
                  {deletingId === issuer.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function IssuerFormDialog({ trigger, issuer }: { trigger: React.ReactNode; issuer?: IssuerData }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [form, setForm] = React.useState<FormState>(toForm(issuer));
  const editing = !!issuer;

  React.useEffect(() => {
    if (open) setForm(toForm(issuer));
  }, [open, issuer]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((s) => ({ ...s, [key]: value }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return toast({ title: "Issuer name is required", variant: "error" });
    setBusy(true);
    const fd = new FormData();
    for (const [k, v] of Object.entries(form)) {
      if (typeof v === "boolean") {
        if (v) fd.set(k, "on");
      } else {
        fd.set(k, v);
      }
    }
    const res = editing ? await updateIssuerAction(issuer!.id, fd) : await createIssuerAction(fd);
    setBusy(false);
    if (res.error) return toast({ title: res.error, variant: "error" });
    toast({ title: editing ? "Issuer updated" : "Issuer created", variant: "success" });
    setOpen(false);
    router.refresh();
  }

  const ro = isRomania(form.country);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit issuer" : "New issuer"}</DialogTitle>
          <DialogDescription>Seller legal entity used when issuing invoices.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="issuer-name">Name *</Label>
              <Input id="issuer-name" value={form.name} onChange={(e) => set("name", e.target.value)} required placeholder="BIT SENTINEL SECURITY SRL" />
            </div>
            <Field label="Legal name" value={form.legalName} onChange={(v) => set("legalName", v)} />
            <Field label="Tax id (CUI / VAT)" value={form.taxId} onChange={(v) => set("taxId", v)} />
            <Field label="Reg. com. (J)" value={form.regCom} onChange={(v) => set("regCom", v)} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Country</Label>
              <ClientCombobox
                value={form.country}
                options={COUNTRIES.map((c) => ({ value: c, label: c, searchText: countryCodeForName(c) }))}
                onChange={(v) => set("country", normalizeCountryValue(v) || ROMANIA)}
                placeholder="Select country"
                searchPlaceholder="Search country…"
                emptyText="No country found."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="issuer-county">County (județ)</Label>
              {ro ? (
                <ClientCombobox
                  value={form.county}
                  options={RO_COUNTIES.map((c) => ({ value: c, label: c }))}
                  onChange={(v) => set("county", v)}
                  placeholder="Select county"
                  searchPlaceholder="Search county…"
                  emptyText="No county found."
                />
              ) : (
                <Input id="issuer-county" value={form.county} onChange={(e) => set("county", e.target.value)} />
              )}
            </div>
            <Field label="City" value={form.city} onChange={(v) => set("city", v)} />
            <div className="space-y-2">
              <Label htmlFor="issuer-address">Address</Label>
              <Textarea id="issuer-address" value={form.address} onChange={(e) => set("address", e.target.value)} rows={2} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Bank" value={form.bankName} onChange={(v) => set("bankName", v)} />
            <Field label="IBAN" value={form.iban} onChange={(v) => set("iban", v)} />
            <Field label="Phone" value={form.phone} onChange={(v) => set("phone", v)} />
            <Field label="Email" type="email" value={form.email} onChange={(v) => set("email", v)} />
            <Field label="Capital social" value={form.capital} onChange={(v) => set("capital", v)} />
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="issuer-inf-supl">Additional info (invoice footer)</Label>
              <Textarea
                id="issuer-inf-supl"
                value={form.infSupl}
                onChange={(e) => set("infSupl", e.target.value)}
                rows={2}
                placeholder="e.g. Swift BTRLRO22, contact…"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-6">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={form.isActive} onChange={(e) => set("isActive", e.target.checked)} className="h-4 w-4" />
              Active (selectable on invoices)
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={form.isDefault} onChange={(e) => set("isDefault", e.target.checked)} className="h-4 w-4" />
              Default issuer
            </label>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? "Save changes" : "Create issuer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
