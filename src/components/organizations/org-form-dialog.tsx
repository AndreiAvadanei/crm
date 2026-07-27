"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Download } from "lucide-react";
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
  COUNTRIES,
  RO_COUNTIES,
  ROMANIA,
  DEFAULT_COUNTY,
  countryCodeForName,
  isRomania,
  normalizeCountryValue,
} from "@/lib/ro-geo";
import {
  createOrganizationAction,
  updateOrganizationAction,
  fetchAnafCompanyAction,
  getOrganizationForEditAction,
} from "@/server/organization-actions";

// Minimal shape needed to identify the org being edited; the full field set is
// loaded on open via getOrganizationForEditAction so we don't thread ~30 columns
// through every list/stats mapping.
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
  tvaPercent: string;
  clientId: string;
};

type FormState = {
  sourceName: string;
  legalName: string;
  taxId: string;
  tara: string;
  judet: string;
  localitate: string;
  cod_post: string;
  adresa: string;
  reg_com: string;
  banca: string;
  cont_banca: string;
  tel: string;
  email: string;
  is_tva: boolean;
  blocat: boolean;
  data_v_tva: string;
  data_s_tva: string;
  tip_tert: string;
  delegat: string;
  inf_supl: string;
  tvaPercent: string;
  isDefault: boolean;
};

const EMPTY: FormState = {
  sourceName: "",
  legalName: "",
  taxId: "",
  tara: ROMANIA,
  judet: DEFAULT_COUNTY,
  localitate: "",
  cod_post: "",
  adresa: "",
  reg_com: "",
  banca: "",
  cont_banca: "",
  tel: "",
  email: "",
  is_tva: false,
  blocat: false,
  data_v_tva: "",
  data_s_tva: "",
  tip_tert: "",
  delegat: "",
  inf_supl: "",
  tvaPercent: "21",
  isDefault: false,
};

export function OrgFormDialog({
  trigger,
  organization,
  clients,
  fixedClient,
  defaultTvaPercent = "21",
}: {
  trigger: React.ReactNode;
  organization?: OrgData;
  /** Selectable clients for the picker (omit when fixedClient is provided). */
  clients?: { id: string; name: string }[];
  /** Lock the org to a specific client (e.g. when adding from a client page). */
  fixedClient?: { id: string; name: string };
  /** Initial VAT percent for newly-created organizations. */
  defaultTvaPercent?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // `ready` gates the form so it mounts exactly once per open with fully-defined
  // values (avoids the controlled/uncontrolled input warning from a state swap).
  const [ready, setReady] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [clientId, setClientId] = useState(organization?.clientId ?? fixedClient?.id ?? "");
  const [form, setForm] = useState<FormState>(EMPTY);
  const editing = !!organization;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((s) => ({ ...s, [key]: value }));

  // Load the full field set when opening; only flip `ready` once values exist.
  useEffect(() => {
    if (!open) {
      setReady(false);
      return;
    }
    if (!editing) {
      setForm({ ...EMPTY, tvaPercent: defaultTvaPercent });
      setClientId(fixedClient?.id ?? "");
      setReady(true);
      return;
    }
    let cancelled = false;
    setReady(false);
    getOrganizationForEditAction(organization!.id).then((res) => {
      if (cancelled) return;
      if (res.error || !res.org) return toast({ title: res.error ?? "Load failed", variant: "error" });
      const { clientId: cid, ...rest } = res.org;
      setClientId(cid);
      setForm({ ...rest, tara: normalizeCountryValue(rest.tara) || ROMANIA });
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  async function onFetchAnaf() {
    if (!form.taxId.trim()) return toast({ title: "Introduceți CUI/VAT", variant: "error" });
    setFetching(true);
    const res = await fetchAnafCompanyAction(form.taxId);
    setFetching(false);
    if (res.error || !res.data) return toast({ title: res.error ?? "Lookup failed", variant: "error" });
    const d = res.data;
    setForm((s) => ({
      ...s,
      sourceName: s.sourceName || d.legalName || s.sourceName,
      legalName: d.legalName ?? s.legalName,
      reg_com: d.reg_com ?? s.reg_com,
      tara: normalizeCountryValue(d.tara) || s.tara,
      judet: d.judet ?? s.judet,
      localitate: d.localitate ?? s.localitate,
      adresa: d.adresa ?? s.adresa,
      cod_post: d.cod_post ?? s.cod_post,
      tel: d.tel ?? s.tel,
      cont_banca: d.cont_banca ?? s.cont_banca,
      is_tva: d.is_tva,
      blocat: d.blocat,
    }));
    toast({ title: "Date completate din ANAF", variant: "success" });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!clientId) return toast({ title: "Select a client", variant: "error" });
    if (!form.sourceName.trim()) return toast({ title: "Organization name is required", variant: "error" });
    setBusy(true);
    const fd = new FormData();
    fd.set("clientId", clientId);
    for (const [k, v] of Object.entries(form)) {
      if (typeof v === "boolean") {
        if (v) fd.set(k, "on");
      } else {
        fd.set(k, v);
      }
    }
    const res = editing ? await updateOrganizationAction(organization!.id, fd) : await createOrganizationAction(fd);
    setBusy(false);
    if (res.error) return toast({ title: res.error, variant: "error" });
    toast({ title: editing ? "Organization updated" : "Organization created", variant: "success" });
    setOpen(false);
    router.refresh();
  }

  const ro = isRomania(form.tara);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogOpenTrigger trigger={trigger} onOpen={() => setOpen(true)} />
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit organization" : "New organization"}</DialogTitle>
          <DialogDescription>Billing legal entity (CUI, registration, bank, accounting fields).</DialogDescription>
        </DialogHeader>

        {!ready ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-5">
            {/* --- Identity --- */}
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
                <Input id="sourceName" value={form.sourceName ?? ""} onChange={(e) => set("sourceName", e.target.value)} required />
              </div>
              <Field label="Legal name" value={form.legalName} onChange={(v) => set("legalName", v)} />

              {/* Tax id + ANAF fetch (RO only) */}
              <div className="space-y-2">
                <Label htmlFor="taxId">Tax id (CUI / VAT)</Label>
                <div className="flex gap-2">
                  <Input id="taxId" value={form.taxId ?? ""} onChange={(e) => set("taxId", e.target.value)} className="flex-1" />
                  {ro && (
                    <Button type="button" variant="outline" onClick={onFetchAnaf} disabled={fetching} title="Completează din ANAF">
                      {fetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      ANAF
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* --- Location --- */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Țară</Label>
                <ClientCombobox
                  value={form.tara}
                  options={COUNTRIES.map((c) => ({ value: c, label: c, searchText: countryCodeForName(c) }))}
                  onChange={(v) => set("tara", normalizeCountryValue(v) || ROMANIA)}
                  placeholder="Select country"
                  searchPlaceholder="Caută țară…"
                  emptyText="Nicio țară găsită."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="judet">Județ</Label>
                {ro ? (
                  <ClientCombobox
                    value={form.judet}
                    options={RO_COUNTIES.map((c) => ({ value: c, label: c }))}
                    onChange={(v) => set("judet", v)}
                    placeholder="Select county"
                    searchPlaceholder="Caută județ…"
                    emptyText="Niciun județ găsit."
                  />
                ) : (
                  <Input id="judet" value={form.judet ?? ""} onChange={(e) => set("judet", e.target.value)} />
                )}
              </div>
              <Field label="Localitate" value={form.localitate} onChange={(v) => set("localitate", v)} />
              <Field label="Cod poștal" value={form.cod_post} onChange={(v) => set("cod_post", v)} />
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="adresa">Adresă</Label>
                <Textarea id="adresa" value={form.adresa ?? ""} onChange={(e) => set("adresa", e.target.value)} />
              </div>
            </div>

            {/* --- Registration / bank --- */}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Reg. com. (J)" value={form.reg_com} onChange={(v) => set("reg_com", v)} />
              <Field label="Bancă" value={form.banca} onChange={(v) => set("banca", v)} />
              <Field label="Cont bancă (IBAN)" value={form.cont_banca} onChange={(v) => set("cont_banca", v)} />
              <Field label="Telefon" value={form.tel} onChange={(v) => set("tel", v)} />
              <Field label="Email" type="email" value={form.email} onChange={(v) => set("email", v)} />
              <Field label="Tip terț" value={form.tip_tert} onChange={(v) => set("tip_tert", v)} />
            </div>

            {/* --- VAT --- */}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Dată început TVA" type="date" value={form.data_v_tva} onChange={(v) => set("data_v_tva", v)} />
              <Field label="Dată sfârșit TVA" type="date" value={form.data_s_tva} onChange={(v) => set("data_s_tva", v)} />
              <Field label="TVA %" type="number" value={form.tvaPercent} onChange={(v) => set("tvaPercent", v)} />
              <div className="flex items-center gap-2">
                <input id="is_tva" type="checkbox" checked={!!form.is_tva} onChange={(e) => set("is_tva", e.target.checked)} className="h-4 w-4" />
                <Label htmlFor="is_tva">Plătitor TVA</Label>
              </div>
              <div className="flex items-center gap-2">
                <input id="blocat" type="checkbox" checked={!!form.blocat} onChange={(e) => set("blocat", e.target.checked)} className="h-4 w-4" />
                <Label htmlFor="blocat">Blocat</Label>
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                {ro
                  ? `Romanian client: invoices apply this rate (${form.tvaPercent || 0}%).`
                  : "Foreign client: invoices apply 0% VAT (EU reverse charge / export), regardless of this value."}
              </p>
            </div>

            {/* --- Commercial --- */}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Delegat" value={form.delegat} onChange={(v) => set("delegat", v)} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="inf_supl">Informații suplimentare</Label>
              <Textarea id="inf_supl" value={form.inf_supl ?? ""} onChange={(e) => set("inf_supl", e.target.value)} />
            </div>

            <div className="flex items-center gap-2">
                <input id="isDefault" type="checkbox" checked={!!form.isDefault} onChange={(e) => set("isDefault", e.target.checked)} className="h-4 w-4" />
              <Label htmlFor="isDefault">Default billing entity for this client</Label>
            </div>

            <DialogFooter>
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {editing ? "Save changes" : "Create organization"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)} step={type === "number" ? "any" : undefined} />
    </div>
  );
}
