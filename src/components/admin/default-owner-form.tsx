"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { setDefaultDealOwnerAction } from "@/server/admin-actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";

type Owner = { id: string; name: string; email: string };

export function DefaultOwnerForm({
  owners,
  currentOwnerId,
}: {
  owners: Owner[];
  currentOwnerId: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [value, setValue] = React.useState(currentOwnerId ?? "");
  const [busy, setBusy] = React.useState(false);

  const dirty = value !== (currentOwnerId ?? "");

  async function onSave() {
    const fd = new FormData();
    if (value) fd.set("userId", value);
    setBusy(true);
    const res = await setDefaultDealOwnerAction(fd);
    setBusy(false);
    if (res.error) return toast({ title: res.error, variant: "error" });
    toast({ title: "Default assignee saved", variant: "success" });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="defaultOwner">Default assignee</Label>
        <select
          id="defaultOwner"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={busy}
          className="flex h-9 w-full max-w-sm rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Deal creator (default)</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name} ({o.email})
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          When a deal is created without an explicit owner, it is auto-assigned to this user. Leave as
          &ldquo;Deal creator&rdquo; to assign it to whoever creates the deal.
        </p>
      </div>
      <Button onClick={onSave} disabled={busy || !dirty}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        Save
      </Button>
    </div>
  );
}
