/**
 * Link billing organizations (clienti.csv legal entities) to existing CRM clients.
 *
 * Primary strategy is the deterministic SAL-id join:
 *   Organization (clienti "Nume companie")
 *     -> its invoices (facturi rows with matching "Nume companie (from Client)")
 *     -> "Referinta proiect" (SAL-xxxx)
 *     -> Deal.salesId
 *     -> Deal.client
 *
 * Orphans (no SAL / SAL absent from DB / conflicting clients) fall back to a
 * normalized-name + Levenshtein match and are surfaced for manual confirmation
 * via scripts/org-client-overrides.json.
 *
 * Usage:
 *   tsx scripts/link-organizations.ts                 # dry-run (default)
 *   tsx scripts/link-organizations.ts --commit        # upsert Organization rows
 *   flags: --file-clienti <p> --file-facturi <p> --overrides <p> --out <p>
 *          --allow-unresolved   (commit only resolved orgs, skip the rest)
 */
import "dotenv/config";
import fs from "fs";
import { parse } from "csv-parse/sync";
import { PrismaClient } from "../src/generated/prisma";

const prisma = new PrismaClient();

// ----------------------------- args -----------------------------
const args = process.argv.slice(2);
const getArg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const COMMIT = args.includes("--commit");
const ALLOW_UNRESOLVED = args.includes("--allow-unresolved");
const FILE_CLIENTI = getArg("file-clienti") || "./clienti.csv";
const FILE_FACTURI = getArg("file-facturi") || "./facturi.csv";
const FILE_OVERRIDES = getArg("overrides") || "./scripts/org-client-overrides.json";
const OUT_PROPOSAL = getArg("out") || "./scripts/org-link-proposal.csv";

// --------------------------- helpers -----------------------------
function clean(s: unknown): string {
  return (s == null ? "" : String(s))
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/^"+|"+$/g, "")
    .trim();
}

function readCsv(path: string): string[][] {
  const content = fs.readFileSync(path, "utf8");
  return parse(content, { skip_empty_lines: true, relax_column_count: true });
}

const LEGAL_SUFFIXES = [
  "s.r.l.", "s.r.l", "srl", "s.a.", "s.a", "sa", "s.c.s.", "scs", "l.l.c.", "llc",
  "inc.", "inc", "ltd.", "ltd", "gmbh", "ggmbh", "ag", "b.v.", "bv", "aps", "ab",
  "publ", "plc", "limited", "co.", "kg", "oy", "as",
];

/** Normalize a company name for fuzzy comparison. */
function normalizeName(raw: string): string {
  let s = raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/&/g, " and ")
    .replace(/[.,/#!$%^*;:{}=\-_`~()'"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // strip trailing/embedded legal suffix tokens
  let tokens = s.split(" ").filter(Boolean);
  tokens = tokens.filter((t) => !LEGAL_SUFFIXES.includes(t));
  return tokens.join(" ").trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prevDiag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        prevDiag + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      prevDiag = tmp;
    }
  }
  return prev[b.length];
}

/** Similarity 0..1 based on normalized Levenshtein distance. */
function similarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const dist = levenshtein(na, nb);
  return 1 - dist / Math.max(na.length, nb.length);
}

type ClientRow = { id: string; name: string };
type Candidate = { id: string; name: string; count: number };
type Method = "override" | "sal" | "fuzzy" | "none";
type Proposal = {
  status: "OK" | "CONF" | "NONE";
  sourceName: string;
  taxId: string;
  resolvedClientId: string | null;
  resolvedClientName: string | null;
  method: Method;
  confidence: number; // 0..1
  candidates: Candidate[];
};

function csvField(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

async function main() {
  // -- load overrides (sourceName -> { clientId?, clientName?, createClient? }) --
  let overrides: Record<string, { clientId?: string; clientName?: string; createClient?: boolean; note?: string }> = {};
  if (fs.existsSync(FILE_OVERRIDES)) {
    try {
      overrides = JSON.parse(fs.readFileSync(FILE_OVERRIDES, "utf8"));
    } catch (e) {
      console.error(`Failed to parse overrides ${FILE_OVERRIDES}:`, e);
      process.exit(1);
    }
  }

  // -- DB lookups --
  const clients: ClientRow[] = await prisma.client.findMany({ select: { id: true, name: true } });
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const deals = await prisma.deal.findMany({ select: { salesId: true, client: { select: { id: true, name: true } } } });
  const clientBySal = new Map<string, ClientRow | null>();
  for (const d of deals) clientBySal.set(d.salesId.toUpperCase(), d.client);

  // -- parse CSVs --
  const facturi = readCsv(FILE_FACTURI).slice(1); // [3]=company, [9]=SAL
  const clienti = readCsv(FILE_CLIENTI).slice(1); // [0]=name [3]=CUI [4]=J [2]=Tara [5]=Banca [6]=IBAN [1]=Adresa

  // invoices grouped by billing company -> resolved client candidates (via SAL)
  const salCandidates = new Map<string, Map<string, Candidate>>();
  for (const r of facturi) {
    const company = clean(r[3]);
    const sal = clean(r[9]).toUpperCase();
    if (!company || !sal || sal === "-") continue;
    const c = clientBySal.get(sal);
    if (!c || !c.id) continue;
    if (!salCandidates.has(company)) salCandidates.set(company, new Map());
    const m = salCandidates.get(company)!;
    const cur = m.get(c.id);
    m.set(c.id, { id: c.id, name: c.name, count: (cur?.count ?? 0) + 1 });
  }

  // -- build proposals --
  const proposals: Proposal[] = [];
  for (const row of clienti) {
    const sourceName = clean(row[0]);
    if (!sourceName) continue;
    const taxId = clean(row[3]);

    // 1) explicit override wins
    const ov = overrides[sourceName];
    if (ov && (ov.clientId || ov.clientName)) {
      let resolved: ClientRow | undefined;
      if (ov.clientId) resolved = clientById.get(ov.clientId);
      if (!resolved && ov.clientName) {
        const matches = clients.filter((c) => c.name === ov.clientName);
        if (matches.length === 1) resolved = matches[0];
        else if (matches.length > 1) {
          console.warn(`Override for "${sourceName}" clientName="${ov.clientName}" is ambiguous (${matches.length} clients). Use clientId.`);
        } else if (ov.createClient) {
          // No such client yet: create it (only when committing) so the org has a home.
          if (COMMIT) {
            const c = await prisma.client.create({ data: { name: ov.clientName } });
            resolved = { id: c.id, name: c.name };
            clients.push(resolved);
            clientById.set(c.id, resolved);
            console.log(`Created client "${c.name}" (${c.id}) for "${sourceName}".`);
          } else {
            // dry-run: report intent without writing
            proposals.push({
              status: "OK", sourceName, taxId,
              resolvedClientId: "(new)", resolvedClientName: `${ov.clientName} (will be created)`,
              method: "override", confidence: 1,
              candidates: [{ id: "(new)", name: ov.clientName, count: 0 }],
            });
            continue;
          }
        }
      }
      if (resolved) {
        proposals.push({
          status: "OK", sourceName, taxId,
          resolvedClientId: resolved.id, resolvedClientName: resolved.name,
          method: "override", confidence: 1,
          candidates: [{ id: resolved.id, name: resolved.name, count: 0 }],
        });
        continue;
      }
      console.warn(`Override for "${sourceName}" did not resolve to a client; falling through.`);
    }

    // 2) SAL join
    const cand = salCandidates.get(sourceName);
    const candidates = cand ? [...cand.values()].sort((a, b) => b.count - a.count) : [];
    if (candidates.length === 1) {
      proposals.push({
        status: "OK", sourceName, taxId,
        resolvedClientId: candidates[0].id, resolvedClientName: candidates[0].name,
        method: "sal", confidence: 1, candidates,
      });
      continue;
    }
    if (candidates.length > 1) {
      proposals.push({
        status: "CONF", sourceName, taxId,
        resolvedClientId: null, resolvedClientName: null,
        method: "sal", confidence: 0, candidates,
      });
      continue;
    }

    // 3) fuzzy fallback (no SAL link at all)
    let best: { c: ClientRow; score: number } | null = null;
    for (const c of clients) {
      const score = similarity(sourceName, c.name);
      if (!best || score > best.score) best = { c, score };
    }
    if (best && best.score >= 0.86) {
      proposals.push({
        status: "OK", sourceName, taxId,
        resolvedClientId: best.c.id, resolvedClientName: best.c.name,
        method: "fuzzy", confidence: best.score,
        candidates: [{ id: best.c.id, name: best.c.name, count: 0 }],
      });
    } else {
      proposals.push({
        status: "NONE", sourceName, taxId,
        resolvedClientId: null, resolvedClientName: null,
        method: "none", confidence: best?.score ?? 0,
        candidates: best ? [{ id: best.c.id, name: best.c.name, count: 0 }] : [],
      });
    }
  }

  // -- write proposal CSV --
  const header = ["status", "sourceName", "taxId", "method", "confidence", "resolvedClientId", "resolvedClientName", "candidates"];
  const lines = [header.join(",")];
  for (const p of proposals) {
    const cands = p.candidates.map((c) => `${c.name} [${c.count}] (${c.id})`).join(" | ");
    lines.push([
      p.status, csvField(p.sourceName), csvField(p.taxId), p.method, p.confidence.toFixed(2),
      p.resolvedClientId ?? "", csvField(p.resolvedClientName ?? ""), csvField(cands),
    ].join(","));
  }
  fs.writeFileSync(OUT_PROPOSAL, lines.join("\n") + "\n");

  // -- summary --
  const ok = proposals.filter((p) => p.status === "OK");
  const conf = proposals.filter((p) => p.status === "CONF");
  const none = proposals.filter((p) => p.status === "NONE");
  console.log(`Organizations: ${proposals.length}  | OK: ${ok.length}  CONF: ${conf.length}  NONE: ${none.length}`);
  console.log(`Proposal written to ${OUT_PROPOSAL}`);
  if (conf.length || none.length) {
    console.log("\nNeeds resolution in scripts/org-client-overrides.json:");
    for (const p of [...conf, ...none]) {
      const cands = p.candidates.map((c) => `${c.name} [${c.count}] (${c.id})`).join("  ||  ");
      console.log(`  [${p.status}] ${p.sourceName}  =>  ${cands || "(no candidate)"}`);
    }
  }

  if (!COMMIT) {
    console.log("\nDry run. Re-run with --commit to write Organization rows.");
    await prisma.$disconnect();
    return;
  }

  // -- commit --
  const unresolved = proposals.filter((p) => !p.resolvedClientId);
  if (unresolved.length && !ALLOW_UNRESOLVED) {
    console.error(`\nAborting commit: ${unresolved.length} organizations unresolved. Resolve them in ${FILE_OVERRIDES} or pass --allow-unresolved.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  let created = 0, updated = 0, skipped = 0;
  for (const row of clienti) {
    const sourceName = clean(row[0]);
    if (!sourceName) continue;
    const p = proposals.find((x) => x.sourceName === sourceName);
    if (!p || !p.resolvedClientId) { skipped++; continue; }
    const data = {
      clientId: p.resolvedClientId,
      legalName: sourceName,
      country: clean(row[2]) || null,
      taxId: clean(row[3]) || null,
      regNumber: clean(row[4]) || null,
      bankName: clean(row[5]) || null,
      iban: clean(row[6]) || null,
      address: clean(row[1]) || null,
    };
    const existing = await prisma.organization.findUnique({ where: { sourceName } });
    if (existing) {
      await prisma.organization.update({ where: { sourceName }, data });
      updated++;
    } else {
      await prisma.organization.create({ data: { sourceName, ...data } });
      created++;
    }
  }

  // mark the sole org of each client as default
  const grouped = await prisma.organization.groupBy({ by: ["clientId"], _count: { _all: true } });
  for (const g of grouped) {
    if (g._count._all === 1) {
      await prisma.organization.updateMany({ where: { clientId: g.clientId }, data: { isDefault: true } });
    }
  }

  console.log(`\nCommitted. Created: ${created}  Updated: ${updated}  Skipped: ${skipped}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
