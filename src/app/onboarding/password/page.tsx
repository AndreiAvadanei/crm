import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { getSession, authStage } from "@/lib/auth/session";
import { ChangePasswordForm } from "@/components/auth/change-password-form";

export const metadata = {
  title: "Set a new password",
};

export default async function OnboardingPasswordPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  const stage = authStage(s);
  if (stage === "need-2fa-enroll") redirect("/onboarding/2fa");
  if (stage === "need-2fa-verify") redirect("/login/verify");
  if (stage === "authenticated") redirect("/dashboard");

  return (
    <AuthShell title="Set a new password" subtitle="For security, you must change your password before continuing.">
      <ChangePasswordForm requireCurrent={false} />
    </AuthShell>
  );
}
