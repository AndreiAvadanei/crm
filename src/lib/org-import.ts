import "server-only";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/db";
import { countryToStorageCode } from "@/lib/ro-geo";

// Importer for the SAGA/WinMentor "clienti" export (.xls/.xlsx). Each row is a
// company that maps to a billing Organization (and its owning Client). Upsert is
// keyed on Organization.sourceName (= the export "denumire"), so re-imports
// update in place instead of duplicating.

export interface OrgImportResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

export type OrgImportPreviewAction = "create" | "update" | "skip";

export interface OrgImportPreviewRow {
  rowNumber: number;
  sourceName: string;
  taxId: string | null;
  location: string | null;
  tvaPercent: string | null;
  action: OrgImportPreviewAction;
  reason?: string;
}

export interface OrgImportPreviewResult extends OrgImportResult {
  rows: OrgImportPreviewRow[];
}

type Row = Record<string, unknown>;

const REQUIRED_COLUMNS = ["denumire"];
const OPTIONAL_COLUMNS = [
  "cod_fiscal",
  "tara",
  "judet",
  "localitate",
  "adresa",
  "cont_banca",
  "banca",
  "tel",
  "email",
  "reg_com",
  "delegat",
  "inf_supl",
  "tip_tert",
  "is_tva",
  "blocat",
  "data_v_tva",
  "data_s_tva",
  "cod_post",
];
const EXPECTED_COLUMNS = [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS];

function normalizeHeader(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

function clean(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s === "-") return null;
  return s;
}

function boolish(v: unknown): boolean {
  const s = clean(v);
  return s === "1" || s?.toLowerCase() === "true";
}

/** Plătitor TVA: checked in the export → platform default %; otherwise 0%. */
function tvaPercentFromIsTva(isTva: boolean, defaultTvaPercent: string): string {
  return isTva ? defaultTvaPercent : "0";
}

function normalizeCountry(raw: string | null): string | null {
  if (!raw) return null;
  return countryToStorageCode(raw) ?? raw;
}

/** Parse dates like "6/16/25" (M/D/YY) or ISO; returns null when empty/invalid. */
function parseDate(v: unknown): Date | null {
  const s = clean(v);
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const mo = Number(m[1]);
    const d = Number(m[2]);
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    const dt = new Date(Date.UTC(y, mo - 1, d));
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/** Map a sheet row to the org column set (canonical columns mirrored, matching
 * the org form's orgData()). Returns null when there's no usable name. */
function mapRow(r: Row) {
  const denumire = clean(r.denumire);
  if (!denumire) return null;

  const taraRaw = clean(r.tara);
  const tara = normalizeCountry(taraRaw);
  const reg_com = clean(r.reg_com);
  const banca = clean(r.banca);
  const cont_banca = clean(r.cont_banca);
  const adresa = clean(r.adresa);

  return {
    sourceName: denumire,
    data: {
      legalName: denumire,
      taxId: clean(r.cod_fiscal),
      // Canonical columns mirrored from the RO field set (country stored as ISO-2).
      country: tara,
      regNumber: reg_com,
      bankName: banca,
      iban: cont_banca,
      address: adresa,
      // Romanian "tert" fields.
      tara,
      judet: clean(r.judet),
      localitate: clean(r.localitate),
      adresa,
      cont_banca,
      banca,
      tel: clean(r.tel),
      email: clean(r.email),
      reg_com,
      delegat: clean(r.delegat),
      inf_supl: clean(r.inf_supl),
      tip_tert: clean(r.tip_tert),
      is_tva: boolish(r.is_tva),
      blocat: boolish(r.blocat),
      data_v_tva: parseDate(r.data_v_tva),
      data_s_tva: parseDate(r.data_s_tva),
      cod_post: clean(r.cod_post),
    },
  };
}

function workbookRows(buffer: Buffer): { rows: Row[]; errors: string[] } {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { rows: [], errors: ["No sheet found in file."] };

  const ws = wb.Sheets[sheetName];
  const headerRows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, raw: false });
  const headers = (headerRows[0] ?? []).map(normalizeHeader).filter(Boolean);
  if (headers.length === 0) return { rows: [], errors: ["Nu am găsit antetul coloanelor în fișier."] };

  const missingRequired = REQUIRED_COLUMNS.filter((col) => !headers.includes(col));
  const matchedColumns = EXPECTED_COLUMNS.filter((col) => headers.includes(col));
  if (missingRequired.length > 0) {
    return {
      rows: [],
      errors: [
        `Coloane lipsă: ${missingRequired.join(", ")}. Fișierul trebuie să conțină cel puțin coloana "denumire".`,
      ],
    };
  }
  if (matchedColumns.length < 2) {
    return {
      rows: [],
      errors: [
        `Coloanele nu par să corespundă exportului de organizații. Am găsit doar: ${matchedColumns.join(", ")}.`,
      ],
    };
  }

  const rows = XLSX.utils.sheet_to_json<Row>(ws, { defval: "", raw: false }).map((row) =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [normalizeHeader(key), value]))
  );
  return { rows, errors: [] };
}

/** Parse the workbook and classify what each row would do without writing data. */
export async function previewOrganizationsFromBuffer(
  buffer: Buffer,
  opts: { defaultTvaPercent?: string } = {}
): Promise<OrgImportPreviewResult> {
  const defaultTva = opts.defaultTvaPercent ?? "21";
  const { rows, errors } = workbookRows(buffer);
  const result: OrgImportPreviewResult = {
    total: rows.length,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [...errors],
    rows: [],
  };
  if (errors.length > 0) return result;

  const mappedRows = rows.map((row, index) => ({ rowNumber: index + 2, mapped: mapRow(row) }));
  const names = Array.from(
    new Set(mappedRows.flatMap(({ mapped }) => (mapped ? [mapped.sourceName] : [])))
  );
  const existingNames = new Set(
    (
      await prisma.organization.findMany({
        where: { sourceName: { in: names } },
        select: { sourceName: true },
      })
    ).map((org) => org.sourceName)
  );
  const namesSeenInFile = new Set<string>();

  for (const { rowNumber, mapped } of mappedRows) {
    if (!mapped) {
      result.skipped++;
      const reason = "Missing denumire";
      result.errors.push(`Row ${rowNumber}: ${reason}`);
      result.rows.push({
        rowNumber,
        sourceName: "(fără denumire)",
        taxId: null,
        location: null,
        tvaPercent: null,
        action: "skip",
        reason,
      });
      continue;
    }

    const alreadySeenInFile = namesSeenInFile.has(mapped.sourceName);
    const willUpdate = existingNames.has(mapped.sourceName) || alreadySeenInFile;
    if (willUpdate) {
      result.updated++;
    } else {
      result.created++;
    }
    namesSeenInFile.add(mapped.sourceName);
    const tvaPercent = tvaPercentFromIsTva(mapped.data.is_tva, defaultTva);
    result.rows.push({
      rowNumber,
      sourceName: mapped.sourceName,
      taxId: mapped.data.taxId,
      location: [mapped.data.tara, mapped.data.localitate, mapped.data.judet].filter(Boolean).join(", ") || null,
      tvaPercent,
      action: willUpdate ? "update" : "create",
      reason: alreadySeenInFile && !existingNames.has(mapped.sourceName) ? "Duplicate name in file" : undefined,
    });
  }

  return result;
}

/** Parse the workbook buffer and upsert organizations. New rows also create (or
 * reuse by name) an owning Client and mark the org default when it's the first. */
export async function importOrganizationsFromBuffer(
  buffer: Buffer,
  opts: { defaultTvaPercent?: string } = {}
): Promise<OrgImportResult> {
  const defaultTva = opts.defaultTvaPercent ?? "21";
  const { rows, errors } = workbookRows(buffer);
  const result: OrgImportResult = { total: rows.length, created: 0, updated: 0, skipped: 0, errors: [...errors] };
  if (errors.length > 0) return result;

  for (let i = 0; i < rows.length; i++) {
    const mapped = mapRow(rows[i]);
    if (!mapped) {
      result.skipped++;
      continue;
    }
    try {
      const existing = await prisma.organization.findUnique({
        where: { sourceName: mapped.sourceName },
        select: { id: true },
      });
      const tvaPercent = tvaPercentFromIsTva(mapped.data.is_tva, defaultTva);
      if (existing) {
        await prisma.organization.update({
          where: { id: existing.id },
          data: {
            ...mapped.data,
            tvaPercent,
          },
        });
        result.updated++;
      } else {
        let client = await prisma.client.findFirst({
          where: { name: mapped.sourceName },
          select: { id: true },
        });
        if (!client) {
          client = await prisma.client.create({
            data: { name: mapped.sourceName, country: mapped.data.tara },
            select: { id: true },
          });
        }
        const orgCount = await prisma.organization.count({ where: { clientId: client.id } });
        await prisma.organization.create({
          data: {
            clientId: client.id,
            sourceName: mapped.sourceName,
            isDefault: orgCount === 0,
            tvaPercent,
            ...mapped.data,
          },
        });
        result.created++;
      }
    } catch (e) {
      result.skipped++;
      // +2: 1-based, plus the header row.
      result.errors.push(`Row ${i + 2} (${mapped.sourceName}): ${(e as Error).message}`);
    }
  }

  return result;
}
