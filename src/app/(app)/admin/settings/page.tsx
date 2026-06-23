import { requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { getSetting, SETTING_KEYS } from "@/lib/settings";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { DefaultOwnerForm } from "@/components/admin/default-owner-form";
import { InboundWebhookForm } from "@/components/admin/inbound-webhook-form";

export const metadata = {
  title: "Settings",
};

export default async function SettingsPage() {
  await requireAdmin();

  const [owners, defaultOwnerId, webhookSecret] = await Promise.all([
    prisma.user.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true },
    }),
    getSetting(SETTING_KEYS.defaultDealOwnerId),
    getSetting(SETTING_KEYS.inboundWebhookSecret),
  ]);

  // Only surface a stored id that still maps to an active user.
  const currentOwnerId = defaultOwnerId && owners.some((o) => o.id === defaultOwnerId) ? defaultOwnerId : null;

  const baseUrl = (process.env.APP_BASE_URL || "http://localhost:3007").replace(/\/$/, "");
  const webhookUrl = `${baseUrl}/api/webhooks/inbound-email`;

  return (
    <div>
      <PageHeader title="Settings" description="Workspace-wide defaults and automation." />
      <div className="grid gap-6 p-4 md:max-w-2xl md:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Deal assignment</CardTitle>
            <CardDescription>
              Choose who new deals are assigned to when no owner is selected at creation time.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DefaultOwnerForm owners={owners} currentOwnerId={currentOwnerId} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Inbound email webhook</CardTitle>
            <CardDescription>
              Receive lead emails (e.g. forwarded from Gmail) as JSON. Each request creates a client (if
              new) and a deal, auto-assigned using the default assignee above.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <InboundWebhookForm webhookUrl={webhookUrl} currentSecret={webhookSecret} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
