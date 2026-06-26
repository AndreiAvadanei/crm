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
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { createSeriesAction, updateSeriesAction, deleteSeriesAction } from "@/server/series-actions";

export type SeriesData = {
  id: string;
  prefix: string;
  nextNumber: number;
  isActive: boolean;
  isDefault: boolean;
};

type FormState = { prefix: string; nextNumber: string; isActive: boolean; isDefault: boolean };

function toForm(series?: SeriesData): FormState {
  return {
    prefix: series?.prefix ?? "",
    nextNumber: String(series?.nextNumber ?? 1),
    isActive: series?.isActive ?? true,
    isDefault: series?.isDefault ?? false,
  };
}

export function SeriesManager({ series }: { series: SeriesData[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  async function onDelete(s: SeriesData) {
    if (!confirm(`Delete series "${s.prefix}"? Invoices already numbered keep their number.`)) return;
    setDeletingId(s.id);
    const res = await deleteSeriesAction(s.id);
    setDeletingId(null);
    if (res.error) return toast({ title: res.error, variant: "error" });
    toast({ title: "Series deleted", variant: "success" });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Number series for issued invoices. The next number is assigned and incremented the first time an invoice is
          issued (XML download / accounting email).
        </p>
        <SeriesFormDialog
          trigger={
            <Button size="sm">
              <Plus className="h-4 w-4" /> Add series
            </Button>
          }
        />
      </div>

      {series.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No series yet. Add one (e.g. prefix &quot;BIT.R&quot;, starting number 100).
        </p>
      ) : (
        <div className="divide-y rounded-md border">
          {series.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{s.prefix}</span>
                  {s.isDefault && <Badge variant="success">Default</Badge>}
                  {!s.isActive && <Badge variant="secondary">Inactive</Badge>}
                </div>
                <div className="text-xs text-muted-foreground">
                  Next: <span className="font-mono">{s.prefix} {s.nextNumber}</span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <SeriesFormDialog
                  series={s}
                  trigger={
                    <Button variant="ghost" size="icon" aria-label="Edit series">
                      <Pencil className="h-4 w-4" />
                    </Button>
                  }
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Delete series"
                  disabled={deletingId === s.id}
                  onClick={() => onDelete(s)}
                >
                  {deletingId === s.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SeriesFormDialog({ trigger, series }: { trigger: React.ReactNode; series?: SeriesData }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [form, setForm] = React.useState<FormState>(toForm(series));
  const editing = !!series;

  React.useEffect(() => {
    if (open) setForm(toForm(series));
  }, [open, series]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((s) => ({ ...s, [key]: value }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.prefix.trim()) return toast({ title: "Series prefix is required", variant: "error" });
    setBusy(true);
    const fd = new FormData();
    fd.set("prefix", form.prefix.trim());
    fd.set("nextNumber", form.nextNumber);
    if (form.isActive) fd.set("isActive", "on");
    if (form.isDefault) fd.set("isDefault", "on");
    const res = editing ? await updateSeriesAction(series!.id, fd) : await createSeriesAction(fd);
    setBusy(false);
    if (res.error) return toast({ title: res.error, variant: "error" });
    toast({ title: editing ? "Series updated" : "Series created", variant: "success" });
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit series" : "New series"}</DialogTitle>
          <DialogDescription>Invoice number series used to assign FacturaNumar.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="series-prefix">Prefix *</Label>
              <Input id="series-prefix" value={form.prefix} onChange={(e) => set("prefix", e.target.value)} required placeholder="BIT.R" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="series-next">Next number *</Label>
              <Input
                id="series-next"
                type="number"
                min={1}
                value={form.nextNumber}
                onChange={(e) => set("nextNumber", e.target.value)}
                required
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Next invoice will be <span className="font-mono">{form.prefix || "PREFIX"} {form.nextNumber || "?"}</span>.
          </p>
          <div className="flex flex-wrap gap-6">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={form.isActive} onChange={(e) => set("isActive", e.target.checked)} className="h-4 w-4" />
              Active
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={form.isDefault} onChange={(e) => set("isDefault", e.target.checked)} className="h-4 w-4" />
              Default series
            </label>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? "Save changes" : "Create series"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
