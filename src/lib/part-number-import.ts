import "server-only";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/db";

// Importer for the part-numbers matrix export (.xlsx). Each row is one billable
// part-number template. Upsert is keyed on `code` so re-imports update in place.

export interface PartNumberImportResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

type Row = Record<string, unknown>;

// Header (lowercased) -> model field. Tolerates minor spelling variants.
const HEADER_MAP: Record<string, keyof MappedData> = {
  "part number": "code",
  "part-number": "code",
  partnumber: "code",
  group: "group",
  title: "title",
  limitations: "limitations",
  limitation: "limitations",
  category: "category",
  "sub-category": "subCategory",
  "sub category": "subCategory",
  subcategory: "subCategory",
  "sub-sub-category": "subSubCategory",
  "sub-subcategory": "subSubCategory",
  "sub sub category": "subSubCategory",
  type: "type",
  description: "description",
};

interface MappedData {
  code: string;
  group: string | null;
  title: string | null;
  limitations: string | null;
  category: string | null;
  subCategory: string | null;
  subSubCategory: string | null;
  type: string | null;
  description: string | null;
}

function normalizeHeader(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

function clean(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s === "-") return null;
  return s;
}

/**
 * Normalize a raw code so its dynamic parts use the `<...>` placeholder syntax.
 * Some matrix rows write a trailing bare "-limit" (e.g. "BLUE-MDR-C-limit");
 * convert those to "<limit>" so the wizard can offer a fill-in field.
 */
export function normalizeCode(raw: string): string {
  let code = raw.trim();
  // Trailing "-limit" (case-insensitive) with no angle brackets already present.
  if (!/<[^>]+>/.test(code)) {
    code = code.replace(/-limit\b/gi, "-<limit>");
  }
  return code;
}

function mapRow(r: Row): MappedData | null {
  const data: Partial<MappedData> = {};
  for (const [key, value] of Object.entries(r)) {
    const field = HEADER_MAP[normalizeHeader(key)];
    if (field) data[field] = clean(value) as never;
  }
  const code = data.code ? normalizeCode(data.code) : null;
  if (!code) return null;
  return {
    code,
    group: data.group ?? null,
    title: data.title ?? null,
    limitations: data.limitations ?? null,
    category: data.category ?? null,
    subCategory: data.subCategory ?? null,
    subSubCategory: data.subSubCategory ?? null,
    type: data.type ?? null,
    description: data.description ?? null,
  };
}

function workbookRows(buffer: Buffer): { rows: Row[]; errors: string[] } {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { rows: [], errors: ["No sheet found in file."] };

  const ws = wb.Sheets[sheetName];
  const headerRows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, raw: false });
  const headers = (headerRows[0] ?? []).map(normalizeHeader).filter(Boolean);
  if (!headers.some((h) => HEADER_MAP[h] === "code")) {
    return { rows: [], errors: ['Could not find a "Part Number" column in the first row.'] };
  }

  const rows = XLSX.utils.sheet_to_json<Row>(ws, { defval: "", raw: false }).map((row) =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [normalizeHeader(key), value]))
  );
  return { rows, errors: [] };
}

/** Parse the workbook buffer and upsert part numbers, keyed on `code`. */
export async function importPartNumbersFromBuffer(buffer: Buffer): Promise<PartNumberImportResult> {
  const { rows, errors } = workbookRows(buffer);
  const result: PartNumberImportResult = { total: rows.length, created: 0, updated: 0, skipped: 0, errors: [...errors] };
  if (errors.length > 0) return result;

  for (let i = 0; i < rows.length; i++) {
    const mapped = mapRow(rows[i]);
    if (!mapped) {
      result.skipped++;
      continue;
    }
    try {
      const existing = await prisma.partNumber.findUnique({ where: { code: mapped.code }, select: { id: true } });
      const { code, ...rest } = mapped;
      if (existing) {
        await prisma.partNumber.update({ where: { id: existing.id }, data: rest });
        result.updated++;
      } else {
        await prisma.partNumber.create({ data: { code, order: i, ...rest } });
        result.created++;
      }
    } catch (e) {
      result.skipped++;
      result.errors.push(`Row ${i + 2} (${mapped.code}): ${(e as Error).message}`);
    }
  }
  return result;
}
