/**
 * Idempotent bulk import of contract numbers for a single company (Issuer).
 *
 * Usage:
 *   tsx scripts/import-contract-numbers.ts [tsvPath] [issuerName] [createdByEmail]
 *
 * Defaults: scripts/contract-numbers-bit-sentinel.tsv, issuer "BIT SENTINEL",
 * creator andrei@bit-sentinel.com.
 *
 * The TSV has three tab-separated columns: number, clientName, type
 * (type is one of: in | out | in/out). Rows already present for the target
 * issuer (matched by number) are skipped, so the script is safe to re-run.
 */
import { readFileSync } from "node:fs";
import { PrismaClient, ContractType } from "../src/generated/prisma";

const prisma = new PrismaClient();

const DEFAULT_CREATED_BY_EMAIL = "andrei@bit-sentinel.com";

type Parsed = { number: string; clientName: string; type: ContractType; comment: string | null };

function parseType(raw: string): { type: ContractType; comment: string | null } {
  const t = (raw ?? "").trim().toLowerCase();
  if (t === "out") return { type: ContractType.OUT, comment: null };
  if (t === "in") return { type: ContractType.IN, comment: null };
  if (t === "in/out" || t === "in-out" || t === "in&out") {
    return { type: ContractType.IN, comment: "Marked as in/out in source" };
  }
  // Blank or unrecognized type: default to IN and flag it in the comment.
  return { type: ContractType.IN, comment: "Type unspecified in source" };
}

function parseFile(path: string): Parsed[] {
  const raw = readFileSync(path, "utf8");
  const rows: Parsed[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols = line.split("\t");
    if (cols.length < 3) {
      throw new Error(`Malformed line (need 3 tab-separated columns): ${line}`);
    }
    const number = cols[0].trim();
    if (!number) throw new Error(`Missing contract number on line: ${line}`);
    const { type, comment: typeComment } = parseType(cols[2]);
    const notes: string[] = [];
    let clientName = cols[1].replace(/\s+/g, " ").trim();
    if (!clientName) {
      clientName = "(unspecified)";
      notes.push("No client in source");
    }
    if (typeComment) notes.push(typeComment);
    rows.push({ number, clientName, type, comment: notes.length ? notes.join("; ") : null });
  }
  return rows;
}

async function main() {
  const tsvPath = process.argv[2] ?? "scripts/contract-numbers-bit-sentinel.tsv";
  const issuerName = process.argv[3] ?? "BIT SENTINEL";
  const createdByEmail = process.argv[4] ?? DEFAULT_CREATED_BY_EMAIL;

  const creator = await prisma.user.findUnique({
    where: { email: createdByEmail },
    select: { id: true, name: true, email: true },
  });
  if (!creator) {
    throw new Error(`No user found with email "${createdByEmail}".`);
  }

  const issuers = await prisma.issuer.findMany({
    where: { name: { contains: issuerName } },
    select: { id: true, name: true },
  });
  if (issuers.length === 0) {
    throw new Error(`No issuer found matching "${issuerName}". Available: ` +
      (await prisma.issuer.findMany({ select: { name: true } })).map((i) => i.name).join(", "));
  }
  if (issuers.length > 1) {
    throw new Error(`Ambiguous issuer "${issuerName}" matches: ${issuers.map((i) => i.name).join(", ")}. ` +
      `Pass an exact name as the 2nd argument.`);
  }
  const issuer = issuers[0];

  const rows = parseFile(tsvPath);
  console.log(
    `Importing ${rows.length} contract numbers into issuer "${issuer.name}" (${issuer.id}), ` +
      `created by ${creator.name} <${creator.email}> (${creator.id})`
  );

  const existing = new Set(
    (await prisma.contractNumber.findMany({ where: { issuerId: issuer.id }, select: { number: true } })).map(
      (c) => c.number
    )
  );

  let created = 0;
  let skipped = 0;
  for (const r of rows) {
    if (existing.has(r.number)) {
      skipped++;
      continue;
    }
    await prisma.contractNumber.create({
      data: {
        issuerId: issuer.id,
        number: r.number,
        organizationId: null,
        clientName: r.clientName,
        type: r.type,
        isFrameAgreement: false,
        expiresAt: null,
        comment: r.comment,
        createdById: creator.id,
        createdByName: creator.name,
      },
    });
    existing.add(r.number);
    created++;
  }

  console.log(`Done. Created ${created}, skipped ${skipped} (already present).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
