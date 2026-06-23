"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, KeyRound } from "lucide-react";
import {
  verifyLoginTotpAction,
  passkeyAuthOptionsAction,
  passkeyAuthConfirmAction,
} from "@/server/auth-actions";
import { runPasskeyAuthentication, passkeysSupported } from "@/lib/auth/passkey-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

export function TwoFactorVerify({ hasTotp, hasPasskey }: { hasTotp: boolean; hasPasskey: boolean }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function done() {
    router.replace("/dashboard");
    router.refresh();
  }

  async function verifyTotp() {
    setBusy(true);
    setError(null);
    const res = await verifyLoginTotpAction(code);
    setBusy(false);
    if (res.error) return setError(res.error);
    done();
  }

  async function verifyPasskey() {
    setBusy(true);
    setError(null);
    try {
      const options = await passkeyAuthOptionsAction();
      if ("error" in options) {
        setBusy(false);
        return setError(options.error as string);
      }
      const assertion = await runPasskeyAuthentication(options as never);
      const res = await passkeyAuthConfirmAction(assertion);
      setBusy(false);
      if (res.error) return setError(res.error);
      done();
    } catch {
      setBusy(false);
      setError("Passkey verification was cancelled or failed.");
    }
  }

  return (
    <div className="space-y-4">
      {hasTotp && (
        <div className="space-y-2">
          <Label htmlFor="code">Authenticator code</Label>
          <Input
            id="code"
            inputMode="numeric"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
          />
          <Button onClick={verifyTotp} disabled={busy || code.length < 6} className="w-full">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Verify
          </Button>
        </div>
      )}

      {hasTotp && hasPasskey && (
        <div className="flex items-center gap-3">
          <Separator className="flex-1" />
          <span className="text-xs text-muted-foreground">or</span>
          <Separator className="flex-1" />
        </div>
      )}

      {hasPasskey && (
        <Button
          variant="outline"
          onClick={verifyPasskey}
          disabled={busy || !passkeysSupported()}
          className="w-full"
        >
          <KeyRound /> Use a passkey
        </Button>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
