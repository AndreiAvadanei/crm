"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { InlineInput, InlineSelect, InlineTextarea } from "@/components/shared/inline-edit";
import { quickUpdateDealCustomFieldAction } from "@/server/quick-actions";
import { formatDate } from "@/lib/utils";
import type { FieldDefView } from "@/components/shared/custom-field-inputs";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="pt-1 text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1 text-right">{children}</div>
    </div>
  );
}

/** Multi-select committing an array of option strings on each toggle. */
function InlineMultiSelect({
  options,
  value,
  onSave,
}: {
  options: string[];
  value: string[];
  onSave: (next: string[]) => Promise<{ ok?: boolean; error?: string }>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [selected, setSelected] = React.useState<string[]>(value);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => setSelected(value), [value]);

  async function toggle(opt: string) {
    const next = selected.includes(opt) ? selected.filter((x) => x !== opt) : [...selected, opt];
    const prev = selected;
    setSelected(next);
    setBusy(true);
    const res = await onSave(next);
    setBusy(false);
    if (res.error) {
      toast({ title: res.error, variant: "error" });
      setSelected(prev);
      return;
    }
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Edit"
          className="inline-flex min-h-7 max-w-full items-center justify-end gap-1 rounded px-1.5 py-0.5 text-right transition-colors hover:bg-accent/60 hover:ring-1 hover:ring-border"
        >
          {selected.length ? (
            <span className="truncate font-medium">{selected.join(", ")}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
          {busy && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
        {options.map((o) => (
          <DropdownMenuCheckboxItem
            key={o}
            checked={selected.includes(o)}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => toggle(o)}
          >
            {o}
          </DropdownMenuCheckboxItem>
        ))}
        {options.length === 0 && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">No options.</div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function DealCustomFields({
  dealId,
  defs,
  values,
}: {
  dealId: string;
  defs: FieldDefView[];
  values: Record<string, unknown>;
}) {
  return (
    <div className="space-y-3 text-sm">
      {defs.map((def) => {
        const v = values[def.id];
        const save = (value: unknown) => quickUpdateDealCustomFieldAction(dealId, def.id, value);

        let editor: React.ReactNode;
        switch (def.type) {
          case "TEXTAREA":
            editor = (
              <InlineTextarea value={(v as string) ?? ""} onSave={(next) => save(next || null)} />
            );
            break;
          case "BOOLEAN":
            editor = (
              <InlineSelect
                value={v === true ? "true" : v === false ? "false" : ""}
                placeholder="—"
                options={[
                  { value: "true", label: "Yes" },
                  { value: "false", label: "No" },
                ]}
                onSave={(next) => save(next === "" ? null : next === "true")}
              />
            );
            break;
          case "SELECT":
            editor = (
              <InlineSelect
                value={(v as string) ?? ""}
                placeholder="—"
                options={def.options.map((o) => ({ value: o, label: o }))}
                onSave={(next) => save(next || null)}
              />
            );
            break;
          case "MULTISELECT":
            editor = (
              <InlineMultiSelect
                options={def.options}
                value={Array.isArray(v) ? (v as string[]) : []}
                onSave={(next) => save(next)}
              />
            );
            break;
          case "NUMBER":
            editor = (
              <InlineInput
                value={v != null ? String(v) : ""}
                type="number"
                align="right"
                onSave={(next) => {
                  const n = next.trim() === "" ? null : Number(next.replace(/,/g, ""));
                  if (n !== null && !Number.isFinite(n)) {
                    return Promise.resolve({ error: "Invalid number." });
                  }
                  return save(n);
                }}
              />
            );
            break;
          case "DATE":
            editor = (
              <InlineInput
                value={v ? String(v).slice(0, 10) : ""}
                type="date"
                align="right"
                display={
                  v ? formatDate(String(v)) : <span className="text-muted-foreground">—</span>
                }
                onSave={(next) => save(next || null)}
              />
            );
            break;
          case "URL": {
            // Inline-editable URL with an "open in new tab" affordance.
            const raw = (v as string) ?? "";
            const href = raw && !/^https?:\/\//i.test(raw) ? `https://${raw}` : raw;
            editor = (
              <div className="flex min-w-0 items-center justify-end gap-1">
                <div className="min-w-0 flex-1">
                  <InlineInput
                    value={raw}
                    align="right"
                    display={raw ? <span title={raw}>{raw}</span> : undefined}
                    onSave={(next) => save(next || null)}
                  />
                </div>
                {raw && (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open in new tab"
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            );
            break;
          }
          default:
            // TEXT and anything else → single-line text.
            editor = (
              <InlineInput
                value={(v as string) ?? ""}
                align="right"
                onSave={(next) => save(next || null)}
              />
            );
        }

        return (
          <Row key={def.id} label={def.label}>
            {editor}
          </Row>
        );
      })}
    </div>
  );
}
