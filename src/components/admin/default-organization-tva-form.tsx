"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { setDefaultOrganizationTvaPercentAction } from "@/server/admin-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";

export function DefaultOrganizationTvaForm({ currentPercent }: { currentPercent: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [value, setValue] = useState(currentPercent);
  const [busy, setBusy] = useState(false);
  const dirty = value !== currentPercent;

  async function onSave() {
    const fd = new FormData();
    fd.set("tvaPercent", value);
    setBusy(true);
    const res = await setDefaultOrganizationTvaPercentAction(fd);
    setBusy(false);
    if (res.error) return toast({ title: res.error, variant: "error" });
    toast({ title: "Default organization VAT saved", variant: "success" });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="defaultOrganizationTva">Default VAT percent</Label>
        <div className="flex max-w-sm items-center gap-2">
          <Input
            id="defaultOrganizationTva"
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={busy}
          />
          <span className="text-sm text-muted-foreground">%</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Used as the starting VAT value for new organizations and imported organizations. Each organization
          can still be edited independently.
        </p>
      </div>
      <Button onClick={onSave} disabled={busy || !dirty}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        Save
      </Button>
    </div>
  );
}
