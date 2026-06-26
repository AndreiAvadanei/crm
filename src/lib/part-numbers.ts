// Client-safe helpers for the part-number matrix (no `server-only`, no prisma
// imports) so they can be used from both client components and server code.

export type PartNumberOption = {
  id: string;
  code: string;
  group: string | null;
  title: string | null;
  limitations: string | null;
  category: string | null;
  subCategory: string | null;
  subSubCategory: string | null;
  type: string | null;
};

/**
 * Extract the dynamic placeholders from a template code in order of appearance,
 * e.g. "PHISH-P-L-MM-A-<limit1>-<limit2>" -> ["limit1", "limit2"]. Duplicates
 * are de-duplicated so a placeholder used twice maps to a single input.
 */
export function parsePlaceholders(code: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /<([^>]+)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const name = m[1].trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/** Whether a code has at least one `<...>` placeholder to fill in. */
export function hasPlaceholders(code: string): boolean {
  return /<[^>]+>/.test(code);
}

/**
 * Per-placeholder human hints derived from the comma-separated "Limitations"
 * column, aligned positionally with the placeholders. Falls back to the
 * placeholder name when there's no matching hint.
 */
export function placeholderHints(code: string, limitations: string | null): Record<string, string> {
  const placeholders = parsePlaceholders(code);
  const parts = (limitations ?? "")
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const hints: Record<string, string> = {};
  placeholders.forEach((ph, i) => {
    hints[ph] = parts[i] || parts[0] || ph;
  });
  return hints;
}

/**
 * Replace each `<ph>` in the template with the provided value. Missing/empty
 * values keep the `<ph>` token so the code reads as "still to fill in".
 */
export function resolvePartNumberCode(code: string, values: Record<string, string> | null | undefined): string {
  if (!values) return code;
  return code.replace(/<([^>]+)>/g, (_match, name: string) => {
    const v = values[name.trim()];
    return v != null && String(v).trim() !== "" ? String(v).trim() : `<${name}>`;
  });
}

/** True once every placeholder in the code has a non-empty value. */
export function isPartNumberComplete(code: string, values: Record<string, string> | null | undefined): boolean {
  const placeholders = parsePlaceholders(code);
  if (placeholders.length === 0) return true;
  if (!values) return false;
  return placeholders.every((ph) => (values[ph] ?? "").toString().trim() !== "");
}

/** Compact one-line descriptor for an option (used in search/labels). */
export function partNumberSummary(opt: Pick<PartNumberOption, "category" | "subCategory" | "subSubCategory" | "type">): string {
  return [opt.category, opt.subCategory, opt.subSubCategory, opt.type]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(" › ");
}
