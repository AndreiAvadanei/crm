"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Share2 } from "lucide-react";
import { shareClientAction, unshareClientAction } from "@/server/client-share-actions";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

type ShareUser = { id: string; name: string; color: string; shared: boolean };

export function ClientShareControl({
  clientId,
  users,
  trigger,
}: {
  clientId: string;
  users: ShareUser[];
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [state, setState] = useState(users);

  async function toggle(userId: string, on: boolean) {
    setState((s) => s.map((u) => (u.id === userId ? { ...u, shared: on } : u)));
    const res = on
      ? await shareClientAction(clientId, userId)
      : await unshareClientAction(clientId, userId);
    if (res.error) {
      toast({ title: res.error, variant: "error" });
      setState((s) => s.map((u) => (u.id === userId ? { ...u, shared: !on } : u)));
      return;
    }
    router.refresh();
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <Share2 className="h-4 w-4" /> Share
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Share client access</DialogTitle>
          <DialogDescription>Grant individual sales users access to this client.</DialogDescription>
        </DialogHeader>
        <div className="max-h-80 space-y-1 overflow-y-auto">
          {state.map((u) => (
            <div key={u.id} className="flex items-center justify-between rounded-md px-2 py-1.5">
              <div className="flex items-center gap-2">
                <Avatar name={u.name} color={u.color} className="h-7 w-7 text-[10px]" />
                <span className="text-sm">{u.name}</span>
              </div>
              <Switch checked={u.shared} onCheckedChange={(v) => toggle(u.id, v)} />
            </div>
          ))}
          {state.length === 0 && (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <UserPlus className="h-4 w-4" /> No other sales users.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
