import fs from "fs";
import path from "path";
import { Upload, ShieldAlert, FileSpreadsheet } from "lucide-react";
import { requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const metadata = {
  title: "Import from Jira",
};

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-2xl border bg-muted px-4 py-3 text-xs">
      <code>{children}</code>
    </pre>
  );
}

export default async function ImportPage() {
  await requireAdmin();

  const csvPath = path.join(process.cwd(), "jira.csv");
  let fileInfo: { exists: boolean; sizeMb?: string } = { exists: false };
  try {
    const st = fs.statSync(csvPath);
    fileInfo = { exists: true, sizeMb: (st.size / 1024 / 1024).toFixed(1) };
  } catch {
    fileInfo = { exists: false };
  }

  const [dealCount, clientCount, taskCount] = await Promise.all([
    prisma.deal.count({ where: { deletedAt: null } }),
    prisma.client.count(),
    prisma.task.count(),
  ]);

  return (
    <div>
      <PageHeader title="Import from Jira" description="Bring your existing Jira Sales data into Bit Sentinel." />
      <div className="page-body grid gap-6 pt-0 md:grid-cols-3">
        <div className="space-y-6 md:col-span-2">
          <Card className="border-warning/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-[var(--warning)]" /> Guarded operation
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>
                The importer never runs automatically. It defaults to a <strong>dry run</strong> that only previews
                what would be imported. Review the preview first, then run with <code>--commit</code> to apply. The
                import is idempotent — safe to re-run (deals upsert on their <code>SAL-</code> id).
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>How to run</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div>
                <div className="mb-1 font-medium">1. Preview (no writes)</div>
                <CodeBlock>npm run import:jira -- --file ./jira.csv --dry-run</CodeBlock>
              </div>
              <div>
                <div className="mb-1 font-medium">Verify Jira file downloads (no writes)</div>
                <CodeBlock>npm run import:jira -- --file ./jira.csv --dry-run --verify-downloads 2</CodeBlock>
              </div>
              <div>
                <div className="mb-1 font-medium">2. Apply when satisfied</div>
                <CodeBlock>npm run import:jira -- --file ./jira.csv --commit</CodeBlock>
              </div>
              <div>
                <div className="mb-1 font-medium">Apply and copy Jira files into Bit Sentinel storage</div>
                <CodeBlock>JIRA_EMAIL="you@example.com" JIRA_API_TOKEN="..." npm run import:jira -- --file ./jira.csv --commit --download-files</CodeBlock>
              </div>
              <p className="text-muted-foreground">
                Inside Docker: <code>docker compose exec web npm run import:jira -- --file ./jira.csv --commit</code>
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>What gets imported</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>• <strong>Customer</strong> issues become <strong>Deals</strong> (and auto-create their company as a <strong>Client</strong>). The Jira <code>Issue key</code> becomes the deal <code>SAL-</code> id.</p>
              <p>• <strong>Subtask</strong> issues become <strong>Tasks</strong> on their parent deal; subtask descriptions, comments, and files are preserved on the parent deal with the subtask key/title.</p>
              <p>• <code>Status</code> maps to a pipeline stage (missing stages are created), <code>Labels</code> to tags.</p>
              <p>• Selected <code>Custom field (...)</code> columns map to deal fields and custom field values.</p>
              <p>• <code>Comment</code> columns become deal comments; <code>Attachment</code> columns become attachment records linking the original Jira file URL, or downloaded Bit Sentinel files when <code>--download-files</code> is used.</p>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5" /> Source file
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">jira.csv</span>
                {fileInfo.exists ? (
                  <Badge variant="success">found · {fileInfo.sizeMb} MB</Badge>
                ) : (
                  <Badge variant="destructive">not found</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Place the export at the project root as <code>jira.csv</code>.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5" /> Current data
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Deals</span>
                <span className="font-medium tabular-nums">{dealCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Clients</span>
                <span className="font-medium tabular-nums">{clientCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tasks</span>
                <span className="font-medium tabular-nums">{taskCount}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
