"use client";

import { useRef } from "react";
import Link from "next/link";
import { LogOut, User as UserIcon, ShieldCheck } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { logoutAction } from "@/server/auth-actions";
import { APP_NAME } from "@/lib/app-constants";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function Topbar({
  name,
  email,
  role,
  avatarColor,
}: {
  name: string;
  email: string;
  role: string;
  avatarColor: string;
}) {
  const logoutFormRef = useRef<HTMLFormElement>(null);
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b bg-background px-4 md:px-6">
      <div className="md:hidden flex items-center gap-2 font-semibold">
        <ShieldCheck className="h-5 w-5 text-primary" /> {APP_NAME}
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent">
            <Avatar name={name} color={avatarColor} />
            <div className="hidden text-left sm:block">
              <div className="text-sm font-medium leading-tight">{name}</div>
              <div className="text-xs text-muted-foreground leading-tight">{email}</div>
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="flex items-center justify-between">
              Account
              <Badge variant={role === "ADMIN" ? "default" : "secondary"}>{role}</Badge>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/account/security">
                <UserIcon /> Security & passkeys
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-2"
              onSelect={() => logoutFormRef.current?.requestSubmit()}
            >
              <LogOut /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {/* Kept outside the dropdown so it isn't unmounted when the menu closes. */}
      <form ref={logoutFormRef} action={logoutAction} className="hidden" />
    </header>
  );
}
