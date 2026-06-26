"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Copy, Check, RefreshCw } from "lucide-react";
import { setInboundWebhookSecretAction } from "@/server/admin-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";

type SecretAction = (formData: FormData) => Promise<{ ok?: boolean; error?: string; secret?: string }>;

export function InboundWebhookForm({
  webhookUrl,
  currentSecret,
  action = setInboundWebhookSecretAction,
  urlHint,
}: {
  webhookUrl: string;
  currentSecret: string | null;
  action?: SecretAction;
  urlHint?: React.ReactNode;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [secret, setSecret] = React.useState(currentSecret ?? "");
  const [busy, setBusy] = React.useState<"save" | "regen" | "clear" | null>(null);
  const [copied, setCopied] = React.useState<"url" | "secret" | null>(null);

  async function copy(text: string, which: "url" | "secret") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast({ title: "Copy failed", variant: "error" });
    }
  }

  async function submit(mode: "save" | "regen" | "clear") {
    const fd = new FormData();
    if (mode === "regen") fd.set("regenerate", "1");
    else if (mode === "save") fd.set("secret", secret);
    // clear → send nothing

    setBusy(mode);
    const res = await action(fd);
    setBusy(null);
    if (res.error) return toast({ title: res.error, variant: "error" });
    if (res.secret) setSecret(res.secret);
    else if (mode === "clear") setSecret("");
    toast({
      title: mode === "clear" ? "Webhook disabled" : "Webhook secret saved",
      variant: "success",
    });
    router.refresh();
  }

  const fullUrl = secret ? `${webhookUrl}?secret=${encodeURIComponent(secret)}` : webhookUrl;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label>Endpoint URL</Label>
        <div className="flex gap-2">
          <Input readOnly value={webhookUrl} className="font-mono text-xs" />
          <Button type="button" variant="outline" size="icon" onClick={() => copy(webhookUrl, "url")}>
            {copied === "url" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
        {urlHint ?? (
          <p className="text-xs text-muted-foreground">
            POST the email JSON here. Authenticate with header <code>x-webhook-secret</code>, an{" "}
            <code>Authorization: Bearer &lt;secret&gt;</code> header, or a <code>?secret=</code> query param.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="webhookSecret">Shared secret</Label>
        <div className="flex gap-2">
          <Input
            id="webhookSecret"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="Not configured — generate or set a secret"
            className="font-mono text-xs"
            disabled={busy !== null}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => copy(secret, "secret")}
            disabled={!secret}
          >
            {copied === "secret" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Requests without a matching secret are rejected with 401. While unset, the endpoint returns 503.
        </p>
      </div>

      {secret && (
        <div className="space-y-2">
          <Label>Ready-to-use URL</Label>
          <div className="flex gap-2">
            <Input readOnly value={fullUrl} className="font-mono text-xs" />
            <Button type="button" variant="outline" size="icon" onClick={() => copy(fullUrl, "url")}>
              {copied === "url" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => submit("save")} disabled={busy !== null || !secret}>
          {busy === "save" && <Loader2 className="h-4 w-4 animate-spin" />}
          Save secret
        </Button>
        <Button variant="outline" onClick={() => submit("regen")} disabled={busy !== null}>
          {busy === "regen" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Generate new
        </Button>
        <Button variant="ghost" onClick={() => submit("clear")} disabled={busy !== null || !currentSecret}>
          {busy === "clear" && <Loader2 className="h-4 w-4 animate-spin" />}
          Disable
        </Button>
      </div>
    </div>
  );
}
