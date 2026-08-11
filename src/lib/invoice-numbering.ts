import "server-only";

import { prisma } from "@/lib/db";

/**
 * Assign a FacturaNumar to an invoice from its series, the first time it's
 * issued. Idempotent: returns the existing number untouched when one is already
 * set, and never increments the counter twice for the same invoice. Resolves the
 * invoice's explicit series, falling back to the default active series. Returns
 * the assigned/existing number, or null when there's no usable series.
 *
 * Only self-issued invoices get a number from our series; by default the
 * accounting firm generates the invoice and assigns the number, so we leave it
 * untouched (returns null).
 */
/**
 * Stamp the invoice date the first time an invoice goes to accounting. Dates are
 * stored at UTC midnight, like every other date in the app. Idempotent: an
 * invoice that already has a date keeps it, so re-sends (and the date later
 * extracted from the issued PDF) never move it.
 */
export async function assignInvoiceIssueDate(invoiceId: string, when: Date = new Date()): Promise<Date | null> {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { issueDate: true } });
  if (!invoice) return null;
  if (invoice.issueDate) return invoice.issueDate;
  const issueDate = new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate()));
  await prisma.invoice.update({ where: { id: invoiceId }, data: { issueDate } });
  return issueDate;
}

export async function assignInvoiceNumber(invoiceId: string): Promise<string | null> {
  return prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, number: true, seriesId: true, selfIssued: true },
    });
    if (!invoice) return null;
    if (invoice.number && invoice.number.trim()) return invoice.number;
    if (!invoice.selfIssued) return null;

    const series =
      (invoice.seriesId
        ? await tx.invoiceSeries.findUnique({ where: { id: invoice.seriesId } })
        : null) ??
      (await tx.invoiceSeries.findFirst({
        where: { isActive: true },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      }));
    if (!series || !series.isActive) return null;

    // Atomic increment: the UPDATE locks the row, so concurrent issues can't
    // grab the same number. The number we assign is the value before increment.
    const updated = await tx.invoiceSeries.update({
      where: { id: series.id },
      data: { nextNumber: { increment: 1 } },
      select: { prefix: true, nextNumber: true },
    });
    const assigned = updated.nextNumber - 1;
    const number = `${updated.prefix} ${assigned}`;
    await tx.invoice.update({ where: { id: invoiceId }, data: { number, seriesId: series.id } });
    return number;
  });
}
