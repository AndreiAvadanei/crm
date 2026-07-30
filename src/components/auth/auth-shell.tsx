import { ShieldCheck } from "lucide-react";
import { PUBLIC_APP_NAME } from "@/lib/app-constants";

export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden border-r bg-muted p-12 lg:flex">
        <div className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <ShieldCheck className="h-6 w-6 text-primary" />
          {PUBLIC_APP_NAME}
        </div>
        <div className="space-y-4">
          <h1 className="text-3xl font-semibold leading-tight text-foreground">
            Close more deals with a faster, modern pipeline.
          </h1>
          <p className="max-w-md text-muted-foreground">
            Clients, deals, tasks, files and insights — secured with mandatory 2FA and passkeys.
          </p>
        </div>
        <div className="text-sm text-muted-foreground">Secure sales workspace</div>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-1.5">
            <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
            {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
