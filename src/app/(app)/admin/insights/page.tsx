import { requireAdmin } from "@/lib/auth/guards";
import { getSellerBreakdown, type Granularity } from "@/lib/analytics";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DashboardFilters } from "@/components/dashboard/dashboard-filters";
import { SellerCompareChart } from "@/components/dashboard/dashboard-charts";
import { GranularityToggle } from "@/components/dashboard/scorecard-table";
import { SellerInsights } from "@/components/dashboard/seller-insights";
import { formatCurrency } from "@/lib/utils";

export const metadata = {
  title: "Seller insights",
};

function parseDate(v?: string): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export default async function AdminInsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; active?: string; gran?: string }>;
}) {
  const user = await requireAdmin();
  const sp = await searchParams;

  const granularity: Granularity =
    sp.gran === "semester" || sp.gran === "year" ? sp.gran : "quarter";

  const sellers = await getSellerBreakdown(user, {
    from: parseDate(sp.from),
    to: parseDate(sp.to) ?? new Date(),
    activeOnly: sp.active === "1",
    granularity,
  });

  const maxWon = Math.max(1, ...sellers.map((s) => s.kpis.totalWon));
  const chartData = sellers.map((s) => ({
    name: s.name,
    color: s.avatarColor,
    won: s.kpis.totalWon,
    pipeline: s.kpis.pipelineTotal,
  }));

  return (
    <div className="pb-10">
      <PageHeader
        title="Seller insights"
        description="Compare sales performance across the team."
      />
      <div className="space-y-6 p-4 md:p-6">
        <DashboardFilters showComparison={false} />

        {sellers.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              No deals in this window yet.
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Leaderboard · won value</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {sellers.map((s, i) => (
                    <div key={s.ownerId} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2">
                          <span className="w-4 text-xs text-muted-foreground tabular-nums">
                            {i + 1}
                          </span>
                          <Avatar name={s.name} color={s.avatarColor} className="h-6 w-6 text-[10px]" />
                          {s.name}
                        </span>
                        <span className="font-medium tabular-nums">
                          {formatCurrency(s.kpis.totalWon)}
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-muted">
                        <div
                          className="h-2 rounded-full bg-primary"
                          style={{ width: `${(s.kpis.totalWon / maxWon) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <SellerCompareChart data={chartData} />
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Per-seller KPIs</CardTitle>
              </CardHeader>
              <CardContent className="px-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Seller</TableHead>
                      <TableHead className="text-right">Pipeline</TableHead>
                      <TableHead className="text-right">Won value</TableHead>
                      <TableHead className="text-right">Win rate</TableHead>
                      <TableHead className="text-right">Loss rate</TableHead>
                      <TableHead className="text-right">Avg won</TableHead>
                      <TableHead className="text-right">Avg cycle</TableHead>
                      <TableHead className="text-right">W / L / Open</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sellers.map((s) => (
                      <TableRow key={s.ownerId}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Avatar name={s.name} color={s.avatarColor} className="h-7 w-7 text-[11px]" />
                            <div>
                              <div className="text-sm font-medium">{s.name}</div>
                              <Badge variant={s.role === "ADMIN" ? "default" : "secondary"} className="mt-0.5">
                                {s.role}
                              </Badge>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(s.kpis.pipelineTotal)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(s.kpis.totalWon)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {Math.round(s.kpis.winRate)}%
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {Math.round(s.kpis.lossRate)}%
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(s.kpis.avgWonDeal)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {s.kpis.avgDaysToClose ? `${Math.round(s.kpis.avgDaysToClose)}d` : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                          {s.kpis.wonCount} / {s.kpis.lostCount} / {s.kpis.openCount}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Per-seller breakdown</h2>
                <p className="text-sm text-muted-foreground">
                  Yearly statistics with trimestrial, semestrial &amp; anual win
                  rate and value per seller.
                </p>
              </div>
              <GranularityToggle granularity={granularity} />
            </div>

            <SellerInsights sellers={sellers} />
          </>
        )}
      </div>
    </div>
  );
}
