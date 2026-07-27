import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/db";
import { InvoiceStatus, Prisma } from "@/generated/prisma";
import { saveFile } from "@/lib/storage";
import { logActivity } from "@/lib/activity";
import { getInvoiceWebhookSecret } from "@/lib/settings";
import { extractInvoiceFromPdf, parseInvoiceDate, parseInvoiceTotal } from "@/lib/openai-invoice";
import { splitGrossTotal } from "@/lib/invoice-totals";
import { resolveInvoiceVatPercent } from "@/lib/invoice-vat";

export const runtime = "nodejs";
// Inbound PDFs are base64 in the JSON body — allow a generous time budget for
// storage + per-file OpenAI extraction.
export const maxDuration = 300;

interface IncomingFile {
  name?: string;
  contentType?: string;
  size?: number;
  contentBase64?: string;
}

interface Payload {
  invoiceId?: string;
  shortCode?: string;
  gmailMessageId?: string;
  initiatedByEmail?: string;
  files?: IncomingFile[];
}

/** Constant-time secret comparison that tolerates differing lengths. */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Pull the presented secret from common header/query locations. */
function presentedSecret(req: NextRequest): string | null {
  const header = req.headers.get("x-webhook-secret");
  if (header) return header.trim();
  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const query = req.nextUrl.searchParams.get("secret");
  return query ? query.trim() : null;
}

/** Append new download URLs to the existing free-text documents field, deduped. */
function mergeFileUrls(existing: string | null, added: string[]): string {
  const prev = (existing ?? "")
    .split(/[\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const set = new Set(prev);
  for (const url of added) set.add(url);
  return Array.from(set).join("\n");
}

export async function POST(req: NextRequest) {
  // Auth — reject unless a secret is configured (Admin → Settings) and matches.
  const expected = await getInvoiceWebhookSecret();
  if (!expected) return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  const provided = presentedSecret(req);
  if (!provided || !secretMatches(provided, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const ref = body.invoiceId?.trim();
  if (!ref) return NextResponse.json({ error: "Missing invoiceId" }, { status: 400 });

  // The CRM emits REF-<Invoice.id>-REF; also accept the import keys as a fallback.
  const invoice = await prisma.invoice.findFirst({
    where: { OR: [{ id: ref }, { externalRecordId: ref }, { externalRef: ref }] },
    include: { organization: { select: { clientId: true, sourceName: true, country: true, tvaPercent: true } } },
  });
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

  const incoming = (body.files ?? []).filter((f) => f.contentBase64);
  if (incoming.length === 0) {
    return NextResponse.json({ error: "No files" }, { status: 400 });
  }

  // 1. Persist each PDF locally + create an InvoiceFile row.
  const stored: { id: string; filename: string; buffer: Buffer }[] = [];
  for (const f of incoming) {
    const filename = f.name || "invoice.pdf";
    const buffer = Buffer.from(f.contentBase64 as string, "base64");
    const { storageKey, size } = await saveFile(buffer, filename);
    const rec = await prisma.invoiceFile.create({
      data: {
        invoiceId: invoice.id,
        filename,
        mimeType: f.contentType || "application/pdf",
        size,
        storageKey,
        source: "email-reply",
      },
    });
    stored.push({ id: rec.id, filename, buffer });
  }

  // 2. Extract number/total/date from each PDF via OpenAI (best-effort).
  const numbers: string[] = [];
  const totals: string[] = [];
  const dates: string[] = [];
  for (const s of stored) {
    const ex = await extractInvoiceFromPdf(s.buffer, s.filename);
    if (ex.invoiceNumber) numbers.push(ex.invoiceNumber);
    if (ex.invoiceTotal) totals.push(ex.invoiceTotal);
    if (ex.invoiceDate) dates.push(ex.invoiceDate);
  }

  // 3. Build the authenticated download links + update the invoice.
  const base = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
  const downloadUrls = stored.map((s) => `${base}/api/invoices/files/${s.id}`);

  const data: Prisma.InvoiceUpdateInput = {
    status: InvoiceStatus.GENERATA,
    fileUrls: mergeFileUrls(invoice.fileUrls, downloadUrls),
  };
  if (numbers.length) data.number = numbers.join("\n");
  const parsedTotal = parseInvoiceTotal(totals[0] ?? null);
  if (parsedTotal != null) {
    // The PDF total is the authoritative gross amount. Split it back into base +
    // VAT at the client's rate so the stored breakdown stays consistent
    // (base + VAT = total), and refresh the outstanding amount when unpaid.
    const vatPercent = resolveInvoiceVatPercent(invoice, invoice.organization);
    const split = splitGrossTotal(parsedTotal, vatPercent);
    data.totalAmount = new Prisma.Decimal(split.total);
    data.totalBaseAmount = new Prisma.Decimal(split.base);
    data.vatAmount = new Prisma.Decimal(split.vat);
    data.totalRaw = totals[0];
    if (!invoice.paid) data.unpaidAmount = new Prisma.Decimal(split.total);
  }
  const parsedDate = parseInvoiceDate(dates[0] ?? null);
  if (parsedDate) data.issueDate = parsedDate;

  await prisma.invoice.update({ where: { id: invoice.id }, data });

  await logActivity({
    action: "invoice_files_received",
    entity: "Invoice",
    entityId: invoice.id,
    meta: {
      number: numbers.join(", ") || invoice.number,
      organization: invoice.organization.sourceName,
      fileCount: stored.length,
      gmailMessageId: body.gmailMessageId,
      extractedTotal: totals[0] ?? null,
      extractedDate: dates[0] ?? null,
    },
  });

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoice.id}`);
  if (invoice.clientId) revalidatePath(`/clients/${invoice.clientId}`);
  if (invoice.salesIdSnapshot) revalidatePath(`/deals/${invoice.salesIdSnapshot}`);

  return NextResponse.json({
    ok: true,
    invoiceId: invoice.id,
    status: InvoiceStatus.GENERATA,
    files: stored.map((s, i) => ({ id: s.id, filename: s.filename, url: downloadUrls[i] })),
    extracted: { number: numbers, total: totals, date: dates },
  });
}
