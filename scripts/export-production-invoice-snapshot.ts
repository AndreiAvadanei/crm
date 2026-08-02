/**
 * Read-only production invoice snapshot.
 *
 * Uses the explicitly configured SSH host and reads Invoice + InvoiceLine +
 * Organization. It does not mutate production.
 *
 * Usage:
 *   npx tsx scripts/export-production-invoice-snapshot.ts
 */
import fs from "fs";
import { spawnSync } from "child_process";

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const HOST = arg("host", "root@46.224.17.213");
const OUT = arg("out", "data-init/production-invoices-snapshot.json");

const sql = `
SELECT JSON_OBJECT(
  'id', i.id,
  'externalRecordId', i.externalRecordId,
  'number', i.number,
  'organization', o.sourceName,
  'issueDate', DATE_FORMAT(i.issueDate, '%Y-%m-%d'),
  'currency', i.currency,
  'totalAmount', CAST(i.totalAmount AS CHAR),
  'totalBaseAmount', CAST(i.totalBaseAmount AS CHAR),
  'servicesDescription', i.servicesDescription,
  'contractRef', i.contractRef,
  'partNumberCode', i.partNumberCode,
  'originalValues', i.originalValues,
  'lineId', l.id,
  'lineServiceDescription', l.serviceDescription,
  'lineTextSupplement', l.textSupplement,
  'lineValue', CAST(l.value AS CHAR),
  'lineTotal', CAST(l.total AS CHAR),
  'lineOriginalValues', l.originalValues
)
FROM Invoice i
JOIN Organization o ON o.id = i.organizationId
LEFT JOIN InvoiceLine l ON l.invoiceId = i.id
ORDER BY o.sourceName, i.issueDate, i.number, l.id;
`.trim();

const encoded = Buffer.from(sql, "utf8").toString("base64");
const remote = [
  `printf %s '${encoded}'`,
  "base64 -d",
  "docker exec -i crm-mysql-1 sh -lc 'mysql -u\"$MYSQL_USER\" -p\"$MYSQL_PASSWORD\" \"$MYSQL_DATABASE\" --batch --raw --skip-column-names'",
].join(" | ");

const result = spawnSync("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", HOST, remote], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});

if (result.status !== 0) {
  process.stderr.write(result.stderr);
  throw new Error(`Production snapshot failed (ssh exit ${result.status ?? "unknown"}).`);
}

type RawRow = Record<string, unknown>;
const rows: RawRow[] = result.stdout
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.startsWith("{"))
  .map((line) => JSON.parse(line) as RawRow);

const byInvoice = new Map<string, {
  id: unknown;
  externalRecordId: unknown;
  number: unknown;
  organization: unknown;
  issueDate: unknown;
  currency: unknown;
  totalAmount: unknown;
  totalBaseAmount: unknown;
  servicesDescription: unknown;
  contractRef: unknown;
  partNumberCode: unknown;
  originalValues: unknown;
  lines: Array<{
    id: unknown;
    serviceDescription: unknown;
    textSupplement: unknown;
    value: unknown;
    total: unknown;
    originalValues: unknown;
  }>;
}>();

for (const row of rows) {
  const id = String(row.id ?? "");
  if (!id) continue;
  let invoice = byInvoice.get(id);
  if (!invoice) {
    invoice = {
      id: row.id,
      externalRecordId: row.externalRecordId,
      number: row.number,
      organization: row.organization,
      issueDate: row.issueDate,
      currency: row.currency,
      totalAmount: row.totalAmount,
      totalBaseAmount: row.totalBaseAmount,
      servicesDescription: row.servicesDescription,
      contractRef: row.contractRef,
      partNumberCode: row.partNumberCode,
      originalValues: row.originalValues,
      lines: [],
    };
    byInvoice.set(id, invoice);
  }
  if (row.lineId) {
    invoice.lines.push({
      id: row.lineId,
      serviceDescription: row.lineServiceDescription,
      textSupplement: row.lineTextSupplement,
      value: row.lineValue,
      total: row.lineTotal,
      originalValues: row.lineOriginalValues,
    });
  }
}

const output = {
  generatedAt: new Date().toISOString(),
  host: HOST,
  invoiceCount: byInvoice.size,
  rowCount: rows.length,
  invoices: [...byInvoice.values()],
};
fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`Wrote ${byInvoice.size} production invoices (${rows.length} line rows) -> ${OUT}`);
