"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Copy } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { createUserAction, updateUserAction } from "@/server/admin-actions";

type UserData = { id: string; name: string; email: string; role: string; visibleFrom: string | null; invoiceVisibleFrom: string | null };

export function UserFormDialog({ trigger, user }: { trigger: React.ReactNode; user?: UserData }) {
  const router = useRouter();
  const { toast } = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [temp, setTemp] = useState<string | null>(null);
  const editing = !!user;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formRef.current) return;
    setBusy(true);
    const fd = new FormData(formRef.current);
    const res = editing ? await updateUserAction(user!.id, fd) : await createUserAction(fd);
    setBusy(false);
    if (res.error) return toast({ title: res.error, variant: "error" });
    if (!editing && res.tempPassword) {
      setTemp(res.tempPassword);
      router.refresh();
      return;
    }
    toast({ title: "User updated", variant: "success" });
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setTemp(null);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit user" : "New user"}</DialogTitle>
          <DialogDescription>
            {editing ? "Update role and default visibility." : "An onboarding temp password is generated."}
          </DialogDescription>
        </DialogHeader>

        {temp ? (
          <div className="space-y-4">
            <p className="text-sm">User created. Share this one-time password — they must change it and enroll 2FA on first login.</p>
            <div className="flex items-center justify-between rounded-md border bg-muted px-3 py-2 font-mono text-sm">
              {temp}
              <button
                onClick={() => {
                  navigator.clipboard.writeText(temp);
                  toast({ title: "Copied", variant: "success" });
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <Copy className="h-4 w-4" />
              </button>
            </div>
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form ref={formRef} onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Full name</Label>
              <Input id="name" name="name" defaultValue={user?.name ?? ""} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" defaultValue={user?.email ?? ""} required />
              {editing && (
                <p className="text-xs text-muted-foreground">
                  Changing the email updates the login address and signs the user out of active sessions.
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="role">Role</Label>
                <select
                  id="role"
                  name="role"
                  defaultValue={user?.role ?? "SALES"}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="SALES">Sales</option>
                  <option value="ADMIN">Admin</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="visibleFrom">Visible from</Label>
                <Input
                  id="visibleFrom"
                  name="visibleFrom"
                  type="date"
                  defaultValue={user?.visibleFrom?.slice(0, 10) ?? ""}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="invoiceVisibleFrom">Invoices visible from</Label>
              <Input
                id="invoiceVisibleFrom"
                name="invoiceVisibleFrom"
                type="date"
                defaultValue={user?.invoiceVisibleFrom?.slice(0, 10) ?? ""}
              />
              <p className="text-xs text-muted-foreground">
                Sales user can see every invoice issued on/after this date, even for clients not shared with them. Leave
                empty to limit invoices to their visible clients.
              </p>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {editing ? "Save" : "Create user"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
