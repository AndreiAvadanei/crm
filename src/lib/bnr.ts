import "server-only";

// Fetches official BNR (Banca Națională a României) reference exchange rates and
// converts a foreign-currency amount to RON. Used when a Romanian client is
// billed in RON but the contract/lines are priced in EUR/USD: the value is
// converted at the BNR reference rate from the day before the invoice date, the
// standard Romanian invoicing convention.

type Cube = { date: string; rates: Record<string, number> };

// BNR serves these files only from curs.bnr.ro since 2026-08-06; the old
// www.bnr.ro addresses redirect to the site's HTML home page.
const YEAR_FEED = (year: number) => `https://curs.bnr.ro/files/xml/years/nbrfxrates${year}.xml`;
const LATEST_FEED = "https://curs.bnr.ro/nbrfxrates.xml";

// Cache parsed cubes per source URL for the process lifetime (rates are
// immutable once published; the latest feed is re-fetched after a short TTL).
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; cubes: Cube[] }>();

function parseCubes(xml: string): Cube[] {
  const cubes: Cube[] = [];
  const cubeRe = /<Cube\s+date="(\d{4}-\d{2}-\d{2})"\s*>([\s\S]*?)<\/Cube>/g;
  let cubeMatch: RegExpExecArray | null;
  while ((cubeMatch = cubeRe.exec(xml))) {
    const date = cubeMatch[1];
    const inner = cubeMatch[2];
    const rates: Record<string, number> = {};
    const rateRe = /<Rate\s+currency="([A-Z]{3})"(?:\s+multiplier="(\d+)")?\s*>([\d.]+)<\/Rate>/g;
    let rateMatch: RegExpExecArray | null;
    while ((rateMatch = rateRe.exec(inner))) {
      const currency = rateMatch[1];
      const multiplier = rateMatch[2] ? Number(rateMatch[2]) : 1;
      const value = Number(rateMatch[3]);
      if (Number.isFinite(value) && multiplier > 0) rates[currency] = value / multiplier;
    }
    cubes.push({ date, rates });
  }
  return cubes;
}

async function loadCubes(url: string): Promise<Cube[]> {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.cubes;
  const res = await fetch(url, { headers: { "User-Agent": "crm-invoicing" } });
  if (!res.ok) throw new Error(`BNR feed ${url} returned ${res.status}`);
  const xml = await res.text();
  const cubes = parseCubes(xml);
  // A feed that moved answers 200 with an HTML page, which parses to nothing.
  // Fail loudly instead of caching an empty result for the whole TTL.
  if (cubes.length === 0) {
    throw new Error(`BNR feed ${url} returned no rates${res.redirected ? ` (redirected to ${res.url})` : ""}`);
  }
  cache.set(url, { at: Date.now(), cubes });
  return cubes;
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export type BnrRate = { rate: number; rateDate: string };

/**
 * Return the BNR reference rate (RON per 1 unit of `currency`) effective for an
 * invoice issued on `invoiceDate` — i.e. the most recent published rate strictly
 * before that date (BNR doesn't publish on weekends/holidays, so this walks back
 * automatically). Throws when the rate can't be determined.
 */
export async function getBnrRonRate(currency: string, invoiceDate: Date): Promise<BnrRate> {
  const code = currency.trim().toUpperCase();
  if (!code || code === "RON") return { rate: 1, rateDate: toIsoDate(invoiceDate) };

  const targetIso = toIsoDate(invoiceDate);
  const year = invoiceDate.getUTCFullYear();

  // Gather candidate cubes: current year, the latest feed (recent days that may
  // not be in the year file yet), and the previous year for early-January dates.
  const sources = [YEAR_FEED(year), LATEST_FEED];
  if (invoiceDate.getUTCMonth() === 0) sources.push(YEAR_FEED(year - 1));

  const seen = new Map<string, Cube>();
  let lastError: unknown = null;
  for (const url of sources) {
    try {
      for (const cube of await loadCubes(url)) {
        if (!seen.has(cube.date)) seen.set(cube.date, cube);
      }
    } catch (err) {
      lastError = err;
    }
  }

  const cubes = Array.from(seen.values()).sort((a, b) => a.date.localeCompare(b.date));
  if (cubes.length === 0) {
    throw new Error(
      `Could not fetch BNR exchange rates for ${code}.${lastError ? ` (${(lastError as Error).message})` : ""}`
    );
  }

  // Most recent cube strictly before the invoice date; fall back to the closest
  // available cube when none precede it (e.g. invoice dated in the past).
  const before = cubes.filter((c) => c.date < targetIso && c.rates[code] != null);
  const chosen = before.length ? before[before.length - 1] : [...cubes].reverse().find((c) => c.rates[code] != null);

  if (!chosen || chosen.rates[code] == null) {
    throw new Error(`BNR has no published rate for ${code} near ${targetIso}.`);
  }
  return { rate: chosen.rates[code], rateDate: chosen.date };
}
