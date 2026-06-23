import { Plus, Pencil } from "lucide-react";
import { requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StagesManager, type StageItem } from "@/components/admin/stages-manager";
import { TagDialog } from "@/components/admin/tag-dialog";
import { DeleteButton } from "@/components/shared/delete-button";
import { deleteTagAction } from "@/server/admin-actions";
import { TagBadge } from "@/components/shared/tag-badge";

export const metadata = {
  title: "Pipeline & tags",
};

export default async function PipelinePage() {
  await requireAdmin();
  const pipeline = await prisma.pipeline.findFirst({
    where: { isDefault: true },
    include: {
      stages: { orderBy: { order: "asc" }, include: { _count: { select: { deals: true } } } },
    },
  });
  const tags = await prisma.tag.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { deals: true } } } });

  const stageItems: StageItem[] = (pipeline?.stages ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    color: s.color,
    probability: s.probability,
    phase: s.phase,
    isWon: s.isWon,
    isLost: s.isLost,
    dealCount: s._count.deals,
  }));

  return (
    <div className="pb-10">
      <PageHeader title="Pipeline & tags" description="Configure deal stages and tags." />
      <div className="grid gap-6 p-4 md:grid-cols-2 md:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Stages</CardTitle>
          </CardHeader>
          <CardContent>
            <StagesManager stages={stageItems} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Tags</CardTitle>
            <TagDialog
              trigger={
                <Button size="sm">
                  <Plus /> New tag
                </Button>
              }
            />
          </CardHeader>
          <CardContent className="space-y-2">
            {tags.map((t) => (
              <div key={t.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
                <div className="flex items-center gap-3">
                  <TagBadge tag={t} />
                  <span className="text-xs text-muted-foreground">{t._count.deals} deals</span>
                </div>
                <div className="flex items-center gap-1">
                  <TagDialog
                    tag={{ id: t.id, name: t.name, color: t.color }}
                    trigger={
                      <Button variant="ghost" size="icon">
                        <Pencil className="h-4 w-4" />
                      </Button>
                    }
                  />
                  <DeleteButton iconOnly onDelete={deleteTagAction.bind(null, t.id)} title="Delete tag?" />
                </div>
              </div>
            ))}
            {tags.length === 0 && <p className="text-sm text-muted-foreground">No tags.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
