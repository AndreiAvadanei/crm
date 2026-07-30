import { requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { getDefaultOrganizationTvaPercent, getSetting, getTaskWebhookDefaults, SETTING_KEYS } from "@/lib/settings";
import { brandingLogoVersion } from "@/lib/branding";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { DefaultOwnerForm } from "@/components/admin/default-owner-form";
import { DefaultOrganizationTvaForm } from "@/components/admin/default-organization-tva-form";
import { InboundWebhookForm } from "@/components/admin/inbound-webhook-form";
import { TaskWebhookDefaultsForm } from "@/components/admin/task-webhook-defaults-form";
import { BrandingForm } from "@/components/admin/branding-form";
import { IssuersManager } from "@/components/admin/issuers-card";
import { SeriesManager } from "@/components/admin/series-card";
import { PartNumbersManager } from "@/components/admin/part-numbers-card";
import { setInvoiceWebhookSecretAction, setTaskWebhookSecretAction } from "@/server/admin-actions";

export const metadata = {
  title: "Settings",
};

export default async function SettingsPage() {
  await requireAdmin();

  const [owners, defaultOwnerId, defaultOrganizationTvaPercent, webhookSecret, invoiceWebhookSecret, taskWebhookSecret, taskWebhookDefaults, lightLogo, darkLogo, issuers, series, partNumbers] = await Promise.all([
    prisma.user.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true },
    }),
    getSetting(SETTING_KEYS.defaultDealOwnerId),
    getDefaultOrganizationTvaPercent(),
    getSetting(SETTING_KEYS.inboundWebhookSecret),
    getSetting(SETTING_KEYS.invoiceWebhookSecret),
    getSetting(SETTING_KEYS.taskWebhookSecret),
    getTaskWebhookDefaults(),
    brandingLogoVersion("light"),
    brandingLogoVersion("dark"),
    prisma.issuer.findMany({
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      select: {
        id: true, name: true, legalName: true, taxId: true, regCom: true, country: true,
        county: true, city: true, address: true, bankName: true, iban: true, phone: true,
        email: true, capital: true, infSupl: true, isActive: true, isDefault: true,
      },
    }),
    prisma.invoiceSeries.findMany({
      orderBy: [{ isDefault: "desc" }, { prefix: "asc" }],
      select: { id: true, prefix: true, nextNumber: true, isActive: true, isDefault: true },
    }),
    prisma.partNumber.findMany({
      orderBy: [{ order: "asc" }, { code: "asc" }],
      select: {
        id: true, code: true, group: true, title: true, limitations: true, category: true,
        subCategory: true, subSubCategory: true, type: true, description: true, active: true,
      },
    }),
  ]);

  // Only surface a stored id that still maps to an active user.
  const currentOwnerId = defaultOwnerId && owners.some((o) => o.id === defaultOwnerId) ? defaultOwnerId : null;

  const baseUrl = (process.env.APP_BASE_URL || "http://localhost:3007").replace(/\/$/, "");
  const webhookUrl = `${baseUrl}/api/webhooks/inbound-email`;
  const invoiceWebhookUrl = `${baseUrl}/api/webhooks/invoice-files`;
  const taskWebhookUrl = `${baseUrl}/api/webhooks/create-task`;

  return (
    <div>
      <PageHeader title="Settings" description="Workspace-wide defaults and automation." />
      <div className="grid items-start gap-6 p-4 md:grid-cols-2 md:p-6">
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
            <CardTitle>Organization VAT</CardTitle>
            <CardDescription>
              Choose the default VAT percentage for new billing organizations.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DefaultOrganizationTvaForm currentPercent={defaultOrganizationTvaPercent} />
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

        <Card>
          <CardHeader>
            <CardTitle>Inbound invoice webhook</CardTitle>
            <CardDescription>
              Receive issued invoice PDFs (replies forwarded from Gmail) as JSON. Each request stores the
              files, extracts the number/total/date with OpenAI, attaches them to the matching invoice, and
              marks it Generated.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <InboundWebhookForm
              webhookUrl={invoiceWebhookUrl}
              currentSecret={invoiceWebhookSecret}
              action={setInvoiceWebhookSecretAction}
              urlHint={
                <p className="text-xs text-muted-foreground">
                  POST the invoice-files JSON here. Authenticate with header <code>x-webhook-secret</code>, an{" "}
                  <code>Authorization: Bearer &lt;secret&gt;</code> header, or a <code>?secret=</code> query
                  param. Set this same value as <code>WEBHOOK_SECRET</code> in the Gmail Apps Script.
                </p>
              }
            />
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Create-task webhook</CardTitle>
            <CardDescription>
              POST <code>{`{ "sales_id": "SAL-1234" }`}</code> to add a follow-up task to that deal. The task
              is assigned to the deal owner (or the default assignee above when the deal has no owner),
              using the text, due date, and priority configured below. A request may override any of these
              by sending <code>title</code>, <code>due_days</code>, or <code>priority</code>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 md:grid-cols-2">
              <InboundWebhookForm
                webhookUrl={taskWebhookUrl}
                currentSecret={taskWebhookSecret}
                action={setTaskWebhookSecretAction}
                urlHint={
                  <p className="text-xs text-muted-foreground">
                    POST JSON with a <code>sales_id</code> here. Authenticate with header{" "}
                    <code>x-webhook-secret</code>, an <code>Authorization: Bearer &lt;secret&gt;</code>{" "}
                    header, or a <code>?secret=</code> query param.
                  </p>
                }
              />
              <div className="space-y-2">
                <p className="text-sm font-medium">Task defaults</p>
                <TaskWebhookDefaultsForm
                  title={taskWebhookDefaults.title}
                  dueDays={taskWebhookDefaults.dueDays}
                  urgency={taskWebhookDefaults.urgency}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Invoice issuers</CardTitle>
            <CardDescription>
              Define the legal entities you issue invoices from (e.g. BIT SENTINEL SECURITY SRL, CYBEREDU SRL).
              Each issuer is selectable in the new-invoice wizard and usable as an invoice filter.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <IssuersManager issuers={issuers} />
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Invoice number series</CardTitle>
            <CardDescription>
              Define number series (e.g. prefix &quot;BIT.R&quot;) with a starting number. FacturaNumar is assigned and
              the counter auto-increments the first time each invoice is issued.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SeriesManager series={series} />
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Part numbers</CardTitle>
            <CardDescription>
              Manage the billable part-number matrix. Auto-populate it from the matrix file, then inline-edit, add,
              or delete entries. Codes with <code>&lt;limit&gt;</code> placeholders are filled in per invoice.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PartNumbersManager partNumbers={partNumbers} />
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Branding</CardTitle>
            <CardDescription>
              Upload your project logo (PNG) for light and dark mode. It replaces the title in the sidebar.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-2">
                <p className="text-sm font-medium">Light mode logo</p>
                <BrandingForm mode="light" version={lightLogo} />
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">Dark mode logo</p>
                <BrandingForm mode="dark" version={darkLogo} />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
