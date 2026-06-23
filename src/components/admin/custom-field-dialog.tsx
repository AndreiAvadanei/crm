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
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/components/ui/toast";
import { createFieldDefAction, updateFieldDefAction } from "@/server/admin-actions";

const TYPES = ["TEXT", "TEXTAREA", "NUMBER", "DATE", "SELECT", "MULTISELECT", "BOOLEAN", "URL"];

type FieldData = {
  id: string;
  label: string;
  type: string;
  required: boolean;
  options: string[];
};

export function CustomFieldDialog({
  trigger,
  entity,
  field,
}: {
  trigger: React.ReactNode;
  entity: "DEAL" | "CLIENT";
  field?: FieldData;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const editing = !!field;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formRef.current) return;
    setBusy(true);
    const fd = new FormData(formRef.current);
    const res = editing ? await updateFieldDefAction(field!.id, fd) : await createFieldDefAction(fd);
    setBusy(false);
    if (res.error) return toast({ title: res.error, variant: "error" });
    toast({ title: editing ? "Field updated" : "Field created", variant: "success" });
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit field" : "New custom field"}</DialogTitle>
          <DialogDescription>For {entity === "DEAL" ? "deals" : "clients"}.</DialogDescription>
        </DialogHeader>
        <form ref={formRef} onSubmit={onSubmit} className="space-y-4">
          <input type="hidden" name="entity" value={entity} />
          <div className="space-y-2">
            <Label htmlFor="label">Label</Label>
            <Input id="label" name="label" defaultValue={field?.label ?? ""} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="type">Type</Label>
            <select
              id="type"
              name="type"
              defaultValue={field?.type ?? "TEXT"}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="options">Options (for SELECT / MULTISELECT)</Label>
            <Textarea
              id="options"
              name="options"
              defaultValue={field?.options.join("\n") ?? ""}
              placeholder="One option per line"
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="required" name="required" defaultChecked={field?.required} />
            <Label htmlFor="required">Required</Label>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
