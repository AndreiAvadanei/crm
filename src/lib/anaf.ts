import "server-only";
import { ROMANIA, normalizeCountyValue } from "@/lib/ro-geo";

// Lookup of Romanian company data by CUI/VAT through the demoanaf.ro proxy of
// the official ANAF registry. Returns a normalized subset mapped to our org
// fields, or null on failure (never throws to the caller's action).

export interface AnafCompany {
  legalName: string | null;
  taxId: string | null;
  reg_com: string | null;
  tara: string;
  judet: string | null;
  localitate: string | null;
  adresa: string | null;
  cod_post: string | null;
  tel: string | null;
  cont_banca: string | null;
  is_tva: boolean;
  blocat: boolean;
}

interface AnafAddress {
  street?: string;
  number?: string;
  locality?: string;
  county?: string;
  country?: string;
  postalCode?: string;
}

interface AnafData {
  cui?: number | string;
  name?: string;
  phone?: string;
  iban?: string;
  address?: string;
  postalCode?: string;
  legalForm?: string;
  registrationNumber?: string;
  vatRegistered?: boolean;
  inactive?: boolean;
  headquartersAddress?: AnafAddress;
  fiscalAddress?: AnafAddress;
}

interface AnafResponse {
  success?: boolean;
  data?: AnafData;
}

/** Strip the "RO" VAT prefix and any non-digits, returning the bare CUI. */
export function normalizeCui(input: string): string {
  return input.replace(/^\s*RO/i, "").replace(/\D/g, "");
}

const trim = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : v != null ? String(v).trim() : "";
  return s || null;
};

export async function fetchAnafCompany(rawCui: string): Promise<AnafCompany | null> {
  const cui = normalizeCui(rawCui);
  if (!cui) return null;

  const base = process.env.ANAF_API_BASE || "https://demoanaf.ro/api/company";
  try {
    const res = await fetch(`${base}/${cui}`, {
      // demoanaf.ro gates non-browser User-Agents behind an x402 paywall (402),
      // so present a browser UA to keep the free lookup working.
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
      },
      // Don't cache; the registry data changes and lookups are explicit.
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as AnafResponse;
    if (!json?.success || !json.data) return null;

    const d = json.data;
    const hq = d.headquartersAddress ?? d.fiscalAddress ?? {};
    return {
      legalName: trim(d.name),
      taxId: trim(d.cui) ?? cui,
      reg_com: trim(d.registrationNumber),
      tara: trim(hq.country) ?? ROMANIA,
      judet: trim(normalizeCountyValue(hq.county)),
      localitate: trim(hq.locality),
      adresa: trim(d.address) ?? trim([hq.street, hq.number].filter(Boolean).join(" ")),
      cod_post: trim(hq.postalCode) ?? trim(d.postalCode),
      tel: trim(d.phone),
      cont_banca: trim(d.iban),
      is_tva: !!d.vatRegistered,
      blocat: !!d.inactive,
    };
  } catch (err) {
    console.error("[anaf] lookup failed:", err);
    return null;
  }
}
