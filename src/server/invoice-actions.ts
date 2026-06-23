"use server";

import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { InvoiceStatus } from "@/generated/prisma";
import { requireUser } from "@/lib/auth/guards";
import { canEditClient, isAdmin } from "@/lib/rbac";
import { logActivity } from "@/lib/activity";
import { sendEmail } from "@/lib/email";
import {
  DEFAULT_INVOICE_CURRENCY,
  DEFAULT_INVOICE_ISSUER,
  DEFAULT_INVOICE_PAYMENT_TERM,
  DEFAULT_INVOICE_STATUS,
  INVOICE_CURRENCY_OPTIONS,
  INVOICE_ISSUER_OPTIONS,
  INVOICE_PAYMENT_TERM_OPTIONS,
} from "@/lib/invoice-constants";

type Result = { ok?: boolean; error?: string; id?: string };

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

function parseIssuer(v: string | undefined): string {
  const issuer = v || DEFAULT_INVOICE_ISSUER;
  return (INVOICE_ISSUER_OPTIONS as readonly string[]).includes(issuer) ? issuer : DEFAULT_INVOICE_ISSUER;
}

function parseDate(v: string | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/** Build the column set shared by create/update from the form. */
async function invoiceData(formData: FormData) {
  const sale = await resolveDeal(str(formData, "salesId"));
  return {
    fields: {
      status: parseStatus(str(formData, "status")),
      dealId: sale.dealId,
      salesIdSnapshot: sale.salesId,
      servicesDescription: str(formData, "servicesDescription") ?? null,
      contractRef: str(formData, "contractRef") ?? null,
      amountRaw: str(formData, "amountRaw") ?? null,
      currency: parseCurrency(str(formData, "currency")),
      paymentTermDays: parsePaymentTerm(str(formData, "paymentTermDays")),
      expectedInvoiceDate: parseDate(str(formData, "expectedInvoiceDate")),
      issuerName: parseIssuer(str(formData, "issuerName")),
    },
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
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { clientId: true } });
  if (!org) return { error: "Organization not found." };
  if (!(await canEditOrgInvoices(user, org.clientId))) return { error: "Not allowed." };

  const { fields, saleMissing } = await invoiceData(formData);
  if (saleMissing) return { error: `No deal found for ${str(formData, "salesId")}.` };

  const invoice = await prisma.invoice.create({
    data: {
      externalRecordId: `manual-${crypto.randomUUID()}`,
      organizationId,
      clientId: org.clientId,
      createdByName: user.name,
      ...fields,
    },
  });
  await logActivity({
    actorId: user.id,
    action: "invoice_created",
    entity: "Invoice",
    entityId: invoice.id,
    meta: { number: invoice.number, organizationId },
  });
  revalidatePath("/invoices");
  if (org.clientId) revalidatePath(`/clients/${org.clientId}`);
  if (fields.salesIdSnapshot) revalidatePath(`/deals/${fields.salesIdSnapshot}`);
  return { ok: true, id: invoice.id };
}

export async function updateInvoiceAction(invoiceId: string, formData: FormData): Promise<Result> {
  const user = await requireUser();
  const existing = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, number: true, clientId: true, organizationId: true, organization: { select: { clientId: true } } },
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

  const { fields, saleMissing } = await invoiceData(formData);
  if (saleMissing) return { error: `No deal found for ${str(formData, "salesId")}.` };

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { organizationId, clientId, ...fields },
  });
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

function invoiceAmountText(totalAmount: unknown, amountRaw: string | null): string {
  if (amountRaw) return amountRaw;
  if (totalAmount == null) return "";
  return String(totalAmount);
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
  services: string | null;
  amount: string;
  currency: string | null;
  paymentTermDays: number | null;
}) {
  const isRefacere = (input.number ?? "").trim().length > 0;
  const titlePrefix = isRefacere ? "Refacere factura" : "Factura noua";
  const subject = `${titlePrefix} pentru ${input.organizationName}  pe ${input.issuerName ?? ""} REF-${input.id}-REF`;
  const existingInvoiceRow = isRefacere
    ? `<tr><td>Facturile despre care e vorba</td><td>${esc(input.number)}</td></tr>`
    : "";

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
                <td>Servicii</td>
                <td>${esc(input.services)}</td>
            </tr>
            <tr>
                <td>Suma</td>
                <td>${esc(input.amount)}</td>
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
        
        <p>Dacă ai nevoie de informații suplimentare, nu ezita să mă contactezi.</p>
        
        <p>Vă mulțumesc pentru colaborare!</p>
        
        <p>Cu stimă,<br>Andrei</p>
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
          taxId: true,
          regNumber: true,
          bankName: true,
          iban: true,
        },
      },
      client: { select: { id: true, name: true } },
      deal: { select: { salesId: true } },
    },
  });
  if (!inv) return { error: "Not found." };
  if (!(await canEditOrgInvoices(user, inv.clientId ?? inv.organization.clientId))) return { error: "Not allowed." };
  if (inv.status !== InvoiceStatus.IN_ASTEPTARE) return { error: "Only pending invoices can be generated." };
  const { subject, html } = renderBillingInvoiceEmail({
    id: inv.id,
    number: inv.number,
    organizationName: inv.organization.sourceName,
    issuerName: inv.issuerName,
    address: inv.organization.address,
    country: inv.organization.country,
    taxId: inv.organization.taxId,
    regNumber: inv.organization.regNumber,
    bankName: inv.organization.bankName,
    iban: inv.organization.iban,
    services: inv.servicesDescription,
    amount: invoiceAmountText(inv.totalAmount, inv.amountRaw),
    currency: inv.currency,
    paymentTermDays: inv.paymentTermDays,
  });

  await sendEmail({
    from: BILLING_EMAIL_FROM,
    to: BILLING_EMAIL_TO,
    cc: BILLING_EMAIL_CC,
    replyTo: BILLING_EMAIL_REPLY_TO,
    subject,
    html,
  });
  await prisma.invoice.update({ where: { id: invoiceId }, data: { status: InvoiceStatus.TRIMISA_LA_CONTABILITATE } });
  await logActivity({
    actorId: user.id,
    action: "invoice_generate_requested",
    entity: "Invoice",
    entityId: invoiceId,
    meta: {
      number: inv.number,
      organization: inv.organization.sourceName,
      client: inv.client?.name,
      salesId: inv.deal?.salesId ?? inv.salesIdSnapshot,
      from: BILLING_EMAIL_FROM,
      to: parseRecipients(BILLING_EMAIL_TO),
      cc: parseRecipients(BILLING_EMAIL_CC),
      replyTo: BILLING_EMAIL_REPLY_TO,
      subject,
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
