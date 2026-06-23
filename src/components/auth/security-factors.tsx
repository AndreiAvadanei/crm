"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Smartphone, Trash2, Loader2, Plus } from "lucide-react";
import {
  startTotpEnrollAction,
  confirmTotpEnrollAction,
  passkeyRegisterOptionsAction,
  passkeyRegisterConfirmAction,
  removePasskeyAction,
} from "@/server/auth-actions";
import { runPasskeyRegistration, passkeysSupported } from "@/lib/auth/passkey-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/utils";

type Cred = { id: string; deviceName: string; createdAt: string; lastUsedAt: string | null };

// Shown when a server action throws (rather than returning a structured error),
// most commonly a stale action id from a tab left open across a redeploy.
const STALE_ACTION_MESSAGE =
  "Something went wrong. If this page was open during an update, hard refresh (Cmd/Ctrl+Shift+R) and try again.";

export function SecurityFactors({ hasTotp, credentials }: { hasTotp: boolean; credentials: Cred[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function beginTotp() {
    setBusy(true);
    try {
      const res = await startTotpEnrollAction();
      if ("error" in res) return toast({ title: res.error, variant: "error" });
      setQr(res.qr);
    } catch {
      // Surface thrown server actions (e.g. a stale action id after a redeploy)
      // instead of leaving the button stuck with no feedback.
      toast({ title: STALE_ACTION_MESSAGE, variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function confirmTotp() {
    setBusy(true);
    try {
      const res = await confirmTotpEnrollAction(code);
      if (res.error) return toast({ title: res.error, variant: "error" });
      setQr(null);
      setCode("");
      toast({ title: "Authenticator enabled", variant: "success" });
      router.refresh();
    } catch {
      toast({ title: STALE_ACTION_MESSAGE, variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function addPasskey() {
    setBusy(true);
    try {
      const options = await passkeyRegisterOptionsAction();
      if ("error" in options) return toast({ title: options.error as string, variant: "error" });
      const cred = await runPasskeyRegistration(options as never);
      const res = await passkeyRegisterConfirmAction(cred, navigator.platform || "Passkey");
      if (res.error) return toast({ title: res.error, variant: "error" });
      toast({ title: "Passkey added", variant: "success" });
      router.refresh();
    } catch {
      toast({ title: "Passkey registration cancelled", variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Two-factor authentication</CardTitle>
        <CardDescription>Required to access the workspace.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Smartphone className="h-4 w-4" /> Authenticator app
            </div>
            {hasTotp ? (
              <Badge variant="success">Enabled</Badge>
            ) : (
              <Button size="sm" variant="outline" onClick={beginTotp} disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Set up
              </Button>
            )}
          </div>
          {qr && (
            <div className="space-y-3 rounded-lg border p-4">
              <div className="flex justify-center rounded bg-white p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qr} alt="TOTP QR" width={160} height={160} />
              </div>
              <Input
                inputMode="numeric"
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <Button size="sm" className="w-full" onClick={confirmTotp} disabled={busy || code.length < 6}>
                Verify & enable
              </Button>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium">
              <KeyRound className="h-4 w-4" /> Passkeys
            </div>
            <Button size="sm" variant="outline" onClick={addPasskey} disabled={busy || !passkeysSupported()}>
              <Plus /> Add
            </Button>
          </div>
          <div className="space-y-2">
            {credentials.length === 0 && (
              <p className="text-sm text-muted-foreground">No passkeys registered.</p>
            )}
            {credentials.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                <div>
                  <div className="font-medium">{c.deviceName}</div>
                  <div className="text-xs text-muted-foreground">
                    Added {formatDate(c.createdAt)}
                    {c.lastUsedAt ? ` · Last used ${formatDate(c.lastUsedAt)}` : ""}
                  </div>
                </div>
                <ConfirmDialog
                  onConfirm={() => removePasskeyAction(c.id)}
                  title="Remove passkey?"
                  description={`"${c.deviceName}" will no longer be able to sign in.`}
                  confirmLabel="Remove"
                  successMessage="Passkey removed"
                >
                  <Button size="icon" variant="ghost">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </ConfirmDialog>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
