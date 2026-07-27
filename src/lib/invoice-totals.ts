// Pure (client-safe) helpers that treat invoice articles as the source of truth
// for amounts. The VAT rate is resolved separately (server-side, from the
// client's country + the organization's VAT %) and passed in here.

export const DEFAULT_INVOICE_VAT_PERCENT = 21;

export type LineAmountInput = {
  quantity?: number | string | null;
  unitPrice?: number | string | null;
  value?: number | string | null;
};

export type InvoiceTotals = {
  /** Net total before VAT (sum of line values). */
  base: number;
  /** VAT amount. */
  vat: number;
  /** Gross total including VAT. */
  total: number;
};

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Net value of a single article: an explicit `value` wins, otherwise it's
 * `quantity * unitPrice` with quantity defaulting to 1.
 */
export function lineNetValue(line: LineAmountInput): number {
  const explicit = num(line.value);
  if (explicit != null) return explicit;
  const q = num(line.quantity) ?? 1;
  const up = num(line.unitPrice) ?? 0;
  return q * up;
}

/** Gross (VAT-inclusive) total of a single article. */
export function lineGrossTotal(line: LineAmountInput, vatPercent: number): number {
  return round2(lineNetValue(line) * (1 + vatPercent / 100));
}

/** Roll the articles up into base / VAT / total at the given VAT %. */
export function computeInvoiceTotals(lines: LineAmountInput[], vatPercent: number): InvoiceTotals {
  const base = round2(lines.reduce((sum, line) => sum + lineNetValue(line), 0));
  const vat = round2(base * (vatPercent / 100));
  const total = round2(base + vat);
  return { base, vat, total };
}

/**
 * Split a VAT-inclusive (gross) total back into base + VAT at the given rate,
 * so `base + vat === total`. Used when an authoritative total comes from an
 * external source (e.g. the issued PDF) and we need a consistent breakdown.
 */
export function splitGrossTotal(total: number, vatPercent: number): InvoiceTotals {
  const base = round2(total / (1 + vatPercent / 100));
  const vat = round2(total - base);
  return { base, vat, total: round2(total) };
}

/** True when an article carries any billable amount (used to drop blank rows). */
export function lineHasAmount(line: LineAmountInput): boolean {
  return num(line.value) != null || num(line.unitPrice) != null || num(line.quantity) != null;
}
