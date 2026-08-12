// Static geo lists used by the organization form: a searchable country list
// (default Romania) and the 41 Romanian counties + Bucharest (default).

/** Canonical country name used as the default and to gate Romania-only UI. */
export const ROMANIA = "România";

/** Default Romanian county. */
export const DEFAULT_COUNTY = "București";

/**
 * Romanian counties (judete) including the municipality of Bucharest.
 * Diacritic-correct display names; matching in the combobox is diacritic-aware
 * via the generic label filter.
 */
export const RO_COUNTIES: string[] = [
  "Alba",
  "Arad",
  "Argeș",
  "Bacău",
  "Bihor",
  "Bistrița-Năsăud",
  "Botoșani",
  "Brașov",
  "Brăila",
  "București",
  "Buzău",
  "Caraș-Severin",
  "Călărași",
  "Cluj",
  "Constanța",
  "Covasna",
  "Dâmbovița",
  "Dolj",
  "Galați",
  "Giurgiu",
  "Gorj",
  "Harghita",
  "Hunedoara",
  "Ialomița",
  "Iași",
  "Ilfov",
  "Maramureș",
  "Mehedinți",
  "Mureș",
  "Neamț",
  "Olt",
  "Prahova",
  "Satu Mare",
  "Sălaj",
  "Sibiu",
  "Suceava",
  "Teleorman",
  "Timiș",
  "Tulcea",
  "Vaslui",
  "Vâlcea",
  "Vrancea",
];

/**
 * Country list for the searchable select. Romania first so it's the obvious
 * default; the rest are alphabetical. Not exhaustive but covers common cases.
 */
export const COUNTRIES: string[] = [
  ROMANIA,
  "Republica Moldova",
  "Austria",
  "Belgia",
  "Bulgaria",
  "Cehia",
  "Cipru",
  "Croația",
  "Danemarca",
  "Elveția",
  "Estonia",
  "Finlanda",
  "Franța",
  "Germania",
  "Grecia",
  "Irlanda",
  "Italia",
  "Letonia",
  "Lituania",
  "Luxemburg",
  "Malta",
  "Marea Britanie",
  "Norvegia",
  "Olanda",
  "Polonia",
  "Portugalia",
  "Slovacia",
  "Slovenia",
  "Spania",
  "Suedia",
  "Ungaria",
  "Statele Unite ale Americii",
  "Canada",
  "Turcia",
  "Ucraina",
  "Emiratele Arabe Unite",
  "Israel",
  "Japonia",
  "China",
  "India",
  "Australia",
  "Altă țară",
];

const COUNTRY_CODE_TO_NAME: Record<string, string> = {
  RO: ROMANIA,
  MD: "Republica Moldova",
  AT: "Austria",
  BE: "Belgia",
  BG: "Bulgaria",
  CZ: "Cehia",
  CY: "Cipru",
  HR: "Croația",
  DK: "Danemarca",
  CH: "Elveția",
  EE: "Estonia",
  FI: "Finlanda",
  FR: "Franța",
  DE: "Germania",
  GR: "Grecia",
  IE: "Irlanda",
  IT: "Italia",
  LV: "Letonia",
  LT: "Lituania",
  LU: "Luxemburg",
  MT: "Malta",
  GB: "Marea Britanie",
  UK: "Marea Britanie",
  NO: "Norvegia",
  NL: "Olanda",
  PL: "Polonia",
  PT: "Portugalia",
  SK: "Slovacia",
  SI: "Slovenia",
  ES: "Spania",
  SE: "Suedia",
  HU: "Ungaria",
  US: "Statele Unite ale Americii",
  CA: "Canada",
  TR: "Turcia",
  UA: "Ucraina",
  AE: "Emiratele Arabe Unite",
  IL: "Israel",
  JP: "Japonia",
  CN: "China",
  IN: "India",
  AU: "Australia",
};

/**
 * Romanian county (județ) -> official 2-letter code used by Saga/SPV invoice
 * imports (e.g. "Alba" -> "AB", "Botoșani" -> "BT", "București" -> "B").
 */
export const RO_COUNTY_CODE: Record<string, string> = {
  Alba: "AB",
  Arad: "AR",
  Argeș: "AG",
  Bacău: "BC",
  Bihor: "BH",
  "Bistrița-Năsăud": "BN",
  Botoșani: "BT",
  Brașov: "BV",
  Brăila: "BR",
  București: "B",
  Buzău: "BZ",
  "Caraș-Severin": "CS",
  Călărași: "CL",
  Cluj: "CJ",
  Constanța: "CT",
  Covasna: "CV",
  Dâmbovița: "DB",
  Dolj: "DJ",
  Galați: "GL",
  Giurgiu: "GR",
  Gorj: "GJ",
  Harghita: "HR",
  Hunedoara: "HD",
  Ialomița: "IL",
  Iași: "IS",
  Ilfov: "IF",
  Maramureș: "MM",
  Mehedinți: "MH",
  Mureș: "MS",
  Neamț: "NT",
  Olt: "OT",
  Prahova: "PH",
  "Satu Mare": "SM",
  Sălaj: "SJ",
  Sibiu: "SB",
  Suceava: "SV",
  Teleorman: "TR",
  Timiș: "TM",
  Tulcea: "TL",
  Vaslui: "VS",
  Vâlcea: "VL",
  Vrancea: "VN",
};

/** Strip diacritics and lowercase for diacritic-insensitive matching. */
function foldDiacritics(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // Romanian comma-below s/t sometimes normalize oddly; force-fold them too.
    .replace(/[șş]/gi, "s")
    .replace(/[țţ]/gi, "t")
    .toLowerCase()
    .trim();
}

const RO_COUNTY_CODE_FOLDED: Record<string, string> = Object.fromEntries(
  Object.entries(RO_COUNTY_CODE).map(([name, code]) => [foldDiacritics(name), code])
);

/**
 * Resolve a county name (with or without diacritics, any casing) to its Saga
 * 2-letter code. Accepts a value that is already a code. Returns "" when unknown.
 */
export function countyCodeForName(county: string | null | undefined): string {
  const value = county?.trim();
  if (!value) return "";
  // Already a valid code (e.g. "BT", "B").
  const upper = value.toUpperCase();
  if (Object.values(RO_COUNTY_CODE).includes(upper)) return upper;
  return RO_COUNTY_CODE_FOLDED[foldDiacritics(value)] ?? "";
}

const RO_COUNTY_BY_FOLDED_NAME: Record<string, string> = Object.fromEntries(
  RO_COUNTIES.map((name) => [foldDiacritics(name), name])
);

const RO_COUNTY_BY_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(RO_COUNTY_CODE).map(([name, code]) => [code, name])
);

/**
 * Resolve a county to the exact `RO_COUNTIES` spelling so it matches the county
 * picker. External sources spell diacritics with cedillas ("Iaşi", ANAF) or use
 * codes ("IS"), while our list uses comma-below ("Iași"). Unknown values are
 * returned trimmed so foreign regions and free text survive unchanged.
 */
export function normalizeCountyValue(county: string | null | undefined): string {
  const value = county?.trim();
  if (!value) return "";
  return RO_COUNTY_BY_FOLDED_NAME[foldDiacritics(value)] ?? RO_COUNTY_BY_CODE[value.toUpperCase()] ?? value;
}

const COUNTRY_NAME_TO_CODE_FOLDED: Record<string, string> = Object.fromEntries(
  Object.entries(COUNTRY_CODE_TO_NAME).map(([code, name]) => [foldDiacritics(name), code])
);

/** Normalize a country value from imports/exports to a 2-letter ISO code for storage. */
export function countryToStorageCode(country: string | null | undefined): string | null {
  const value = country?.trim();
  if (!value) return null;
  const upper = value.toUpperCase();
  if (COUNTRY_CODE_TO_NAME[upper]) return upper;
  const folded = foldDiacritics(value);
  return COUNTRY_NAME_TO_CODE_FOLDED[folded] ?? (/^[A-Za-z]{2}$/.test(value) ? upper : null);
}

/** Convert supported ISO-2 country codes to picker values. */
export function normalizeCountryValue(country: string | null | undefined): string {
  const value = country?.trim();
  if (!value) return "";
  return COUNTRY_CODE_TO_NAME[value.toUpperCase()] ?? value;
}

/** Return an ISO-2 code for picker search where the country is in the supported list. */
export function countryCodeForName(country: string | null | undefined): string {
  const normalized = normalizeCountryValue(country);
  if (!normalized) return "";
  return Object.entries(COUNTRY_CODE_TO_NAME).find(([, name]) => name === normalized)?.[0] ?? "";
}

/** True when the given country value should be treated as Romania. */
export function isRomania(country: string | null | undefined): boolean {
  if (!country) return false;
  const c = normalizeCountryValue(country).trim().toLowerCase();
  return c === "românia" || c === "romania" || c === "ro" || c === "rou";
}

/** ISO-2 codes of EU member states (used to decide intra-community reverse charge). */
export const EU_COUNTRY_CODES = new Set<string>([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU",
  "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
]);

/** True when the country is an EU member state (accepts names or ISO-2 codes). */
export function isEuCountry(country: string | null | undefined): boolean {
  return EU_COUNTRY_CODES.has(countryCodeForName(country));
}
