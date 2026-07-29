/**
 * Import invoices from facturi.csv into the Invoice table.
 *
 * For each row:
 *   - resolve Organization by sourceName (= "Nume companie (from Client)")
 *   - resolve Deal by salesId (= "Referinta proiect", SAL-xxxx)  [nullable]
 *   - upsert Invoice keyed by "Record ID" (idempotent re-import)
 *
 * Rows that carry multiple invoice numbers/totals (e.g. storno + reissue, split
 * across newlines) are expanded into multiple Invoice rows with keys
 * "<recordId>#<i>". Numbers are parsed across EU/US/space-grouped formats.
 *
 * Usage:
 *   tsx scripts/import-invoices.ts            # dry-run (default)
 *   tsx scripts/import-invoices.ts --commit   # write rows
 *   flags: --file <facturi.csv>
 */
import "dotenv/config";
import fs from "fs";
import { parse } from "csv-parse/sync";
import { PrismaClient, InvoiceStatus } from "../src/generated/prisma";

const prisma = new PrismaClient();

// ----------------------------- args -----------------------------
const args = process.argv.slice(2);
const getArg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const COMMIT = args.includes("--commit");
const FILE = getArg("file") || "./facturi.csv";

// --------------------------- helpers -----------------------------
function clean(s: unknown): string {
  return (s == null ? "" : String(s)).replace(/^\uFEFF/, "").trim().replace(/^"+|"+$/g, "").trim();
}

function splitLines(s: string): string[] {
  return clean(s).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
}

function mapStatus(raw: string): InvoiceStatus {
  const s = raw.toLowerCase();
  if (s.includes("contabilitate")) return InvoiceStatus.TRIMISA_LA_CONTABILITATE;
  if (s.includes("asteptare") || s.includes("așteptare")) return InvoiceStatus.IN_ASTEPTARE;
  if (s.includes("generat")) return InvoiceStatus.GENERATA;
  return InvoiceStatus.OTHER;
}

/** Parse messy money strings: "18,920.00", "29.576,00", "59 214.40", "EUR 16 920.00", "-9 240.04". */
function parseMoney(raw: string): number | null {
  if (!raw) return null;
  let s = raw.replace(/[^0-9.,\-]/g, "").trim(); // drop currency letters/spaces
  if (!s || s === "-") return null;
  const hasDot = s.includes(".");
  const hasComma = s.includes(",");
  if (hasDot && hasComma) {
    // the rightmost separator is the decimal point
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", "."); // EU: 29.576,00
    } else {
      s = s.replace(/,/g, ""); // US: 18,920.00
    }
  } else if (hasComma) {
    // only comma: decimal if exactly 2 trailing digits, else thousands
    s = /,\d{2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
  } else if (hasDot) {
    // only dot: thousands if grouped like 1.234.567 ; else decimal
    if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Parse "dd.mm.yyyy" (first line only). */
function parseDate(raw: string): Date | null {
  const first = splitLines(raw)[0] || "";
  const m = first.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (!m) return null;
  let [, d, mo, y] = m;
  let year = Number(y);
  if (year < 100) year += 2000;
  const date = new Date(Date.UTC(year, Number(mo) - 1, Number(d)));
  return isNaN(date.getTime()) ? null : date;
}

function parseTermDays(raw: string): number | null {
  const m = clean(raw).match(/\d+/);
  return m ? Number(m[0]) : null;
}

/** Best-effort contract reference, e.g. "Nr. 234/15.11.2022". */
function extractContractRef(services: string): string | null {
  const m = services.match(/\bnr\.?\s*([0-9]{1,5}\s*\/\s*[0-9][0-9.\/]{3,12})/i);
  return m ? m[0].replace(/\s+/g, " ").trim() : null;
}

async function main() {
  const rows = parse(fs.readFileSync(FILE, "utf8"), { skip_empty_lines: true, relax_column_count: true }) as string[][];
  const header = rows[0];
  const data = rows.slice(1);

  // Column indices (by position, matching facturi.csv layout)
  const C = {
    ref: 0, status: 1, company: 3, issuer: 4, services: 5, amount: 6,
    currency: 7, term: 8, sal: 9, issueDate: 10, files: 11, total: 12,
    number: 13, createdBy: 14, recordId: 17,
  };

  // org lookup by sourceName
  const orgs = await prisma.organization.findMany({ select: { id: true, sourceName: true, clientId: true } });
  const orgByName = new Map(orgs.map((o) => [o.sourceName, o]));
  // deal lookup by salesId
  const deals = await prisma.deal.findMany({ select: { id: true, salesId: true } });
  const dealBySal = new Map(deals.map((d) => [d.salesId.toUpperCase(), d.id]));

  type Rec = {
    externalRecordId: string; externalRef: string; number: string | null;
    status: InvoiceStatus; organizationId: string; clientId: string | null;
    dealId: string | null; salesIdSnapshot: string | null;
    servicesDescription: string | null; contractRef: string | null;
    amountRaw: string | null; currency: string | null; paymentTermDays: number | null;
    issueDate: Date | null; totalAmount: number | null; totalRaw: string | null;
    fileUrls: string | null; issuerName: string | null; createdByName: string | null;
  };

  const records: Rec[] = [];
  const missingOrg: string[] = [];
  const missingDeal: string[] = [];
  const splitMismatch: string[] = [];

  for (const r of data) {
    const recordId = clean(r[C.recordId]);
    const company = clean(r[C.company]);
    if (!recordId || !company) continue;

    const org = orgByName.get(company);
    if (!org) {
      missingOrg.push(`${recordId} (${company})`);
      continue;
    }

    const sal = clean(r[C.sal]).toUpperCase();
    const hasSal = sal && sal !== "-";
    const dealId = hasSal ? dealBySal.get(sal) ?? null : null;
    if (hasSal && !dealId) missingDeal.push(`${recordId} ${sal}`);

    const status = mapStatus(clean(r[C.status]));
    const services = clean(r[C.services]) || null;
    const base = {
      externalRef: clean(r[C.ref]),
      status,
      organizationId: org.id,
      clientId: org.clientId,
      dealId,
      salesIdSnapshot: hasSal ? sal : null,
      servicesDescription: services,
      contractRef: services ? extractContractRef(services) : null,
      amountRaw: clean(r[C.amount]) || null,
      currency: clean(r[C.currency]) || null,
      paymentTermDays: parseTermDays(r[C.term]),
      issueDate: parseDate(clean(r[C.issueDate])),
      fileUrls: clean(r[C.files]) || null,
      issuerName: clean(r[C.issuer]) || null,
      createdByName: clean(r[C.createdBy]) || null,
    };

    // expand multi-invoice rows (numbers/totals split on newlines)
    const numbers = splitLines(r[C.number]);
    const totals = splitLines(r[C.total]);
    const n = Math.max(numbers.length, totals.length, 1);

    if (n > 1 && numbers.length !== totals.length) {
      splitMismatch.push(`${recordId} (numbers=${numbers.length}, totals=${totals.length})`);
    }

    if (n <= 1) {
      const singleTotal = totals[0] ?? (clean(r[C.total]) || null);
      records.push({
        ...base, externalRecordId: recordId,
        number: numbers[0] ?? null,
        totalRaw: singleTotal,
        totalAmount: parseMoney(singleTotal ?? ""),
      });
    } else if (numbers.length === totals.length) {
      for (let i = 0; i < n; i++) {
        records.push({
          ...base, externalRecordId: `${recordId}#${i}`,
          number: numbers[i] ?? null,
          totalRaw: totals[i] ?? null,
          totalAmount: parseMoney(totals[i] ?? ""),
        });
      }
    } else {
      // mismatch: keep a single record with raw values rather than guessing
      records.push({
        ...base, externalRecordId: recordId,
        number: clean(r[C.number]) || null,
        totalRaw: clean(r[C.total]) || null,
        totalAmount: parseMoney(clean(r[C.total])),
      });
    }
  }

  console.log(`Rows: ${data.length}  ->  Invoice records: ${records.length}`);
  console.log(`Linked to deal: ${records.filter((x) => x.dealId).length}  | no deal link: ${records.filter((x) => !x.dealId).length}`);
  console.log(`Parsed total amount: ${records.filter((x) => x.totalAmount != null).length}  | unparsed: ${records.filter((x) => x.totalAmount == null).length}`);
  if (missingOrg.length) console.log(`\nMissing organization (skipped): ${missingOrg.length}\n  ${missingOrg.join("\n  ")}`);
  if (missingDeal.length) console.log(`\nSAL not found in DB (deal left null): ${missingDeal.length}\n  ${missingDeal.join(", ")}`);
  if (splitMismatch.length) console.log(`\nNumber/total split mismatch (kept as single row): ${splitMismatch.length}\n  ${splitMismatch.join(", ")}`);

  if (!COMMIT) {
    console.log("\nDry run. Re-run with --commit to write Invoice rows.");
    await prisma.$disconnect();
    return;
  }

  let created = 0, updated = 0;
  const skippedDup: string[] = [];
  for (const rec of records) {
    const { externalRecordId, ...rest } = rec;
    const payload = {
      ...rest,
      totalAmount: rec.totalAmount == null ? null : rec.totalAmount.toFixed(2),
    };
    const existing = await prisma.invoice.findUnique({ where: { externalRecordId }, select: { id: true } });
    if (existing) {
      await prisma.invoice.update({ where: { externalRecordId }, data: payload });
      updated++;
      continue;
    }
    // Guard against double-importing an invoice that already exists from another
    // source (e.g. the SAGA XLS importer keys on `accounting:{number}` while this
    // importer keys on the Airtable Record ID). Match by invoice number so we
    // don't create a second row for the same physical invoice.
    if (rest.number) {
      const byNumber = await prisma.invoice.findFirst({
        where: { number: rest.number },
        select: { id: true, externalRecordId: true },
      });
      if (byNumber) {
        skippedDup.push(`${rest.number} (existing: ${byNumber.externalRecordId})`);
        continue;
      }
    }
    await prisma.invoice.create({ data: { externalRecordId, ...payload } });
    created++;
  }
  console.log(`\nCommitted. Created: ${created}  Updated: ${updated}  Skipped (duplicate number): ${skippedDup.length}`);
  if (skippedDup.length) console.log(`  ${skippedDup.join("\n  ")}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
