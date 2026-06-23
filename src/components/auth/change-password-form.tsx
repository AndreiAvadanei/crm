"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { changePasswordAction } from "@/server/auth-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PASSWORD_RULE_TEXT } from "@/lib/auth/password-rules";

export function ChangePasswordForm({ requireCurrent }: { requireCurrent: boolean }) {
  const [state, action, pending] = useActionState(changePasswordAction, {});

  return (
    <form action={action} className="space-y-4">
      {requireCurrent && (
        <div className="space-y-2">
          <Label htmlFor="current">Current password</Label>
          <Input id="current" name="current" type="password" autoComplete="current-password" required />
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="next">New password</Label>
        <Input id="next" name="next" type="password" autoComplete="new-password" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm">Confirm new password</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </div>
      <p className="text-xs text-muted-foreground">{PASSWORD_RULE_TEXT}</p>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state?.ok && <p className="text-sm text-[var(--success)]">Password updated.</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        Save password
      </Button>
    </form>
  );
}
