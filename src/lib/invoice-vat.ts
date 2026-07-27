// Isomorphic (used on the server for stored totals + the client for previews and
// the organization VAT display). Only depends on the pure ro-geo helpers.
import { isRomania } from "@/lib/ro-geo";
import { round2 } from "@/lib/invoice-totals";

/**
 * VAT rate that applies to an invoice, mirroring the Saga export decision
 * (minus currency conversion): Romanian clients use the organization's VAT %,
 * any foreign client is 0% (EU reverse charge or export / out of scope).
 */
export function resolveOrgVatPercent(org: { country: string | null; tvaPercent: unknown }): number {
  if (!isRomania(org.country)) return 0;
  const n = Number(org.tvaPercent);
  return Number.isFinite(n) ? n : 0;
}

/** Infer the VAT % from a stored base + VAT breakdown (legacy invoices). */
export function inferVatPercentFromAmounts(base: number | null, vat: number | null): number | null {
  if (base == null || vat == null) return null;
  if (base === 0) return vat === 0 ? 0 : null;
  const pct = round2((vat / base) * 100);
  return Number.isFinite(pct) ? pct : null;
}

/**
 * VAT rate for an invoice: prefer the locked invoice value, else infer from stored
 * amounts, else fall back to the org country default.
 */
export function resolveInvoiceVatPercent(
  invoice: { vatPercent?: unknown; totalBaseAmount?: unknown; vatAmount?: unknown },
  org: { country: string | null; tvaPercent: unknown }
): number {
  const stored = invoice.vatPercent != null ? Number(invoice.vatPercent) : null;
  if (stored != null && Number.isFinite(stored)) return stored;
  const base = invoice.totalBaseAmount == null ? null : Number(invoice.totalBaseAmount);
  const vat = invoice.vatAmount == null ? null : Number(invoice.vatAmount);
  const inferred = inferVatPercentFromAmounts(base, vat);
  if (inferred != null) return inferred;
  return resolveOrgVatPercent(org);
}

/** Parse a VAT % from form input; falls back to `orgDefault` when blank/invalid. */
export function parseVatPercentInput(v: string | undefined, orgDefault: number): number {
  if (v == null || v.trim() === "") return orgDefault;
  const n = Number(v.replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return orgDefault;
  return n;
}
