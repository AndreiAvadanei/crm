"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Handshake,
  Building2,
  Users,
  SlidersHorizontal,
  GitBranch,
  Upload,
  CheckSquare,
  Activity,
  BarChart3,
  Image as ImageIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SidebarLogo } from "@/components/app/sidebar-logo";

type NavItem = { href: string; label: string; icon: React.ElementType };

const mainNav: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/deals", label: "Deals", icon: Handshake },
  { href: "/clients", label: "Clients", icon: Building2 },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
];

const adminNav: NavItem[] = [
  { href: "/admin/insights", label: "Seller Insights", icon: BarChart3 },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/custom-fields", label: "Custom Fields", icon: SlidersHorizontal },
  { href: "/admin/pipeline", label: "Pipeline & Tags", icon: GitBranch },
  { href: "/admin/branding", label: "Branding", icon: ImageIcon },
  { href: "/admin/import", label: "Import", icon: Upload },
  { href: "/activity", label: "Activity", icon: Activity },
];

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/65 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {item.label}
    </Link>
  );
}

export function Sidebar({
  isAdmin,
  logoLightVersion = 0,
  logoDarkVersion = 0,
}: {
  isAdmin: boolean;
  logoLightVersion?: number;
  logoDarkVersion?: number;
}) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r bg-sidebar md:flex">
      <div className="flex h-14 items-center gap-2 border-b px-5 text-base font-semibold">
        <SidebarLogo lightVersion={logoLightVersion} darkVersion={logoDarkVersion} />
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {mainNav.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(item.href)} />
        ))}
        {isAdmin && (
          <>
            <div className="px-3 pb-1 pt-5 text-xs font-medium text-sidebar-foreground/45">
              Admin
            </div>
            {adminNav.map((item) => (
              <NavLink key={item.href} item={item} active={isActive(item.href)} />
            ))}
          </>
        )}
      </nav>
    </aside>
  );
}
