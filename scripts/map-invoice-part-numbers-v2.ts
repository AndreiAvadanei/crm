/**
 * Production-aligned, read-only invoice -> part-number reconciliation.
 *
 * Sources:
 *   - data-init/Facturi in lei cu detalii Bit.xls
 *   - data-init/Facturi in valuta cu detalii BIT.xls
 *   - data-init/Internal Affairs - 2023_2024_2025_2026 - Proiecte.csv
 *
 * This script NEVER writes the database. It mirrors the current production
 * import state (valuta overwrote colliding RON invoice numbers), matches the
 * complete accounting history to tracker activities, and emits review CSVs.
 *
 * Important design choices:
 *   - All recurring tracker rows are preserved. Monthly rows are evidence, not
 *     duplicates.
 *   - Recurrent companies are matched chronologically, one tracker billing
 *     slot per invoice line.
 *   - Amount is supporting evidence only. Contract values may increase or
 *     decrease over time, and actual invoice values can differ systematically.
 *   - "Facturat Da/Nu" is never treated as truth. Issued/upcoming status is
 *     derived from actual accounting invoices; tracker flags are audit context.
 *   - Output is sorted by company, then date.
 *
 * Usage:
 *   npx tsx scripts/map-invoice-part-numbers.ts
 */
import fs from "fs";
import { createHash } from "crypto";
import { parse } from "csv-parse/sync";
import * as XLSX from "xlsx";

// ---------------------------------------------------------------------------
// Arguments / outputs
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const LEI_FILE = arg("lei", "data-init/Facturi in lei cu detalii Bit.xls");
const VALUTA_FILE = arg("valuta", "data-init/Facturi in valuta cu detalii BIT.xls");
const PRODUCTION_FILE = arg("production", "data-init/production-invoices-snapshot.json");
const TRACKER_FILE = arg("tracker", "data-init/Internal Affairs - 2023_2024_2025_2026 - Proiecte.csv");
const PART_NUMBER_FILE = arg("partNumbers", "data-init/part-numbers.xlsx");
const ALIAS_FILE = arg("aliases", "scripts/tracker-org-aliases.json");
const REVIEW_OUT = arg("reviewOut", "scripts/invoice-part-number-review.csv");
const DETAIL_OUT = arg("detailOut", "scripts/invoice-part-number-proposal.csv");
const COMPANY_OUT = arg("companyOut", "scripts/invoice-mapping-company-summary.csv");
const SCHEDULE_OUT = arg("scheduleOut", "scripts/invoice-schedule-reconciliation.csv");
const FORECAST_OUT = arg("forecastOut", "scripts/upcoming-invoice-forecast.csv");
const MISSING_RON_OUT = arg("missingRonOut", "scripts/production-missing-ron-invoices.csv");
const NUMBER_REUSE_OUT = arg("numberReuseOut", "scripts/production-number-reuse-anomalies.csv");
const METADATA_OUT = arg("metadataOut", "scripts/invoice-mapping-run-metadata.json");
const AS_OF_RAW = arg("as-of", new Date().toISOString().slice(0, 10));
const AS_OF = new Date(`${AS_OF_RAW}T00:00:00.000Z`);
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Normalization / parsing
// ---------------------------------------------------------------------------
function clean(value: unknown): string {
  return (value == null ? "" : String(value)).replace(/^\uFEFF/, "").trim();
}

function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[șş]/g, "s").replace(/[țţ]/g, "t");
}

function normalizeCompany(value: string): string {
  return stripDiacritics(clean(value).toLowerCase())
    .replace(/[“”„"'.(),_&]/g, " ")
    .replace(/\b(srl|s r l|sa|s a|llc|l l c|inc|gmbh|ltd|limited|plc|bv|b v|ag|kft|sc|s c|sca|s c a|scs|s c s|societatea|company|co|and)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWORDS = new Set([
  "the", "and", "for", "from", "din", "conform", "contract", "agreement", "service", "services",
  "servicii", "nr", "no", "under", "according", "invoice", "factura", "security", "recurrent",
]);

function tokens(value: string): Set<string> {
  return new Set(
    stripDiacritics(clean(value).toLowerCase())
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((token) => token.length >= 3 && !STOPWORDS.has(token)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const token of a) if (b.has(token)) common += 1;
  return common / (a.size + b.size - common);
}

function serviceSignature(value: string): string {
  return [...tokens(value.replace(/\b\d+(?:[.,/]\d+)*\b/g, " "))].sort().join(" ");
}

function parseAmount(raw: string): number | null {
  let value = clean(raw).replace(/\s+/g, "").replace(/[^0-9.,-]/g, "");
  if (!value || value === "-") return null;
  if (value.includes(".") && value.includes(",")) {
    const eu = /^-?\d{1,3}(?:\.\d{3})*,\d+$/.test(value);
    const us = /^-?\d{1,3}(?:,\d{3})*\.\d+$/.test(value);
    if (eu) value = value.replace(/\./g, "").replace(",", ".");
    else if (us) value = value.replace(/,/g, "");
    else return null;
  } else if (value.includes(",")) {
    const commaCount = (value.match(/,/g) ?? []).length;
    if (commaCount > 1) {
      if (!/^-?\d{1,3}(?:,\d{3})+$/.test(value)) return null;
      value = value.replace(/,/g, "");
    } else {
      value = /,\d{1,2}$/.test(value) ? value.replace(",", ".") : value.replace(",", "");
    }
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(value)) {
    value = value.replace(/\./g, "");
  } else if ((value.match(/\./g) ?? []).length > 1) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseDate(value: string): Date | null {
  const text = clean(value);
  if (!text) return null;
  const dmy = text.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (dmy) {
    let year = Number(dmy[3]);
    if (year < 100) year += 2000;
    const month = Number(dmy[2]);
    const day = Number(dmy[1]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
      ? date
      : null;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** SheetJS raw:false returns invoice XLS date cells as m/d/yy. */
function parseInvoiceDate(value: string): Date | null {
  const text = clean(value);
  const mdy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!mdy) return parseDate(text);
  const month = Number(mdy[1]);
  const day = Number(mdy[2]);
  let year = Number(mdy[3]);
  if (year < 100) year += 2000;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date
    : null;
}

function iso(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "";
}

function dayDiff(a: Date | null, b: Date | null): number | null {
  return a && b ? Math.round((a.getTime() - b.getTime()) / DAY_MS) : null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function csv(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function sha256(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

type CatalogResolution = {
  status: "UNIQUE" | "AMBIGUOUS" | "MISSING" | "EMPTY";
  template: string;
  values: Record<string, string>;
  candidates: string[];
};

function loadPartNumberCatalog(file: string): string[] {
  const workbook = XLSX.read(fs.readFileSync(file), { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
  return rows
    .map((row) => clean(row["Part Number"]).replace(/-limit\b/gi, "-<limit>"))
    .filter(Boolean);
}

function normalizeConcretePartNumber(code: string): string {
  // A few tracker rows put concrete numeric values inside angle brackets
  // (e.g. ...-<400>-<12>). Those are values, not template placeholders.
  return code.replace(/<(\d+(?:[.,]\d+)?)>/g, "$1");
}

function resolveCatalogCode(code: string, templates: string[]): CatalogResolution {
  code = normalizeConcretePartNumber(code);
  if (!code) return { status: "EMPTY", template: "", values: {}, candidates: [] };
  const matches: Array<{ template: string; values: Record<string, string> }> = [];
  for (const template of templates) {
    const placeholders = [...template.matchAll(/<([^>]+)>/g)];
    if (!placeholders.length) {
      if (template === code) matches.push({ template, values: {} });
      continue;
    }
    let pattern = "^";
    let cursor = 0;
    for (const placeholder of placeholders) {
      const literal = template.slice(cursor, placeholder.index);
      pattern += literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      pattern += "([^-]+)";
      cursor = (placeholder.index ?? 0) + placeholder[0].length;
    }
    pattern += `${template.slice(cursor).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
    const concrete = code.match(new RegExp(pattern, "i"));
    if (!concrete) continue;
    const values: Record<string, string> = {};
    placeholders.forEach((placeholder, index) => {
      values[placeholder[1]] = concrete[index + 1];
    });
    matches.push({ template, values });
  }
  if (!matches.length) return { status: "MISSING", template: "", values: {}, candidates: [] };
  if (matches.length > 1) {
    return { status: "AMBIGUOUS", template: "", values: {}, candidates: matches.map((match) => match.template) };
  }
  return { status: "UNIQUE", template: matches[0].template, values: matches[0].values, candidates: [matches[0].template] };
}

/**
 * Contract references only. Deliberately excludes Annex/Comanda numbers:
 * treating "Anexa 12" as contract 12 created false deterministic matches.
 */
function contractIds(value: string): Set<string> {
  const result = new Set<string>();
  const text = clean(value);
  const patterns = [
    /(?:contract(?:ul)?|framework(?:\s+service)?\s+agreement|services?\s+agreement)\s*(?:nr|no)?\.?\s*[:#-]?\s*(\d{1,6})/gi,
    /(?:^|[\s,(])(?:nr|no)\.?\s*(\d{1,6})\s*\/\s*\d{1,2}[./-]\d{1,2}/gi,
    /\b(\d{2,6})\s*\/\s*\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) result.add(match[1]);
  }
  return result;
}

function contractAmountFromText(value: string): number | null {
  const match = clean(value).match(/(-?[\d.,]+)\s*(?:euro|eur|usd|dolari?|dollars?)\b/i);
  return match ? parseAmount(match[1]) : null;
}

function milestone(value: string): "avans" | "final" | "storno" | "" {
  const text = stripDiacritics(value.toLowerCase());
  if (/\bstorn/.test(text)) return "storno";
  if (/\bavans\b/.test(text)) return "avans";
  if (/\b(final|rest|diferenta|integral)\b/.test(text)) return "final";
  return "";
}

// ---------------------------------------------------------------------------
// Invoice source parsing
// ---------------------------------------------------------------------------
type InvoiceSource = "ron" | "valuta";

type InvoiceLine = {
  index: number;
  service: string;
  amountLocal: number | null;
  amountContract: number | null;
};

type Invoice = {
  sourceKey: string;
  sourceId: string;
  dbKey: string;
  source: InvoiceSource;
  number: string;
  organization: string;
  orgNorm: string;
  issueDate: Date | null;
  currency: string;
  amountLocal: number | null;
  amountContract: number | null;
  exchangeRate: number | null;
  serviceText: string;
  serviceTokens: Set<string>;
  contractIds: Set<string>;
  milestone: "avans" | "final" | "storno" | "";
  lines: InvoiceLine[];
};

function loadInvoices(file: string, source: InvoiceSource): Invoice[] {
  const workbook = XLSX.read(fs.readFileSync(file), { type: "buffer", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: false,
    blankrows: false,
  });
  const required = ["nr_iesire", "id_iesire", "denumire", "data", "baza_tva", "denumire1"];
  const headers = new Set(Object.keys(rows[0] ?? {}).map((key) => key.toLowerCase()));
  const missingHeaders = required.filter((key) => !headers.has(key));
  if (missingHeaders.length) throw new Error(`${file}: missing required columns: ${missingHeaders.join(", ")}`);
  const grouped = new Map<string, Invoice>();

  for (const row of rows) {
    const get = (key: string) => clean(row[key]);
    const number = get("nr_iesire");
    if (!number) continue;
    // id_iesire identifies the actual source invoice. nr_iesire is reused
    // both across files and, in a small number of cases, inside one file.
    const sourceId = get("id_iesire") || `${number}|${get("denumire")}|${get("data")}`;
    const sourceKey = `${source}:${sourceId}`;
    const lineService = [get("denumire1"), get("text_supl")].filter(Boolean).join(" | ");
    const exchangeRateRaw = parseAmount(get("curs") || get("curs_ref"));
    const exchangeRate = exchangeRateRaw && exchangeRateRaw > 1 ? exchangeRateRaw : null;
    const lineLocal = parseAmount(get("valoare")) ?? parseAmount(get("total1"));
    const foreignLine = source === "valuta" ? parseAmount(get("val_val1")) : null;
    const lineContract = foreignLine ?? contractAmountFromText(lineService)
      ?? (lineLocal != null && exchangeRate ? lineLocal / exchangeRate : null);

    let invoice = grouped.get(sourceKey);
    if (!invoice) {
      const organization = get("denumire");
      const base = parseAmount(get("baza_tva"));
      const total = parseAmount(get("total"));
      const headerService = [get("denumire1"), get("text_supl"), get("inf_suplm")].filter(Boolean).join(" | ");
      const foreignAmount = source === "valuta" ? parseAmount(get("val_val")) : null;
      const contractAmount = foreignAmount ?? contractAmountFromText(headerService)
        ?? (base != null && exchangeRate ? base / exchangeRate : null);
      invoice = {
        sourceKey,
        sourceId,
        // Production currently has the unqualified key for both exports.
        dbKey: `accounting:${number}`,
        source,
        number,
        organization,
        orgNorm: normalizeCompany(organization),
        issueDate: parseInvoiceDate(get("data")),
        currency: (get("cod_valuta") || "RON").toUpperCase(),
        // Tracker values are service/net values; compare against baza_tva, not
        // VAT-inclusive total.
        amountLocal: base != null ? Math.abs(base) : total == null ? null : Math.abs(total),
        amountContract: contractAmount == null ? null : Math.abs(contractAmount),
        exchangeRate,
        serviceText: headerService,
        serviceTokens: tokens(headerService),
        contractIds: new Set(),
        milestone: "",
        lines: [],
      };
      grouped.set(sourceKey, invoice);
    } else if (lineService) {
      invoice.serviceText += ` | ${lineService}`;
      for (const token of tokens(lineService)) invoice.serviceTokens.add(token);
    }

    const duplicateLine = invoice.lines.some(
      (line) => line.service.toLowerCase() === lineService.toLowerCase()
        && line.amountLocal === (lineLocal == null ? null : Math.abs(lineLocal)),
    );
    if (lineService && !duplicateLine) {
      invoice.lines.push({
        index: invoice.lines.length + 1,
        service: lineService,
        amountLocal: lineLocal == null ? null : Math.abs(lineLocal),
        amountContract: lineContract == null ? null : Math.abs(lineContract),
      });
    }
  }

  for (const invoice of grouped.values()) {
    invoice.contractIds = contractIds(invoice.serviceText);
    invoice.milestone = milestone(invoice.serviceText);
    if (!invoice.lines.length) {
      invoice.lines.push({
        index: 1,
        service: invoice.serviceText,
        amountLocal: invoice.amountLocal,
        amountContract: invoice.amountContract,
      });
    }
  }
  return [...grouped.values()];
}

type ProductionSnapshot = {
  invoiceCount: number;
  invoices: Array<{
    id: string;
    externalRecordId: string;
    number: string | null;
    organization: string;
    issueDate: string | null;
    currency: string | null;
    totalAmount: string | null;
    totalBaseAmount: string | null;
    servicesDescription: string | null;
    originalValues: Record<string, unknown> | null;
    lines: Array<{
      id: string;
      serviceDescription: string | null;
      textSupplement: string | null;
      value: string | null;
      total: string | null;
      originalValues: Record<string, unknown> | null;
    }>;
  }>;
};

function loadProductionInvoices(file: string): Invoice[] {
  const snapshot = JSON.parse(fs.readFileSync(file, "utf8")) as ProductionSnapshot;
  const invoices: Invoice[] = [];
  for (const raw of snapshot.invoices) {
    if (!raw.number) continue;
    const original = raw.originalValues ?? {};
    const source: InvoiceSource = (raw.currency ?? "RON").toUpperCase() === "RON" ? "ron" : "valuta";
    const exchangeRaw = parseAmount(clean(original.curs ?? original.curs_ref));
    const exchangeRate = exchangeRaw && exchangeRaw > 1 ? exchangeRaw : null;
    const serviceText = [
      raw.servicesDescription,
      clean(original.text_supl),
      ...raw.lines.flatMap((line) => [line.serviceDescription, line.textSupplement]),
    ].filter(Boolean).join(" | ");
    const foreignAmount = source === "valuta" ? parseAmount(clean(original.val_val)) : null;
    const base = parseAmount(raw.totalBaseAmount ?? "");
    const amountContract = foreignAmount ?? contractAmountFromText(serviceText)
      ?? (base != null && exchangeRate ? base / exchangeRate : null);
    const lines: InvoiceLine[] = raw.lines.map((line, index) => {
      const lineOriginal = line.originalValues ?? {};
      const lineService = [line.serviceDescription, line.textSupplement].filter(Boolean).join(" | ");
      const local = parseAmount(line.value ?? "") ?? parseAmount(line.total ?? "");
      const foreignLine = source === "valuta"
        ? parseAmount(clean(lineOriginal.val_val1 ?? lineOriginal.val_val))
        : null;
      const contract = foreignLine ?? contractAmountFromText(lineService)
        ?? (local != null && exchangeRate ? local / exchangeRate : null);
      return {
        index: index + 1,
        service: lineService,
        amountLocal: local == null ? null : Math.abs(local),
        amountContract: contract == null ? null : Math.abs(contract),
      };
    });
    const invoice: Invoice = {
      sourceKey: `production:${raw.id}`,
      sourceId: raw.id,
      dbKey: raw.externalRecordId,
      source,
      number: raw.number,
      organization: raw.organization,
      orgNorm: normalizeCompany(raw.organization),
      issueDate: raw.issueDate ? new Date(`${raw.issueDate}T00:00:00.000Z`) : null,
      currency: (raw.currency ?? "RON").toUpperCase(),
      amountLocal: base == null ? null : Math.abs(base),
      amountContract: amountContract == null ? null : Math.abs(amountContract),
      exchangeRate,
      serviceText,
      serviceTokens: tokens(serviceText),
      contractIds: contractIds(serviceText),
      milestone: milestone(serviceText),
      lines: lines.length ? lines : [{
        index: 1,
        service: serviceText,
        amountLocal: base == null ? null : Math.abs(base),
        amountContract: amountContract == null ? null : Math.abs(amountContract),
      }],
    };
    invoices.push(invoice);
  }
  if (invoices.length !== snapshot.invoiceCount) {
    throw new Error(`Production snapshot declared ${snapshot.invoiceCount} invoices but parsed ${invoices.length}.`);
  }
  return invoices;
}

// ---------------------------------------------------------------------------
// Tracker parsing: activities -> possible billing slots
// ---------------------------------------------------------------------------
type Activity = {
  rowNumber: number;
  society: string;
  societyNorm: string;
  partNumber: string;
  description: string;
  contractRef: string;
  contractIds: Set<string>;
  issuer: string;
  year: string;
  total: number | null;
  avans: number | null;
  final: number | null;
  dateAvans: Date | null;
  dateFinal: Date | null;
  estimateAvans: Date | null;
  estimateFinal: Date | null;
  billedAvansFlag: string;
  billedFinalFlag: string;
};

type BillingSlot = {
  id: string;
  activity: Activity;
  kind: "avans" | "final" | "total";
  amount: number | null;
  expectedDate: Date | null;
  dateSource: "actual" | "estimated" | "none";
  trackerBilledFlag: string;
};

function loadActivities(file: string): Activity[] {
  const rows = parse(fs.readFileSync(file, "utf8"), {
    skip_empty_lines: true,
    relax_column_count: true,
    relax_quotes: true,
  }) as string[][];
  const header = rows[0].map(clean);
  const requiredHeaders = [
    "Societate", "Part Number activitate", "Descriere activitate", "Referinta CTR",
    "Total activitate", "Avans", "Final", "Data avans", "Data final",
    "Data estimata avans", "Data estimata inchidere", "Facturat avans", "Facturat final",
  ];
  const missingHeaders = requiredHeaders.filter((name) => !header.includes(name));
  if (missingHeaders.length) throw new Error(`${file}: missing required columns: ${missingHeaders.join(", ")}`);
  const col = (name: string) => header.indexOf(name);
  const indices = {
    society: col("Societate"),
    partNumber: col("Part Number activitate"),
    description: col("Descriere activitate"),
    contractRef: col("Referinta CTR"),
    total: col("Total activitate"),
    avans: col("Avans"),
    final: col("Final"),
    dateAvans: col("Data avans"),
    dateFinal: col("Data final"),
    estimateAvans: col("Data estimata avans"),
    estimateFinal: col("Data estimata inchidere"),
    billedAvans: col("Facturat avans"),
    billedFinal: col("Facturat final"),
    issuer: col("Companie"),
    year: col("An"),
  };
  const get = (row: string[], index: number) => index >= 0 && index < row.length ? clean(row[index]) : "";
  const activities: Activity[] = [];

  rows.slice(1).forEach((row, index) => {
    const society = get(row, indices.society);
    const partNumber = get(row, indices.partNumber);
    if (!society || society === "-" || !partNumber || partNumber === "-") return;
    const contractRef = get(row, indices.contractRef);
    activities.push({
      rowNumber: index + 2,
      society,
      societyNorm: normalizeCompany(society),
      partNumber,
      description: get(row, indices.description),
      contractRef,
      contractIds: contractIds(contractRef),
      issuer: get(row, indices.issuer),
      year: get(row, indices.year),
      total: parseAmount(get(row, indices.total)),
      avans: parseAmount(get(row, indices.avans)),
      final: parseAmount(get(row, indices.final)),
      dateAvans: parseDate(get(row, indices.dateAvans)),
      dateFinal: parseDate(get(row, indices.dateFinal)),
      estimateAvans: parseDate(get(row, indices.estimateAvans)),
      estimateFinal: parseDate(get(row, indices.estimateFinal)),
      billedAvansFlag: get(row, indices.billedAvans),
      billedFinalFlag: get(row, indices.billedFinal),
    });
  });
  return activities;
}

function activitySlots(activity: Activity): BillingSlot[] {
  const result: BillingSlot[] = [];
  const add = (
    kind: BillingSlot["kind"],
    amount: number | null,
    actual: Date | null,
    estimated: Date | null,
    trackerBilledFlag: string,
  ) => result.push({
    id: `tracker:${activity.rowNumber}:${kind}`,
    activity,
    kind,
    amount: amount == null ? null : Math.abs(amount),
    expectedDate: actual ?? estimated,
    dateSource: actual ? "actual" : estimated ? "estimated" : "none",
    trackerBilledFlag,
  });

  if ((activity.avans ?? 0) !== 0 || activity.dateAvans || activity.estimateAvans) {
    add("avans", activity.avans, activity.dateAvans, activity.estimateAvans, activity.billedAvansFlag);
  }
  if ((activity.final ?? 0) !== 0 || activity.dateFinal || activity.estimateFinal) {
    add("final", activity.final, activity.dateFinal, activity.estimateFinal, activity.billedFinalFlag);
  }
  if (!result.length && (activity.total ?? 0) !== 0) {
    add("total", activity.total, null, activity.estimateFinal ?? activity.estimateAvans, activity.billedFinalFlag);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Company resolution and profiles
// ---------------------------------------------------------------------------
type OrgResolution = { trackerOrg: string | null; match: "exact" | "alias" | "fuzzy" | "none"; similarity: number };

function loadAliases(): Map<string, string> {
  const aliases = new Map<string, string>();
  if (!fs.existsSync(ALIAS_FILE)) return aliases;
  const input = JSON.parse(fs.readFileSync(ALIAS_FILE, "utf8")) as Record<string, string>;
  for (const [invoiceName, trackerName] of Object.entries(input)) {
    aliases.set(normalizeCompany(invoiceName), normalizeCompany(trackerName));
  }
  return aliases;
}

function resolveOrganization(orgNorm: string, trackerOrgs: Set<string>, aliases: Map<string, string>): OrgResolution {
  if (trackerOrgs.has(orgNorm)) return { trackerOrg: orgNorm, match: "exact", similarity: 1 };
  const alias = aliases.get(orgNorm);
  if (alias && trackerOrgs.has(alias)) return { trackerOrg: alias, match: "alias", similarity: 1 };
  let best = "";
  let bestScore = 0;
  for (const trackerOrg of trackerOrgs) {
    const score = jaccard(tokens(orgNorm), tokens(trackerOrg));
    if (score > bestScore) {
      bestScore = score;
      best = trackerOrg;
    }
  }
  // Fuzzy is retained for review, never auto-HIGH.
  if (best && bestScore >= 0.8) return { trackerOrg: best, match: "fuzzy", similarity: bestScore };
  return { trackerOrg: null, match: "none", similarity: bestScore };
}

type CompanyType = "SMALL" | "RECURRENT" | "MANY" | "STANDARD";
type RatioPoint = { date: Date; ratio: number };

type CompanyProfile = {
  org: string;
  companyType: CompanyType;
  invoiceCount: number;
  activityCount: number;
  cadenceShare: number;
  modalServiceShare: number;
  dominantPartNumber: string;
  dominantPartNumberShare: number;
  amountTrend: "UP" | "DOWN" | "STABLE" | "MIXED/UNKNOWN";
  ratioPoints: RatioPoint[];
};

function cadenceShare(invoices: Invoice[]): number {
  const dates = [...new Set(invoices.filter((invoice) => invoice.milestone !== "storno").map((invoice) => iso(invoice.issueDate)).filter(Boolean))]
    .map((value) => new Date(`${value}T00:00:00.000Z`))
    .sort((a, b) => a.getTime() - b.getTime());
  if (dates.length < 4) return 0;
  let monthly = 0;
  for (let i = 1; i < dates.length; i += 1) {
    const gap = Math.abs(dayDiff(dates[i], dates[i - 1]) ?? 0);
    if (gap >= 20 && gap <= 50) monthly += 1;
  }
  return monthly / (dates.length - 1);
}

function modalServiceShare(invoices: Invoice[]): number {
  const signatures = invoices
    .filter((invoice) => invoice.milestone !== "storno")
    .map((invoice) => serviceSignature(invoice.serviceText))
    .filter(Boolean);
  if (!signatures.length) return 0;
  const counts = new Map<string, number>();
  for (const signature of signatures) counts.set(signature, (counts.get(signature) ?? 0) + 1);
  return Math.max(...counts.values()) / signatures.length;
}

function amountTrend(invoices: Invoice[], recurrent: boolean): CompanyProfile["amountTrend"] {
  if (!recurrent) return "MIXED/UNKNOWN";
  const values = invoices
    .filter((invoice) => invoice.milestone !== "storno" && invoice.amountContract != null)
    .sort((a, b) => (a.issueDate?.getTime() ?? 0) - (b.issueDate?.getTime() ?? 0))
    .map((invoice) => invoice.amountContract!);
  if (values.length < 6) return "MIXED/UNKNOWN";
  const recent = median(values.slice(-3));
  const prior = median(values.slice(-6, -3));
  if (recent == null || prior == null || prior === 0) return "MIXED/UNKNOWN";
  const ratio = recent / prior;
  if (ratio >= 1.05) return "UP";
  if (ratio <= 0.95) return "DOWN";
  return "STABLE";
}

function buildProfile(org: string, invoices: Invoice[], activities: Activity[], slots: BillingSlot[]): CompanyProfile {
  const pnCounts = new Map<string, number>();
  for (const activity of activities) pnCounts.set(activity.partNumber, (pnCounts.get(activity.partNumber) ?? 0) + 1);
  const dominant = [...pnCounts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  const dominantShare = activities.length ? dominant[1] / activities.length : 0;
  const cadence = cadenceShare(invoices);
  const modalShare = modalServiceShare(invoices);
  const recurrent = invoices.length >= 5
    && cadence >= 0.55
    && (modalShare >= 0.45 || dominantShare >= 0.7);
  const companyType: CompanyType = invoices.length < 5
    ? "SMALL"
    : recurrent
      ? "RECURRENT"
      : invoices.length >= 15
        ? "MANY"
        : "STANDARD";

  // Learn local invoice/tracker amount ratios only from near-exact date pairs.
  // This captures systematic differences and step changes, but never rejects a
  // match when price changes.
  const ratioPoints: RatioPoint[] = [];
  if (recurrent) {
    for (const invoice of invoices) {
      if (!invoice.issueDate || invoice.milestone === "storno" || !invoice.amountContract) continue;
      const near = slots
        .filter((slot) => slot.expectedDate && slot.amount && Math.abs(dayDiff(invoice.issueDate, slot.expectedDate) ?? 999) <= 7)
        .sort((a, b) => {
          const aDate = Math.abs(dayDiff(invoice.issueDate, a.expectedDate) ?? 999);
          const bDate = Math.abs(dayDiff(invoice.issueDate, b.expectedDate) ?? 999);
          if (aDate !== bDate) return aDate - bDate;
          const aDelta = Math.abs(invoice.amountContract! / a.amount! - 1);
          const bDelta = Math.abs(invoice.amountContract! / b.amount! - 1);
          return aDelta - bDelta;
        });
      const slot = near[0];
      if (slot?.amount) {
        const ratio = invoice.amountContract / slot.amount;
        if (ratio >= 0.4 && ratio <= 2.5) ratioPoints.push({ date: invoice.issueDate, ratio });
      }
    }
  }

  return {
    org,
    companyType,
    invoiceCount: invoices.length,
    activityCount: activities.length,
    cadenceShare: cadence,
    modalServiceShare: modalShare,
    dominantPartNumber: dominant[0],
    dominantPartNumberShare: dominantShare,
    amountTrend: amountTrend(invoices, recurrent),
    ratioPoints,
  };
}

function localRatio(profile: CompanyProfile, date: Date | null): number | null {
  if (!date || profile.ratioPoints.length < 3) return null;
  const nearest = [...profile.ratioPoints]
    .sort((a, b) => Math.abs(a.date.getTime() - date.getTime()) - Math.abs(b.date.getTime() - date.getTime()))
    .slice(0, 6)
    .map((point) => point.ratio);
  return median(nearest);
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------
type MatchUnit = {
  id: string;
  invoice: Invoice;
  line: InvoiceLine;
};

type MatchEdge = {
  unit: MatchUnit;
  slot: BillingSlot;
  score: number;
  signals: string[];
  dateGap: number | null;
  contractMatch: boolean;
  amountDelta: number | null;
};

function scoreEdge(unit: MatchUnit, slot: BillingSlot, profile: CompanyProfile): MatchEdge {
  const { invoice, line } = unit;
  const signals: string[] = [];
  let score = 0;

  if (
    (invoice.milestone === "avans" && slot.kind === "final")
    || (invoice.milestone === "final" && slot.kind === "avans")
  ) {
    return {
      unit,
      slot,
      score: -100,
      signals: [`milestone-conflict:${invoice.milestone}->${slot.kind}`],
      dateGap: invoice.issueDate && slot.expectedDate
        ? Math.abs(dayDiff(invoice.issueDate, slot.expectedDate) ?? 9999)
        : null,
      contractMatch: false,
      amountDelta: null,
    };
  }

  const lineContracts = contractIds(line.service || invoice.serviceText);
  const contractMatch = [...lineContracts].some((id) => slot.activity.contractIds.has(id))
    || [...invoice.contractIds].some((id) => slot.activity.contractIds.has(id));
  if (contractMatch) {
    score += 60;
    signals.push("contract");
  }

  const signedGap = dayDiff(invoice.issueDate, slot.expectedDate);
  const dateGap = signedGap == null ? null : Math.abs(signedGap);
  if (dateGap != null) {
    const recurrentPoints = dateGap <= 3 ? 55
      : dateGap <= 10 ? 48
        : dateGap <= 20 ? 40
          : dateGap <= 35 ? 30
            : dateGap <= 50 ? 20
              : dateGap <= 75 ? 10
                : dateGap <= 120 ? 4
                  : 0;
    const normalPoints = dateGap <= 7 ? 28
      : dateGap <= 31 ? 18
        : dateGap <= 90 ? 8
          : dateGap <= 180 ? 3
            : 0;
    const points = profile.companyType === "RECURRENT" ? recurrentPoints : normalPoints;
    score += points;
    if (points) signals.push(`date:${dateGap}d`);
  }

  const invoiceAmount = line.amountContract ?? invoice.amountContract;
  let amountDelta: number | null = null;
  if (invoiceAmount && slot.amount) {
    const ratio = localRatio(profile, invoice.issueDate);
    // Tracker currency is not explicit. Never compare USD nominal values to
    // tracker values unless a dated recurring series learned the local ratio.
    if (invoice.currency !== "USD" || ratio != null) {
      const expected = slot.amount * (ratio ?? 1);
      amountDelta = Math.abs(invoiceAmount / expected - 1);
      const amountPoints = amountDelta <= 0.02 ? 25 : amountDelta <= 0.08 ? 15 : amountDelta <= 0.2 ? 7 : 0;
      score += amountPoints;
      if (amountPoints) signals.push(`${ratio ? `trend-adjusted-amount:${ratio.toFixed(3)}` : "amount"}:${(amountDelta * 100).toFixed(1)}%`);
    }
  }

  if (invoice.milestone && invoice.milestone !== "storno" && invoice.milestone === slot.kind) {
    score += 12;
    signals.push(`milestone:${slot.kind}`);
  }

  const descriptionSimilarity = jaccard(tokens(line.service || invoice.serviceText), tokens(`${slot.activity.description} ${slot.activity.partNumber}`));
  if (descriptionSimilarity >= 0.1) {
    const points = Math.round(descriptionSimilarity * 24);
    score += points;
    signals.push(`description:${descriptionSimilarity.toFixed(2)}`);
  }

  if ((line.service || invoice.serviceText).toUpperCase().includes(slot.activity.partNumber.toUpperCase())) {
    score += 50;
    signals.push("part-number-in-text");
  }

  if (
    profile.dominantPartNumberShare >= 0.8
    && slot.activity.partNumber === profile.dominantPartNumber
    && profile.activityCount >= 5
  ) {
    const points = profile.dominantPartNumberShare >= 0.9 ? 20 : 12;
    score += points;
    signals.push(`company-profile:${Math.round(profile.dominantPartNumberShare * 100)}%`);
  }

  return { unit, slot, score, signals, dateGap, contractMatch, amountDelta };
}

type UnitMatch = { edge: MatchEdge; alternatives: MatchEdge[] };

function matchCompany(
  invoices: Invoice[],
  activities: Activity[],
  profile: CompanyProfile,
): { unitMatches: Map<string, UnitMatch>; slotMatches: Map<string, MatchUnit> } {
  const slots = activities.flatMap(activitySlots);
  const units: MatchUnit[] = invoices
    .filter((invoice) => invoice.milestone !== "storno")
    .flatMap((invoice) => invoice.lines.map((line) => ({ id: `${invoice.sourceKey}#${line.index}`, invoice, line })));
  const alternatives = new Map<string, MatchEdge[]>();
  const edges: MatchEdge[] = [];

  for (const unit of units) {
    const candidates = slots
      .map((slot) => scoreEdge(unit, slot, profile))
      .filter((edge) => {
        if (edge.contractMatch) return true;
        if (edge.dateGap == null || edge.dateGap > (profile.companyType === "RECURRENT" ? 120 : 365)) return false;
        return edge.score > 0;
      })
      .sort((a, b) => b.score - a.score || (a.dateGap ?? 9999) - (b.dateGap ?? 9999));
    alternatives.set(unit.id, candidates);
    edges.push(...candidates);
  }

  // Global greedy assignment: exact-date / contract edges naturally rank first.
  // One billing slot can be consumed by one invoice line only.
  edges.sort((a, b) =>
    Number(b.contractMatch) - Number(a.contractMatch)
    || b.score - a.score
    || (a.dateGap ?? 9999) - (b.dateGap ?? 9999));

  const usedUnits = new Set<string>();
  const usedSlots = new Set<string>();
  const unitMatches = new Map<string, UnitMatch>();
  const slotMatches = new Map<string, MatchUnit>();
  const minimum = profile.companyType === "RECURRENT" ? 20 : 18;
  for (const edge of edges) {
    if (edge.score < minimum || usedUnits.has(edge.unit.id) || usedSlots.has(edge.slot.id)) continue;
    usedUnits.add(edge.unit.id);
    usedSlots.add(edge.slot.id);
    unitMatches.set(edge.unit.id, { edge, alternatives: alternatives.get(edge.unit.id)?.slice(0, 5) ?? [] });
    slotMatches.set(edge.slot.id, edge.unit);
  }
  return { unitMatches, slotMatches };
}

type Confidence = "HIGH" | "MEDIUM" | "LOW" | "NONE";
type MatchMode =
  | "CONTRACT"
  | "RECURRENT_DATE"
  | "HISTORICAL_PATTERN"
  | "PROFILE"
  | "SCORED"
  | "MULTI_LINE"
  | "STORNO_REFERENCE"
  | "SOURCE_REUSE_ANOMALY"
  | "NONE";

type Proposal = {
  invoice: Invoice;
  profile: CompanyProfile | null;
  orgResolution: OrgResolution;
  mode: MatchMode;
  confidence: Confidence;
  partNumber: string;
  contractRef: string;
  trackerRow: number | null;
  expectedDate: Date | null;
  dateGap: number | null;
  score: number;
  reason: string;
  candidates: string[];
  lineMatches: Array<{ line: number; service: string; partNumber: string; confidence: Confidence; trackerRow: number | null }>;
};

function confidenceFor(edge: MatchEdge, profile: CompanyProfile, org: OrgResolution, distinctNearTop: number): Confidence {
  if (org.match === "fuzzy") return edge.contractMatch && edge.score >= 80 ? "MEDIUM" : "LOW";
  if (edge.contractMatch && distinctNearTop === 1) return "HIGH";
  if (profile.companyType === "SMALL") return edge.score >= 55 ? "MEDIUM" : "LOW";
  if (
    profile.companyType === "RECURRENT"
    && edge.dateGap != null
    && edge.dateGap <= 10
    && (profile.dominantPartNumberShare >= 0.7 || edge.score >= 55)
  ) return "HIGH";
  if (profile.dominantPartNumberShare >= 0.9 && edge.dateGap != null && edge.dateGap <= 35) return "HIGH";
  if (edge.score >= 70 && distinctNearTop === 1) return "HIGH";
  if (edge.score >= 40 || (edge.dateGap != null && edge.dateGap <= 35)) return "MEDIUM";
  return "LOW";
}

function aggregateProposal(
  invoice: Invoice,
  profile: CompanyProfile,
  orgResolution: OrgResolution,
  unitMatches: Map<string, UnitMatch>,
): Proposal {
  const lineMatches = invoice.lines.map((line) => {
    const match = unitMatches.get(`${invoice.sourceKey}#${line.index}`);
    if (!match) return { line: line.index, service: line.service, partNumber: "", confidence: "NONE" as Confidence, trackerRow: null };
    const nearTop = match.alternatives.filter((edge) => edge.score >= match.edge.score - 10);
    const distinctNearTop = new Set(nearTop.map((edge) => edge.slot.activity.partNumber)).size;
    return {
      line: line.index,
      service: line.service,
      partNumber: match.edge.slot.activity.partNumber,
      confidence: confidenceFor(match.edge, profile, orgResolution, distinctNearTop),
      trackerRow: match.edge.slot.activity.rowNumber,
    };
  });
  const matched = invoice.lines
    .map((line) => unitMatches.get(`${invoice.sourceKey}#${line.index}`))
    .filter((value): value is UnitMatch => !!value);
  if (!matched.length) {
    return {
      invoice, profile, orgResolution, mode: "NONE", confidence: "NONE", partNumber: "", contractRef: "",
      trackerRow: null, expectedDate: null, dateGap: null, score: 0,
      reason: "No accounting-to-tracker activity match met the conservative threshold.",
      candidates: [], lineMatches,
    };
  }

  const partNumbers = new Set(matched.map((match) => match.edge.slot.activity.partNumber).filter(Boolean));
  const best = [...matched].sort((a, b) => b.edge.score - a.edge.score)[0];
  const candidatePns = [...new Set(matched.flatMap((match) => match.alternatives.map((edge) => edge.slot.activity.partNumber)))];
  if (partNumbers.size > 1) {
    return {
      invoice, profile, orgResolution, mode: "MULTI_LINE", confidence: "LOW", partNumber: "", contractRef: "",
      trackerRow: null, expectedDate: null, dateGap: null, score: best.edge.score,
      reason: `Invoice lines map to multiple part numbers: ${[...partNumbers].join(" | ")}. Invoice schema stores only one; manual decision required.`,
      candidates: candidatePns, lineMatches,
    };
  }

  const nearTop = best.alternatives.filter((edge) => edge.score >= best.edge.score - 10);
  const distinctNearTop = new Set(nearTop.map((edge) => edge.slot.activity.partNumber)).size;
  const confidence = matched
    .map((match) => confidenceFor(match.edge, profile, orgResolution, distinctNearTop))
    .sort((a, b) => ["HIGH", "MEDIUM", "LOW", "NONE"].indexOf(b) - ["HIGH", "MEDIUM", "LOW", "NONE"].indexOf(a))[0];
  const mode: MatchMode = best.edge.contractMatch
    ? "CONTRACT"
    : profile.companyType === "RECURRENT" && (best.edge.dateGap ?? 999) <= 35
      ? "RECURRENT_DATE"
      : profile.dominantPartNumberShare >= 0.8 && best.edge.slot.activity.partNumber === profile.dominantPartNumber
        ? "PROFILE"
        : "SCORED";

  return {
    invoice,
    profile,
    orgResolution,
    mode,
    confidence,
    partNumber: [...partNumbers][0] ?? "",
    contractRef: best.edge.slot.activity.contractRef,
    trackerRow: best.edge.slot.activity.rowNumber,
    expectedDate: best.edge.slot.expectedDate,
    dateGap: best.edge.dateGap,
    score: best.edge.score,
    reason: `${mode}; ${best.edge.signals.join(", ")}; company=${profile.companyType}; dominant=${profile.dominantPartNumber || "-"} (${Math.round(profile.dominantPartNumberShare * 100)}%)`,
    candidates: candidatePns,
    lineMatches,
  };
}

/**
 * Conservative continuation for recurring invoices after tracker rows stop.
 * This does not use price: contracts may increase/decrease. It requires at
 * least five already-matched invoices from the same company with highly
 * similar service text and >=95% agreement on one part number.
 */
function applyHistoricalPatternFallback(
  proposals: Proposal[],
  profile: CompanyProfile,
  orgResolution: OrgResolution,
): Proposal[] {
  if (orgResolution.match === "fuzzy") return proposals;
  const trusted = proposals.filter((proposal) =>
    proposal.partNumber
    && proposal.confidence === "HIGH"
    && proposal.invoice.milestone !== "storno"
    && proposal.invoice.serviceTokens.size > 0);
  return proposals.map((proposal) => {
    if (proposal.mode !== "NONE" || proposal.invoice.serviceTokens.size === 0) return proposal;
    const broadlySimilar = trusted
      .map((candidate) => ({
        candidate,
        similarity: jaccard(proposal.invoice.serviceTokens, candidate.invoice.serviceTokens),
        dateGap: Math.abs(dayDiff(proposal.invoice.issueDate, candidate.invoice.issueDate) ?? 9999),
      }))
      .filter((entry) => entry.similarity >= 0.55 && entry.dateGap <= 800);
    const similar = broadlySimilar.filter((entry) => entry.similarity >= 0.75);
    const evidence = similar.length >= 5 ? similar : broadlySimilar.length >= 10 ? broadlySimilar : [];
    if (!evidence.length) return proposal;
    const counts = new Map<string, number>();
    for (const entry of evidence) {
      counts.set(entry.candidate.partNumber, (counts.get(entry.candidate.partNumber) ?? 0) + 1);
    }
    const [partNumber, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const share = count / evidence.length;
    if (share < 0.95) return proposal;
    const nearest = evidence
      .filter((entry) => entry.candidate.partNumber === partNumber)
      .sort((a, b) => a.dateGap - b.dateGap)[0];
    // Old recurring history is useful, but not auto-importable forever: a
    // renewed contract can keep the same service wording and change part no.
    const confidence: Confidence = count >= 8 && share >= 0.98 && nearest.dateGap <= 90 ? "HIGH" : "MEDIUM";
    return {
      ...proposal,
      mode: "HISTORICAL_PATTERN",
      confidence,
      partNumber,
      contractRef: nearest.candidate.contractRef,
      trackerRow: nearest.candidate.trackerRow,
      expectedDate: null,
      dateGap: nearest.dateGap,
      score: Math.round(100 * share),
      candidates: [partNumber],
      reason: `Historical recurring pattern: ${count}/${evidence.length} similar issued invoices map to ${partNumber} (${Math.round(share * 100)}%); nearest=${nearest.dateGap}d; amount intentionally ignored.`,
    };
  });
}

function mapStorno(invoice: Invoice, companyProposals: Proposal[], profile: CompanyProfile, org: OrgResolution): Proposal {
  const prior = companyProposals
    .filter((proposal) => proposal.invoice.milestone !== "storno" && proposal.partNumber && proposal.invoice.issueDate && invoice.issueDate)
    .map((proposal) => {
      const gap = Math.abs(dayDiff(invoice.issueDate, proposal.invoice.issueDate) ?? 9999);
      const amountClose = invoice.amountContract && proposal.invoice.amountContract
        ? Math.abs(invoice.amountContract / proposal.invoice.amountContract - 1) <= 0.02
        : false;
      const contractMatch = [...invoice.contractIds].some((id) => proposal.invoice.contractIds.has(id));
      return { proposal, gap, amountClose, contractMatch, rank: (contractMatch ? 100 : 0) + (amountClose ? 50 : 0) - gap };
    })
    .filter((candidate) => candidate.gap <= 180 && (candidate.contractMatch || candidate.amountClose))
    .sort((a, b) => b.rank - a.rank)[0];
  if (!prior) {
    return {
      invoice, profile, orgResolution: org, mode: "NONE", confidence: "NONE", partNumber: "", contractRef: "",
      trackerRow: null, expectedDate: null, dateGap: null, score: 0,
      reason: "Storno: no sufficiently similar original invoice found.", candidates: [], lineMatches: [],
    };
  }
  return {
    invoice,
    profile,
    orgResolution: org,
    mode: "STORNO_REFERENCE",
    confidence: prior.contractMatch && prior.amountClose ? "HIGH" : "MEDIUM",
    partNumber: prior.proposal.partNumber,
    contractRef: prior.proposal.contractRef,
    trackerRow: prior.proposal.trackerRow,
    expectedDate: prior.proposal.expectedDate,
    dateGap: prior.gap,
    score: prior.rank,
    reason: `Storno mapped to ${prior.proposal.invoice.number}; contract=${prior.contractMatch}; amount=${prior.amountClose}; gap=${prior.gap}d`,
    candidates: [prior.proposal.partNumber],
    lineMatches: [],
  };
}

// ---------------------------------------------------------------------------
// CSV rendering
// ---------------------------------------------------------------------------
function sortByCompanyDate<T extends { invoice: Invoice }>(values: T[]): T[] {
  return [...values].sort((a, b) =>
    a.invoice.orgNorm.localeCompare(b.invoice.orgNorm)
    || (a.invoice.issueDate?.getTime() ?? 0) - (b.invoice.issueDate?.getTime() ?? 0)
    || a.invoice.number.localeCompare(b.invoice.number));
}

function renderProposalCsv(proposals: Proposal[], review: boolean, catalogTemplates: string[]): string {
  const referenceHeaders = [
    "companyType", "companyInvoiceCount", "companyActivityCount", "companyDominantPartNumber",
    "companyDominantShare", "companyCadenceShare", "companyAmountTrend", "recommendedAction", "confidence", "matchMode",
    "source", "sourceId", "invoiceNumber", "organization", "issueDate", "currency", "amountContract", "amountLocal",
    "milestone", "proposedPartNumber", "partNumberTemplate", "partNumberValues", "catalogStatus",
    "partNumberCandidates", "trackerRow", "trackerExpectedDate",
    "dateGapDays", "proposedContractRef", "invoiceServiceText", "lineMatches", "reason",
  ];
  const headers = review
    ? ["invoiceKey", "import", "partNumberFinal", "notes", ...referenceHeaders]
    : ["invoiceKey", ...referenceHeaders];
  const lines = [headers.join(",")];

  for (const proposal of sortByCompanyDate(proposals)) {
    const { invoice, profile } = proposal;
    const concretePartNumber = normalizeConcretePartNumber(proposal.partNumber);
    const catalog = resolveCatalogCode(concretePartNumber, catalogTemplates);
    const safeCandidate = proposal.confidence === "HIGH"
      && proposal.partNumber
      && catalog.status === "UNIQUE"
      && proposal.mode !== "MULTI_LINE"
      && proposal.mode !== "STORNO_REFERENCE"
      && proposal.mode !== "HISTORICAL_PATTERN"
      && proposal.orgResolution.match !== "fuzzy"
      && (
        (proposal.mode === "CONTRACT" && proposal.dateGap != null && proposal.dateGap <= 14)
        || (proposal.mode === "RECURRENT_DATE" && proposal.dateGap != null && proposal.dateGap <= 7)
      );
    const recommendedAction = safeCandidate
      ? "ACCEPT_CANDIDATE"
      : proposal.partNumber
        ? "REVIEW"
        : "SKIP_NO_MATCH";
    const reference = [
      profile?.companyType ?? "UNMATCHED",
      profile?.invoiceCount ?? "",
      profile?.activityCount ?? "",
      profile?.dominantPartNumber ?? "",
      profile ? profile.dominantPartNumberShare.toFixed(3) : "",
      profile ? profile.cadenceShare.toFixed(3) : "",
      profile?.amountTrend ?? "",
      recommendedAction,
      proposal.confidence,
      proposal.mode,
      invoice.source,
      invoice.sourceId,
      invoice.number,
      invoice.organization,
      iso(invoice.issueDate),
      invoice.currency,
      invoice.amountContract?.toFixed(2) ?? "",
      invoice.amountLocal?.toFixed(2) ?? "",
      invoice.milestone,
      concretePartNumber,
      catalog.template,
      Object.keys(catalog.values).length ? JSON.stringify(catalog.values) : "",
      catalog.status,
      proposal.candidates.join(" | "),
      proposal.trackerRow ?? "",
      iso(proposal.expectedDate),
      proposal.dateGap ?? "",
      proposal.contractRef.replace(/\s+/g, " "),
      invoice.serviceText.replace(/\s+/g, " ").slice(0, 240),
      proposal.lineMatches.length > 1 ? JSON.stringify(proposal.lineMatches) : "",
      proposal.reason,
    ];
    const row = review
      // Never pre-authorize a DB write. The reviewer explicitly changes this
      // to yes after checking the candidate/company sequence.
      ? [invoice.dbKey, "no", concretePartNumber, "", ...reference]
      : [invoice.dbKey, ...reference];
    lines.push(row.map(csv).join(","));
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const leiInvoices = loadInvoices(LEI_FILE, "ron");
  const valutaInvoices = loadInvoices(VALUTA_FILE, "valuta");
  const currentSourceInvoices = [...leiInvoices, ...valutaInvoices];
  const productionInvoices = loadProductionInvoices(PRODUCTION_FILE);
  const catalogTemplates = loadPartNumberCatalog(PART_NUMBER_FILE);

  const sourceNumberGroups = new Map<string, Invoice[]>();
  for (const invoice of currentSourceInvoices) {
    const key = `${invoice.source}:${invoice.number}`;
    const list = sourceNumberGroups.get(key) ?? [];
    list.push(invoice);
    sourceNumberGroups.set(key, list);
  }
  const reusedSourceNumbers = new Set(
    [...sourceNumberGroups.entries()].filter(([, invoices]) => invoices.length > 1).map(([key]) => key),
  );

  // Link each current source row to the actual production row by number +
  // company + date. Rows not represented in production are real accounting
  // invoices hidden by the externalRecordId collision and remain evidence for
  // "already invoiced" schedule reconciliation.
  const sourceByNumber = new Map<string, Invoice[]>();
  for (const invoice of currentSourceInvoices) {
    const list = sourceByNumber.get(invoice.number) ?? [];
    list.push(invoice);
    sourceByNumber.set(invoice.number, list);
  }
  const representedSourceKeys = new Set<string>();
  for (const production of productionInvoices) {
    const candidates = sourceByNumber.get(production.number) ?? [];
    const exact = candidates.find((candidate) =>
      candidate.orgNorm === production.orgNorm
      && iso(candidate.issueDate) === iso(production.issueDate));
    if (exact) representedSourceKeys.add(exact.sourceKey);
  }
  const missingCurrentInvoices = currentSourceInvoices.filter(
    (invoice) => !representedSourceKeys.has(invoice.sourceKey),
  );
  // Production is the target. Missing current source rows are added only as
  // accounting evidence so stale Facturat flags cannot create false forecasts.
  const allSourceInvoices = [...productionInvoices, ...missingCurrentInvoices];

  const activities = loadActivities(TRACKER_FILE);
  const activitiesByOrg = new Map<string, Activity[]>();
  for (const activity of activities) {
    const list = activitiesByOrg.get(activity.societyNorm) ?? [];
    list.push(activity);
    activitiesByOrg.set(activity.societyNorm, list);
  }
  const trackerOrgs = new Set(activitiesByOrg.keys());
  const aliases = loadAliases();

  const resolutionBySource = new Map<string, OrgResolution>();
  for (const invoice of allSourceInvoices) {
    resolutionBySource.set(invoice.sourceKey, resolveOrganization(invoice.orgNorm, trackerOrgs, aliases));
  }

  // Group the complete accounting history. Matching all 1,669 source invoices
  // prevents overwritten RON invoices from being mislabeled "not invoiced".
  const sourceByTrackerOrg = new Map<string, Invoice[]>();
  for (const invoice of allSourceInvoices) {
    const trackerOrg = resolutionBySource.get(invoice.sourceKey)?.trackerOrg;
    if (!trackerOrg) continue;
    const list = sourceByTrackerOrg.get(trackerOrg) ?? [];
    list.push(invoice);
    sourceByTrackerOrg.set(trackerOrg, list);
  }

  const profiles = new Map<string, CompanyProfile>();
  const sourceProposals = new Map<string, Proposal>();
  const matchedSlots = new Map<string, MatchUnit>();

  for (const [trackerOrg, invoices] of sourceByTrackerOrg) {
    const orgActivities = activitiesByOrg.get(trackerOrg) ?? [];
    const slots = orgActivities.flatMap(activitySlots);
    const profile = buildProfile(trackerOrg, invoices, orgActivities, slots);
    profiles.set(trackerOrg, profile);
    const { unitMatches, slotMatches } = matchCompany(invoices, orgActivities, profile);
    for (const [slotId, unit] of slotMatches) matchedSlots.set(slotId, unit);

    const initialNonStorno: Proposal[] = [];
    for (const invoice of invoices.filter((value) => value.milestone !== "storno")) {
      const proposal = aggregateProposal(invoice, profile, resolutionBySource.get(invoice.sourceKey)!, unitMatches);
      initialNonStorno.push(proposal);
    }
    const orgResolution = resolutionBySource.get(invoices[0].sourceKey)!;
    const nonStorno = applyHistoricalPatternFallback(initialNonStorno, profile, orgResolution);
    for (const proposal of nonStorno) {
      sourceProposals.set(proposal.invoice.sourceKey, proposal);
    }
    for (const invoice of invoices.filter((value) => value.milestone === "storno")) {
      sourceProposals.set(
        invoice.sourceKey,
        mapStorno(invoice, nonStorno, profile, resolutionBySource.get(invoice.sourceKey)!),
      );
    }
  }

  for (const invoice of allSourceInvoices) {
    if (sourceProposals.has(invoice.sourceKey)) continue;
    const resolution = resolutionBySource.get(invoice.sourceKey)!;
    sourceProposals.set(invoice.sourceKey, {
      invoice,
      profile: null,
      orgResolution: resolution,
      mode: "NONE",
      confidence: "NONE",
      partNumber: "",
      contractRef: "",
      trackerRow: null,
      expectedDate: null,
      dateGap: null,
      score: 0,
      reason: resolution.match === "none" ? "Organization not found in tracker." : "No match.",
      candidates: [],
      lineMatches: [],
    });
  }

  // Production review contains exactly the current DB snapshot rows.
  const productionProposals = productionInvoices.map((invoice) => {
    const proposal = sourceProposals.get(invoice.sourceKey)!;
    if (!reusedSourceNumbers.has(`${invoice.source}:${invoice.number}`)) return proposal;
    return {
      ...proposal,
      mode: "SOURCE_REUSE_ANOMALY" as MatchMode,
      confidence: "NONE" as Confidence,
      partNumber: "",
      contractRef: "",
      trackerRow: null,
      expectedDate: null,
      score: 0,
      reason: "Quarantined: nr_iesire is reused by multiple organization/date/id_iesire headers inside the same source workbook; production lines may be contaminated.",
    };
  });
  fs.writeFileSync(REVIEW_OUT, renderProposalCsv(productionProposals, true, catalogTemplates), "utf8");
  fs.writeFileSync(DETAIL_OUT, renderProposalCsv(productionProposals, false, catalogTemplates), "utf8");

  // Current accounting-export rows absent from production need DB repair before
  // they can be enriched. Keep them separate from the review import.
  const missingRows = [
    ["sourceKey", "collidingDbKey", "invoiceNumber", "organization", "issueDate", "amountContract", "amountLocal", "proposedPartNumber", "confidence", "reason"].join(","),
    ...sortByCompanyDate(missingCurrentInvoices.map((invoice) => sourceProposals.get(invoice.sourceKey)!)).map((proposal) => [
      proposal.invoice.sourceKey,
      proposal.invoice.dbKey,
      proposal.invoice.number,
      proposal.invoice.organization,
      iso(proposal.invoice.issueDate),
      proposal.invoice.amountContract?.toFixed(2) ?? "",
      proposal.invoice.amountLocal?.toFixed(2) ?? "",
      proposal.partNumber,
      proposal.confidence,
      "Present in newest accounting export but absent from production (usually externalRecordId collision).",
    ].map(csv).join(",")),
  ];
  fs.writeFileSync(MISSING_RON_OUT, missingRows.join("\n"), "utf8");

  const reuseRows = [
    ["source", "invoiceNumber", "sourceId", "organization", "issueDate", "currency", "serviceText"].join(","),
    ...[...sourceNumberGroups.entries()]
      .filter(([key, invoices]) => reusedSourceNumbers.has(key) && invoices.length > 1)
      .flatMap(([, invoices]) => invoices)
      .sort((a, b) => a.source.localeCompare(b.source) || a.number.localeCompare(b.number) || (a.issueDate?.getTime() ?? 0) - (b.issueDate?.getTime() ?? 0))
      .map((invoice) => [
        invoice.source,
        invoice.number,
        invoice.sourceId,
        invoice.organization,
        iso(invoice.issueDate),
        invoice.currency,
        invoice.serviceText.replace(/\s+/g, " "),
      ].map(csv).join(",")),
  ];
  fs.writeFileSync(NUMBER_REUSE_OUT, reuseRows.join("\n"), "utf8");

  // Company summary, sorted by company.
  const companyRows = [
    ["organization", "companyType", "invoiceCountAllAccounting", "trackerActivityCount", "dominantPartNumber", "dominantShare", "monthlyCadenceShare", "modalServiceShare", "amountTrend", "learnedRatioPoints"].join(","),
    ...[...profiles.values()].sort((a, b) => a.org.localeCompare(b.org)).map((profile) => [
      profile.org,
      profile.companyType,
      profile.invoiceCount,
      profile.activityCount,
      profile.dominantPartNumber,
      profile.dominantPartNumberShare.toFixed(3),
      profile.cadenceShare.toFixed(3),
      profile.modalServiceShare.toFixed(3),
      profile.amountTrend,
      profile.ratioPoints.length,
    ].map(csv).join(",")),
  ];
  fs.writeFileSync(COMPANY_OUT, companyRows.join("\n"), "utf8");

  // Reconcile every tracker billing slot to actual accounting evidence. Tracker
  // Facturat flags are shown only as possible stale-data warnings.
  const scheduleRows: string[][] = [];
  for (const activity of activities) {
    for (const slot of activitySlots(activity)) {
      const matched = matchedSlots.get(slot.id);
      const status = matched
        ? "INVOICED_ACCOUNTING"
        : !slot.expectedDate
          ? "UNMATCHED_NO_DATE"
          : slot.expectedDate.getTime() > AS_OF.getTime()
            ? "UPCOMING"
            : "PAST_UNMATCHED";
      const flag = slot.trackerBilledFlag.toLowerCase();
      const discrepancy = matched && (flag === "nu" || flag === "n/a")
        ? "TRACKER_FLAG_STALE_NOT_BILLED"
        : !matched && flag === "da"
          ? "TRACKER_SAYS_BILLED_NOT_FOUND"
          : "";
      scheduleRows.push([
        activity.society,
        activity.partNumber,
        activity.rowNumber.toString(),
        slot.kind,
        iso(slot.expectedDate),
        slot.dateSource,
        slot.amount?.toFixed(2) ?? "",
        activity.contractRef.replace(/\s+/g, " "),
        status,
        slot.trackerBilledFlag,
        discrepancy,
        matched?.invoice.number ?? "",
        matched?.invoice.source ?? "",
        iso(matched?.invoice.issueDate ?? null),
        matched ? String(Math.abs(dayDiff(matched.invoice.issueDate, slot.expectedDate) ?? 0)) : "",
      ]);
    }
  }
  scheduleRows.sort((a, b) => normalizeCompany(a[0]).localeCompare(normalizeCompany(b[0])) || a[4].localeCompare(b[4]));
  const scheduleHeader = [
    "organization", "partNumber", "trackerRow", "milestone", "expectedDate", "dateSource",
    "trackerAmount", "contractRef", "accountingStatus", "trackerFacturatFlag", "flagDiscrepancy",
    "matchedInvoiceNumber", "matchedInvoiceSource", "matchedInvoiceDate", "dateGapDays",
  ];
  fs.writeFileSync(SCHEDULE_OUT, [scheduleHeader, ...scheduleRows].map((row) => row.map(csv).join(",")).join("\n"), "utf8");
  const forecast = scheduleRows.filter((row) => row[8] !== "INVOICED_ACCOUNTING");
  fs.writeFileSync(FORECAST_OUT, [scheduleHeader, ...forecast].map((row) => row.map(csv).join(",")).join("\n"), "utf8");

  fs.writeFileSync(METADATA_OUT, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    asOf: AS_OF_RAW,
    inputs: {
      lei: { file: LEI_FILE, sha256: sha256(LEI_FILE), invoices: leiInvoices.length },
      valuta: { file: VALUTA_FILE, sha256: sha256(VALUTA_FILE), invoices: valutaInvoices.length },
      production: { file: PRODUCTION_FILE, sha256: sha256(PRODUCTION_FILE), invoices: productionInvoices.length },
      tracker: { file: TRACKER_FILE, sha256: sha256(TRACKER_FILE), activities: activities.length },
      partNumbers: { file: PART_NUMBER_FILE, sha256: sha256(PART_NUMBER_FILE), templates: catalogTemplates.length },
    },
    reconciliation: {
      knownAccountingInvoices: allSourceInvoices.length,
      currentRowsMissingInProduction: missingCurrentInvoices.length,
      withinFileReusedNumbers: reusedSourceNumbers.size,
      trackerSlots: scheduleRows.length,
    },
  }, null, 2)}\n`, "utf8");

  const confidenceCounts = new Map<string, number>();
  const modeCounts = new Map<string, number>();
  const typeCounts = new Map<string, number>();
  for (const proposal of productionProposals) {
    confidenceCounts.set(proposal.confidence, (confidenceCounts.get(proposal.confidence) ?? 0) + 1);
    modeCounts.set(proposal.mode, (modeCounts.get(proposal.mode) ?? 0) + 1);
    const type = proposal.profile?.companyType ?? "UNMATCHED";
    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
  }
  const recommended = productionProposals.filter((proposal) =>
    proposal.confidence === "HIGH"
    && proposal.partNumber
    && resolveCatalogCode(proposal.partNumber, catalogTemplates).status === "UNIQUE"
    && proposal.orgResolution.match !== "fuzzy"
    && (
      (proposal.mode === "CONTRACT" && proposal.dateGap != null && proposal.dateGap <= 14)
      || (proposal.mode === "RECURRENT_DATE" && proposal.dateGap != null && proposal.dateGap <= 7)
    )).length;

  console.log(`Newest accounting exports:  ${currentSourceInvoices.length} source invoices (RON ${leiInvoices.length} + valuta ${valutaInvoices.length})`);
  console.log(`Production snapshot rows:    ${productionInvoices.length}`);
  console.log(`Known accounting evidence:   ${allSourceInvoices.length} (production + missing current rows)`);
  console.log(`Current rows missing in DB:  ${missingCurrentInvoices.length}`);
  console.log(`Within-file reused numbers:  ${reusedSourceNumbers.size} (quarantined)`);
  console.log(`Tracker activities / slots: ${activities.length} / ${activities.flatMap(activitySlots).length}`);
  console.log(`As-of date:                 ${AS_OF_RAW}`);
  console.log("\nProduction confidence:");
  for (const key of ["HIGH", "MEDIUM", "LOW", "NONE"]) {
    const count = confidenceCounts.get(key) ?? 0;
    console.log(`  ${key.padEnd(8)} ${String(count).padStart(4)}  ${((100 * count) / productionInvoices.length).toFixed(1)}%`);
  }
  console.log(`  ${"RECOMMEND".padEnd(8)} ${String(recommended).padStart(4)}  ${((100 * recommended) / productionInvoices.length).toFixed(1)}%`);
  console.log("  Import column defaults to no for every row.");
  console.log("\nProduction match modes:");
  for (const [key, count] of [...modeCounts].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key.padEnd(18)} ${count}`);
  }
  console.log("\nProduction invoices by company type:");
  for (const [key, count] of [...typeCounts].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key.padEnd(10)} ${count}`);
  }
  console.log(`\nSchedule: matched ${scheduleRows.filter((row) => row[8] === "INVOICED_ACCOUNTING").length}, upcoming ${scheduleRows.filter((row) => row[8] === "UPCOMING").length}, past-unmatched ${scheduleRows.filter((row) => row[8] === "PAST_UNMATCHED").length}`);
  console.log(`\nWrote ${REVIEW_OUT}`);
  console.log(`Wrote ${DETAIL_OUT}`);
  console.log(`Wrote ${COMPANY_OUT}`);
  console.log(`Wrote ${SCHEDULE_OUT}`);
  console.log(`Wrote ${FORECAST_OUT}`);
  console.log(`Wrote ${MISSING_RON_OUT}`);
  console.log(`Wrote ${NUMBER_REUSE_OUT}`);
  console.log(`Wrote ${METADATA_OUT}`);
}

main();
