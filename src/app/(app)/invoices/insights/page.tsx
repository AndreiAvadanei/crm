import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { getInvoiceInsights } from "@/lib/invoice-insights";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { InvoiceInsightsClient, type InsightsData } from "@/components/invoices/invoice-insights-client";
import { InsightsIssuerSwitcher } from "@/components/invoices/insights-issuer-switcher";

export const metadata = { title: "Invoices Insights" };

export default async function InvoiceInsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ issuer?: string }>;
}) {
  const user = await requireAdmin();
  const { issuer: issuerParam } = await searchParams;

  const issuers = await prisma.issuer.findMany({
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    select: { id: true, name: true, isDefault: true },
  });
  const defaultIssuer = issuers.find((i) => i.isDefault) ?? issuers[0];
  // Default to the default issuer; "all" means overall. Honor an explicit param.
  const known = new Set(issuers.map((i) => i.name));
  const selected = issuerParam === "all" ? "all" : issuerParam && known.has(issuerParam) ? issuerParam : defaultIssuer?.name ?? "all";

  const insights = await getInvoiceInsights(user, { issuer: selected === "all" ? null : selected });

  const data: InsightsData = {
    generatedAt: insights.generatedAt.toISOString(),
    currentYear: insights.currentYear,
    previousYear: insights.previousYear,
    currencies: insights.currencies,
    summaries: insights.summaries,
    yearly: insights.yearly,
    monthly: insights.monthly,
    quarters: insights.quarters,
    semesters: insights.semesters,
    forecast: insights.forecast,
    monthlyMatrix: insights.monthlyMatrix,
    clientYearly: insights.clientYearly,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Invoices Insights"
        description={
          selected === "all"
            ? "Net-of-VAT trends and predicted cashflow across all issuers."
            : `Net-of-VAT trends and predicted cashflow for ${selected}.`
        }
      >
        <Button asChild variant="outline" size="sm">
          <Link href="/invoices">
            <ArrowLeft className="h-4 w-4" />
            Back to invoices
          </Link>
        </Button>
      </PageHeader>

      <div className="px-4 pt-2 md:px-6">
        <InsightsIssuerSwitcher issuers={issuers} selected={selected} />
      </div>

      <InvoiceInsightsClient data={data} />
    </div>
  );
}
