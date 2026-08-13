"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Handshake,
  Building2,
  Building,
  Receipt,
  FileSignature,
  ChartColumnIncreasing,
  Users,
  SlidersHorizontal,
  GitBranch,
  Upload,
  CheckSquare,
  Activity,
  BarChart3,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SidebarLogo } from "@/components/app/sidebar-logo";

type NavItem = { href: string; label: string; icon: React.ElementType };
type NavGroup = { label: string; items: NavItem[] };

const workspaceNav: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
];

const crmNav: NavItem[] = [
  { href: "/deals", label: "Deals", icon: Handshake },
  { href: "/clients", label: "Clients", icon: Building2 },
  { href: "/organizations", label: "Organizations", icon: Building },
];

const financeNav: NavItem[] = [
  { href: "/invoices", label: "Invoices", icon: Receipt },
  { href: "/contract-numbers", label: "Contract Numbers", icon: FileSignature },
];

const adminNav: NavItem[] = [
  { href: "/invoices/insights", label: "Invoices Insights", icon: ChartColumnIncreasing },
  { href: "/admin/insights", label: "Seller Insights", icon: BarChart3 },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/custom-fields", label: "Custom Fields", icon: SlidersHorizontal },
  { href: "/admin/pipeline", label: "Pipeline & Tags", icon: GitBranch },
  { href: "/admin/settings", label: "Settings", icon: Settings },
  { href: "/admin/import", label: "Import", icon: Upload },
  { href: "/activity", label: "Activity", icon: Activity },
];

const mainGroups: NavGroup[] = [
  { label: "Workspace", items: workspaceNav },
  { label: "CRM", items: crmNav },
  { label: "Finance", items: financeNav },
];

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-3 rounded-xl px-3 py-2 text-[13.5px] font-medium tracking-tight transition-colors md:py-[7px]",
        active
          ? "bg-primary/12 text-primary shadow-[inset_0_0_0_1px] shadow-primary/15"
          : "text-sidebar-foreground/68 hover:bg-sidebar-accent/80 hover:text-sidebar-foreground"
      )}
    >
      <Icon className={cn("h-4 w-4 shrink-0", active && "text-primary")} />
      {item.label}
    </Link>
  );
}

function NavSection({
  label,
  items,
  isActive,
  onNavigate,
}: {
  label: string;
  items: NavItem[];
  isActive: (href: string) => boolean;
  onNavigate?: () => void;
}) {
  return (
    <div className="space-y-0.5">
      <div className="px-3 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-sidebar-foreground/40">
        {label}
      </div>
      {items.map((item) => (
        <NavLink key={item.href} item={item} active={isActive(item.href)} onNavigate={onNavigate} />
      ))}
    </div>
  );
}

/** Shared nav list used by the desktop sidebar and the mobile drawer. */
export function AppNav({
  isAdmin,
  onNavigate,
  className,
}: {
  isAdmin: boolean;
  onNavigate?: () => void;
  className?: string;
}) {
  const pathname = usePathname();
  // Pick the single most specific (longest) matching nav href so overlapping
  // prefixes like /invoices and /invoices/insights don't both highlight.
  const allHrefs = [...workspaceNav, ...crmNav, ...financeNav, ...adminNav].map((i) => i.href);
  const bestMatch = allHrefs
    .filter((href) => pathname === href || pathname.startsWith(href + "/"))
    .sort((a, b) => b.length - a.length)[0];
  const isActive = (href: string) => href === bestMatch;

  return (
    <nav className={cn("flex-1 space-y-1 overflow-y-auto px-3 pb-4 pt-1", className)}>
      {mainGroups.map((group) => (
        <NavSection
          key={group.label}
          label={group.label}
          items={group.items}
          isActive={isActive}
          onNavigate={onNavigate}
        />
      ))}
      {isAdmin && (
        <NavSection label="Admin" items={adminNav} isActive={isActive} onNavigate={onNavigate} />
      )}
    </nav>
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
  return (
    <aside className="hidden w-64 shrink-0 flex-col bg-sidebar md:flex">
      <div className="flex h-16 items-center gap-2.5 px-5 text-[15px] font-semibold tracking-tight">
        <SidebarLogo lightVersion={logoLightVersion} darkVersion={logoDarkVersion} />
      </div>
      <AppNav isAdmin={isAdmin} />
    </aside>
  );
}
