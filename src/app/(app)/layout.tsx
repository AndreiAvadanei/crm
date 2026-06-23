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
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        isAdmin={user.role === "ADMIN"}
        logoLightVersion={logoLightVersion}
        logoDarkVersion={logoDarkVersion}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar name={user.name} email={user.email} role={user.role} avatarColor={user.avatarColor} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
