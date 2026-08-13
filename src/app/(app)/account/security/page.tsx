import { requireFullAuth } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChangePasswordForm } from "@/components/auth/change-password-form";
import { SecurityFactors } from "@/components/auth/security-factors";

export const metadata = {
  title: "Security",
};

export default async function SecurityPage() {
  const user = await requireFullAuth();
  const credentials = await prisma.webAuthnCredential.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <PageHeader title="Security" description="Manage your password and two-factor methods." />
      <div className="page-body grid gap-6 pt-0 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Password</CardTitle>
            <CardDescription>Change your account password.</CardDescription>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm requireCurrent />
          </CardContent>
        </Card>

        <SecurityFactors
          hasTotp={!!user.totpSecret}
          credentials={credentials.map((c) => ({
            id: c.id,
            deviceName: c.deviceName,
            createdAt: c.createdAt.toISOString(),
            lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
          }))}
        />
      </div>
    </div>
  );
}
