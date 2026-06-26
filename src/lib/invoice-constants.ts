// Client-safe invoice constants/types (no `server-only`, no prisma client
// imports) so they can be used from both client components and server code.

export const INVOICE_STATUS_LABELS = {
  GENERATA: "Generated",
  TRIMISA_LA_CONTABILITATE: "Sent to accounting",
  IN_ASTEPTARE: "Pending",
  OTHER: "Other",
} as const;

export type InvoiceStatusKey = keyof typeof INVOICE_STATUS_LABELS;

/** Badge color per status. Green (success) marks a fully generated invoice. */
export function invoiceStatusVariant(
  status: string
): "default" | "success" | "warning" | "secondary" {
  switch (status) {
    case "GENERATA":
      return "success";
    case "TRIMISA_LA_CONTABILITATE":
      return "default";
    case "IN_ASTEPTARE":
      return "warning";
    default:
      return "secondary";
  }
}

export const INVOICE_STATUS_OPTIONS = [
  { value: "IN_ASTEPTARE", label: "Pending" },
  { value: "GENERATA", label: "Generated" },
  { value: "TRIMISA_LA_CONTABILITATE", label: "Sent to accounting" },
  { value: "OTHER", label: "Other" },
] as const;

export const INVOICE_CURRENCY_OPTIONS = ["RON", "EUR", "USD"] as const;
export const INVOICE_PAYMENT_TERM_OPTIONS = [10, 20, 30, 60, 90, 120] as const;
export const INVOICE_ISSUER_OPTIONS = ["BIT SENTINEL SECURITY SRL", "CYBEREDU SRL"] as const;

export const DEFAULT_INVOICE_STATUS = "IN_ASTEPTARE";
export const DEFAULT_INVOICE_CURRENCY = "RON";
export const DEFAULT_INVOICE_PAYMENT_TERM = 10;
export const DEFAULT_INVOICE_ISSUER = "BIT SENTINEL SECURITY SRL";
