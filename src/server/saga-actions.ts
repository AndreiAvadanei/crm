"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { InvoiceStatus } from "@/generated/prisma";
import { requireUser } from "@/lib/auth/guards";
import { canEditClient, isAdmin } from "@/lib/rbac";
import { logActivity } from "@/lib/activity";
import { sendEmail, renderEmailLayout } from "@/lib/email";
import { assignInvoiceNumber } from "@/lib/invoice-numbering";
import { buildInvoiceSagaXml, buildInvoicesSagaXml } from "@/lib/invoice-saga";

const BILLING_EMAIL_FROM = "billing@bit-sentinel.com";
const BILLING_EMAIL_TO = "romeo200564ro@gmail.com";
const BILLING_EMAIL_CC = "andrei@bit-sentinel.com";
const BILLING_EMAIL_REPLY_TO = "billing@bit-sentinel.com";

type XmlResult = { ok?: boolean; error?: string; filename?: string; xml?: string; warnings?: string[] };
type ActionResult = { ok?: boolean; error?: string; count?: number; warnings?: string[] };

type AuthUser = Awaited<ReturnType<typeof requireUser>>;

async function canEditOrgInvoices(user: AuthUser, clientId: string | null): Promise<boolean> {
  if (isAdmin(user)) return true;
  if (!clientId) return false;
  return canEditClient(user, clientId);
}

/** Authorize every id and return them, or throw with a friendly message. */
async function authorizeInvoices(user: AuthUser, invoiceIds: string[]) {
  const unique = Array.from(new Set(invoiceIds.filter(Boolean)));
  if (unique.length === 0) throw new Error("No invoices selected.");
  const invoices = await prisma.invoice.findMany({
    where: { id: { in: unique } },
    select: { id: true, clientId: true, status: true, organization: { select: { clientId: true } } },
  });
  if (invoices.length !== unique.length) throw new Error("Some invoices were not found.");
  for (const inv of invoices) {
    if (!(await canEditOrgInvoices(user, inv.clientId ?? inv.organization.clientId))) {
      throw new Error("Not allowed for one or more of the selected invoices.");
    }
  }
  return invoices;
}

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtAmount(value: unknown, currency: string | null): string {
  if (value == null) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${currency ?? ""}`.trim();
}

/** Build & download the Saga XML for one invoice (assigns its number if needed). */
export async function downloadInvoiceSagaXmlAction(invoiceId: string): Promise<XmlResult> {
  const user = await requireUser();
  try {
    await authorizeInvoices(user, [invoiceId]);
    await assignInvoiceNumber(invoiceId);
    const { filename, xml, warnings } = await buildInvoiceSagaXml(invoiceId);
    revalidatePath("/invoices");
    revalidatePath(`/invoices/${invoiceId}`);
    return { ok: true, filename, xml, warnings };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/** Build one combined <Facturi> file for several invoices (assigns numbers). */
export async function bulkDownloadInvoicesSagaXmlAction(invoiceIds: string[]): Promise<XmlResult> {
  const user = await requireUser();
  try {
    const invoices = await authorizeInvoices(user, invoiceIds);
    for (const inv of invoices) await assignInvoiceNumber(inv.id);
    const { filename, xml, warnings } = await buildInvoicesSagaXml(invoices.map((i) => i.id));
    revalidatePath("/invoices");
    return { ok: true, filename, xml, warnings };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/** Send a single compact accounting email for several invoices, with one combined XML attached. */
export async function bulkSendInvoicesEmailAction(invoiceIds: string[]): Promise<ActionResult> {
  const user = await requireUser();
  let authorized;
  try {
    authorized = await authorizeInvoices(user, invoiceIds);
  } catch (err) {
    return { error: (err as Error).message };
  }

  const ids = authorized.map((i) => i.id);
  for (const id of ids) await assignInvoiceNumber(id);

  let combined;
  try {
    combined = await buildInvoicesSagaXml(ids);
  } catch (err) {
    return { error: `Could not build the Saga XML: ${(err as Error).message}` };
  }

  // Load a compact summary for the email body (post-numbering).
  const rows = await prisma.invoice.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      number: true,
      currency: true,
      totalAmount: true,
      issuerName: true,
      organization: { select: { sourceName: true } },
    },
    orderBy: [{ issuerName: "asc" }, { number: "asc" }],
  });

  const tableRows = rows
    .map(
      (r) => `<tr>
        <td style="padding:6px 10px;border:1px solid #e5e7eb;font-family:monospace;">${esc(r.number || "(fără număr)")}</td>
        <td style="padding:6px 10px;border:1px solid #e5e7eb;">${esc(r.organization.sourceName)}</td>
        <td style="padding:6px 10px;border:1px solid #e5e7eb;">${esc(r.issuerName ?? "")}</td>
        <td style="padding:6px 10px;border:1px solid #e5e7eb;text-align:right;white-space:nowrap;">${esc(fmtAmount(r.totalAmount, r.currency))}</td>
      </tr>`
    )
    .join("");

  const body = `
    <p>Atașat găsiți fișierul XML pentru import în Saga, cu ${rows.length} ${rows.length === 1 ? "factură" : "facturi"}:</p>
    <table style="border-collapse:collapse;width:100%;font-size:13px;">
      <thead>
        <tr>
          <th style="padding:6px 10px;border:1px solid #e5e7eb;text-align:left;background:#f3f4f6;">Număr</th>
          <th style="padding:6px 10px;border:1px solid #e5e7eb;text-align:left;background:#f3f4f6;">Client</th>
          <th style="padding:6px 10px;border:1px solid #e5e7eb;text-align:left;background:#f3f4f6;">Emitent</th>
          <th style="padding:6px 10px;border:1px solid #e5e7eb;text-align:right;background:#f3f4f6;">Total</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>
    <p style="margin-top:16px;color:#6b7280;font-size:12px;">Inițiat din CRM de ${esc(user.name)}${user.email ? ` (${esc(user.email)})` : ""}.</p>`;

  const subject = `Import facturi Saga — ${rows.length} ${rows.length === 1 ? "factură" : "facturi"} (${new Date().toLocaleDateString("ro-RO")})`;
  const html = renderEmailLayout(`Import facturi Saga (${rows.length})`, body);

  try {
    await sendEmail({
      from: BILLING_EMAIL_FROM,
      to: BILLING_EMAIL_TO,
      cc: BILLING_EMAIL_CC,
      replyTo: BILLING_EMAIL_REPLY_TO,
      subject,
      html,
      attachments: [{ name: combined.filename, content: combined.xml, contentType: "application/xml" }],
    });
  } catch (err) {
    return { error: `Could not send the email: ${(err as Error).message}` };
  }

  // Move pending invoices to "sent to accounting".
  await prisma.invoice.updateMany({
    where: { id: { in: ids }, status: InvoiceStatus.IN_ASTEPTARE },
    data: { status: InvoiceStatus.TRIMISA_LA_CONTABILITATE },
  });

  await logActivity({
    actorId: user.id,
    action: "invoice_bulk_generate_requested",
    entity: "Invoice",
    entityId: ids[0],
    meta: { count: ids.length, ids, subject, sagaXmlFile: combined.filename },
  });

  revalidatePath("/invoices");
  return { ok: true, count: ids.length, warnings: combined.warnings };
}
