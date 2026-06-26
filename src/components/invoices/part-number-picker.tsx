"use client";

import * as React from "react";
import { Check, ChevronRight, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  parsePlaceholders,
  placeholderHints,
  resolvePartNumberCode,
  isPartNumberComplete,
  type PartNumberOption,
} from "@/lib/part-numbers";

// Classification hierarchy, drilled into one click at a time.
const DIMS = [
  { key: "group", label: "Group" },
  { key: "category", label: "Category" },
  { key: "subCategory", label: "Sub-category" },
  { key: "subSubCategory", label: "Sub-sub-category" },
  { key: "type", label: "Type" },
] as const;

type DimKey = (typeof DIMS)[number]["key"];
const LEAF = "__leaf__";
type Selections = Partial<Record<DimKey, string>> & { [LEAF]?: string };

function valOf(p: PartNumberOption, key: DimKey): string {
  return (p[key] ?? "").trim();
}

function uniqueStable(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

type StepOption = { value: string; label: string; secondary?: string };
type View = {
  breadcrumbs: { key: DimKey; label: string; value: string }[];
  nextDim: DimKey | typeof LEAF | null;
  nextLabel: string;
  options: StepOption[];
  leaf: PartNumberOption | null;
};

function computeView(parts: PartNumberOption[], selections: Selections): View {
  let candidates = parts;
  const breadcrumbs: View["breadcrumbs"] = [];

  for (const { key, label } of DIMS) {
    if (selections[key] !== undefined) {
      candidates = candidates.filter((c) => valOf(c, key) === selections[key]);
      if (selections[key]) breadcrumbs.push({ key, label, value: selections[key]! });
      continue;
    }
    const distinct = uniqueStable(candidates.map((c) => valOf(c, key)));
    if (distinct.length <= 1) {
      // Uniform (often empty) at this level → skip it automatically.
      const only = distinct[0] ?? "";
      candidates = candidates.filter((c) => valOf(c, key) === only);
      continue;
    }
    // A real branching point: ask the user to choose.
    return {
      breadcrumbs,
      nextDim: key,
      nextLabel: label,
      options: distinct.map((v) => ({ value: v, label: v || "(unspecified)" })),
      leaf: null,
    };
  }

  // Classification exhausted. Disambiguate any remaining same-class entries by title.
  if (candidates.length > 1) {
    if (selections[LEAF]) {
      const chosen = candidates.find((c) => c.id === selections[LEAF]);
      if (chosen) return { breadcrumbs, nextDim: null, nextLabel: "", options: [], leaf: chosen };
    }
    return {
      breadcrumbs,
      nextDim: LEAF,
      nextLabel: "Option",
      options: candidates.map((c) => ({ value: c.id, label: c.title || c.code, secondary: c.code })),
      leaf: null,
    };
  }

  return { breadcrumbs, nextDim: null, nextLabel: "", options: [], leaf: candidates[0] ?? null };
}

function selectionsFromPart(p: PartNumberOption): Selections {
  const s: Selections = { [LEAF]: p.id };
  for (const { key } of DIMS) s[key] = valOf(p, key);
  return s;
}

export function PartNumberPicker({
  partNumbers,
  value,
  values,
  onChange,
  disabled = false,
  disabledHint,
}: {
  partNumbers: PartNumberOption[];
  /** Selected part number id ("" = none). */
  value: string;
  /** Placeholder -> value map for the selected part number. */
  values: Record<string, string>;
  onChange: (next: { id: string; values: Record<string, string> }) => void;
  /** Read-only mode (e.g. inherited from a related invoice). */
  disabled?: boolean;
  disabledHint?: React.ReactNode;
}) {
  const [selections, setSelections] = React.useState<Selections>(() => {
    const p = value ? partNumbers.find((x) => x.id === value) : null;
    return p ? selectionsFromPart(p) : {};
  });

  const view = React.useMemo(() => computeView(partNumbers, selections), [partNumbers, selections]);
  const leafId = view.leaf?.id ?? "";

  // Keep the parent's stored value in sync with the drilled-down leaf. Selecting a
  // different part number resets its limit values; navigating up clears it.
  React.useEffect(() => {
    if (leafId !== value) onChange({ id: leafId, values: {} });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leafId]);

  // Resync the drill path when the selected value changes from outside.
  React.useEffect(() => {
    if (value && view.leaf?.id !== value) {
      const p = partNumbers.find((x) => x.id === value);
      if (p) setSelections(selectionsFromPart(p));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function chooseDim(dim: DimKey, v: string) {
    setSelections(() => {
      const next: Selections = {};
      for (const { key } of DIMS) {
        if (key === dim) break;
        if (selections[key] !== undefined) next[key] = selections[key];
      }
      next[dim] = v;
      return next;
    });
  }

  function chooseLeaf(id: string) {
    setSelections((prev) => ({ ...prev, [LEAF]: id }));
  }

  function resetTo(index: number) {
    // Keep only the breadcrumbs before `index`; index === -1 clears everything.
    setSelections(() => {
      const next: Selections = {};
      for (let i = 0; i < index; i++) {
        const bc = view.breadcrumbs[i];
        next[bc.key] = bc.value;
      }
      return next;
    });
  }

  const selected = view.leaf;
  const placeholders = selected ? parsePlaceholders(selected.code) : [];
  const hints = selected ? placeholderHints(selected.code, selected.limitations) : {};
  const resolved = selected ? resolvePartNumberCode(selected.code, values) : "";
  const complete = selected ? isPartNumberComplete(selected.code, values) : false;

  if (disabled) {
    return (
      <div className="space-y-2 rounded-md border border-dashed bg-muted/20 p-3">
        {selected ? (
          <>
            {selected.title && <div className="text-sm font-medium">{selected.title}</div>}
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm">{resolved}</span>
              <Badge variant="secondary">Inherited</Badge>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No part number on the related invoice.</p>
        )}
        {disabledHint && <p className="text-xs text-muted-foreground">{disabledHint}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border bg-muted/20 p-3">
      {/* Breadcrumb trail of choices made so far. */}
      {(view.breadcrumbs.length > 0 || selected) && (
        <div className="flex flex-wrap items-center gap-1 text-xs">
          {view.breadcrumbs.map((bc, i) => (
            <React.Fragment key={bc.key}>
              {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
              <button
                type="button"
                onClick={() => resetTo(i)}
                className="rounded bg-background px-2 py-0.5 font-medium hover:bg-accent"
                title={`Change ${bc.label.toLowerCase()}`}
              >
                {bc.value}
              </button>
            </React.Fragment>
          ))}
          {selected && (
            <>
              {view.breadcrumbs.length > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
              <span className="rounded bg-primary/10 px-2 py-0.5 font-mono font-medium text-primary">{selected.code}</span>
            </>
          )}
          <button
            type="button"
            onClick={() => resetTo(0)}
            className="ml-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Start over"
          >
            <RotateCcw className="h-3 w-3" /> Reset
          </button>
        </div>
      )}

      {/* Active step: click an option to drill in. */}
      {view.nextDim && (
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground">
            {view.nextDim === LEAF ? "Choose the exact option" : `Choose ${view.nextLabel.toLowerCase()}`}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {view.options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => (view.nextDim === LEAF ? chooseLeaf(opt.value) : chooseDim(view.nextDim as DimKey, opt.value))}
                className="group flex max-w-full flex-col items-start rounded-md border bg-background px-2.5 py-1.5 text-left text-sm transition-colors hover:border-primary hover:bg-accent"
              >
                <span className="truncate font-medium">{opt.label}</span>
                {opt.secondary && <span className="truncate font-mono text-[11px] text-muted-foreground">{opt.secondary}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Selected leaf: fill in the dynamic limits. */}
      {selected && (
        <div className="space-y-3 border-t pt-3">
          {selected.title && <div className="text-sm font-medium">{selected.title}</div>}

          {placeholders.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {placeholders.map((ph) => (
                <div key={ph} className="space-y-1">
                  <label className="flex items-center gap-1 text-xs font-medium">
                    <span className="font-mono text-muted-foreground">&lt;{ph}&gt;</span>
                    {hints[ph] && hints[ph] !== ph && <span className="text-muted-foreground">— {hints[ph]}</span>}
                  </label>
                  <Input
                    value={values[ph] ?? ""}
                    onChange={(e) => onChange({ id: value, values: { ...values, [ph]: e.target.value } })}
                    placeholder={hints[ph] && hints[ph] !== ph ? hints[ph] : "value"}
                    className="h-8 text-sm"
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">This part number has no dynamic limits.</p>
          )}

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Result:</span>
            <span className={cn("font-mono text-sm", complete ? "text-[var(--success)]" : "text-foreground")}>{resolved}</span>
            {complete ? (
              <Badge variant="success">
                <Check className="h-3 w-3" /> Ready
              </Badge>
            ) : placeholders.length > 0 ? (
              <Badge variant="warning">Fill the limits</Badge>
            ) : null}
          </div>
        </div>
      )}

      {!view.nextDim && !selected && (
        <p className="text-xs text-muted-foreground">No part numbers available.</p>
      )}
    </div>
  );
}
