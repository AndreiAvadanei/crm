"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
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
import { useToast } from "@/components/ui/toast";
import { setAccessRulesAction } from "@/server/admin-actions";
import type { TagView } from "@/components/shared/tag-badge";

type Rule = { tagId: string | null; visibleFrom: string | null };

export function AccessRulesDialog({
  trigger,
  userId,
  tags,
  initialRules,
}: {
  trigger: React.ReactNode;
  userId: string;
  tags: TagView[];
  initialRules: Rule[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rules, setRules] = useState<Rule[]>(initialRules.length ? initialRules : []);

  function add() {
    setRules((r) => [...r, { tagId: null, visibleFrom: null }]);
  }
  function update(i: number, patch: Partial<Rule>) {
    setRules((r) => r.map((rule, idx) => (idx === i ? { ...rule, ...patch } : rule)));
  }
  function remove(i: number) {
    setRules((r) => r.filter((_, idx) => idx !== i));
  }

  async function save() {
    setBusy(true);
    const res = await setAccessRulesAction(userId, rules);
    setBusy(false);
    if (res.error) return toast({ title: res.error, variant: "error" });
    toast({ title: "Access rules saved", variant: "success" });
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Tag & date visibility</DialogTitle>
          <DialogDescription>
            Each rule grants visibility to deals/clients with a tag, created on/after a date. Leave tag empty for all
            tags; leave date empty to use the user&apos;s default visibility.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {rules.map((rule, i) => (
            <div key={i} className="flex items-center gap-2">
              <select
                value={rule.tagId ?? ""}
                onChange={(e) => update(i, { tagId: e.target.value || null })}
                className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">All tags</option>
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <Input
                type="date"
                value={rule.visibleFrom ?? ""}
                onChange={(e) => update(i, { visibleFrom: e.target.value || null })}
                className="w-40"
              />
              <Button variant="ghost" size="icon" onClick={() => remove(i)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
          {rules.length === 0 && (
            <p className="text-sm text-muted-foreground">No rules — user only sees owned and shared records.</p>
          )}
          <Button variant="outline" size="sm" onClick={add}>
            <Plus /> Add rule
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save rules
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
