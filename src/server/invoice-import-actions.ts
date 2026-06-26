"use server";

import { revalidatePath } from "next/cache";
import * as XLSX from "xlsx";
import { InvoiceStatus, Prisma } from "@/generated/prisma";
import { requireUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { isAdmin } from "@/lib/rbac";
import { logActivity } from "@/lib/activity";

type Result<T> = { ok?: boolean; error?: string } & T;
type InvoiceWorkbookKind = "ron" | "valuta";

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
  number: string;
  organizationName: string;
  organizationExists: boolean;
  willCreateOrganization: boolean;
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

const REQUIRED_COLUMNS = ["nr_iesire", "denumire", "data", "baza_tva", "tva", "neachitat", "denumire1"];

function inferWorkbookKind(fileName: string): { kind?: InvoiceWorkbookKind; error?: string } {
  const lower = fileName.toLowerCase();
  const hasRon = /\bron\b/.test(lower) || lower.includes("ron -") || lower.includes("- ron");
  const hasValuta = lower.includes("valuta");
  if (hasRon && hasValuta) return { error: "File name must identify only one export type: RON or valuta." };
  if (hasRon) return { kind: "ron" };
  if (hasValuta) return { kind: "valuta" };
  return { error: 'File name must include "ron" or "valuta" so the importer can validate the export type.' };
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
  if (kind === "valuta" && !headers.has("cod_valuta")) {
    errors.push('Valuta invoice exports must include the "cod_valuta" column.');
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
    const number = get(row, "nr_iesire");
    const organizationName = get(row, "denumire");
    const issueDateRaw = get(row, "data");
    const issueDate = parseDateIso(issueDateRaw);
    const rowErrors: string[] = [];
    const rowWarnings: string[] = [];

    if (!number) rowErrors.push("Missing nr_iesire.");
    if (!organizationName) rowErrors.push("Missing denumire.");
    if (!issueDateRaw) rowErrors.push("Missing data.");
    if (issueDateRaw && !issueDate) rowErrors.push(`Invalid data "${issueDateRaw}".`);

    const key = number || `row-${rowNumber}`;
    const originalValues = rawRecord(row);
    const line: InvoiceImportLinePreview = {
      rowNumber,
      serviceDescription: get(row, "denumire1"),
      textSupplement: get(row, "text_supl"),
      unitOfMeasure: normalizeUnit(get(row, "um")),
      quantity: parseDecimal(get(row, "cantitate")),
      unitPrice: parseDecimal(get(row, "pret_unitar")),
      value: parseDecimal(get(row, "valoare")),
      total: parseDecimal(get(row, "total1")),
      originalValues,
    };
    if (!line.serviceDescription) rowWarnings.push("Missing denumire1/service article.");

    const totalBaseAmount = parseDecimal(get(row, "baza_tva"));
    const vatAmount = parseDecimal(get(row, "tva"));
    const headerTotal = parseDecimal(get(row, "total"));
    const totalAmount = headerTotal && !isZero(headerTotal) ? headerTotal : totalBaseAmount;
    const unpaidAmount = parseDecimal(get(row, "neachitat"));
    const currency = normalizeCurrency(get(row, "cod_valuta"), fallbackCurrency);

    const organizationExists = organizationName ? existingOrgNames.has(organizationName.toLowerCase()) : false;
    const existing = groups.get(key);
    if (existing) {
      existing.lines.push(line);
      existing.articleCount = existing.lines.length;
      existing.servicesPreview = uniqueJoin(existing.lines.map((l) => l.serviceDescription));
      existing.textSupplement = uniqueJoin(existing.lines.map((l) => l.textSupplement));
      existing.errors.push(...rowErrors.map((e) => `Row ${rowNumber}: ${e}`));
      existing.warnings.push(...rowWarnings.map((e) => `Row ${rowNumber}: ${e}`));
      return;
    }

    groups.set(key, {
      importKey: `accounting:${key}`,
      number: number ?? key,
      organizationName: organizationName ?? "",
      organizationExists,
      willCreateOrganization: !!organizationName && !organizationExists,
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
  const kind = inferWorkbookKind(file.name);
  if (kind.error || !kind.kind) return { error: kind.error ?? "Could not detect invoice export type." };

  const existingOrganizations = await prisma.organization.findMany({ select: { sourceName: true } });
  const existingOrgNames = new Set(existingOrganizations.map((org) => org.sourceName.toLowerCase()));
  const buffer = Buffer.from(await file.arrayBuffer());
  const preview = parseWorkbook(buffer, file.name, kind.kind, existingOrgNames);
  if (preview.errors.length > 0) return { error: preview.errors.join(" ") };
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

async function upsertPreviewInvoice(
  row: InvoiceImportPreviewRow,
  userName: string,
  issuer: { id: string; name: string } | null
): Promise<string> {
  const org = await getOrCreateOrganization(row.organizationName);
  const existing =
    (await prisma.invoice.findUnique({ where: { externalRecordId: row.importKey }, select: { id: true } })) ??
    (await prisma.invoice.findFirst({ where: { number: row.number }, select: { id: true } }));

  const data = {
    externalRecordId: row.importKey,
    externalRef: row.originalValues.id_iesire ?? row.originalValues.id_solicit ?? null,
    number: row.number,
    status: InvoiceStatus.GENERATA,
    organizationId: org.organizationId,
    clientId: org.clientId,
    servicesDescription: row.servicesPreview,
    amountRaw: row.originalValues.val_val ? `${row.originalValues.val_val} ${row.currency ?? ""}`.trim() : row.totalAmount,
    currency: row.currency,
    paymentTermDays: paymentTermDays(row.issueDate, row.originalValues.scadent),
    issueDate: toDate(row.issueDate),
    expectedInvoiceDate: null,
    paid: row.paid,
    totalAmount: toNullableDecimal(row.totalAmount),
    totalBaseAmount: toNullableDecimal(row.totalBaseAmount),
    vatAmount: toNullableDecimal(row.vatAmount),
    unpaidAmount: toNullableDecimal(row.unpaidAmount),
    totalRaw: row.originalValues.total ?? row.totalAmount,
    invoiceInfo: row.invoiceInfo,
    originalValues: toJson(row.originalValues),
    createdByName: userName,
    // Only stamp the issuer when one was chosen for this import, so re-imports
    // without a selection don't wipe a previously-set issuer.
    ...(issuer ? { issuerId: issuer.id, issuerName: issuer.name } : {}),
  };

  const invoice = existing
    ? await prisma.invoice.update({ where: { id: existing.id }, data, select: { id: true } })
    : await prisma.invoice.create({ data, select: { id: true } });

  await prisma.invoiceLine.deleteMany({ where: { invoiceId: invoice.id } });
  if (row.lines.length > 0) {
    await prisma.invoiceLine.createMany({
      data: row.lines.map((line, index) => ({
        invoiceId: invoice.id,
        sourceLineKey: `${line.rowNumber}-${index + 1}`,
        serviceDescription: line.serviceDescription,
        textSupplement: line.textSupplement,
        unitOfMeasure: line.unitOfMeasure,
        quantity: toNullableDecimal(line.quantity),
        unitPrice: toNullableDecimal(line.unitPrice),
        value: toNullableDecimal(line.value),
        total: toNullableDecimal(line.total),
        originalValues: toJson(line.originalValues),
      })),
    });
  }
  return invoice.id;
}

export async function applyInvoiceWorkbookImportAction(
  payload: string,
  issuerId?: string
): Promise<Result<{ imported?: number; createdOrganizations?: number }>> {
  const user = await requireUser();
  if (!isAdmin(user)) return { error: "Only admins can import accounting invoice exports." };
  let preview: InvoiceImportPreview;
  try {
    preview = JSON.parse(payload) as InvoiceImportPreview;
  } catch {
    return { error: "The preview data is invalid. Re-run preview and try again." };
  }

  const blockingErrors = [...preview.errors, ...preview.invoices.flatMap((row) => row.errors)];
  if (blockingErrors.length > 0) return { error: `Fix ${blockingErrors.length} import error(s) before applying.` };

  let issuer: { id: string; name: string } | null = null;
  if (issuerId) {
    issuer = await prisma.issuer.findUnique({ where: { id: issuerId }, select: { id: true, name: true } });
    if (!issuer) return { error: "Selected issuer no longer exists. Re-open the dialog and pick again." };
  }

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
