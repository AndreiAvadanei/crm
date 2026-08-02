// Shared rules for blocking issue-time actions (XML download, accounting email,
// invoice generation) on invoices that still need manual monthly
// personalization. Kept free of `server-only`/prisma imports so the same
// messages and detection can be reused by client components (button tooltips).

export const PERSONALIZATION_BLOCK_MESSAGE =
  "This invoice needs personalization. Review and unmark it before it can be generated, emailed, or exported to XML.";

/** True when an invoice must be personalized before it can be issued. */
export function invoiceRequiresPersonalization(inv: { needsPersonalization?: boolean | null }): boolean {
  return inv.needsPersonalization === true;
}

/** Human-readable message for one or more blocked invoices. */
export function personalizationBlockMessage(labels: string[]): string {
  if (labels.length <= 1) return PERSONALIZATION_BLOCK_MESSAGE;
  return `${labels.length} selected invoices need personalization and can’t be issued yet: ${labels.join(", ")}. Review and unmark them first.`;
}
