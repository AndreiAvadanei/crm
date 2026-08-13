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
      <div className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-12 lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(700px_420px_at_20%_0%,color-mix(in_oklch,var(--primary)_22%,transparent),transparent_60%),radial-gradient(520px_360px_at_90%_80%,color-mix(in_oklch,var(--chart-5)_14%,transparent),transparent_55%)]"
        />
        <div className="relative flex items-center gap-2.5 text-[17px] font-semibold tracking-tight text-foreground">
          <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-primary/12 text-primary">
            <ShieldCheck className="h-5 w-5" />
          </span>
          {PUBLIC_APP_NAME}
        </div>
        <div className="relative max-w-md space-y-4">
          <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight text-foreground">
            Close more deals with a faster, modern pipeline.
          </h1>
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            Clients, deals, tasks, files and insights — secured with mandatory 2FA and passkeys.
          </p>
        </div>
        <div className="relative text-sm text-muted-foreground">Secure sales workspace</div>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-7">
          <div className="space-y-2">
            <h2 className="text-[1.75rem] font-semibold tracking-tight">{title}</h2>
            {subtitle && <p className="text-[15px] leading-relaxed text-muted-foreground">{subtitle}</p>}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
