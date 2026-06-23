"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

export type FieldDefView = {
  id: string;
  label: string;
  type: string;
  required: boolean;
  options: string[];
};

export function CustomFieldInputs({
  defs,
  values,
}: {
  defs: FieldDefView[];
  values?: Record<string, unknown>;
}) {
  if (defs.length === 0) return null;
  return (
    <div className="space-y-4">
      <div className="text-xs font-medium text-muted-foreground">Custom fields</div>
      <div className="grid gap-4 sm:grid-cols-2">
        {defs.map((def) => {
          const name = `cf:${def.id}`;
          const v = values?.[def.id];
          return (
            <div key={def.id} className="space-y-2">
              <Label htmlFor={name}>
                {def.label}
                {def.required && <span className="text-destructive"> *</span>}
              </Label>
              {def.type === "TEXTAREA" ? (
                <Textarea id={name} name={name} defaultValue={(v as string) ?? ""} required={def.required} />
              ) : def.type === "BOOLEAN" ? (
                <div className="flex h-9 items-center">
                  <Checkbox id={name} name={name} defaultChecked={!!v} />
                </div>
              ) : def.type === "SELECT" ? (
                <select
                  id={name}
                  name={name}
                  defaultValue={(v as string) ?? ""}
                  required={def.required}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">—</option>
                  {def.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : def.type === "MULTISELECT" ? (
                <select
                  id={name}
                  name={name}
                  multiple
                  defaultValue={(Array.isArray(v) ? (v as string[]) : []) as string[]}
                  className="min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {def.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  id={name}
                  name={name}
                  type={def.type === "NUMBER" ? "number" : def.type === "DATE" ? "date" : def.type === "URL" ? "url" : "text"}
                  step={def.type === "NUMBER" ? "any" : undefined}
                  defaultValue={
                    def.type === "DATE" && v ? String(v).slice(0, 10) : (v as string) ?? ""
                  }
                  required={def.required}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
