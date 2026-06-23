"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, KeyRound, ShieldOff, Ban, CircleCheck, Copy } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { resetUserPasswordAction, resetUser2faAction, setUserStatusAction } from "@/server/admin-actions";

export function UserRowActions({
  userId,
  status,
  isSelf,
}: {
  userId: string;
  status: string;
  isSelf: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [temp, setTemp] = useState<string | null>(null);

  async function resetPassword() {
    const res = await resetUserPasswordAction(userId);
    if (res.error) return toast({ title: res.error, variant: "error" });
    setTemp(res.tempPassword ?? null);
    router.refresh();
  }
  async function reset2fa() {
    const res = await resetUser2faAction(userId);
    if (res.error) return toast({ title: res.error, variant: "error" });
    toast({ title: "2FA reset — user re-enrolls on next login", variant: "success" });
    router.refresh();
  }
  async function toggleStatus() {
    const res = await setUserStatusAction(userId, status === "ACTIVE" ? "DISABLED" : "ACTIVE");
    if (res.error) return toast({ title: res.error, variant: "error" });
    router.refresh();
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={resetPassword}>
            <KeyRound /> Reset password
          </DropdownMenuItem>
          <DropdownMenuItem onClick={reset2fa}>
            <ShieldOff /> Reset 2FA
          </DropdownMenuItem>
          {!isSelf && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={toggleStatus}>
                {status === "ACTIVE" ? (
                  <>
                    <Ban /> Disable
                  </>
                ) : (
                  <>
                    <CircleCheck /> Enable
                  </>
                )}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={!!temp} onOpenChange={(o) => !o && setTemp(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Temporary password</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-between rounded-md border bg-muted px-3 py-2 font-mono text-sm">
            {temp}
            <button
              onClick={() => {
                if (temp) navigator.clipboard.writeText(temp);
                toast({ title: "Copied", variant: "success" });
              }}
              className="text-muted-foreground hover:text-foreground"
            >
              <Copy className="h-4 w-4" />
            </button>
          </div>
          <DialogFooter>
            <Button onClick={() => setTemp(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
