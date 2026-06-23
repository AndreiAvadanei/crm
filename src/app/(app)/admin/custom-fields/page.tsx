import { Plus, Pencil } from "lucide-react";
import { requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { fieldOptions } from "@/lib/custom-fields";
import type { CustomEntity, CustomFieldDefinition } from "@/generated/prisma";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CustomFieldDialog } from "@/components/admin/custom-field-dialog";
import { DeleteButton } from "@/components/shared/delete-button";
import { deleteFieldDefAction } from "@/server/admin-actions";

function FieldList({ entity, defs }: { entity: CustomEntity; defs: CustomFieldDefinition[] }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>{entity === "DEAL" ? "Deal fields" : "Client fields"}</CardTitle>
        <CustomFieldDialog
          entity={entity}
          trigger={
            <Button size="sm">
              <Plus /> New field
            </Button>
          }
        />
      </CardHeader>
      <CardContent className="space-y-2">
        {defs.map((d) => (
          <div key={d.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium">
                {d.label}
                {d.required && <Badge variant="warning">required</Badge>}
              </div>
              <div className="text-xs text-muted-foreground">
                {d.type}
                {fieldOptions(d).length > 0 ? ` · ${fieldOptions(d).map((o) => o.value).join(", ")}` : ""}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <CustomFieldDialog
                entity={entity}
                field={{ id: d.id, label: d.label, type: d.type, required: d.required, options: fieldOptions(d).map((o) => o.value) }}
                trigger={
                  <Button variant="ghost" size="icon">
                    <Pencil className="h-4 w-4" />
                  </Button>
                }
              />
              <DeleteButton iconOnly onDelete={deleteFieldDefAction.bind(null, d.id)} title="Delete field?" description="Existing values for this field are removed." />
            </div>
          </div>
        ))}
        {defs.length === 0 && <p className="text-sm text-muted-foreground">No fields yet.</p>}
      </CardContent>
    </Card>
  );
}

export default async function CustomFieldsPage() {
  await requireAdmin();
  const defs = await prisma.customFieldDefinition.findMany({ orderBy: { order: "asc" } });
  const dealDefs = defs.filter((d) => d.entity === "DEAL");
  const clientDefs = defs.filter((d) => d.entity === "CLIENT");

  return (
    <div className="pb-10">
      <PageHeader title="Custom fields" description="Configure extra fields for deals and clients." />
      <div className="grid gap-6 p-4 md:grid-cols-2 md:p-6">
        <FieldList entity="DEAL" defs={dealDefs} />
        <FieldList entity="CLIENT" defs={clientDefs} />
      </div>
    </div>
  );
}
