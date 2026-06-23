"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, Upload } from "lucide-react";
import { uploadBrandingLogoAction, deleteBrandingLogoAction } from "@/server/branding-actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export function BrandingForm({
  mode,
  version,
}: {
  mode: "light" | "dark";
  version: number;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const hasLogo = version > 0;
  const src = `/api/branding/${mode}?v=${version}`;

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.set("file", file);
    setBusy(true);
    const res = await uploadBrandingLogoAction(mode, fd);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    if (res.error) return toast({ title: res.error, variant: "error" });
    toast({ title: "Logo updated", variant: "success" });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {/* Preview on the matching background so contrast is realistic */}
      <div
        className={cn(
          "flex h-24 items-center justify-center rounded-lg border",
          mode === "dark" ? "bg-neutral-900" : "bg-white"
        )}
      >
        {hasLogo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={`${mode} logo`} className="max-h-12 w-auto object-contain" />
        ) : (
          <span className={cn("text-sm", mode === "dark" ? "text-neutral-400" : "text-neutral-400")}>
            No {mode} logo
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/png,.png"
          onChange={onFile}
          disabled={busy}
          className="hidden"
          id={`logo-${mode}`}
        />
        <Button asChild variant="outline" disabled={busy}>
          <label htmlFor={`logo-${mode}`} className="cursor-pointer">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {hasLogo ? "Replace PNG" : "Upload PNG"}
          </label>
        </Button>
        {hasLogo && (
          <ConfirmDialog
            onConfirm={() => deleteBrandingLogoAction(mode)}
            title="Remove logo?"
            description={`The ${mode} logo will be removed.`}
            confirmLabel="Remove"
            successMessage="Logo removed"
          >
            <Button variant="ghost" size="icon" disabled={busy} title="Remove logo">
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </ConfirmDialog>
        )}
      </div>
      <p className="text-xs text-muted-foreground">PNG only, up to 2&nbsp;MB. Transparent background recommended.</p>
    </div>
  );
}
