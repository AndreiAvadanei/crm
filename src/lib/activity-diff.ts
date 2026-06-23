// Server-side helpers for computing field-level diffs that get stored in an
// AuditLog's `meta.changes`. The shape is intentionally pre-formatted (all
// values are display strings) so the client-safe formatter / activity page can
// render them without any further resolution.

import { formatCurrency, formatDate } from "@/lib/utils";

export const DASH = "\u2014"; // em dash for empty values

export type ActivityChange = { field: string; label: string; from: string; to: string };

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Plain-text snippet with HTML stripped and truncated to `max` chars. */
export function snippet(v: unknown, max = 80): string {
  if (v == null) return DASH;
  const t = stripHtml(String(v));
  if (!t) return DASH;
  return t.length > max ? `${t.slice(0, max).trimEnd()}\u2026` : t;
}

function toNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Canonical string used purely for equality checks (so we only record fields
// that actually changed). Dates compare by time, arrays order-independently.
function canon(v: unknown): string {
  if (v == null || v === "") return "";
  if (v instanceof Date) return String(v.getTime());
  if (Array.isArray(v)) return v.map((x) => canon(x)).sort().join("|");
  return String(v).trim();
}

type Fmt = (v: unknown) => string;

const fmtText: Fmt = (v) => snippet(v);
const fmtPlain: Fmt = (v) => (v == null || v === "" ? DASH : String(v));
const fmtCurrency: Fmt = (v) => {
  const n = toNumber(v);
  return n == null ? DASH : formatCurrency(n);
};
const fmtDate: Fmt = (v) => {
  if (v == null || v === "") return DASH;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? DASH : formatDate(d);
};
const fmtBool: Fmt = (v) => (v == null || v === "" ? DASH : v ? "Yes" : "No");
const fmtList: Fmt = (v) => (Array.isArray(v) && v.length ? v.join(", ") : DASH);

function build(field: string, label: string, from: unknown, to: unknown, fmt: Fmt): ActivityChange | null {
  if (canon(from) === canon(to)) return null;
  return { field, label, from: fmt(from), to: fmt(to) };
}

export const diffText = (field: string, label: string, from: unknown, to: unknown) =>
  build(field, label, from, to, fmtText);
export const diffPlain = (field: string, label: string, from: unknown, to: unknown) =>
  build(field, label, from, to, fmtPlain);
export const diffCurrency = (field: string, label: string, from: unknown, to: unknown) =>
  build(field, label, from, to, fmtCurrency);
export const diffDate = (field: string, label: string, from: unknown, to: unknown) =>
  build(field, label, from, to, fmtDate);
export const diffBool = (field: string, label: string, from: unknown, to: unknown) =>
  build(field, label, from, to, fmtBool);
/** Diff two lists of human names (e.g. tag names). Order-independent. */
export const diffList = (field: string, label: string, from: string[], to: string[]) =>
  build(field, label, from, to, fmtList);

/** Drop the nulls produced by unchanged fields. */
export function changeList(...items: (ActivityChange | null)[]): ActivityChange[] {
  return items.filter((c): c is ActivityChange => c != null);
}

/** Format a single value with a named formatter (used for create/delete summaries). */
export function displayValue(kind: "text" | "plain" | "currency" | "date" | "bool", v: unknown): string {
  switch (kind) {
    case "currency":
      return fmtCurrency(v);
    case "date":
      return fmtDate(v);
    case "bool":
      return fmtBool(v);
    case "text":
      return fmtText(v);
    default:
      return fmtPlain(v);
  }
}
