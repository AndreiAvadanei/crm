import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { getSession, authStage } from "@/lib/auth/session";
import { TwoFactorEnroll } from "@/components/auth/two-factor-enroll";

export default async function Onboarding2faPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  const stage = authStage(s);
  if (stage === "need-password") redirect("/onboarding/password");
  if (stage === "authenticated") redirect("/dashboard");
  // need-2fa-verify means already enrolled -> go verify
  if (stage === "need-2fa-verify") redirect("/login/verify");

  return (
    <AuthShell
      title="Secure your account"
      subtitle="Two-factor authentication is required. Choose an authenticator app or a passkey."
    >
      <TwoFactorEnroll />
    </AuthShell>
  );
}
