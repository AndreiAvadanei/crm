import { Plus, Pencil, SlidersHorizontal } from "lucide-react";
import { requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { getTagViews } from "@/lib/view-helpers";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UserFormDialog } from "@/components/admin/user-form-dialog";
import { AccessRulesDialog } from "@/components/admin/access-rules-dialog";
import { UserRowActions } from "@/components/admin/user-row-actions";
import { formatDate } from "@/lib/utils";

export default async function UsersAdminPage() {
  const me = await requireAdmin();
  const [users, tags] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      include: { accessRules: true, _count: { select: { credentials: true } } },
    }),
    getTagViews(),
  ]);

  return (
    <div className="pb-10">
      <PageHeader title="Users" description="Manage sales users, admins, access and onboarding.">
        <UserFormDialog
          trigger={
            <Button>
              <Plus /> New user
            </Button>
          }
        />
      </PageHeader>

      <div className="p-4 md:p-6">
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>2FA</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Visible from</TableHead>
                <TableHead>Access rules</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Avatar name={u.name} color={u.avatarColor} />
                      <div>
                        <div className="text-sm font-medium">{u.name}</div>
                        <div className="text-xs text-muted-foreground">{u.email}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.role === "ADMIN" ? "default" : "secondary"}>{u.role}</Badge>
                  </TableCell>
                  <TableCell>
                    {u.twoFactorEnabled ? (
                      <Badge variant="success">on</Badge>
                    ) : (
                      <Badge variant="warning">pending</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {u.status === "ACTIVE" ? (
                      <Badge variant="success">active</Badge>
                    ) : (
                      <Badge variant="destructive">disabled</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {u.visibleFrom ? formatDate(u.visibleFrom) : "—"}
                  </TableCell>
                  <TableCell>
                    {u.role === "ADMIN" ? (
                      <span className="text-xs text-muted-foreground">all access</span>
                    ) : (
                      <AccessRulesDialog
                        userId={u.id}
                        tags={tags}
                        initialRules={u.accessRules.map((r) => ({
                          tagId: r.tagId,
                          visibleFrom: r.visibleFrom ? r.visibleFrom.toISOString().slice(0, 10) : null,
                        }))}
                        trigger={
                          <Button variant="outline" size="sm">
                            <SlidersHorizontal className="h-3.5 w-3.5" /> {u.accessRules.length} rule
                            {u.accessRules.length === 1 ? "" : "s"}
                          </Button>
                        }
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <UserFormDialog
                        user={{
                          id: u.id,
                          name: u.name,
                          role: u.role,
                          visibleFrom: u.visibleFrom ? u.visibleFrom.toISOString() : null,
                        }}
                        trigger={
                          <Button variant="ghost" size="icon">
                            <Pencil className="h-4 w-4" />
                          </Button>
                        }
                      />
                      <UserRowActions userId={u.id} status={u.status} isSelf={u.id === me.id} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
