import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { getSession, authStage } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export const metadata = {
  title: "Sign in",
};

export default async function LoginPage() {
  const stage = authStage(await getSession());
  if (stage === "need-password") redirect("/onboarding/password");
  if (stage === "need-2fa-enroll") redirect("/onboarding/2fa");
  if (stage === "need-2fa-verify") redirect("/login/verify");
  if (stage === "authenticated") redirect("/dashboard");

  return (
    <AuthShell title="Sign in" subtitle="Enter your credentials to access the workspace.">
      <LoginForm />
    </AuthShell>
  );
}
