import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { getSession, authStage } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { TwoFactorVerify } from "@/components/auth/two-factor-verify";

export const metadata = {
  title: "Verify it's you",
};

export default async function VerifyPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  const stage = authStage(s);
  if (stage === "need-password") redirect("/onboarding/password");
  if (stage === "need-2fa-enroll") redirect("/onboarding/2fa");
  if (stage === "authenticated") redirect("/dashboard");

  const passkeyCount = await prisma.webAuthnCredential.count({ where: { userId: s.user.id } });

  return (
    <AuthShell title="Verify it's you" subtitle="Enter your authenticator code or use a passkey.">
      <TwoFactorVerify hasTotp={!!s.user.totpSecret} hasPasskey={passkeyCount > 0} />
    </AuthShell>
  );
}
