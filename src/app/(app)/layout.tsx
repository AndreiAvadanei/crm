import { requireFullAuth } from "@/lib/auth/guards";
import { brandingLogoVersion } from "@/lib/branding";
import { Sidebar } from "@/components/app/sidebar";
import { Topbar } from "@/components/app/topbar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireFullAuth();
  const [logoLightVersion, logoDarkVersion] = await Promise.all([
    brandingLogoVersion("light"),
    brandingLogoVersion("dark"),
  ]);

  return (
    <div className="flex h-screen overflow-hidden bg-sidebar">
      <Sidebar
        isAdmin={user.role === "ADMIN"}
        logoLightVersion={logoLightVersion}
        logoDarkVersion={logoDarkVersion}
      />
      <div className="flex min-w-0 flex-1 flex-col p-0 md:p-2 md:pl-0">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background md:rounded-2xl md:border md:border-border/70 md:shadow-[var(--shadow-sm)]">
          <Topbar
            name={user.name}
            email={user.email}
            role={user.role}
            avatarColor={user.avatarColor}
            isAdmin={user.role === "ADMIN"}
            logoLightVersion={logoLightVersion}
            logoDarkVersion={logoDarkVersion}
          />
          <main className="flex-1 overflow-y-auto overscroll-contain">{children}</main>
        </div>
      </div>
    </div>
  );
}
