/**
 * Validate and import reviewed invoice enrichment into production.
 *
 * Dry-run (default):
 *   npx tsx scripts/import-reviewed-invoice-enrichment.ts --file <csv>
 *
 * Apply (requires a validated backup path):
 *   npx tsx scripts/import-reviewed-invoice-enrichment.ts --file <csv> \
 *     --apply --backup /root/crm-backups/<file>.sql.gz
 *
 * Add --skip-unresolved to leave approved rows whose concrete part number does
 * not resolve to exactly one production PartNumber template untouched.
 */
import { createHash } from "crypto";
import fs from "fs";
import { spawnSync } from "child_process";
import { parse } from "csv-parse/sync";

type ReviewRow = Record<string, string>;

const args = process.argv.slice(2);
const valueArg = (name: string, fallback = "") => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const hasArg = (name: string) => args.includes(`--${name}`);

const FILE = valueArg("file", "data-init/invoice-part-number-review - invoice-part-number-review.csv.csv");
const HOST = valueArg("host", "root@46.224.17.213");
const CONTAINER = valueArg("container", "crm-web-1");
const BACKUP = valueArg("backup");
const ANNUAL_PHISH_MONTHS = valueArg("annual-phish-months");
const APPLY = hasArg("apply");
const SKIP_UNRESOLVED = hasArg("skip-unresolved");
const REPORT = valueArg("report", "scripts/invoice-enrichment-import-report.json");

function fail(message: string): never {
  throw new Error(message);
}

function sha256(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function required(row: ReviewRow, key: string): string {
  const value = String(row[key] ?? "").trim();
  if (!value) fail(`Missing ${key} for ${row.invoiceKey || "unknown row"}.`);
  return value;
}

if (!fs.existsSync(FILE)) fail(`Review CSV not found: ${FILE}`);
const rows = parse(fs.readFileSync(FILE, "utf8"), {
  columns: true,
  bom: true,
  skip_empty_lines: true,
  relax_column_count: false,
  trim: false,
}) as ReviewRow[];

const expectedHeaders = [
  "invoiceKey", "import", "partNumberFinal", "finalClientFinal", "invoiceNumber",
  "organization", "issueDate", "sourceId", "proposedContractRef",
];
for (const header of expectedHeaders) {
  if (!rows.length || !(header in rows[0])) fail(`Review CSV is missing required column: ${header}`);
}

const invalidImport = rows.filter((row) => !["yes", "no"].includes(String(row.import ?? "").trim().toLowerCase()));
if (invalidImport.length) fail(`${invalidImport.length} rows have import values other than yes/no.`);
const duplicateKeys = [...new Set(rows.map((row) => required(row, "invoiceKey")))]
  .filter((key) => rows.filter((row) => row.invoiceKey.trim() === key).length > 1);
if (duplicateKeys.length) fail(`Duplicate invoiceKey values: ${duplicateKeys.slice(0, 10).join(", ")}`);

const approved = rows
  .filter((row) => row.import.trim().toLowerCase() === "yes")
  .map((row) => {
    let partNumberCode = required(row, "partNumberFinal").replace(/<(\d+(?:[.,]\d+)?)>/g, "$1");
    if (ANNUAL_PHISH_MONTHS && /^PHISH-P-L-YY-A-\d+$/i.test(partNumberCode)) {
      partNumberCode = `${partNumberCode}-${ANNUAL_PHISH_MONTHS}`;
    }
    return {
      invoiceKey: required(row, "invoiceKey"),
      invoiceNumber: required(row, "invoiceNumber"),
      organization: required(row, "organization"),
      issueDate: required(row, "issueDate"),
      sourceId: required(row, "sourceId"),
      partNumberCode,
      finalClientName: required(row, "finalClientFinal"),
      contractRef: String(row.proposedContractRef ?? "").trim(),
    };
  });

if (!approved.length) fail("No rows are marked import=yes.");

if (APPLY) {
  if (!BACKUP) fail("--apply requires --backup <validated remote dump path>.");
  const backupCheck = spawnSync(
    "ssh",
    ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", HOST, `test -s '${BACKUP.replace(/'/g, "'\\''")}'`],
    { encoding: "utf8" },
  );
  if (backupCheck.status !== 0) fail(`Validated backup not found on ${HOST}: ${BACKUP}`);
}

const payload = {
  apply: APPLY,
  skipUnresolved: SKIP_UNRESOLVED,
  reviewFile: FILE,
  reviewSha256: sha256(FILE),
  backupPath: BACKUP || null,
  annualPhishMonths: ANNUAL_PHISH_MONTHS || null,
  totalReviewRows: rows.length,
  approved,
};
const payloadBase64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");

const remoteScript = String.raw`
const { randomBytes } = require("crypto");
const { PrismaClient, Prisma } = require("/app/src/generated/prisma");
const prisma = new PrismaClient();
const payload = JSON.parse(Buffer.from("${payloadBase64}", "base64").toString("utf8"));

const norm = (value) => String(value || "").trim().toLocaleLowerCase("en-US").normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ");
const normalizeCode = (value) => String(value || "").trim().replace(/<(\d+(?:[.,]\d+)?)>/g, "$1");
const escapeRegex = (value) => value.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");

function resolveCode(code, templates) {
  code = normalizeCode(code);
  const matches = [];
  for (const partNumber of templates) {
    const template = String(partNumber.code || "").replace(/-limit\b/gi, "-<limit>");
    const placeholders = [...template.matchAll(/<([^>]+)>/g)];
    if (!placeholders.length) {
      if (template === code) matches.push({ id: partNumber.id, template, values: {} });
      continue;
    }
    let pattern = "^";
    let cursor = 0;
    for (const placeholder of placeholders) {
      pattern += escapeRegex(template.slice(cursor, placeholder.index));
      pattern += "([^-]+)";
      cursor = placeholder.index + placeholder[0].length;
    }
    pattern += escapeRegex(template.slice(cursor)) + "$";
    const concrete = code.match(new RegExp(pattern, "i"));
    if (!concrete) continue;
    const values = {};
    placeholders.forEach((placeholder, index) => {
      values[placeholder[1]] = concrete[index + 1];
    });
    matches.push({ id: partNumber.id, template, values });
  }
  return matches;
}

function sourceId(invoice) {
  const original = invoice.originalValues && typeof invoice.originalValues === "object" ? invoice.originalValues : {};
  return String(original.id_iesire || invoice.externalRecordId.match(/:(?:ron|valuta):([^:]+)$/)?.[1] || "");
}

async function main() {
  const keys = payload.approved.map((row) => row.invoiceKey);
  const [invoices, templates, existingFinalClients] = await Promise.all([
    prisma.invoice.findMany({
      where: { externalRecordId: { in: keys } },
      select: {
        id: true,
        externalRecordId: true,
        number: true,
        issueDate: true,
        originalValues: true,
        contractRef: true,
        partNumberId: true,
        partNumberCode: true,
        finalClientId: true,
        organization: { select: { sourceName: true } },
        finalClient: { select: { name: true } },
      },
    }),
    prisma.partNumber.findMany({ where: { active: true }, select: { id: true, code: true } }),
    prisma.finalClient.findMany({ select: { id: true, name: true } }),
  ]);

  const errors = [];
  const invoiceByKey = new Map(invoices.map((invoice) => [invoice.externalRecordId, invoice]));
  const finalClientByName = new Map();
  for (const finalClient of existingFinalClients) {
    const key = norm(finalClient.name);
    if (finalClientByName.has(key) && finalClientByName.get(key).id !== finalClient.id) {
      errors.push("Duplicate production Final Client name: " + finalClient.name);
    } else {
      finalClientByName.set(key, finalClient);
    }
  }

  const prepared = [];
  const skipped = [];
  const newFinalClients = new Map();
  for (const row of payload.approved) {
    const invoice = invoiceByKey.get(row.invoiceKey);
    if (!invoice) {
      errors.push("Invoice key not found: " + row.invoiceKey);
      continue;
    }
    const actualDate = invoice.issueDate ? invoice.issueDate.toISOString().slice(0, 10) : "";
    if (
      String(invoice.number || "") !== row.invoiceNumber
      || invoice.organization.sourceName !== row.organization
      || actualDate !== row.issueDate
      || sourceId(invoice) !== row.sourceId
    ) {
      errors.push("Production fingerprint mismatch: " + row.invoiceKey);
      continue;
    }

    const matches = resolveCode(row.partNumberCode, templates);
    if (matches.length !== 1) {
      const reason = matches.length
        ? "Part number matches multiple templates: " + row.partNumberCode
        : "Part number has no production template: " + row.partNumberCode;
      if (payload.skipUnresolved) {
        skipped.push({ invoiceKey: row.invoiceKey, reason });
        continue;
      }
      errors.push(reason + " (" + row.invoiceKey + ")");
      continue;
    }

    const finalKey = norm(row.finalClientName);
    let finalClient = finalClientByName.get(finalKey) || newFinalClients.get(finalKey);
    if (!finalClient) {
      finalClient = {
        id: "fcimp_" + randomBytes(12).toString("hex"),
        name: row.finalClientName,
      };
      newFinalClients.set(finalKey, finalClient);
    }

    if (invoice.partNumberCode && invoice.partNumberCode !== row.partNumberCode) {
      errors.push("Existing part number differs for " + row.invoiceKey);
      continue;
    }
    if (invoice.finalClient?.name && norm(invoice.finalClient.name) !== finalKey) {
      errors.push("Existing Final Client differs for " + row.invoiceKey);
      continue;
    }
    if (row.contractRef && invoice.contractRef && invoice.contractRef !== row.contractRef) {
      errors.push("Existing contract differs for " + row.invoiceKey);
      continue;
    }

    prepared.push({
      row,
      invoiceId: invoice.id,
      partNumber: matches[0],
      finalClient,
    });
  }

  const summary = {
    mode: payload.apply ? "apply" : "dry-run",
    reviewFile: payload.reviewFile,
    reviewSha256: payload.reviewSha256,
    backupPath: payload.backupPath,
    annualPhishMonths: payload.annualPhishMonths,
    totalReviewRows: payload.totalReviewRows,
    approvedRows: payload.approved.length,
    preparedRows: prepared.length,
    skippedRows: skipped.length,
    newFinalClients: newFinalClients.size,
    contractsToSet: prepared.filter((item) => item.row.contractRef).length,
    partNumbersToSet: prepared.length,
    finalClientsToSet: prepared.length,
    errors,
    skipped,
  };

  if (errors.length) {
    console.log(JSON.stringify(summary));
    process.exitCode = 2;
    return;
  }
  if (!payload.apply) {
    console.log(JSON.stringify(summary));
    return;
  }

  await prisma.$transaction(async (tx) => {
    if (newFinalClients.size) {
      await tx.finalClient.createMany({ data: [...newFinalClients.values()] });
    }
    for (let offset = 0; offset < prepared.length; offset += 50) {
      const chunk = prepared.slice(offset, offset + 50);
      await Promise.all(chunk.map((item) => tx.invoice.update({
        where: { id: item.invoiceId },
        data: {
          partNumberId: item.partNumber.id,
          partNumberCode: item.row.partNumberCode,
          partNumberValues: Object.keys(item.partNumber.values).length ? item.partNumber.values : Prisma.DbNull,
          finalClientId: item.finalClient.id,
          ...(item.row.contractRef ? { contractRef: item.row.contractRef } : {}),
        },
      })));
    }
    await tx.auditLog.create({
      data: {
        id: "auditimp_" + randomBytes(12).toString("hex"),
        action: "bulk_invoice_enrichment_import",
        entity: "Invoice",
        meta: {
          reviewSha256: payload.reviewSha256,
          backupPath: payload.backupPath,
          annualPhishMonths: payload.annualPhishMonths,
          importedRows: prepared.length,
          skippedRows: skipped.length,
          createdFinalClients: newFinalClients.size,
        },
      },
    });
  }, { maxWait: 30000, timeout: 300000 });

  const verified = await prisma.invoice.findMany({
    where: { id: { in: prepared.map((item) => item.invoiceId) } },
    select: {
      id: true,
      partNumberCode: true,
      contractRef: true,
      finalClient: { select: { name: true } },
    },
  });
  const verifiedById = new Map(verified.map((invoice) => [invoice.id, invoice]));
  const verificationErrors = [];
  for (const item of prepared) {
    const invoice = verifiedById.get(item.invoiceId);
    if (
      !invoice
      || invoice.partNumberCode !== item.row.partNumberCode
      || norm(invoice.finalClient?.name) !== norm(item.row.finalClientName)
      || (item.row.contractRef && invoice.contractRef !== item.row.contractRef)
    ) verificationErrors.push(item.row.invoiceKey);
  }
  summary.verificationErrors = verificationErrors;
  summary.importedRows = prepared.length - verificationErrors.length;
  console.log(JSON.stringify(summary));
  if (verificationErrors.length) process.exitCode = 3;
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ fatal: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
`;

const remote = spawnSync(
  "ssh",
  [
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=15",
    HOST,
    `docker exec -i ${CONTAINER} node -`,
  ],
  {
    input: remoteScript,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  },
);

const stdoutLines = remote.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
const jsonLine = [...stdoutLines].reverse().find((line) => line.startsWith("{"));
let result: Record<string, unknown> = {};
if (jsonLine) {
  try {
    result = JSON.parse(jsonLine) as Record<string, unknown>;
  } catch {
    result = { unparsedOutput: remote.stdout };
  }
}
const report = {
  generatedAt: new Date().toISOString(),
  host: HOST,
  container: CONTAINER,
  exitCode: remote.status,
  result,
  stderr: remote.stderr.trim(),
};
fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (remote.status !== 0) {
  process.stderr.write(remote.stderr);
  console.error(`Validation/import failed. Report: ${REPORT}`);
  process.exit(remote.status ?? 1);
}

console.log(JSON.stringify(result, null, 2));
console.log(`Wrote ${REPORT}`);
