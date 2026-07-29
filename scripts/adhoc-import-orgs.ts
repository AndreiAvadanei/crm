/**
 * Ad-hoc headless runner for the organizations import (SAGA "clienti" .xls/.xlsx).
 * Reuses the exact app logic in src/lib/org-import.ts so behavior matches the UI.
 *
 *   tsx scripts/adhoc-import-orgs.ts <file.xls>            # preview (no writes)
 *   tsx scripts/adhoc-import-orgs.ts <file.xls> --commit   # upsert into DB
 */
import fs from "fs";
import {
  importOrganizationsFromBuffer,
  previewOrganizationsFromBuffer,
} from "@/lib/org-import";
import { getDefaultOrganizationTvaPercent } from "@/lib/settings";

async function main() {
  const file = process.argv[2];
  const commit = process.argv.includes("--commit");
  if (!file) throw new Error("usage: adhoc-import-orgs.ts <file.xls> [--commit]");

  const buf = fs.readFileSync(file);
  const defaultTvaPercent = await getDefaultOrganizationTvaPercent();
  console.log(`Default org VAT %: ${defaultTvaPercent}`);

  if (!commit) {
    const p = await previewOrganizationsFromBuffer(buf, { defaultTvaPercent });
    console.log("=== PREVIEW (no writes) ===");
    console.log(JSON.stringify(
      { total: p.total, create: p.created, update: p.updated, skip: p.skipped, errorCount: p.errors.length, firstErrors: p.errors.slice(0, 10) },
      null, 2,
    ));
  } else {
    const r = await importOrganizationsFromBuffer(buf, { defaultTvaPercent });
    console.log("=== IMPORT (committed) ===");
    console.log(JSON.stringify(
      { total: r.total, created: r.created, updated: r.updated, skipped: r.skipped, errorCount: r.errors.length, firstErrors: r.errors.slice(0, 10) },
      null, 2,
    ));
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
