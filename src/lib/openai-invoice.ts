import "server-only";
import OpenAI from "openai";

export interface ExtractedInvoice {
  invoiceNumber: string | null;
  invoiceTotal: string | null;
  invoiceDate: string | null;
}

/**
 * Extract the invoice number, total and issue date from a PDF using OpenAI.
 *
 * Mirrors the Make.com flow (pdf -> text -> structured extraction) but sends the
 * PDF straight to the model as a file input, so no separate pdf-to-text step is
 * needed. Returns nulls (never throws) when the key is missing or the call fails;
 * the caller still stores the file and advances the invoice.
 */
export async function extractInvoiceFromPdf(
  pdfBuffer: Buffer,
  filename: string
): Promise<ExtractedInvoice> {
  const empty: ExtractedInvoice = { invoiceNumber: null, invoiceTotal: null, invoiceDate: null };
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return empty;

  const model = process.env.OPENAI_MODEL || "gpt-4o";
  const client = new OpenAI({ apiKey });

  try {
    const response = await client.responses.create({
      model,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "You are an accountant at Bit Sentinel Security. Extract the following details " +
                "from the attached invoice PDF: invoice_number (series and number, e.g. 'BT.BIT 123'), " +
                "invoice_total (total amount invoiced for all services, e.g. '123.59') and " +
                "invoice_date (e.g. '01.01.2024'). If a value is missing, return an empty string.",
            },
            {
              type: "input_file",
              filename,
              file_data: `data:application/pdf;base64,${pdfBuffer.toString("base64")}`,
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "invoice_details",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              invoice_number: { type: "string", description: "Invoice series and number." },
              invoice_total: { type: "string", description: "Total amount invoiced." },
              invoice_date: { type: "string", description: "Invoice date." },
            },
            required: ["invoice_number", "invoice_total", "invoice_date"],
          },
        },
      },
    });

    const raw = response.output_text;
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      invoiceNumber: clean(parsed.invoice_number),
      invoiceTotal: clean(parsed.invoice_total),
      invoiceDate: clean(parsed.invoice_date),
    };
  } catch (err) {
    console.error("[openai-invoice] extraction failed:", err);
    return empty;
  }
}

function clean(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s || null;
}

/** Parse a money string like "1.234,56", "123.59 RON", "1,234.56" into a number. */
export function parseInvoiceTotal(raw: string | null): number | null {
  if (!raw) return null;
  // Keep digits and separators only.
  let s = raw.replace(/[^\d.,]/g, "");
  if (!s) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) {
    // Comma is the decimal separator (European): drop thousands dots, swap comma.
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    // Dot is the decimal separator: drop thousands commas.
    s = s.replace(/,/g, "");
  }
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/** Parse an invoice date that may be DD.MM.YYYY, DD/MM/YYYY, YYYY-MM-DD, etc. */
export function parseInvoiceDate(raw: string | null): Date | null {
  if (!raw) return null;
  const s = raw.trim();
  // DD.MM.YYYY or DD/MM/YYYY or DD-MM-YYYY
  const dmy = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    let year = Number(dmy[3]);
    if (year < 100) year += 2000;
    const d = new Date(Date.UTC(year, month - 1, day));
    return isNaN(d.getTime()) ? null : d;
  }
  // ISO / other parseable formats.
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
