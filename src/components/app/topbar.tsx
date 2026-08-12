"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { LogOut, Menu, User as UserIcon } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { AppNav } from "@/components/app/sidebar";
import { SidebarLogo } from "@/components/app/sidebar-logo";
import { logoutAction } from "@/server/auth-actions";
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
  isAdmin,
  logoLightVersion = 0,
  logoDarkVersion = 0,
}: {
  name: string;
  email: string;
  role: string;
  avatarColor: string;
  isAdmin: boolean;
  logoLightVersion?: number;
  logoDarkVersion?: number;
}) {
  const logoutFormRef = useRef<HTMLFormElement>(null);
  const [navOpen, setNavOpen] = useState(false);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b bg-background px-3 md:px-6">
      <div className="flex min-w-0 items-center gap-1 md:hidden">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Open navigation"
          onClick={() => setNavOpen(true)}
        >
          <Menu />
        </Button>
        <div className="truncate text-base font-semibold">
          <SidebarLogo lightVersion={logoLightVersion} darkVersion={logoDarkVersion} />
        </div>
      </div>

      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent
          side="left"
          className="w-[min(20rem,100vw)] gap-0 bg-sidebar p-0 sm:max-w-[20rem]"
        >
          <div className="flex h-14 items-center gap-2 border-b px-5 pr-12 text-base font-semibold">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SidebarLogo lightVersion={logoLightVersion} darkVersion={logoDarkVersion} />
          </div>
          <AppNav isAdmin={isAdmin} onNavigate={() => setNavOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="hidden flex-1 md:block" />
      <div className="flex items-center gap-1 sm:gap-2">
        <ThemeToggle />
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent">
            <Avatar name={name} color={avatarColor} />
            <div className="hidden text-left sm:block">
              <div className="text-sm font-medium leading-tight">{name}</div>
              <div className="text-xs leading-tight text-muted-foreground">{email}</div>
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
