"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Pencil, Plus, Sparkles, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import {
  createPartNumberAction,
  updatePartNumberAction,
  deletePartNumberAction,
  importPartNumbersFromMatrixAction,
  importPartNumbersFromUploadAction,
} from "@/server/part-number-actions";
import { parsePlaceholders, partNumberSummary } from "@/lib/part-numbers";

export type PartNumberData = {
  id: string;
  code: string;
  group: string | null;
  title: string | null;
  limitations: string | null;
  category: string | null;
  subCategory: string | null;
  subSubCategory: string | null;
  type: string | null;
  description: string | null;
  active: boolean;
};

type FormState = Omit<PartNumberData, "id">;

const blank: FormState = {
  code: "",
  group: "",
  title: "",
  limitations: "",
  category: "",
  subCategory: "",
  subSubCategory: "",
  type: "",
  description: "",
  active: true,
} as unknown as FormState;

function toForm(pn?: PartNumberData): FormState {
  return {
    code: pn?.code ?? "",
    group: pn?.group ?? "",
    title: pn?.title ?? "",
    limitations: pn?.limitations ?? "",
    category: pn?.category ?? "",
    subCategory: pn?.subCategory ?? "",
    subSubCategory: pn?.subSubCategory ?? "",
    type: pn?.type ?? "",
    description: pn?.description ?? "",
    active: pn?.active ?? true,
  };
}

function buildFormData(form: FormState): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(form)) {
    if (typeof v === "boolean") {
      if (v) fd.set(k, "on");
    } else {
      fd.set(k, v ?? "");
    }
  }
  return fd;
}

export function PartNumbersManager({ partNumbers }: { partNumbers: PartNumberData[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [query, setQuery] = React.useState("");
  const [groupFilter, setGroupFilter] = React.useState<string>("");
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [importing, setImporting] = React.useState<"matrix" | "upload" | null>(null);

  const groups = React.useMemo(() => {
    const set = new Set<string>();
    for (const pn of partNumbers) if (pn.group) set.add(pn.group);
    return Array.from(set).sort();
  }, [partNumbers]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return partNumbers.filter((pn) => {
      if (groupFilter && pn.group !== groupFilter) return false;
      if (!q) return true;
      return [pn.code, pn.title, pn.group, pn.category, pn.subCategory, pn.subSubCategory, pn.type, pn.limitations]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [partNumbers, query, groupFilter]);

  async function onDelete(pn: PartNumberData) {
    if (!confirm(`Delete part number "${pn.code}"? Invoices using it keep their saved code but are unlinked.`)) return;
    setDeletingId(pn.id);
    const res = await deletePartNumberAction(pn.id);
    setDeletingId(null);
    if (res.error) return toast({ title: res.error, variant: "error" });
    toast({ title: "Part number deleted", variant: "success" });
    router.refresh();
  }

  async function autoPopulate() {
    setImporting("matrix");
    const res = await importPartNumbersFromMatrixAction();
    setImporting(null);
    if (res.error || !res.result) return toast({ title: res.error ?? "Import failed", variant: "error" });
    toast({
      title: `Imported: ${res.result.created} new, ${res.result.updated} updated`,
      variant: "success",
    });
    router.refresh();
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting("upload");
    const fd = new FormData();
    fd.set("file", file);
    const res = await importPartNumbersFromUploadAction(fd);
    setImporting(null);
    if (fileRef.current) fileRef.current.value = "";
    if (res.error || !res.result) return toast({ title: res.error ?? "Import failed", variant: "error" });
    toast({ title: `Imported: ${res.result.created} new, ${res.result.updated} updated`, variant: "success" });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          The billable part-number matrix. <code>&lt;limit&gt;</code> placeholders are filled in per invoice in the
          new-invoice wizard.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".xls,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            onChange={onUpload}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={importing !== null}
            onClick={() => fileRef.current?.click()}
          >
            {importing === "upload" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Upload .xlsx
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={importing !== null} onClick={autoPopulate}>
            {importing === "matrix" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Auto-populate from matrix
          </Button>
          <Button type="button" size="sm" onClick={() => { setCreating(true); setEditingId(null); }}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search code, title, category…"
          className="h-9 max-w-xs"
        />
        <div className="flex flex-wrap items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant={groupFilter === "" ? "default" : "outline"}
            onClick={() => setGroupFilter("")}
          >
            All ({partNumbers.length})
          </Button>
          {groups.map((g) => (
            <Button
              key={g}
              type="button"
              size="sm"
              variant={groupFilter === g ? "default" : "outline"}
              onClick={() => setGroupFilter(g)}
            >
              {g}
            </Button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[14rem]">Code</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Classification</TableHead>
              <TableHead>Limits</TableHead>
              <TableHead className="text-center">Active</TableHead>
              <TableHead className="w-px text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {creating && (
              <PartNumberEditorRow
                onCancel={() => setCreating(false)}
                onSaved={() => { setCreating(false); router.refresh(); }}
              />
            )}
            {filtered.map((pn) =>
              editingId === pn.id ? (
                <PartNumberEditorRow
                  key={pn.id}
                  partNumber={pn}
                  onCancel={() => setEditingId(null)}
                  onSaved={() => { setEditingId(null); router.refresh(); }}
                />
              ) : (
                <TableRow key={pn.id} className="group align-top">
                  <TableCell className="font-mono text-xs">
                    <div className="font-medium">{pn.code}</div>
                    {pn.group && <Badge variant="secondary" className="mt-1">{pn.group}</Badge>}
                  </TableCell>
                  <TableCell className="max-w-[20rem] text-sm">{pn.title || <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {partNumberSummary(pn) || "—"}
                  </TableCell>
                  <TableCell className="max-w-[14rem] text-xs text-muted-foreground">
                    {parsePlaceholders(pn.code).length > 0 ? (
                      <span title={pn.limitations ?? undefined}>{pn.limitations || "(unlabeled)"}</span>
                    ) : (
                      <span className="text-muted-foreground/60">fixed</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {pn.active ? (
                      <Check className="mx-auto h-4 w-4 text-[var(--success)]" />
                    ) : (
                      <span className="text-xs text-muted-foreground">off</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Edit part number"
                        onClick={() => { setEditingId(pn.id); setCreating(false); }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Delete part number"
                        disabled={deletingId === pn.id}
                        onClick={() => onDelete(pn)}
                      >
                        {deletingId === pn.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )
            )}
            {filtered.length === 0 && !creating && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  {partNumbers.length === 0
                    ? "No part numbers yet. Auto-populate from the matrix or add one."
                    : "No part numbers match your search."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function PartNumberEditorRow({
  partNumber,
  onCancel,
  onSaved,
}: {
  partNumber?: PartNumberData;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = React.useState<FormState>(toForm(partNumber));
  const [busy, setBusy] = React.useState(false);
  const editing = !!partNumber;
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((s) => ({ ...s, [key]: value }));
  const placeholders = parsePlaceholders(form.code);

  async function save() {
    if (!form.code.trim()) return toast({ title: "Code is required", variant: "error" });
    setBusy(true);
    const fd = buildFormData(form);
    const res = editing ? await updatePartNumberAction(partNumber!.id, fd) : await createPartNumberAction(fd);
    setBusy(false);
    if (res.error) return toast({ title: res.error, variant: "error" });
    toast({ title: editing ? "Part number updated" : "Part number created", variant: "success" });
    onSaved();
  }

  return (
    <TableRow className="bg-muted/30">
      <TableCell colSpan={6} className="p-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Code *" className="lg:col-span-2" mono value={form.code} onChange={(v) => set("code", v)} placeholder="RED-PEN-B-I-BP-<limit>" />
          <Field label="Group" value={form.group ?? ""} onChange={(v) => set("group", v)} placeholder="RED" />
          <Field label="Type" value={form.type ?? ""} onChange={(v) => set("type", v)} />
          <Field label="Title" className="lg:col-span-4" value={form.title ?? ""} onChange={(v) => set("title", v)} />
          <Field label="Category" value={form.category ?? ""} onChange={(v) => set("category", v)} />
          <Field label="Sub-category" value={form.subCategory ?? ""} onChange={(v) => set("subCategory", v)} />
          <Field label="Sub-sub-category" value={form.subSubCategory ?? ""} onChange={(v) => set("subSubCategory", v)} />
          <Field
            label={placeholders.length > 0 ? `Limit labels (${placeholders.join(", ")})` : "Limit labels"}
            value={form.limitations ?? ""}
            onChange={(v) => set("limitations", v)}
            placeholder="numar de assets, perioada in luni"
          />
          <Field label="Description" className="lg:col-span-4" value={form.description ?? ""} onChange={(v) => set("description", v)} />
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={form.active} onCheckedChange={(v) => set("active", v === true)} />
            Active (selectable on invoices)
          </label>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
              <X className="h-4 w-4" /> Cancel
            </Button>
            <Button type="button" size="sm" onClick={save} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {editing ? "Save" : "Create"}
            </Button>
          </div>
        </div>
      </TableCell>
    </TableRow>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  className,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  mono?: boolean;
}) {
  return (
    <div className={`space-y-1 ${className ?? ""}`}>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`h-8 text-sm ${mono ? "font-mono" : ""}`}
      />
    </div>
  );
}
