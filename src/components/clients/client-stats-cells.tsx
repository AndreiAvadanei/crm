import { Badge } from "@/components/ui/badge";
import { formatCurrency, relativeTime } from "@/lib/utils";
import type { ClientStats } from "@/lib/client-stats";

/** Deal breakdown: total + open / won / lost badges and open pipeline value. */
export function DealBreakdownCell({ stats }: { stats: ClientStats }) {
  if (stats.dealCount === 0) {
    return <span className="text-sm text-muted-foreground">No deals</span>;
  }
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-sm tabular-nums">
          {stats.dealCount} {stats.dealCount === 1 ? "deal" : "deals"}
        </span>
        {stats.openCount > 0 && <Badge variant="secondary">{stats.openCount} open</Badge>}
        {stats.wonCount > 0 && <Badge variant="success">{stats.wonCount} won</Badge>}
        {stats.lostCount > 0 && <Badge variant="destructive">{stats.lostCount} lost</Badge>}
      </div>
      {stats.openPipelineEur > 0 && (
        <div className="text-xs text-muted-foreground tabular-nums">
          {formatCurrency(stats.openPipelineEur)} open
        </div>
      )}
    </div>
  );
}

/** "Last deal" + "Last activity" relative timestamps. */
export function ActivityCell({ stats }: { stats: ClientStats }) {
  return (
    <div className="space-y-0.5 text-xs">
      <div className="text-muted-foreground">
        Last deal: <span className="text-foreground">{relativeTime(stats.lastDealCreatedAt)}</span>
      </div>
      <div className="text-muted-foreground">
        Last activity: <span className="text-foreground">{relativeTime(stats.lastActivityAt)}</span>
      </div>
    </div>
  );
}
