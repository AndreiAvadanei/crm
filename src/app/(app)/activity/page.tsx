import Link from "next/link";
import { requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  activityPhrase,
  activityChanges,
  activityEntityName,
  activityEntityHref,
} from "@/lib/activity-format";
import { EmptyState } from "@/components/shared/empty-state";
import { formatDateTime, relativeTime } from "@/lib/utils";
import { Activity } from "lucide-react";

export const metadata = {
  title: "Activity",
};

export default async function ActivityPage() {
  // Admin-only: a full cross-system audit feed.
  await requireAdmin();

  const events = await prisma.auditLog.findMany({
    include: { actor: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <div>
      <PageHeader title="Activity" description="Recent actions across the whole system." />

      <div className="page-body pt-0">
        <Card>
          <CardContent className="divide-y p-0">
            {events.length === 0 && (
              <EmptyState
                icon={Activity}
                title="No activity yet"
                description="Actions across deals, clients, and invoices will show up here."
              />
            )}
            {events.map((e) => {
              const meta = e.meta as Record<string, unknown> | null;
              const changes = activityChanges(meta);
              const name = activityEntityName(meta);
              const href = activityEntityHref(e.entity, e.entityId, meta);
              return (
                <div key={e.id} className="flex items-start gap-3 px-5 py-3.5">
                  <Avatar
                    name={e.actor?.name ?? "System"}
                    color={e.actor?.avatarColor ?? "#64748b"}
                    className="mt-0.5 h-8 w-8 text-xs"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm">
                      <span className="font-medium">{e.actor?.name ?? "System"}</span>{" "}
                      <span className="text-muted-foreground">{activityPhrase(e.action, meta)}</span>
                    </div>
                    {changes.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {changes.map((c, i) => (
                          <li key={i} className="text-xs text-muted-foreground">
                            <span className="font-medium text-foreground/80">{c.label}:</span>{" "}
                            <span className="line-through decoration-muted-foreground/40">{c.from}</span>
                            <span className="px-1">{"\u2192"}</span>
                            <span className="text-foreground/90">{c.to}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="secondary" className="font-normal">
                        {e.entity}
                      </Badge>
                      {name &&
                        (href ? (
                          <Link href={href} className="font-medium text-foreground/80 hover:underline">
                            {name}
                          </Link>
                        ) : (
                          <span className="text-foreground/80">{name}</span>
                        ))}
                      <span title={formatDateTime(e.createdAt)}>{relativeTime(e.createdAt)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
