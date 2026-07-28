/**
 * Read-only proposal generator: enrich accounting invoices with part numbers
 * (and contract refs) from the "Internal Affairs ... Proiecte" project tracker.
 *
 * This DOES NOT touch the database. It reads the source files, runs a cascade
 * matcher, and writes scored proposal CSVs you can eyeball before we ever
 * write anything back to Invoice rows.
 *
 * Sources:
 *   - Accounting invoices: data-init/ron - facturi.xls + data-init/valuta - facturi.xls
 *     (grouped by nr_iesire, exactly like the UI importer -> externalRecordId
 *      "accounting:{nr_iesire}")
 *   - Project tracker: data-init/Internal Affairs - 2023_2024_2025_2026 - Proiecte.csv
 *   - Canonical org list (+ CUI): data-init/clienti.xls  (for alias curation only)
 *   - Optional curated aliases: scripts/tracker-org-aliases.json
 *       { "<tracker society (raw or normalized)>": "<invoice denumire (raw or normalized)>" }
 *
 * Matching cascade (per invoice, org is a hard gate):
 *   Tier 1  DETERMINISTIC  org + contract# -> exactly one part number.
 *   Tier 2  SCORED         org candidates scored by contract#, currency-aware
 *                          amount, milestone (avans/final), date and description.
 *   Tier 3  UNRESOLVED     no org in tracker, or no usable candidate.
 *
 * Improvements implemented (per review):
 *   (1) Org resolution: diacritics-aware normalization + curated alias table +
 *       guarded fuzzy fallback (fuzzy never yields HIGH and needs corroboration).
 *       Also emits scripts/org-alias-proposal.csv for human curation.
 *   (3) Currency-aware amount matching: compares in EUR when an EUR figure is
 *       known, otherwise converts the tracker's EUR amount to RON using the
 *       invoice's own FX rate (curs / curs_ref).
 *   (4) Invoice semantics: detects avans / final / storno from the invoice text
 *       (biases amount matching and flags reversals) and proposes part numbers
 *       per line for multi-line invoices.
 *   (5) Calibration: treats the deterministic matches as ground truth and
 *       measures how often the blind scorer agrees, per confidence band, so the
 *       thresholds are grounded in evidence rather than eyeballing.
 *
 * Outputs (CSV only, no DB writes):
 *   scripts/invoice-part-number-proposal.csv   one row per invoice
 *   scripts/org-alias-proposal.csv             unmatched tracker/invoice orgs
 *   scripts/calibration-report.csv             scorer-vs-deterministic agreement
 *
 * Usage:
 *   tsx scripts/map-invoice-part-numbers.ts
 */
import fs from "fs";
import { parse } from "csv-parse/sync";
import * as XLSX from "xlsx";

// ------------------------------- args ---------------------------------------
const args = process.argv.slice(2);
const getArg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const RON_FILE = getArg("ron", "data-init/ron - facturi.xls");
const VALUTA_FILE = getArg("valuta", "data-init/valuta - facturi.xls");
const TRACKER_FILE = getArg("tracker", "data-init/Internal Affairs - 2023_2024_2025_2026 - Proiecte.csv");
const CLIENTI_FILE = getArg("clienti", "data-init/clienti.xls");
const ALIAS_FILE = getArg("aliases", "scripts/tracker-org-aliases.json");
const OUT_FILE = getArg("out", "scripts/invoice-part-number-proposal.csv");
const ALIAS_OUT = getArg("aliasOut", "scripts/org-alias-proposal.csv");
const CALIB_OUT = getArg("calibOut", "scripts/calibration-report.csv");
const TOP_N = Number(getArg("candidates", "3"));

// Accept a fuzzy org match only above this Jaccard, and only if a hard signal
// (contract#/amount) corroborates. Fuzzy matches never become HIGH.
const FUZZY_ORG_MIN = 0.75;

// ----------------------------- helpers --------------------------------------
function clean(v: unknown): string {
  return (v == null ? "" : String(v)).replace(/^\uFEFF/, "").trim();
}

const DIACRITICS: Record<string, string> = {
  ă: "a", â: "a", î: "i", ș: "s", ş: "s", ț: "t", ţ: "t", á: "a", é: "e", í: "i", ó: "o", ú: "u", ü: "u", ö: "o",
};
function stripDiacritics(s: string): string {
  return s.replace(/[ăâîșşțţáéíóúüö]/g, (c) => DIACRITICS[c] ?? c);
}

/** Normalize a company name for matching: strip diacritics/legal suffixes/punctuation. */
function normCompany(s: string): string {
  let x = stripDiacritics(clean(s).toLowerCase());
  x = x.replace(/[._,&()]/g, " ");
  x = x.replace(/\b(srl|s r l|sa|s a|srls|llc|l l c|inc|gmbh|ltd|limited|sc|societatea|s c|bv|b v|ag|kft|gbr|se|plc|co)\b/g, " ");
  return x.replace(/\s+/g, " ").trim();
}

function tokenSet(s: string): Set<string> {
  return new Set(
    stripDiacritics(clean(s).toLowerCase())
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((t) => t.length >= 3),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/** Extract contract-like numbers ("NR. 302", "482/18.08.2015", "Anexa 12", "No. 350"). */
function contractNums(s: string): Set<string> {
  const out = new Set<string>();
  const text = clean(s);
  for (const m of text.matchAll(/(?:nr|contract|anexa|comanda|act aditional|no|formular comanda)\.?\s*(\d{2,6})/gi)) {
    out.add(m[1]);
  }
  for (const m of text.matchAll(/\b(\d{2,6})\s*\/\s*\d{1,2}[.\-/]\d/g)) out.add(m[1]);
  return out;
}

/** Parse EU/US money. Treats a lone dot before groups of 3 as thousands ("2.000"). */
function parseAmount(raw: string): number | null {
  let s = clean(raw).replace(/[^0-9.,\-]/g, "");
  if (!s || s === "-") return null;
  const hasDot = s.includes(".");
  const hasComma = s.includes(",");
  if (hasDot && hasComma) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (hasComma) {
    s = /,\d{2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
  } else if (hasDot) {
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** EUR amount mentioned inline in RON invoice text ("1000 euro la cursul BNR ..."). */
function euroFromText(s: string): number | null {
  const m = clean(s).match(/([\d.,]+)\s*(?:euro|eur)\b/i);
  return m ? parseAmount(m[1]) : null;
}

/** Milestone hinted by the invoice article text. */
function milestoneOf(text: string): "avans" | "storno" | "final" | "" {
  const t = stripDiacritics(text.toLowerCase());
  if (/\bstorn/.test(t)) return "storno";
  if (/\bavans\b/.test(t)) return "avans";
  if (/\b(final|integral|rest|diferenta)\b/.test(t)) return "final";
  return "";
}

function parseDdMmYyyy(raw: string): Date | null {
  const m = clean(raw).match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/);
  if (!m) return null;
  let [, d, mo, y] = m;
  let year = Number(y);
  if (year < 100) year += 2000;
  const date = new Date(Date.UTC(year, Number(mo) - 1, Number(d)));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Mirror of the importer's date parse (XLSX raw:false yields m/d/yy strings). */
function parseInvoiceDate(raw: string): Date | null {
  const trimmed = clean(raw);
  if (!trimmed) return null;
  const m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) {
    const month = Number(m[1]);
    const day = Number(m[2]);
    const year = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (!Number.isNaN(date.getTime())) return date;
  }
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysBetween(a: Date | null, b: Date | null): number | null {
  if (!a || !b) return null;
  return Math.abs(Math.round((a.getTime() - b.getTime()) / 86_400_000));
}

function csvField(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// --------------------------- load invoices ----------------------------------
type InvoiceLine = {
  service: string;
  valueRon: number | null;
  valueEur: number | null;
};

type Invoice = {
  key: string; // accounting:{nr_iesire}  (matches DB externalRecordId)
  number: string;
  org: string;
  orgNorm: string;
  date: Date | null;
  currency: string;
  amountEur: number | null; // invoice-level EUR figure when known
  amountRon: number | null; // invoice-level RON figure (base/total)
  curs: number | null; // FX rate (>1) usable to convert EUR<->RON
  serviceText: string;
  contractNums: Set<string>;
  milestone: "avans" | "storno" | "final" | "";
  lines: InvoiceLine[];
};

function loadInvoices(file: string, kind: "ron" | "valuta"): Invoice[] {
  if (!fs.existsSync(file)) {
    console.warn(`! skipping missing file: ${file}`);
    return [];
  }
  const wb = XLSX.read(fs.readFileSync(file), { type: "buffer", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: false, blankrows: false });
  const groups = new Map<string, Invoice>();
  for (const row of rows) {
    const g = (k: string) => clean(row[k]);
    const nr = g("nr_iesire");
    if (!nr) continue;
    const key = `accounting:${nr}`;
    const lineService = [g("denumire1"), g("denumire2"), g("text_supl"), g("text_supl1")].filter(Boolean).join(" | ");
    const lineRon = parseAmount(g("valoare")) ?? parseAmount(g("total1"));
    let lineEur: number | null = null;
    if (kind === "valuta") lineEur = parseAmount(g("val_val1")) ?? parseAmount(g("val_val"));
    if (lineEur == null) lineEur = euroFromText(lineService);
    const line: InvoiceLine = { service: lineService, valueRon: lineRon, valueEur: lineEur };

    let inv = groups.get(key);
    if (!inv) {
      const org = g("denumire");
      const base = parseAmount(g("baza_tva"));
      const total = parseAmount(g("total"));
      const curs = parseAmount(g("curs") || g("curs_ref"));
      const cursOk = curs && curs > 1 ? curs : null;
      const headerText = [g("denumire1"), g("denumire2"), g("text_supl"), g("inf_suplm")].filter(Boolean).join(" ");
      inv = {
        key,
        number: nr,
        org,
        orgNorm: normCompany(org),
        date: parseInvoiceDate(g("data")),
        currency: (g("cod_valuta") || (kind === "valuta" ? "EUR" : "RON")).toUpperCase(),
        amountEur: null,
        amountRon: total && total > 0 ? total : base,
        curs: cursOk,
        serviceText: headerText,
        contractNums: new Set<string>(),
        milestone: "",
        lines: [],
      };
      // invoice-level EUR: valuta val_val, else inline euro, else base/curs.
      const valVal = parseAmount(g("val_val"));
      if (kind === "valuta" && valVal) inv.amountEur = valVal;
      if (inv.amountEur == null) inv.amountEur = euroFromText(headerText);
      if (inv.amountEur == null && inv.amountRon && cursOk) inv.amountEur = Math.round((inv.amountRon / cursOk) * 100) / 100;
      groups.set(key, inv);
    } else if (lineService) {
      inv.serviceText += ` | ${lineService}`;
    }
    inv.lines.push(line);
  }
  for (const inv of groups.values()) {
    inv.contractNums = contractNums(inv.serviceText);
    inv.milestone = milestoneOf(inv.serviceText);
    // Collapse duplicate identical lines (Saga repeats denumire1/denumire2).
    const seen = new Set<string>();
    inv.lines = inv.lines.filter((l) => {
      const k = l.service.toLowerCase();
      if (!l.service || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  return [...groups.values()];
}

// --------------------------- load tracker -----------------------------------
type Activity = {
  society: string;
  societyNorm: string;
  partNumber: string;
  contractRef: string;
  contractNums: Set<string>;
  description: string;
  descTokens: Set<string>;
  total: number | null;
  avans: number | null;
  final: number | null;
  dateAvans: Date | null;
  dateFinal: Date | null;
  dateEstAvans: Date | null;
  dateEstClose: Date | null;
  issuer: string;
  year: string;
  dedupKey: string;
};

function loadActivities(file: string): Activity[] {
  const rows = parse(fs.readFileSync(file, "utf8"), {
    skip_empty_lines: true,
    relax_column_count: true,
    relax_quotes: true,
  }) as string[][];
  const header = rows[0].map((h) => clean(h));
  const col = (name: string) => header.indexOf(name);
  const idx = {
    society: col("Societate"),
    ref: col("Referinta CTR"),
    desc: col("Descriere activitate"),
    pn: col("Part Number activitate"),
    total: col("Total activitate"),
    avans: col("Avans"),
    final: col("Final"),
    dAvans: col("Data avans"),
    dFinal: col("Data final"),
    dEstAvans: col("Data estimata avans"),
    dEstClose: col("Data estimata inchidere"),
    issuer: col("Companie"),
    year: col("An"),
  };
  const at = (row: string[], i: number) => (i >= 0 && i < row.length ? clean(row[i]) : "");
  const out: Activity[] = [];
  for (const row of rows.slice(1)) {
    const society = at(row, idx.society);
    const pn = at(row, idx.pn);
    if (!society || society === "-") continue;
    const ref = at(row, idx.ref);
    const desc = at(row, idx.desc);
    out.push({
      society,
      societyNorm: normCompany(society),
      partNumber: pn && pn !== "-" ? pn : "",
      contractRef: ref,
      contractNums: contractNums(ref),
      description: desc,
      descTokens: tokenSet(`${desc} ${pn}`),
      total: parseAmount(at(row, idx.total)),
      avans: parseAmount(at(row, idx.avans)),
      final: parseAmount(at(row, idx.final)),
      dateAvans: parseDdMmYyyy(at(row, idx.dAvans)),
      dateFinal: parseDdMmYyyy(at(row, idx.dFinal)),
      dateEstAvans: parseDdMmYyyy(at(row, idx.dEstAvans)),
      dateEstClose: parseDdMmYyyy(at(row, idx.dEstClose)),
      issuer: at(row, idx.issuer),
      year: at(row, idx.year),
      dedupKey: `${pn}|${[...contractNums(ref)].sort().join(",")}|${at(row, idx.avans)}|${at(row, idx.final)}`,
    });
  }
  return out;
}

// ------------------------- org alias resolution -----------------------------
function loadAliases(): Map<string, string> {
  const map = new Map<string, string>();
  if (!fs.existsSync(ALIAS_FILE)) return map;
  try {
    const raw = JSON.parse(fs.readFileSync(ALIAS_FILE, "utf8")) as Record<string, string>;
    for (const [k, v] of Object.entries(raw)) map.set(normCompany(k), normCompany(v));
  } catch (e) {
    console.warn(`! could not parse ${ALIAS_FILE}: ${(e as Error).message}`);
  }
  return map;
}

function loadClientiCui(file: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!fs.existsSync(file)) return map;
  const wb = XLSX.read(fs.readFileSync(file), { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: false, blankrows: false });
  for (const row of rows) {
    const name = clean(row["denumire"]);
    const cui = clean(row["cod_fiscal"]);
    if (name) map.set(normCompany(name), cui);
  }
  return map;
}

// ----------------------------- scorer ---------------------------------------
type Scored = {
  activity: Activity;
  score: number;
  matchedOn: string[];
  amountKind: string;
  hardSignal: boolean; // contract# or amount matched (used to gate fuzzy-org)
};

/** Currency-aware amount proximity. Compares EUR<->EUR when possible, else the
 *  tracker EUR amount converted to RON via the invoice's own FX rate. */
function amountProximity(inv: Invoice, val: number | null): number {
  if (!val || val <= 0) return Infinity;
  let best = Infinity;
  if (inv.amountEur) best = Math.min(best, Math.abs(inv.amountEur - val) / val);
  if (inv.amountRon && inv.curs) best = Math.min(best, Math.abs(inv.amountRon - val * inv.curs) / (val * inv.curs));
  // RON invoice with no FX and no EUR figure: leave as un-comparable (Infinity).
  return best;
}

function amountScore(inv: Invoice, act: Activity): { score: number; kind: string } {
  const candidates: Array<[string, number | null]> = [
    ["avans", act.avans],
    ["final", act.final],
    ["total", act.total],
  ];
  let best = { score: 0, kind: "" };
  for (const [kind, val] of candidates) {
    const rel = amountProximity(inv, val);
    let score = 0;
    if (rel <= 0.01) score = 30;
    else if (rel <= 0.05) score = 22;
    else if (rel <= 0.12) score = 12;
    // Milestone agreement bonus (invoice says AVANS and we matched the avans, etc.)
    if (score > 0 && inv.milestone && inv.milestone === kind) score += 6;
    if (score > best.score) best = { score, kind };
  }
  return best;
}

function dateScore(inv: Invoice, act: Activity): { score: number; label: string } {
  if (!inv.date) return { score: 0, label: "" };
  const dates: Array<[string, Date | null]> = [
    ["data avans", act.dateAvans],
    ["data final", act.dateFinal],
    ["data est. avans", act.dateEstAvans],
    ["data est. close", act.dateEstClose],
  ];
  let best = 0;
  let label = "";
  for (const [name, d] of dates) {
    const gap = daysBetween(inv.date, d);
    if (gap == null) continue;
    let s = 0;
    if (gap <= 31) s = 15;
    else if (gap <= 120) s = 8;
    else if (gap <= 365) s = 3;
    if (s > best) {
      best = s;
      label = `${name} (${gap}d)`;
    }
  }
  if (best === 0 && act.year && String(inv.date.getUTCFullYear()) === act.year) return { score: 3, label: "same year" };
  return { score: best, label };
}

/** Score one activity against an invoice (or a single line's service+value).
 *  `ignoreContract` powers the calibration pass: it forces the scorer to rely
 *  on amount/date/description only, so we can test those signals against the
 *  contract#-derived ground truth without the comparison being circular. */
function scoreActivity(
  inv: Invoice,
  act: Activity,
  lineOverride?: { service: string; valueRon: number | null; valueEur: number | null },
  opts?: { ignoreContract?: boolean },
): Scored {
  const matchedOn: string[] = [];
  let score = 0;
  let hardSignal = false;

  const text = lineOverride ? lineOverride.service : inv.serviceText;
  const ctrOverlap = !opts?.ignoreContract && [...contractNums(text)].some((c) => act.contractNums.has(c));
  if (ctrOverlap) {
    score += 50;
    matchedOn.push("contract#");
    hardSignal = true;
  }

  // For line scoring, build a shadow invoice carrying the line's own amounts.
  const amtInv: Invoice = lineOverride
    ? { ...inv, amountEur: lineOverride.valueEur, amountRon: lineOverride.valueRon }
    : inv;
  const amt = amountScore(amtInv, act);
  if (amt.score) {
    score += amt.score;
    matchedOn.push(`amount~${amt.kind}`);
    hardSignal = true;
  }

  const dt = dateScore(inv, act);
  if (dt.score) {
    score += dt.score;
    matchedOn.push(dt.label);
  }

  const jac = jaccard(tokenSet(text), act.descTokens);
  if (jac > 0) {
    score += Math.round(jac * 25);
    if (jac >= 0.15) matchedOn.push(`desc~${jac.toFixed(2)}`);
  }

  if (act.partNumber && text.toUpperCase().includes(act.partNumber.toUpperCase())) {
    score += 40;
    matchedOn.push("part# in text");
    hardSignal = true;
  }

  return { activity: act, score, matchedOn, amountKind: amt.kind, hardSignal };
}

// ----------------------------- decide ---------------------------------------
type LineProposal = { service: string; partNumber: string; score: number; on: string[] };
type Proposal = {
  invoice: Invoice;
  tier: "DETERMINISTIC" | "SCORED" | "UNRESOLVED";
  confidence: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  orgMatch: string; // exact | alias | fuzzy~x | none
  partNumber: string;
  contractRef: string;
  description: string;
  amountKind: string;
  year: string;
  issuer: string;
  reason: string;
  candidateCount: number;
  candidates: Scored[];
  lineProposals: LineProposal[];
};

type OrgResolution = { acts: Activity[]; note: string; fuzzy: boolean };

function resolveOrg(inv: Invoice, byOrg: Map<string, Activity[]>, aliases: Map<string, string>): OrgResolution {
  if (byOrg.has(inv.orgNorm)) return { acts: byOrg.get(inv.orgNorm)!, note: "exact", fuzzy: false };
  const aliased = aliases.get(inv.orgNorm);
  if (aliased && byOrg.has(aliased)) return { acts: byOrg.get(aliased)!, note: "alias", fuzzy: false };
  // Guarded fuzzy fallback.
  const invTokens = tokenSet(inv.org);
  let bestKey: string | null = null;
  let bestJac = 0;
  for (const [k] of byOrg) {
    const j = jaccard(invTokens, tokenSet(k));
    if (j > bestJac) {
      bestJac = j;
      bestKey = k;
    }
  }
  if (bestKey && bestJac >= FUZZY_ORG_MIN) return { acts: byOrg.get(bestKey)!, note: `fuzzy~${bestJac.toFixed(2)}`, fuzzy: true };
  return { acts: [], note: "none", fuzzy: false };
}

const UNRESOLVED = (inv: Invoice, orgMatch: string, reason: string, candidateCount = 0): Proposal => ({
  invoice: inv,
  tier: "UNRESOLVED",
  confidence: "NONE",
  orgMatch,
  partNumber: "",
  contractRef: "",
  description: "",
  amountKind: "",
  year: "",
  issuer: "",
  reason,
  candidateCount,
  candidates: [],
  lineProposals: [],
});

function decide(inv: Invoice, byOrg: Map<string, Activity[]>, aliases: Map<string, string>): Proposal {
  const { acts, note, fuzzy } = resolveOrg(inv, byOrg, aliases);
  if (acts.length === 0) return UNRESOLVED(inv, note, "org not found in tracker");

  // Tier 1: deterministic via contract# -> unique part number (only for
  // reliable org matches; a fuzzy org never yields a deterministic result).
  if (!fuzzy && inv.contractNums.size > 0) {
    const hits = acts.filter((a) => a.partNumber && [...inv.contractNums].some((c) => a.contractNums.has(c)));
    const distinct = new Set(hits.map((a) => a.partNumber));
    if (distinct.size === 1) {
      const a = hits[0];
      return {
        invoice: inv,
        tier: "DETERMINISTIC",
        confidence: "HIGH",
        orgMatch: note,
        partNumber: a.partNumber,
        contractRef: a.contractRef.replace(/\s+/g, " "),
        description: a.description,
        amountKind: "",
        year: a.year,
        issuer: a.issuer,
        reason: `org ${note}; unique part# via contract ${[...inv.contractNums].join("/")}${inv.milestone ? `; ${inv.milestone}` : ""}`,
        candidateCount: hits.length,
        candidates: hits.slice(0, TOP_N).map((x) => ({ activity: x, score: 100, matchedOn: ["contract#"], amountKind: "", hardSignal: true })),
        lineProposals: [],
      };
    }
  }

  // Tier 2: score candidates.
  const scored = acts
    .map((a) => scoreActivity(inv, a))
    .filter((s) => s.score > 0)
    .sort((x, y) => y.score - x.score);

  if (scored.length === 0) return UNRESOLVED(inv, note, `org ${note}; ${acts.length} activities but no signal matched`, acts.length);

  const best = scored[0];
  const runnerUp = scored[1];
  const margin = best.score - (runnerUp?.score ?? 0);
  const strong = scored.filter((s) => s.score >= best.score - 10 && s.activity.partNumber);
  const distinctPn = new Set(strong.map((s) => s.activity.partNumber));

  // Fuzzy org matches require a hard corroborating signal, else drop to unresolved.
  if (fuzzy && !best.hardSignal) {
    return UNRESOLVED(inv, note, `org ${note} but no contract#/amount corroboration (desc/date only)`, scored.length);
  }

  let confidence: Proposal["confidence"] = "LOW";
  if (!fuzzy && distinctPn.size === 1 && best.score >= 55) confidence = "HIGH";
  else if (best.score >= 45 || (best.score >= 30 && margin >= 15)) confidence = "MEDIUM";

  // Per-line proposals for genuinely multi-line invoices.
  const lineProposals: LineProposal[] = [];
  if (inv.lines.length > 1) {
    for (const line of inv.lines) {
      const ls = acts
        .map((a) => scoreActivity(inv, a, line))
        .filter((s) => s.score > 0)
        .sort((x, y) => y.score - x.score);
      if (ls[0]) lineProposals.push({ service: line.service.slice(0, 60), partNumber: ls[0].activity.partNumber, score: ls[0].score, on: ls[0].matchedOn });
    }
  }

  return {
    invoice: inv,
    tier: "SCORED",
    confidence,
    orgMatch: note,
    partNumber: best.activity.partNumber,
    contractRef: best.activity.contractRef.replace(/\s+/g, " "),
    description: best.activity.description,
    amountKind: best.amountKind,
    year: best.activity.year,
    issuer: best.activity.issuer,
    reason: `org ${note}; score=${best.score} margin=${margin} on [${best.matchedOn.join(", ")}]; ${distinctPn.size} distinct part# near top${inv.milestone ? `; ${inv.milestone}` : ""}`,
    candidateCount: scored.length,
    candidates: scored.slice(0, TOP_N),
    lineProposals,
  };
}

// --------------------------- calibration (#5) -------------------------------
/** Re-score deterministic (near-certain) invoices with the blind scorer and
 *  measure top-1 agreement, per confidence band, to validate thresholds. */
function calibrate(proposals: Proposal[], byOrg: Map<string, Activity[]>): string[] {
  const truth = proposals.filter((p) => p.tier === "DETERMINISTIC");
  const lines = ["invoiceKey,truthPartNumber,scorerTopPartNumber,agree,scorerScore,scorerBand,scorerMatchedOn"];
  const band = (s: number) => (s >= 55 ? "HIGH-ish" : s >= 30 ? "MEDIUM-ish" : "LOW-ish");
  let agree = 0;
  let scoredCount = 0;
  const byBand: Record<string, { total: number; agree: number }> = {};
  for (const p of truth) {
    const acts = byOrg.get(p.invoice.orgNorm) ?? [];
    // Blind to contract# (the signal that defined the truth) to avoid a circular
    // 100% — this measures the standalone strength of amount/date/description.
    const scored = acts
      .map((a) => scoreActivity(p.invoice, a, undefined, { ignoreContract: true }))
      .filter((s) => s.score > 0)
      .sort((x, y) => y.score - x.score);
    const top = scored[0];
    const topPn = top?.activity.partNumber ?? "";
    const ok = topPn !== "" && topPn === p.partNumber;
    if (top) {
      scoredCount += 1;
      if (ok) agree += 1;
      const b = band(top.score);
      byBand[b] = byBand[b] || { total: 0, agree: 0 };
      byBand[b].total += 1;
      if (ok) byBand[b].agree += 1;
    }
    lines.push(
      [p.invoice.key, p.partNumber, topPn, ok ? "yes" : "no", top?.score ?? 0, top ? band(top.score) : "none", (top?.matchedOn ?? []).join(" ")]
        .map(csvField)
        .join(","),
    );
  }
  console.log("\n=== calibration (scorer vs deterministic ground truth) ===");
  console.log(`  deterministic-labeled invoices: ${truth.length}`);
  console.log(`  blind scorer produced a candidate for: ${scoredCount}`);
  console.log(`  scorer top-1 agrees with contract#-derived part number: ${agree}/${scoredCount} (${scoredCount ? ((100 * agree) / scoredCount).toFixed(1) : "0"}%)`);
  for (const [b, v] of Object.entries(byBand).sort()) {
    console.log(`    band ${b.padEnd(11)} agree ${v.agree}/${v.total} (${((100 * v.agree) / v.total).toFixed(0)}%)`);
  }
  return lines;
}

// ------------------------- org alias proposals ------------------------------
function orgAliasProposals(invoices: Invoice[], byOrg: Map<string, Activity[]>, aliases: Map<string, string>, cui: Map<string, string>): string[] {
  const lines = ["invoiceOrg,invoiceOrgNorm,invoiceCUI,invoiceCount,nearestTrackerOrg,jaccard,note"];
  const invByOrg = new Map<string, { raw: string; count: number }>();
  for (const inv of invoices) {
    const e = invByOrg.get(inv.orgNorm) || { raw: inv.org, count: 0 };
    e.count += 1;
    invByOrg.set(inv.orgNorm, e);
  }
  const trackerKeys = [...byOrg.keys()];
  for (const [orgNorm, info] of invByOrg) {
    if (byOrg.has(orgNorm)) continue; // exact already resolves
    const aliased = aliases.get(orgNorm);
    if (aliased && byOrg.has(aliased)) continue; // curated
    let bestKey = "";
    let bestJac = 0;
    const invTokens = tokenSet(info.raw);
    for (const k of trackerKeys) {
      const j = jaccard(invTokens, tokenSet(k));
      if (j > bestJac) {
        bestJac = j;
        bestKey = k;
      }
    }
    const note = bestJac >= FUZZY_ORG_MIN ? "auto-fuzzy (used)" : bestJac >= 0.4 ? "review" : "no good match";
    lines.push([info.raw, orgNorm, cui.get(orgNorm) ?? "", info.count, bestKey, bestJac.toFixed(2), note].map(csvField).join(","));
  }
  return lines;
}

// ------------------------------- main ---------------------------------------
function main() {
  const invoices = [...loadInvoices(RON_FILE, "ron"), ...loadInvoices(VALUTA_FILE, "valuta")];
  const invByKey = new Map<string, Invoice>();
  for (const inv of invoices) if (!invByKey.has(inv.key)) invByKey.set(inv.key, inv);
  const invList = [...invByKey.values()];

  const activities = loadActivities(TRACKER_FILE);
  const byOrg = new Map<string, Activity[]>();
  for (const a of activities) {
    if (!byOrg.has(a.societyNorm)) byOrg.set(a.societyNorm, []);
    byOrg.get(a.societyNorm)!.push(a);
  }
  // De-dup identical recurring activities within an org so candidate sets and
  // margins aren't dominated by repeated monthly rows.
  for (const [k, list] of byOrg) {
    const seen = new Set<string>();
    byOrg.set(
      k,
      list.filter((a) => {
        if (seen.has(a.dedupKey)) return false;
        seen.add(a.dedupKey);
        return true;
      }),
    );
  }

  const aliases = loadAliases();
  const cui = loadClientiCui(CLIENTI_FILE);

  console.log(`Invoices (grouped): ${invList.length}`);
  console.log(`Tracker activities: ${activities.length} (deduped across ${byOrg.size} orgs)`);
  console.log(`Curated aliases loaded: ${aliases.size}`);

  const proposals = invList.map((inv) => decide(inv, byOrg, aliases));

  const tally = (pred: (p: Proposal) => boolean) => proposals.filter(pred).length;
  const summary = {
    DETERMINISTIC: tally((p) => p.tier === "DETERMINISTIC"),
    "SCORED/HIGH": tally((p) => p.tier === "SCORED" && p.confidence === "HIGH"),
    "SCORED/MEDIUM": tally((p) => p.tier === "SCORED" && p.confidence === "MEDIUM"),
    "SCORED/LOW": tally((p) => p.tier === "SCORED" && p.confidence === "LOW"),
    UNRESOLVED: tally((p) => p.tier === "UNRESOLVED"),
  };
  console.log("\n=== proposal breakdown ===");
  for (const [k, v] of Object.entries(summary)) {
    console.log(`  ${k.padEnd(16)} ${v}\t${((100 * v) / invList.length).toFixed(1)}%`);
  }
  const auto = summary.DETERMINISTIC + summary["SCORED/HIGH"];
  console.log(`  ${"auto (HIGH)".padEnd(16)} ${auto}\t${((100 * auto) / invList.length).toFixed(1)}%`);
  console.log(`  storno invoices flagged: ${tally((p) => p.invoice.milestone === "storno")}`);
  console.log(`  fuzzy-org matches used:  ${tally((p) => p.orgMatch.startsWith("fuzzy"))}`);
  console.log(`  multi-line invoices:     ${tally((p) => p.lineProposals.length > 0)}`);

  // --- main proposal CSV ---
  const headers = [
    "invoiceKey", "invoiceNumber", "organization", "orgMatch", "issueDate", "currency",
    "milestone", "amountEur", "amountRon", "tier", "confidence", "proposedPartNumber",
    "proposedContractRef", "amountMatchedOn", "trackerYear", "issuer", "trackerDescription",
    "invoiceServiceText", "candidateCount", "reason", "topCandidates", "lineProposals",
  ];
  const lines = [headers.join(",")];
  for (const p of proposals) {
    const cand = p.candidates.map((c) => ({
      pn: c.activity.partNumber,
      score: c.score,
      on: c.matchedOn,
      ref: c.activity.contractRef.replace(/\s+/g, " ").slice(0, 40),
      desc: c.activity.description.slice(0, 60),
    }));
    lines.push(
      [
        p.invoice.key, p.invoice.number, p.invoice.org, p.orgMatch,
        p.invoice.date ? p.invoice.date.toISOString().slice(0, 10) : "", p.invoice.currency,
        p.invoice.milestone, p.invoice.amountEur ?? "", p.invoice.amountRon ?? "",
        p.tier, p.confidence, p.partNumber, p.contractRef, p.amountKind, p.year, p.issuer,
        p.description.replace(/\s+/g, " ").slice(0, 120),
        p.invoice.serviceText.replace(/\s+/g, " ").slice(0, 160),
        p.candidateCount, p.reason,
        JSON.stringify(cand), p.lineProposals.length ? JSON.stringify(p.lineProposals) : "",
      ]
        .map(csvField)
        .join(","),
    );
  }
  fs.writeFileSync(OUT_FILE, lines.join("\n"), "utf8");
  console.log(`\nWrote ${proposals.length} rows -> ${OUT_FILE}`);

  // --- org alias proposals ---
  const aliasLines = orgAliasProposals(invList, byOrg, aliases, cui);
  fs.writeFileSync(ALIAS_OUT, aliasLines.join("\n"), "utf8");
  console.log(`Wrote ${aliasLines.length - 1} unmatched-org rows -> ${ALIAS_OUT}`);

  // --- calibration ---
  const calibLines = calibrate(proposals, byOrg);
  fs.writeFileSync(CALIB_OUT, calibLines.join("\n"), "utf8");
  console.log(`Wrote calibration detail -> ${CALIB_OUT}`);
}

main();
