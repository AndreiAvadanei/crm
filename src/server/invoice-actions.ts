"use server";

import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { InvoiceStatus, Prisma } from "@/generated/prisma";
import { requireUser } from "@/lib/auth/guards";
import { canEditClient, isAdmin } from "@/lib/rbac";
import { logActivity } from "@/lib/activity";
import { sendEmail } from "@/lib/email";
import { buildInvoiceSagaXml } from "@/lib/invoice-saga";
import { assignInvoiceNumber } from "@/lib/invoice-numbering";
import { computeInvoiceTotals, lineNetValue, round2, type LineAmountInput } from "@/lib/invoice-totals";
import { resolveOrgVatPercent, resolveInvoiceVatPercent, parseVatPercentInput, inferVatPercentFromAmounts } from "@/lib/invoice-vat";
import {
  DEFAULT_INVOICE_CURRENCY,
  DEFAULT_INVOICE_ISSUER,
  DEFAULT_INVOICE_PAYMENT_TERM,
  DEFAULT_INVOICE_STATUS,
  INVOICE_CURRENCY_OPTIONS,
  INVOICE_PAYMENT_TERM_OPTIONS,
} from "@/lib/invoice-constants";

type Result = { ok?: boolean; error?: string; id?: string };
type InvoiceLineInput = {
  serviceDescription?: string;
  textSupplement?: string;
  unitOfMeasure?: string;
  quantity?: string | null;
  unitPrice?: string | null;
  value?: string | null;
  total?: string | null;
};

const BILLING_EMAIL_FROM = "billing@bit-sentinel.com";
const BILLING_EMAIL_TO = "romeo200564ro@gmail.com";
const BILLING_EMAIL_CC = "andrei@bit-sentinel.com";
const BILLING_EMAIL_REPLY_TO = "billing@bit-sentinel.com";

function str(fd: FormData, k: string) {
  const v = fd.get(k);
  return v == null ? undefined : String(v).trim() || undefined;
}

function parseStatus(v: string | undefined): InvoiceStatus {
  if (v && (Object.values(InvoiceStatus) as string[]).includes(v)) return v as InvoiceStatus;
  return DEFAULT_INVOICE_STATUS;
}

/** Resolve a SAL id (e.g. "SAL-1234") to a deal id, or null when blank/not found. */
async function resolveDeal(salesIdRaw: string | undefined): Promise<{ dealId: string | null; salesId: string | null; missing: boolean }> {
  const salesId = salesIdRaw?.toUpperCase() || null;
  if (!salesId) return { dealId: null, salesId: null, missing: false };
  const deal = await prisma.deal.findUnique({ where: { salesId }, select: { id: true } });
  return { dealId: deal?.id ?? null, salesId, missing: !deal };
}

function parseCurrency(v: string | undefined): string {
  const currency = (v || DEFAULT_INVOICE_CURRENCY).toUpperCase();
  return (INVOICE_CURRENCY_OPTIONS as readonly string[]).includes(currency) ? currency : DEFAULT_INVOICE_CURRENCY;
}

function parsePaymentTerm(v: string | undefined): number {
  const days = Number(v ?? DEFAULT_INVOICE_PAYMENT_TERM);
  return (INVOICE_PAYMENT_TERM_OPTIONS as readonly number[]).includes(days) ? days : DEFAULT_INVOICE_PAYMENT_TERM;
}

/**
 * Resolve the seller/issuer for an invoice. Prefers a configured Issuer (by id),
 * falling back to free-text issuerName for legacy/manual entries. Returns both the
 * link id and the canonical name kept on the invoice for filtering/totals.
 */
async function resolveIssuer(issuerId: string | undefined, issuerName: string | undefined): Promise<{ issuerId: string | null; issuerName: string }> {
  if (issuerId) {
    const issuer = await prisma.issuer.findUnique({ where: { id: issuerId }, select: { id: true, name: true } });
    if (issuer) return { issuerId: issuer.id, issuerName: issuer.name };
  }
  return { issuerId: null, issuerName: issuerName?.trim() || DEFAULT_INVOICE_ISSUER };
}

function parseDate(v: string | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/** Resolve the chosen part number, ignoring stale/unknown ids. */
async function resolvePartNumber(
  idRaw: string | undefined,
  valuesRaw: string | undefined,
  codeRaw: string | undefined
): Promise<{ partNumberId: string | null; partNumberCode: string | null; partNumberValues: Prisma.InputJsonValue | typeof Prisma.DbNull }> {
  const id = idRaw || null;
  if (!id) return { partNumberId: null, partNumberCode: null, partNumberValues: Prisma.DbNull };
  const pn = await prisma.partNumber.findUnique({ where: { id }, select: { id: true } });
  if (!pn) return { partNumberId: null, partNumberCode: null, partNumberValues: Prisma.DbNull };
  let values: Prisma.InputJsonValue | typeof Prisma.DbNull = Prisma.DbNull;
  if (valuesRaw) {
    try {
      const parsed = JSON.parse(valuesRaw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) values = parsed as Prisma.InputJsonObject;
    } catch {
      values = Prisma.DbNull;
    }
  }
  return { partNumberId: pn.id, partNumberCode: codeRaw || null, partNumberValues: values };
}

/** Resolve the chosen number series id, ignoring stale/unknown ids. */
async function resolveSeries(idRaw: string | undefined): Promise<string | null> {
  const id = idRaw || null;
  if (!id) return null;
  const series = await prisma.invoiceSeries.findUnique({ where: { id }, select: { id: true } });
  return series ? series.id : null;
}

/** Resolve a related invoice link, ignoring unknown ids and self-references. */
async function resolveRelatedInvoice(idRaw: string | undefined, selfId?: string): Promise<string | null> {
  const id = idRaw || null;
  if (!id || id === selfId) return null;
  const found = await prisma.invoice.findUnique({ where: { id }, select: { id: true } });
  return found ? found.id : null;
}

function parseBool(v: string | undefined): boolean {
  return v === "1" || v === "true" || v === "on";
}

function parseDecimal(v: string | null | undefined): string | null {
  if (!v) return null;
  let s = v.trim().replace(/\s+/g, "");
  if (!s) return null;
  if (s.includes(",") && !s.includes(".")) s = s.replace(",", ".");
  if (s.includes(",") && s.includes(".")) s = s.replace(/,/g, "");
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(4).replace(/\.?0+$/, "");
}

function parseInvoiceLines(formData: FormData): InvoiceLineInput[] {
  const raw = str(formData, "linesJson");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as InvoiceLineInput[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((line) => ({
        serviceDescription: line.serviceDescription?.trim() || undefined,
        textSupplement: line.textSupplement?.trim() || undefined,
        unitOfMeasure: line.unitOfMeasure?.trim().toLowerCase() || undefined,
        quantity: parseDecimal(line.quantity),
        unitPrice: parseDecimal(line.unitPrice),
        value: parseDecimal(line.value),
        total: parseDecimal(line.total),
      }))
      .filter((line) =>
        Boolean(line.serviceDescription || line.textSupplement || line.unitOfMeasure || line.quantity || line.unitPrice || line.value || line.total)
      );
  } catch {
    return [];
  }
}

/** Net value (before VAT) of a parsed line, defaulting quantity to 1. */
function lineNet(line: InvoiceLineInput): number {
  return lineNetValue(line as LineAmountInput);
}

type LineAmountFingerprint = { quantity: string | null; unitPrice: string | null; value: string | null };

function lineAmountFingerprint(line: {
  quantity?: string | null | unknown;
  unitPrice?: string | null | unknown;
  value?: string | null | unknown;
}): LineAmountFingerprint {
  const q = line.quantity == null ? null : String(line.quantity);
  const up = line.unitPrice == null ? null : String(line.unitPrice);
  const v = line.value == null ? null : String(line.value);
  return {
    quantity: parseDecimal(q),
    unitPrice: parseDecimal(up),
    value: parseDecimal(v),
  };
}

function lineAmountFingerprintsEqual(a: LineAmountFingerprint, b: LineAmountFingerprint): boolean {
  return a.quantity === b.quantity && a.unitPrice === b.unitPrice && a.value === b.value;
}

function linesFinancialFingerprint(
  lines: Array<{ quantity?: unknown; unitPrice?: unknown; value?: unknown }>
): string {
  return JSON.stringify(lines.map((line) => lineAmountFingerprint(line)));
}

function storedVatPercent(invoice: {
  vatPercent: unknown;
  totalBaseAmount: unknown;
  vatAmount: unknown;
}): number | null {
  if (invoice.vatPercent != null) {
    const n = Number(invoice.vatPercent);
    if (Number.isFinite(n)) return n;
  }
  const base = invoice.totalBaseAmount == null ? null : Number(invoice.totalBaseAmount);
  const vat = invoice.vatAmount == null ? null : Number(invoice.vatAmount);
  return inferVatPercentFromAmounts(base, vat);
}

/** True when article amounts or the invoice VAT % changed — totals should be recomputed. */
function invoiceFinancialsChanged(
  existing: {
    vatPercent: unknown;
    totalBaseAmount: unknown;
    vatAmount: unknown;
    lines: Array<{ quantity: unknown; unitPrice: unknown; value: unknown }>;
  },
  incomingLines: InvoiceLineInput[],
  incomingVatPercent: number
): boolean {
  const prevVat = storedVatPercent(existing);
  if (prevVat != null && round2(prevVat) !== round2(incomingVatPercent)) return true;
  return linesFinancialFingerprint(existing.lines) !== linesFinancialFingerprint(incomingLines);
}

type ExistingLineRow = {
  quantity: unknown;
  unitPrice: unknown;
  value: unknown;
  total: unknown;
};

/**
 * Replace an invoice's lines. When `preserveFrom` is set and a line's amounts
 * match the previous row at the same index, keep the stored value/total.
 */
async function writeInvoiceLines(
  invoiceId: string,
  lines: InvoiceLineInput[],
  vatPercent: number,
  preserveFrom?: ExistingLineRow[]
) {
  await prisma.invoiceLine.deleteMany({ where: { invoiceId } });
  if (lines.length === 0) return;
  await prisma.invoiceLine.createMany({
    data: lines.map((line, index) => {
      const preserved = preserveFrom?.[index];
      if (
        preserved &&
        lineAmountFingerprintsEqual(lineAmountFingerprint(line), lineAmountFingerprint(preserved))
      ) {
        return {
          invoiceId,
          sourceLineKey: `manual-${index + 1}`,
          serviceDescription: line.serviceDescription ?? null,
          textSupplement: line.textSupplement ?? null,
          unitOfMeasure: line.unitOfMeasure ?? null,
          quantity: preserved.quantity == null ? null : (preserved.quantity as Prisma.Decimal | string | number),
          unitPrice: preserved.unitPrice == null ? null : (preserved.unitPrice as Prisma.Decimal | string | number),
          value: preserved.value == null ? null : (preserved.value as Prisma.Decimal | string | number),
          total: preserved.total == null ? null : (preserved.total as Prisma.Decimal | string | number),
        };
      }
      const net = lineNet(line);
      const hasAmount = line.value != null || line.unitPrice != null;
      return {
        invoiceId,
        sourceLineKey: `manual-${index + 1}`,
        serviceDescription: line.serviceDescription ?? null,
        textSupplement: line.textSupplement ?? null,
        unitOfMeasure: line.unitOfMeasure ?? null,
        quantity: line.quantity ?? null,
        unitPrice: line.unitPrice ?? null,
        value: hasAmount ? round2(net) : line.value ?? null,
        total: hasAmount ? round2(net * (1 + vatPercent / 100)) : null,
      };
    }),
  });
}

function clampInt(v: string | undefined, def: number, min: number, max: number): number {
  const n = Number.parseInt(v ?? "", 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

/** Shift a date by N months, keeping the day-of-month (clamped to month length). */
function addMonthsKeepDay(base: Date, months: number): Date {
  const d = new Date(base);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, daysInMonth));
  return d;
}

/** Build the column set shared by create/update from the form. */
async function invoiceData(formData: FormData, selfId?: string) {
  const sale = await resolveDeal(str(formData, "salesId"));
  const lines = parseInvoiceLines(formData);
  // Services text is derived from the article lines (the source of truth).
  const servicesDescription =
    lines
      .map((line) => line.serviceDescription)
      .filter(Boolean)
      .join("\n") || null;
  const issuer = await resolveIssuer(str(formData, "issuerId"), str(formData, "issuerName"));
  const partNumber = await resolvePartNumber(
    str(formData, "partNumberId"),
    str(formData, "partNumberValues"),
    str(formData, "partNumberCode")
  );
  const relatedInvoiceId = await resolveRelatedInvoice(str(formData, "relatedInvoiceId"), selfId);
  const selfIssued = parseBool(str(formData, "selfIssued"));
  // A series only matters when we issue the invoice ourselves; otherwise the
  // accounting firm generates it and assigns the number.
  const seriesId = selfIssued ? await resolveSeries(str(formData, "seriesId")) : null;
  return {
    fields: {
      status: parseStatus(str(formData, "status")),
      dealId: sale.dealId,
      salesIdSnapshot: sale.salesId,
      servicesDescription,
      contractRef: str(formData, "contractRef") ?? null,
      currency: parseCurrency(str(formData, "currency")),
      paymentTermDays: parsePaymentTerm(str(formData, "paymentTermDays")),
      expectedInvoiceDate: parseDate(str(formData, "expectedInvoiceDate")),
      issuerName: issuer.issuerName,
      issuerId: issuer.issuerId,
      partNumberId: partNumber.partNumberId,
      partNumberCode: partNumber.partNumberCode,
      partNumberValues: partNumber.partNumberValues,
      relatedInvoiceId,
      selfIssued,
      seriesId,
      paid: parseBool(str(formData, "paid")),
    },
    lines,
    saleMissing: sale.missing,
  };
}

/** Billing permission: admins always; otherwise the org's owning client must be editable. */
async function canEditOrgInvoices(user: Parameters<typeof canEditClient>[0], clientId: string | null): Promise<boolean> {
  if (isAdmin(user)) return true;
  if (!clientId) return false;
  return canEditClient(user, clientId);
}

export async function createInvoiceAction(formData: FormData): Promise<Result> {
  const user = await requireUser();
  const organizationId = str(formData, "organizationId");
  if (!organizationId) return { error: "Organization is required." };
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { clientId: true, country: true, tvaPercent: true },
  });
  if (!org) return { error: "Organization not found." };
  if (!(await canEditOrgInvoices(user, org.clientId))) return { error: "Not allowed." };

  const { fields, lines, saleMissing } = await invoiceData(formData);
  if (saleMissing) return { error: `No deal found for ${str(formData, "salesId")}.` };

  // Articles are the source of truth: roll them up into base / VAT / total.
  const orgDefaultVat = resolveOrgVatPercent(org);
  const vatPercent = parseVatPercentInput(str(formData, "vatPercent"), orgDefaultVat);
  const totals = computeInvoiceTotals(lines, vatPercent);
  const amountFields = {
    vatPercent,
    totalBaseAmount: totals.base,
    vatAmount: totals.vat,
    totalAmount: totals.total,
    unpaidAmount: fields.paid ? 0 : totals.total,
  };

  // Recurrence: create N invoices with identical data but the expected invoice
  // date shifted by `intervalMonths` each time (day kept, month/year change).
  const recurrent = parseBool(str(formData, "recurrent"));
  const repetitions = clampInt(str(formData, "repetitions"), 12, 1, 60);
  const intervalMonths = clampInt(str(formData, "intervalMonths"), 1, 1, 24);
  const baseExpected = fields.expectedInvoiceDate;
  const count = recurrent && baseExpected ? repetitions : 1;

  let firstId = "";
  for (let k = 0; k < count; k++) {
    const expectedInvoiceDate = baseExpected ? addMonthsKeepDay(baseExpected, k * intervalMonths) : null;
    const invoice = await prisma.invoice.create({
      data: {
        externalRecordId: `manual-${crypto.randomUUID()}`,
        organizationId,
        clientId: org.clientId,
        createdByName: user.name,
        ...fields,
        ...amountFields,
        expectedInvoiceDate,
      },
    });
    await writeInvoiceLines(invoice.id, lines, vatPercent);
    if (k === 0) firstId = invoice.id;
  }

  await logActivity({
    actorId: user.id,
    action: "invoice_created",
    entity: "Invoice",
    entityId: firstId,
    meta: { organizationId, count },
  });
  revalidatePath("/invoices");
  if (org.clientId) revalidatePath(`/clients/${org.clientId}`);
  if (fields.salesIdSnapshot) revalidatePath(`/deals/${fields.salesIdSnapshot}`);
  return { ok: true, id: firstId };
}

export async function updateInvoiceAction(invoiceId: string, formData: FormData): Promise<Result> {
  const user = await requireUser();
  const existing = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      number: true,
      clientId: true,
      organizationId: true,
      paid: true,
      vatPercent: true,
      totalBaseAmount: true,
      vatAmount: true,
      totalAmount: true,
      unpaidAmount: true,
      organization: { select: { clientId: true } },
      lines: {
        orderBy: { createdAt: "asc" },
        select: { quantity: true, unitPrice: true, value: true, total: true },
      },
    },
  });
  if (!existing) return { error: "Not found." };
  if (!(await canEditOrgInvoices(user, existing.clientId ?? existing.organization.clientId))) return { error: "Not allowed." };

  // Optional re-assignment of organization.
  let organizationId = str(formData, "organizationId") ?? existing.organizationId;
  let clientId = existing.clientId;
  if (organizationId !== existing.organizationId) {
    const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { clientId: true } });
    if (!org) return { error: "Organization not found." };
    if (!(await canEditOrgInvoices(user, org.clientId))) return { error: "Not allowed for that organization." };
    clientId = org.clientId;
  }

  const { fields, lines, saleMissing } = await invoiceData(formData, invoiceId);
  if (saleMissing) return { error: `No deal found for ${str(formData, "salesId")}.` };

  const orgVat = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { country: true, tvaPercent: true },
  });
  const orgDefaultVat = orgVat ? resolveOrgVatPercent(orgVat) : 0;
  const vatPercent = parseVatPercentInput(str(formData, "vatPercent"), orgDefaultVat);
  const financialChanged = invoiceFinancialsChanged(existing, lines, vatPercent);

  const updateData: Prisma.InvoiceUncheckedUpdateInput = {
    organizationId,
    clientId,
    ...fields,
  };

  if (financialChanged) {
    const totals = computeInvoiceTotals(lines, vatPercent);
    Object.assign(updateData, {
      vatPercent,
      totalBaseAmount: totals.base,
      vatAmount: totals.vat,
      totalAmount: totals.total,
      unpaidAmount: fields.paid ? 0 : totals.total,
    });
  } else if (fields.paid !== existing.paid) {
    updateData.unpaidAmount = fields.paid
      ? 0
      : existing.totalAmount != null
        ? Number(existing.totalAmount)
        : existing.unpaidAmount != null
          ? Number(existing.unpaidAmount)
          : null;
  }

  await prisma.invoice.update({ where: { id: invoiceId }, data: updateData });
  await writeInvoiceLines(
    invoiceId,
    lines,
    financialChanged ? vatPercent : storedVatPercent(existing) ?? vatPercent,
    financialChanged ? undefined : existing.lines
  );
  await logActivity({
    actorId: user.id,
    action: "invoice_updated",
    entity: "Invoice",
    entityId: invoiceId,
    meta: { number: existing.number, organizationId },
  });
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  if (clientId) revalidatePath(`/clients/${clientId}`);
  if (fields.salesIdSnapshot) revalidatePath(`/deals/${fields.salesIdSnapshot}`);
  return { ok: true };
}

/** Inline toggle of the paid flag from the table or detail view. */
export async function setInvoicePaidAction(invoiceId: string, paid: boolean): Promise<Result> {
  const user = await requireUser();
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, number: true, clientId: true, salesIdSnapshot: true, organization: { select: { clientId: true } } },
  });
  if (!inv) return { error: "Not found." };
  if (!(await canEditOrgInvoices(user, inv.clientId ?? inv.organization.clientId))) return { error: "Not allowed." };

  await prisma.invoice.update({ where: { id: invoiceId }, data: { paid } });
  await logActivity({
    actorId: user.id,
    action: "invoice_updated",
    entity: "Invoice",
    entityId: invoiceId,
    meta: { number: inv.number, paid },
  });
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  if (inv.clientId) revalidatePath(`/clients/${inv.clientId}`);
  if (inv.salesIdSnapshot) revalidatePath(`/deals/${inv.salesIdSnapshot}`);
  return { ok: true };
}

/** Inline edit of the linked deal (SAL id) from the table. Empty clears it. */
export async function setInvoiceDealAction(invoiceId: string, salesId: string | null): Promise<Result> {
  const user = await requireUser();
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, number: true, clientId: true, salesIdSnapshot: true, organization: { select: { clientId: true } } },
  });
  if (!inv) return { error: "Not found." };
  if (!(await canEditOrgInvoices(user, inv.clientId ?? inv.organization.clientId))) return { error: "Not allowed." };

  const sale = await resolveDeal(salesId ?? undefined);
  if (sale.missing) return { error: `No deal found for ${salesId}.` };

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { dealId: sale.dealId, salesIdSnapshot: sale.salesId },
  });
  await logActivity({
    actorId: user.id,
    action: "invoice_updated",
    entity: "Invoice",
    entityId: invoiceId,
    meta: { number: inv.number, salesId: sale.salesId },
  });
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  if (inv.clientId) revalidatePath(`/clients/${inv.clientId}`);
  if (inv.salesIdSnapshot) revalidatePath(`/deals/${inv.salesIdSnapshot}`);
  if (sale.salesId) revalidatePath(`/deals/${sale.salesId}`);
  return { ok: true };
}

/** Inline edit of a free-text field (contract reference or services). */
export async function setInvoiceTextFieldAction(
  invoiceId: string,
  field: "contractRef" | "servicesDescription",
  value: string
): Promise<Result> {
  const user = await requireUser();
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, number: true, clientId: true, salesIdSnapshot: true, organization: { select: { clientId: true } } },
  });
  if (!inv) return { error: "Not found." };
  if (!(await canEditOrgInvoices(user, inv.clientId ?? inv.organization.clientId))) return { error: "Not allowed." };

  const trimmed = value.trim();
  await prisma.invoice.update({ where: { id: invoiceId }, data: { [field]: trimmed || null } });
  await logActivity({
    actorId: user.id,
    action: "invoice_updated",
    entity: "Invoice",
    entityId: invoiceId,
    meta: { number: inv.number, field },
  });
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  if (inv.clientId) revalidatePath(`/clients/${inv.clientId}`);
  if (inv.salesIdSnapshot) revalidatePath(`/deals/${inv.salesIdSnapshot}`);
  return { ok: true };
}

/** Inline edit of the expected invoice date (yyyy-mm-dd, or empty to clear). */
export async function setInvoiceExpectedDateAction(invoiceId: string, date: string | null): Promise<Result> {
  const user = await requireUser();
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, number: true, clientId: true, salesIdSnapshot: true, organization: { select: { clientId: true } } },
  });
  if (!inv) return { error: "Not found." };
  if (!(await canEditOrgInvoices(user, inv.clientId ?? inv.organization.clientId))) return { error: "Not allowed." };

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { expectedInvoiceDate: parseDate(date ?? undefined) },
  });
  await logActivity({
    actorId: user.id,
    action: "invoice_updated",
    entity: "Invoice",
    entityId: invoiceId,
    meta: { number: inv.number },
  });
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  if (inv.clientId) revalidatePath(`/clients/${inv.clientId}`);
  if (inv.salesIdSnapshot) revalidatePath(`/deals/${inv.salesIdSnapshot}`);
  return { ok: true };
}

function parseRecipients(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(/[,\n;]/).map((x) => x.trim()).filter(Boolean);
}

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type EmailArticle = {
  description: string;
  textSupplement: string;
  um: string;
  quantity: number;
  unitPrice: number | null;
  value: number;
  total: number;
};

function fmtMoney(value: number, currency: string | null): string {
  const code = (currency || "RON").toUpperCase();
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toFixed(2)} ${code}`.trim();
  }
}

function renderBillingInvoiceEmail(input: {
  id: string;
  number: string | null;
  organizationName: string;
  issuerName: string | null;
  address: string | null;
  country: string | null;
  taxId: string | null;
  regNumber: string | null;
  bankName: string | null;
  iban: string | null;
  articles: EmailArticle[];
  totals: { base: number; vat: number; total: number };
  vatPercent: number;
  currency: string | null;
  paymentTermDays: number | null;
  initiatedByName: string | null;
  initiatedByEmail: string | null;
}) {
  const isRefacere = (input.number ?? "").trim().length > 0;
  const titlePrefix = isRefacere ? "Refacere factura" : "Factura noua";
  const subject = `${titlePrefix} pentru ${input.organizationName}  pe ${input.issuerName ?? ""} REF-${input.id}-REF`;
  const existingInvoiceRow = isRefacere
    ? `<tr><td>Facturile despre care e vorba</td><td>${esc(input.number)}</td></tr>`
    : "";

  const articleRows = input.articles.length
    ? input.articles
        .map((a) => {
          const desc = a.textSupplement
            ? `${esc(a.description)}<br><span style="color:#888;font-size:12px;">${esc(a.textSupplement)}</span>`
            : esc(a.description);
          return `            <tr>
                <td>${desc}</td>
                <td>${esc(a.um)}</td>
                <td style="text-align:right;">${esc(a.quantity)}</td>
                <td style="text-align:right;">${a.unitPrice == null ? "" : esc(fmtMoney(a.unitPrice, input.currency))}</td>
                <td style="text-align:right;">${esc(fmtMoney(a.value, input.currency))}</td>
                <td style="text-align:right;">${esc(fmtMoney(a.total, input.currency))}</td>
            </tr>`;
        })
        .join("\n")
    : `            <tr><td colspan="6" style="color:#888;">Fără articole</td></tr>`;

  const articlesTable = `        <h2 style="font-size:16px;margin-top:24px;">Articole</h2>
        <table>
            <tr>
                <th>Descriere</th>
                <th>UM</th>
                <th style="text-align:right;">Cant.</th>
                <th style="text-align:right;">Preț unitar</th>
                <th style="text-align:right;">Valoare</th>
                <th style="text-align:right;">Total (cu TVA)</th>
            </tr>
${articleRows}
            <tr>
                <td colspan="5" style="text-align:right;"><strong>Total fără TVA</strong></td>
                <td style="text-align:right;">${esc(fmtMoney(input.totals.base, input.currency))}</td>
            </tr>
            <tr>
                <td colspan="5" style="text-align:right;"><strong>TVA (${esc(input.vatPercent)}%)</strong></td>
                <td style="text-align:right;">${esc(fmtMoney(input.totals.vat, input.currency))}</td>
            </tr>
            <tr>
                <td colspan="5" style="text-align:right;"><strong>Total de plată (cu TVA)</strong></td>
                <td style="text-align:right;"><strong>${esc(fmtMoney(input.totals.total, input.currency))}</strong></td>
            </tr>
        </table>`;

  const html = `<!DOCTYPE html>
<html lang="ro">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${esc(titlePrefix)} pentru ${esc(input.organizationName)}</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
        }
        .container {
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
        }
        h1 {
            color: #0066cc;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
        }
        th, td {
            border: 1px solid #ddd;
            padding: 8px;
            text-align: left;
        }
        th {
            background-color: #f2f2f2;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Solicitare ${isRefacere ? "refacere factură" : "creare factură"}</h1>
        
        
        <p>Te rog să ${isRefacere ? "refaci o" : "faci o"} factură pe baza următoarelor informații:</p>
        
        <table>
            <tr>
                <th>Câmp</th>
                <th>Valoare</th>
            </tr>
${existingInvoiceRow}
            <tr>
                <td>Companie (Client)</td>
                <td>${esc(input.organizationName)}</td>
            </tr>
            <tr>
                <td>Factura se face pe</td>
                <td>${esc(input.issuerName)}</td>
            </tr>
            <tr>
                <td>Adresa client</td>
                <td>${esc(input.address)}</td>
            </tr>
            <tr>
                <td>Țara</td>
                <td>${esc(input.country)}</td>
            </tr>
            <tr>
                <td>CUI</td>
                <td>${esc(input.taxId)}</td>
            </tr>
            <tr>
                <td>CUI</td>
                <td>${esc(input.regNumber)}</td>
            </tr>
            <tr>
                <td>Banca</td>
                <td>${esc(input.bankName)}</td>
            </tr>
            <tr>
                <td>IBAN</td>
                <td>${esc(input.iban)}</td>
            </tr>
            <tr>
                <td>Moneda</td>
                <td>${esc(input.currency)}</td>
            </tr>
            <tr>
                <td>Termen de plată</td>
                <td>${esc(input.paymentTermDays != null ? `${input.paymentTermDays} zile` : "")}</td>
            </tr>
            <tr>
                <td>Referință proiect</td>
                <td>REF-${esc(input.id)}-REF</td>
            </tr>
        </table>

${articlesTable}
        
        <p>Dacă ai nevoie de informații suplimentare, nu ezita să mă contactezi.</p>
        
        <p>Vă mulțumesc pentru colaborare!</p>
        
        <p>Cu stimă,<br>Andrei</p>

        <hr style="margin-top:24px;border:none;border-top:1px solid #ddd;">
        <p style="color:#888;font-size:12px;line-height:1.5;">
            Inițiată din platforma CRM de: ${esc(input.initiatedByName)}${input.initiatedByEmail ? ` (${esc(input.initiatedByEmail)})` : ""}<br>
            <span style="font-family:monospace;">[INVOICE-INITIATOR-NAME: ${esc(input.initiatedByName)}]</span><br>
            <span style="font-family:monospace;">[INVOICE-INITIATOR-EMAIL: ${esc(input.initiatedByEmail)}]</span><br>
            <span style="font-family:monospace;">[INVOICE-ID: ${esc(input.id)}]</span>
        </p>
    </div>
</body>
</html>`;

  return { subject, html };
}

export async function prepareGenerateInvoiceAction(invoiceId: string): Promise<Result> {
  const user = await requireUser();
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      organization: {
        select: {
          clientId: true,
          sourceName: true,
          address: true,
          country: true,
          tvaPercent: true,
          taxId: true,
          regNumber: true,
          bankName: true,
          iban: true,
        },
      },
      client: { select: { id: true, name: true } },
      deal: { select: { salesId: true } },
      lines: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!inv) return { error: "Not found." };
  if (!(await canEditOrgInvoices(user, inv.clientId ?? inv.organization.clientId))) return { error: "Not allowed." };
  if (inv.status !== InvoiceStatus.IN_ASTEPTARE) return { error: "Only pending invoices can be generated." };
  // Assign the next FacturaNumar from the series (no-op if already numbered).
  const assignedNumber = await assignInvoiceNumber(invoiceId);

  // Roll the articles up into the email's line table + totals.
  const vatPercent = resolveInvoiceVatPercent(inv, inv.organization);
  const emailArticles = inv.lines.map((line) => {
    const quantity = line.quantity == null ? 1 : Number(line.quantity);
    const unitPrice = line.unitPrice == null ? null : Number(line.unitPrice);
    const value = lineNetValue({ quantity: line.quantity as unknown as number, unitPrice: line.unitPrice as unknown as number, value: line.value as unknown as number });
    return {
      description: line.serviceDescription ?? "",
      textSupplement: line.textSupplement ?? "",
      um: line.unitOfMeasure ?? "buc",
      quantity,
      unitPrice,
      value: round2(value),
      total: round2(value * (1 + vatPercent / 100)),
    };
  });
  const emailTotals = computeInvoiceTotals(
    inv.lines.map((l) => ({ quantity: l.quantity as unknown as number, unitPrice: l.unitPrice as unknown as number, value: l.value as unknown as number })),
    vatPercent
  );

  const { subject, html } = renderBillingInvoiceEmail({
    id: inv.id,
    number: assignedNumber ?? inv.number,
    organizationName: inv.organization.sourceName,
    issuerName: inv.issuerName,
    address: inv.organization.address,
    country: inv.organization.country,
    taxId: inv.organization.taxId,
    regNumber: inv.organization.regNumber,
    bankName: inv.organization.bankName,
    iban: inv.organization.iban,
    articles: emailArticles,
    totals: emailTotals,
    vatPercent,
    currency: inv.currency,
    paymentTermDays: inv.paymentTermDays,
    initiatedByName: user.name,
    initiatedByEmail: user.email,
  });

  // Attach the Saga-import XML so accounting can import the invoice directly.
  let sagaXml: { filename: string; xml: string; warnings: string[] };
  try {
    sagaXml = await buildInvoiceSagaXml(invoiceId);
  } catch (err) {
    return { error: `Could not build the Saga XML: ${(err as Error).message}` };
  }

  await sendEmail({
    from: BILLING_EMAIL_FROM,
    to: BILLING_EMAIL_TO,
    cc: BILLING_EMAIL_CC,
    replyTo: BILLING_EMAIL_REPLY_TO,
    subject,
    html,
    attachments: [{ name: sagaXml.filename, content: sagaXml.xml, contentType: "application/xml" }],
  });
  await prisma.invoice.update({ where: { id: invoiceId }, data: { status: InvoiceStatus.TRIMISA_LA_CONTABILITATE } });
  await logActivity({
    actorId: user.id,
    action: "invoice_generate_requested",
    entity: "Invoice",
    entityId: invoiceId,
    meta: {
      number: assignedNumber ?? inv.number,
      organization: inv.organization.sourceName,
      client: inv.client?.name,
      salesId: inv.deal?.salesId ?? inv.salesIdSnapshot,
      from: BILLING_EMAIL_FROM,
      to: parseRecipients(BILLING_EMAIL_TO),
      cc: parseRecipients(BILLING_EMAIL_CC),
      replyTo: BILLING_EMAIL_REPLY_TO,
      subject,
      sagaXmlFile: sagaXml.filename,
      sagaWarnings: sagaXml.warnings.length ? sagaXml.warnings : undefined,
    },
  });
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  if (inv.clientId) revalidatePath(`/clients/${inv.clientId}`);
  if (inv.salesIdSnapshot) revalidatePath(`/deals/${inv.salesIdSnapshot}`);
  return { ok: true };
}

export async function deleteInvoiceAction(invoiceId: string): Promise<Result> {
  const user = await requireUser();
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, number: true, clientId: true, salesIdSnapshot: true, organization: { select: { clientId: true } } },
  });
  if (!inv) return { error: "Not found." };
  if (!(await canEditOrgInvoices(user, inv.clientId ?? inv.organization.clientId))) return { error: "Not allowed." };

  await prisma.invoice.delete({ where: { id: invoiceId } });
  await logActivity({
    actorId: user.id,
    action: "invoice_deleted",
    entity: "Invoice",
    entityId: invoiceId,
    meta: { number: inv.number },
  });
  revalidatePath("/invoices");
  if (inv.clientId) revalidatePath(`/clients/${inv.clientId}`);
  if (inv.salesIdSnapshot) revalidatePath(`/deals/${inv.salesIdSnapshot}`);
  return { ok: true };
}
