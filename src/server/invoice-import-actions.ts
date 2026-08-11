"use server";

import { revalidatePath } from "next/cache";
import * as XLSX from "xlsx";
import { InvoiceStatus, Prisma } from "@/generated/prisma";
import { requireUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { isAdmin } from "@/lib/rbac";
import { logActivity } from "@/lib/activity";

type Result<T> = { ok?: boolean; error?: string } & T;
export type InvoiceWorkbookKind = "ron" | "valuta";

export type InvoiceImportLinePreview = {
  rowNumber: number;
  serviceDescription: string | null;
  textSupplement: string | null;
  unitOfMeasure: string | null;
  quantity: string | null;
  unitPrice: string | null;
  value: string | null;
  total: string | null;
  originalValues: Record<string, string | null>;
};

export type InvoiceImportPreviewRow = {
  importKey: string;
  sourceInvoiceId: string;
  workbookKind: InvoiceWorkbookKind;
  number: string;
  organizationName: string;
  organizationExists: boolean;
  willCreateOrganization: boolean;
  /** True when this row updates an invoice we issued ourselves instead of creating one. */
  willAdoptSelfIssued: boolean;
  issueDate: string | null;
  currency: string | null;
  totalBaseAmount: string | null;
  vatAmount: string | null;
  totalAmount: string | null;
  unpaidAmount: string | null;
  paid: boolean;
  invoiceInfo: string | null;
  textSupplement: string | null;
  articleCount: number;
  servicesPreview: string | null;
  errors: string[];
  warnings: string[];
  originalValues: Record<string, string | null>;
  lines: InvoiceImportLinePreview[];
};

export type InvoiceImportPreview = {
  fileName: string;
  sheetName: string;
  totalRows: number;
  invoices: InvoiceImportPreviewRow[];
  errors: string[];
  warnings: string[];
  createdOrganizationCount: number;
};

const REQUIRED_COLUMNS = ["id_iesire", "nr_iesire", "denumire", "data", "baza_tva", "tva", "neachitat", "denumire1"];
const VALUTA_REQUIRED_COLUMNS = ["cod_valuta", "val_val", "tva_val", "pu_val", "val_val1", "tva_val1"];

/**
 * Export type, taken from the file name when it says so. A name that doesn't
 * mention ron/lei or valuta falls back to the type picked in the dialog; the
 * header validation then still rejects a workbook that isn't of that type.
 */
function inferWorkbookKind(fileName: string, picked?: string | null): { kind?: InvoiceWorkbookKind; error?: string } {
  const lower = fileName.toLowerCase();
  const hasRon = /\b(?:ron|lei)\b/.test(lower) || lower.includes("ron -") || lower.includes("- ron");
  const hasValuta = lower.includes("valuta");
  if (hasRon && hasValuta) return { error: "File name must identify only one export type: RON or valuta." };
  if (hasRon) return { kind: "ron" };
  if (hasValuta) return { kind: "valuta" };
  if (picked === "ron" || picked === "valuta") return { kind: picked };
  return { error: 'File name must include "ron", "lei", or "valuta", or pick the export type before importing.' };
}

/** The export type chosen in the dialog, when the file name doesn't say. */
function pickedKind(formData: FormData): string | null {
  const value = formData.get("kind");
  return typeof value === "string" && value.length > 0 ? value : null;
}

function clean(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function rawRecord(row: Record<string, unknown>): Record<string, string | null> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, clean(value)]));
}

function get(row: Record<string, unknown>, key: string): string | null {
  return clean(row[key]);
}

function parseDecimal(value: string | null): string | null {
  if (!value) return null;
  let s = value.trim().replace(/\s+/g, "");
  if (!s) return null;
  if (s.includes(",") && !s.includes(".")) s = s.replace(",", ".");
  if (s.includes(",") && s.includes(".")) s = s.replace(/,/g, "");
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(4).replace(/\.?0+$/, "");
}

function sumDecimals(...values: Array<string | null>): string | null {
  const parsed = values.map(parseDecimal).filter((value): value is string => value != null);
  if (parsed.length === 0) return null;
  const total = parsed.reduce((sum, value) => sum.plus(value), new Prisma.Decimal(0));
  return total.toFixed(4).replace(/\.?0+$/, "");
}

function isZero(value: string | null): boolean {
  const parsed = parseDecimal(value);
  return parsed != null && Number(parsed) === 0;
}

function parseDateIso(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) {
    const month = Number(m[1]);
    const day = Number(m[2]);
    const yearRaw = Number(m[3]);
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
      return date.toISOString().slice(0, 10);
    }
  }
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function toDate(value: string | null): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

function paymentTermDays(issueDate: string | null, dueDateRaw: string | null): number | null {
  const dueDate = parseDateIso(dueDateRaw);
  if (!issueDate || !dueDate) return null;
  const start = new Date(`${issueDate}T00:00:00.000Z`).getTime();
  const end = new Date(`${dueDate}T00:00:00.000Z`).getTime();
  const days = Math.round((end - start) / 86_400_000);
  return Number.isFinite(days) && days > 0 ? days : null;
}

function normalizeCurrency(value: string | null, fallback: string): string {
  const raw = (value || fallback || "RON").trim().toUpperCase();
  if (raw === "EURO") return "EUR";
  if (raw === "EUR" || raw === "RON" || raw === "USD") return raw;
  return fallback;
}

function normalizeUnit(value: string | null): string | null {
  return value ? value.trim().toLowerCase() : null;
}

function uniqueJoin(values: Array<string | null>): string | null {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const v = value?.trim();
    if (v && !seen.has(v.toLowerCase())) {
      seen.add(v.toLowerCase());
      out.push(v);
    }
  }
  return out.length ? out.join("\n") : null;
}

function validateHeaders(rows: Record<string, unknown>[], kind: InvoiceWorkbookKind): string[] {
  if (rows.length === 0) return ["The workbook has no data rows."];
  const headers = new Set(Object.keys(rows[0] ?? {}).map((h) => h.toLowerCase()));
  const errors = REQUIRED_COLUMNS.filter((column) => !headers.has(column)).map((column) => `Missing required column "${column}".`);
  if (kind === "valuta") {
    errors.push(
      ...VALUTA_REQUIRED_COLUMNS.filter((column) => !headers.has(column)).map(
        (column) => `Valuta invoice exports must include the "${column}" column.`
      )
    );
  }
  if (kind === "ron" && headers.has("cod_valuta")) {
    errors.push('This looks like a valuta export because it has "cod_valuta"; upload it as a valuta file.');
  }
  return errors;
}

function parseWorkbook(buffer: Buffer, fileName: string, kind: InvoiceWorkbookKind, existingOrgNames: Set<string>): InvoiceImportPreview {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : null;
  if (!sheetName || !sheet) {
    return { fileName, sheetName: "", totalRows: 0, invoices: [], errors: ["The workbook has no sheets."], warnings: [], createdOrganizationCount: 0 };
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: false, blankrows: false });
  const errors = validateHeaders(rows, kind);
  const fallbackCurrency = kind === "valuta" ? "EUR" : "RON";
  const groups = new Map<string, InvoiceImportPreviewRow>();

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const sourceInvoiceId = get(row, "id_iesire");
    const number = get(row, "nr_iesire");
    const organizationName = get(row, "denumire");
    const issueDateRaw = get(row, "data");
    const issueDate = parseDateIso(issueDateRaw);
    const rowErrors: string[] = [];
    const rowWarnings: string[] = [];

    if (!sourceInvoiceId) rowErrors.push("Missing id_iesire.");
    if (!number) rowErrors.push("Missing nr_iesire.");
    if (!organizationName) rowErrors.push("Missing denumire.");
    if (!issueDateRaw) rowErrors.push("Missing data.");
    if (issueDateRaw && !issueDate) rowErrors.push(`Invalid data "${issueDateRaw}".`);

    const key = sourceInvoiceId || `row-${rowNumber}`;
    const originalValues = rawRecord(row);
    const lineValue = parseDecimal(get(row, kind === "valuta" ? "val_val1" : "valoare"));
    const lineVat = kind === "valuta" ? parseDecimal(get(row, "tva_val1")) : null;
    const line: InvoiceImportLinePreview = {
      rowNumber,
      serviceDescription: get(row, "denumire1"),
      textSupplement: get(row, "text_supl"),
      unitOfMeasure: normalizeUnit(get(row, "um")),
      quantity: parseDecimal(get(row, "cantitate")),
      unitPrice: parseDecimal(get(row, kind === "valuta" ? "pu_val" : "pret_unitar")),
      value: lineValue,
      total: kind === "valuta" ? sumDecimals(lineValue, lineVat) : parseDecimal(get(row, "total1")),
      originalValues,
    };
    if (!line.serviceDescription) rowWarnings.push("Missing denumire1/service article.");

    // Valuta exports contain both original-currency and converted-RON values:
    // val_val/tva_val are the invoice amounts, while baza_tva/tva are RON.
    const totalBaseAmount = parseDecimal(get(row, kind === "valuta" ? "val_val" : "baza_tva"));
    const vatAmount = parseDecimal(get(row, kind === "valuta" ? "tva_val" : "tva"));
    const headerTotal = parseDecimal(get(row, "total"));
    const totalAmount =
      kind === "valuta"
        ? sumDecimals(totalBaseAmount, vatAmount)
        : headerTotal ?? sumDecimals(totalBaseAmount, vatAmount);
    const unpaidAmount = parseDecimal(get(row, "neachitat"));
    const currency = normalizeCurrency(get(row, "cod_valuta"), fallbackCurrency);

    const organizationExists = organizationName ? existingOrgNames.has(organizationName.toLowerCase()) : false;
    const existing = groups.get(key);
    if (existing) {
      const consistencyChecks: Array<[string, string | null, string | null]> = [
        ["nr_iesire", existing.number, number],
        ["denumire", existing.organizationName, organizationName],
        ["data", existing.issueDate, issueDate],
        ["cod_valuta", existing.currency, currency],
        ["base amount", existing.totalBaseAmount, totalBaseAmount],
        ["VAT amount", existing.vatAmount, vatAmount],
        ["total amount", existing.totalAmount, totalAmount],
        ["neachitat", existing.unpaidAmount, unpaidAmount],
      ];
      for (const [field, expected, actual] of consistencyChecks) {
        if ((expected ?? "") !== (actual ?? "")) {
          existing.errors.push(
            `Row ${rowNumber}: id_iesire "${key}" has inconsistent ${field} (expected "${expected ?? ""}", got "${actual ?? ""}").`
          );
        }
      }
      existing.lines.push(line);
      existing.articleCount = existing.lines.length;
      existing.servicesPreview = uniqueJoin(existing.lines.map((l) => l.serviceDescription));
      existing.textSupplement = uniqueJoin(existing.lines.map((l) => l.textSupplement));
      existing.errors.push(...rowErrors.map((e) => `Row ${rowNumber}: ${e}`));
      existing.warnings.push(...rowWarnings.map((e) => `Row ${rowNumber}: ${e}`));
      return;
    }

    groups.set(key, {
      importKey: `accounting:${kind}:${key}`,
      sourceInvoiceId: sourceInvoiceId ?? "",
      workbookKind: kind,
      number: number ?? "",
      organizationName: organizationName ?? "",
      organizationExists,
      willCreateOrganization: !!organizationName && !organizationExists,
      willAdoptSelfIssued: false,
      issueDate,
      currency,
      totalBaseAmount,
      vatAmount,
      totalAmount,
      unpaidAmount,
      paid: isZero(unpaidAmount),
      invoiceInfo: get(row, "inf_suplm"),
      textSupplement: line.textSupplement,
      articleCount: 1,
      servicesPreview: line.serviceDescription,
      errors: rowErrors.map((e) => `Row ${rowNumber}: ${e}`),
      warnings: rowWarnings.map((e) => `Row ${rowNumber}: ${e}`),
      originalValues,
      lines: [line],
    });
  });

  const invoices = Array.from(groups.values());
  const invoiceIdsByNumber = new Map<string, Set<string>>();
  for (const invoice of invoices) {
    if (!invoice.number || !invoice.sourceInvoiceId) continue;
    const ids = invoiceIdsByNumber.get(invoice.number) ?? new Set<string>();
    ids.add(invoice.sourceInvoiceId);
    invoiceIdsByNumber.set(invoice.number, ids);
  }
  for (const invoice of invoices) {
    const ids = invoiceIdsByNumber.get(invoice.number);
    if (ids && ids.size > 1) {
      invoice.warnings.push(
        `Invoice number "${invoice.number}" is reused by ${ids.size} source invoices; they will be imported separately by id_iesire.`
      );
    }
  }
  return {
    fileName,
    sheetName,
    totalRows: rows.length,
    invoices,
    errors,
    warnings: [],
    createdOrganizationCount: invoices.filter((row) => row.willCreateOrganization).length,
  };
}

export async function previewInvoiceWorkbookAction(formData: FormData): Promise<Result<{ preview?: InvoiceImportPreview }>> {
  await requireUser();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose an XLS/XLSX invoice file first." };
  const allowed = /\.(xls|xlsx)$/i.test(file.name);
  if (!allowed) return { error: "Only .xls and .xlsx files are supported." };
  const kind = inferWorkbookKind(file.name, pickedKind(formData));
  if (kind.error || !kind.kind) return { error: kind.error ?? "Could not detect invoice export type." };

  const existingOrganizations = await prisma.organization.findMany({ select: { sourceName: true } });
  const existingOrgNames = new Set(existingOrganizations.map((org) => org.sourceName.toLowerCase()));
  const buffer = Buffer.from(await file.arrayBuffer());
  const preview = parseWorkbook(buffer, file.name, kind.kind, existingOrgNames);
  if (preview.errors.length > 0) return { error: preview.errors.join(" ") };

  // Flag the rows that will update an invoice we issued ourselves. Needs the
  // issuer, since that plus the number is what identifies our own invoices.
  const issuerIdRaw = formData.get("issuerId");
  const issuerId = typeof issuerIdRaw === "string" && issuerIdRaw.length > 0 ? issuerIdRaw : null;
  if (issuerId) {
    const index = await selfIssuedNumberIndex(issuerId);
    for (const row of preview.invoices) {
      const matches = index.get(normalizeInvoiceNumber(row.number)) ?? [];
      if (matches.length === 1) {
        row.willAdoptSelfIssued = true;
        row.warnings.push("Matches an invoice you issued yourself — it will be updated in place instead of adding a second record.");
      } else if (matches.length > 1) {
        row.warnings.push(
          `${matches.length} invoices you issued share this number, so none is updated — this row imports as a separate record.`
        );
      }
    }
  } else {
    preview.warnings.push("Select the issuer to see which rows match invoices you issued yourself.");
  }

  return { ok: true, preview };
}

async function getOrCreateOrganization(name: string): Promise<{ organizationId: string; clientId: string }> {
  const existing = await prisma.organization.findUnique({ where: { sourceName: name }, select: { id: true, clientId: true } });
  if (existing) return { organizationId: existing.id, clientId: existing.clientId };

  let client = await prisma.client.findFirst({ where: { name }, select: { id: true } });
  if (!client) {
    client = await prisma.client.create({ data: { name }, select: { id: true } });
  }
  const organization = await prisma.organization.create({
    data: {
      clientId: client.id,
      sourceName: name,
      legalName: name,
      isDefault: true,
    },
    select: { id: true, clientId: true },
  });
  return { organizationId: organization.id, clientId: organization.clientId };
}

function toNullableDecimal(value: string | null): string | null {
  return parseDecimal(value);
}

function toJson(value: Record<string, string | null>): Prisma.InputJsonValue {
  return value as Prisma.InputJsonObject;
}

/** Compare invoice numbers ignoring spacing and case, e.g. "BT.R.BIT  310". */
function normalizeInvoiceNumber(value: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toUpperCase();
}

/**
 * An invoice we issued ourselves is already in the CRM under a "manual-" key, so
 * the export describes a record we own and must update it instead of creating a
 * twin. Matched on the issuer plus the number we assigned from our own series —
 * safe precisely because we generated that number. An ambiguous match is left
 * alone, so the row imports separately rather than merging into the wrong invoice.
 */
async function selfIssuedNumberIndex(issuerId: string): Promise<Map<string, string[]>> {
  const candidates = await prisma.invoice.findMany({
    where: { selfIssued: true, issuerId, externalRecordId: { startsWith: "manual-" } },
    select: { id: true, number: true },
  });
  const index = new Map<string, string[]>();
  for (const candidate of candidates) {
    const key = normalizeInvoiceNumber(candidate.number);
    if (!key) continue;
    index.set(key, [...(index.get(key) ?? []), candidate.id]);
  }
  return index;
}

async function findSelfIssuedInvoice(number: string, issuerId: string): Promise<string | null> {
  const target = normalizeInvoiceNumber(number);
  if (!target) return null;
  const matches = (await selfIssuedNumberIndex(issuerId)).get(target) ?? [];
  return matches.length === 1 ? matches[0] : null;
}

async function upsertPreviewInvoice(
  row: InvoiceImportPreviewRow,
  userName: string,
  issuer: { id: string; name: string }
): Promise<string> {
  const importKey = `accounting:${issuer.id}:${row.workbookKind}:${row.sourceInvoiceId}`;
  let existing = await prisma.invoice.findUnique({
    where: { externalRecordId: importKey },
    select: { id: true },
  });

  // Safely migrate the old accounting:{number} key only when it belongs to this
  // exact source invoice. Never reconcile on invoice number alone.
  if (!existing) {
    const legacy = await prisma.invoice.findUnique({
      where: { externalRecordId: `accounting:${row.number}` },
      select: { id: true, externalRef: true, originalValues: true },
    });
    const originalValues =
      legacy?.originalValues && typeof legacy.originalValues === "object" && !Array.isArray(legacy.originalValues)
        ? (legacy.originalValues as Prisma.JsonObject)
        : null;
    const legacySourceId = clean(originalValues?.id_iesire) ?? clean(legacy?.externalRef);
    if (legacy && legacySourceId === row.sourceInvoiceId) existing = { id: legacy.id };
  }

  // Adopt the invoice we issued ourselves: it takes over the accounting key, so
  // every later import of this export updates it through the normal path.
  const adoptedId = existing ? null : await findSelfIssuedInvoice(row.number, issuer.id);
  if (adoptedId) existing = { id: adoptedId };

  // An adopted invoice keeps the organization it was created against (resolving it
  // by name here could point it at a freshly created duplicate) and its creator.
  const org = adoptedId ? null : await getOrCreateOrganization(row.organizationName);
  const ownership = org
    ? { organizationId: org.organizationId, clientId: org.clientId, createdByName: userName }
    : null;

  const data = {
    externalRecordId: importKey,
    externalRef: row.originalValues.id_iesire ?? row.originalValues.id_solicit ?? null,
    number: row.number,
    status: InvoiceStatus.GENERATA,
    servicesDescription: row.servicesPreview,
    amountRaw: row.totalAmount ? `${row.totalAmount} ${row.currency ?? ""}`.trim() : null,
    currency: row.currency,
    paymentTermDays: paymentTermDays(row.issueDate, row.originalValues.scadent),
    issueDate: toDate(row.issueDate),
    expectedInvoiceDate: null,
    paid: row.paid,
    totalAmount: toNullableDecimal(row.totalAmount),
    totalBaseAmount: toNullableDecimal(row.totalBaseAmount),
    vatAmount: toNullableDecimal(row.vatAmount),
    unpaidAmount: toNullableDecimal(row.unpaidAmount),
    totalRaw: row.totalAmount,
    invoiceInfo: row.invoiceInfo,
    originalValues: toJson(row.originalValues),
    issuerId: issuer.id,
    issuerName: issuer.name,
  };

  const invoice = await prisma.$transaction(async (tx) => {
    let saved: { id: string };
    if (existing) {
      saved = await tx.invoice.update({
        where: { id: existing.id },
        data: ownership ? { ...data, ...ownership } : data,
        select: { id: true },
      });
    } else if (ownership) {
      saved = await tx.invoice.create({ data: { ...data, ...ownership }, select: { id: true } });
    } else {
      throw new Error(`Invoice "${row.number}": no organization could be resolved.`);
    }

    // The export's articles replace ours, but per-line part numbers are ours to
    // keep: carry them over by position whenever the article count still matches.
    const previous = await tx.invoiceLine.findMany({
      where: { invoiceId: saved.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { partNumberId: true, partNumberCode: true, partNumberValues: true },
    });
    const keepPartNumbers = previous.length === row.lines.length;

    await tx.invoiceLine.deleteMany({ where: { invoiceId: saved.id } });
    if (row.lines.length > 0) {
      await tx.invoiceLine.createMany({
        data: row.lines.map((line, index) => ({
          invoiceId: saved.id,
          sourceLineKey: `${row.sourceInvoiceId}:${index + 1}`,
          serviceDescription: line.serviceDescription,
          textSupplement: line.textSupplement,
          unitOfMeasure: line.unitOfMeasure,
          quantity: toNullableDecimal(line.quantity),
          unitPrice: toNullableDecimal(line.unitPrice),
          value: toNullableDecimal(line.value),
          total: toNullableDecimal(line.total),
          originalValues: toJson(line.originalValues),
          partNumberId: keepPartNumbers ? previous[index].partNumberId : null,
          partNumberCode: keepPartNumbers ? previous[index].partNumberCode : null,
          partNumberValues: keepPartNumbers
            ? previous[index].partNumberValues ?? Prisma.JsonNull
            : Prisma.JsonNull,
        })),
      });
    }
    return saved;
  });
  return invoice.id;
}

export async function applyInvoiceWorkbookImportAction(
  formData: FormData
): Promise<Result<{ imported?: number; createdOrganizations?: number }>> {
  const user = await requireUser();
  if (!isAdmin(user)) return { error: "Only admins can import accounting invoice exports." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose an XLS/XLSX invoice file first." };
  if (!/\.(xls|xlsx)$/i.test(file.name)) return { error: "Only .xls and .xlsx files are supported." };
  const kind = inferWorkbookKind(file.name, pickedKind(formData));
  if (kind.error || !kind.kind) return { error: kind.error ?? "Could not detect invoice export type." };

  const issuerIdRaw = formData.get("issuerId");
  const issuerId = typeof issuerIdRaw === "string" && issuerIdRaw.length > 0 ? issuerIdRaw : undefined;
  if (!issuerId) return { error: "Select the issuer before importing invoices." };

  // Re-parse the uploaded workbook here instead of accepting the parsed preview
  // as an argument. Server Action arguments are serialized into an array, and a
  // large payload (e.g. a stringified preview) trips React's array-size guard
  // ("Maximum array nesting exceeded"). Files travel through the multipart path,
  // which is not subject to that limit, and re-parsing keeps the result identical.
  const existingOrganizations = await prisma.organization.findMany({ select: { sourceName: true } });
  const existingOrgNames = new Set(existingOrganizations.map((org) => org.sourceName.toLowerCase()));
  const buffer = Buffer.from(await file.arrayBuffer());
  const preview = parseWorkbook(buffer, file.name, kind.kind, existingOrgNames);

  const blockingErrors = [...preview.errors, ...preview.invoices.flatMap((row) => row.errors)];
  if (blockingErrors.length > 0) return { error: `Fix ${blockingErrors.length} import error(s) before applying.` };

  const issuer = await prisma.issuer.findUnique({ where: { id: issuerId }, select: { id: true, name: true } });
  if (!issuer) return { error: "Selected issuer no longer exists. Re-open the dialog and pick again." };

  let imported = 0;
  let createdOrganizations = 0;
  for (const row of preview.invoices) {
    if (!row.organizationName || !row.number) continue;
    const existedBefore = await prisma.organization.findUnique({ where: { sourceName: row.organizationName }, select: { id: true } });
    await upsertPreviewInvoice(row, user.name, issuer);
    if (!existedBefore) createdOrganizations++;
    imported++;
  }

  await logActivity({
    actorId: user.id,
    action: "invoice_imported",
    entity: "Invoice",
    meta: { fileName: preview.fileName, imported, createdOrganizations, issuer: issuer?.name ?? null },
  });
  revalidatePath("/invoices");
  revalidatePath("/organizations");
  return { ok: true, imported, createdOrganizations };
}
