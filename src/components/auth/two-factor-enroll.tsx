"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, KeyRound, Smartphone } from "lucide-react";
import {
  startTotpEnrollAction,
  confirmTotpEnrollAction,
  passkeyRegisterOptionsAction,
  passkeyRegisterConfirmAction,
} from "@/server/auth-actions";
import { runPasskeyRegistration, passkeysSupported } from "@/lib/auth/passkey-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Shown when a server action throws rather than returning a structured result.
// The most common cause is a browser tab left open across a redeploy, which
// calls a server-action id the new build no longer knows about.
const STALE_ACTION_MESSAGE =
  "Something went wrong. If you left this page open after an update, do a hard refresh (Cmd/Ctrl+Shift+R) and try again.";

export function TwoFactorEnroll() {
  const router = useRouter();
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function beginTotp() {
    setBusy(true);
    setError(null);
    try {
      const res = await startTotpEnrollAction();
      if ("error" in res) return setError(res.error);
      setQr(res.qr);
      setSecret(res.secret);
    } catch {
      // A thrown server action (e.g. a stale action id after the app was
      // redeployed, or a transient server error) would otherwise fail silently.
      setError(STALE_ACTION_MESSAGE);
    } finally {
      setBusy(false);
    }
  }

  async function confirmTotp() {
    setBusy(true);
    setError(null);
    try {
      const res = await confirmTotpEnrollAction(code);
      if (res.error) return setError(res.error);
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError(STALE_ACTION_MESSAGE);
    } finally {
      setBusy(false);
    }
  }

  async function addPasskey() {
    setBusy(true);
    setError(null);
    try {
      const options = await passkeyRegisterOptionsAction();
      if ("error" in options) return setError(options.error as string);
      const cred = await runPasskeyRegistration(options as never);
      const res = await passkeyRegisterConfirmAction(cred, navigator.platform || "Passkey");
      if (res.error) return setError(res.error);
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("Passkey registration was cancelled or failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Tabs defaultValue="totp" className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="totp">
          <Smartphone /> Authenticator
        </TabsTrigger>
        <TabsTrigger value="passkey">
          <KeyRound /> Passkey
        </TabsTrigger>
      </TabsList>

      <TabsContent value="totp" className="space-y-4">
        {!qr ? (
          <Button onClick={beginTotp} disabled={busy} className="w-full">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Set up authenticator app
          </Button>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Scan the QR with Google Authenticator, 1Password, Authy, etc. then enter the 6-digit code.
            </p>
            <div className="flex justify-center rounded-lg border bg-white p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt="TOTP QR code" width={180} height={180} />
            </div>
            <p className="break-all text-center text-xs text-muted-foreground">Secret: {secret}</p>
            <div className="space-y-2">
              <Label htmlFor="code">Verification code</Label>
              <Input
                id="code"
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
              />
            </div>
            <Button onClick={confirmTotp} disabled={busy || code.length < 6} className="w-full">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Verify & enable
            </Button>
          </div>
        )}
      </TabsContent>

      <TabsContent value="passkey" className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Use Face ID, Touch ID, Windows Hello or a security key. Your device creates a passkey bound to this site.
        </p>
        <Button onClick={addPasskey} disabled={busy || !passkeysSupported()} className="w-full">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Create a passkey
        </Button>
        {!passkeysSupported() && (
          <p className="text-xs text-muted-foreground">Passkeys are not supported in this browser.</p>
        )}
      </TabsContent>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </Tabs>
  );
}
