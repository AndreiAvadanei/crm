// Isomorphic (used on the server for stored amounts + the client for previews).
// Only depends on the pure ro-geo helpers.
import { isRomania } from "@/lib/ro-geo";

export const DEFAULT_BILLING_CURRENCY = "RON";

/**
 * Currency an invoice is actually issued in, mirroring the Saga export decision:
 * a Romanian client is always billed in RON (foreign pricing is converted at the
 * BNR rate), while a foreign client is billed in the contract currency.
 */
export function resolveBillingCurrency(country: string | null | undefined, contractCurrency: string | null): string {
  const contract = (contractCurrency || DEFAULT_BILLING_CURRENCY).toUpperCase();
  return isRomania(country) ? DEFAULT_BILLING_CURRENCY : contract;
}
