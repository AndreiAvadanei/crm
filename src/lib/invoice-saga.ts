import "server-only";

import { prisma } from "@/lib/db";
import { getBnrRonRate } from "@/lib/bnr";
import { countryCodeForName, countyCodeForName, isEuCountry, isRomania } from "@/lib/ro-geo";
import { resolveInvoiceVatPercent } from "@/lib/invoice-vat";
import { DEFAULT_INVOICE_ISSUER } from "@/lib/invoice-constants";
import {
  buildSagaFacturiXml,
  type SagaClient,
  type SagaInvoice,
  type SagaLine,
  type SagaSupplier,
} from "@/lib/saga-xml";

const invoiceInclude = {
  organization: true,
  issuer: true,
  lines: { orderBy: { createdAt: "asc" } },
} as const;

type LoadedInvoice = NonNullable<Awaited<ReturnType<typeof loadInvoice>>>;

function loadInvoice(id: string) {
  return prisma.invoice.findUnique({ where: { id }, include: invoiceInclude });
}

function dec(value: unknown): number {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Best-effort numeric extraction from a free-text amount, e.g. "2750 USD" -> 2750. */
function parseAmountText(text: string | null): number {
  if (!text) return 0;
  const m = text.replace(/\s+/g, "").replace(",", ".").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : 0;
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function trimNum(value: number): string {
  return String(Number(value.toFixed(6)));
}

function sanitizeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "factura";
}

function tara(countryName: string | null | undefined): string {
  const code = countryCodeForName(countryName);
  if (code) return code;
  const v = (countryName ?? "").trim();
  return v.length === 2 ? v.toUpperCase() : v;
}

function buildSupplier(invoice: LoadedInvoice, warnings: string[]): SagaSupplier {
  const issuer = invoice.issuer;
  if (!issuer) {
    warnings.push(
      "No configured issuer is linked to this invoice — supplier details (CIF, address, IBAN…) are blank. Pick a configured issuer and edit it in Settings → Invoice issuers."
    );
    return {
      nume: invoice.issuerName || DEFAULT_INVOICE_ISSUER,
      cif: "",
      capital: "",
      regCom: "",
      tara: "RO",
      localitate: "",
      judet: "",
      adresa: "",
      telefon: "",
      mail: "",
      banca: "",
      iban: "",
      infSupl: "",
    };
  }
  if (!issuer.taxId) warnings.push(`Issuer "${issuer.name}" has no tax id (CIF) set.`);
  return {
    nume: issuer.legalName || issuer.name,
    cif: issuer.taxId ?? "",
    capital: issuer.capital ?? "",
    regCom: issuer.regCom ?? "",
    tara: tara(issuer.country) || "RO",
    localitate: issuer.city ?? "",
    judet: isRomania(issuer.country) ? countyCodeForName(issuer.county) : issuer.county ?? "",
    adresa: issuer.address ?? "",
    telefon: issuer.phone ?? "",
    mail: issuer.email ?? "",
    banca: issuer.bankName ?? "",
    iban: issuer.iban ?? "",
    infSupl: issuer.infSupl ?? "",
  };
}

function buildClient(invoice: LoadedInvoice, isRo: boolean, warnings: string[]): SagaClient {
  const org = invoice.organization;
  const nume = org.legalName || org.sourceName;
  if (!org.taxId) warnings.push(`Client "${nume}" has no tax id (CIF) set.`);

  let adresa = org.adresa || org.address || "";
  // For foreign clients the județ field is left empty; keep any region text in the address.
  if (!isRo && org.judet) adresa = adresa ? `${adresa}, ${org.judet}` : org.judet;

  return {
    nume,
    infSupl: org.inf_supl || nume,
    cif: org.taxId ?? "",
    regCom: org.reg_com || org.regNumber || "",
    judet: isRo ? countyCodeForName(org.judet) : "",
    tara: tara(org.country || org.tara),
    localitate: org.localitate ?? "",
    adresa,
    banca: org.banca || org.bankName || "",
    iban: org.cont_banca || org.iban || "",
    telefon: org.tel ?? "",
    mail: org.email ?? "",
  };
}

function buildLines(
  invoice: LoadedInvoice,
  tvaRate: number,
  rate: number,
  contractCurrency: string
): SagaLine[] {
  const converted = rate !== 1;
  // Invoice-level part number is the default; each line may override it.
  const defaultCodArticol = invoice.partNumberCode || undefined;

  const source = invoice.lines.length
    ? invoice.lines.map((line) => {
        const quantity = line.quantity != null ? dec(line.quantity) : 1;
        const unitPrice = dec(line.unitPrice);
        const value = line.value != null ? dec(line.value) : quantity * unitPrice;
        return {
          descriere: line.serviceDescription || "",
          um: line.unitOfMeasure || "buc",
          quantity: quantity || 1,
          unitPrice,
          value,
          textSupplement: line.textSupplement || "",
          codArticol: line.partNumberCode || defaultCodArticol,
        };
      })
    : [
        {
          descriere: invoice.servicesDescription || "Servicii",
          um: "buc",
          quantity: 1,
          unitPrice: dec(invoice.totalAmount) || parseAmountText(invoice.amountRaw),
          value: dec(invoice.totalAmount) || parseAmountText(invoice.amountRaw),
          textSupplement: "",
          codArticol: defaultCodArticol,
        },
      ];

  return source.map((line) => {
    const pret = line.unitPrice * rate;
    const valoare = line.value * rate;
    const tva = (tvaRate / 100) * valoare;
    let infSupl = line.textSupplement;
    if (converted) {
      const note = `${trimNum(line.value)} ${contractCurrency} + TVA la cursul BNR ${trimNum(rate)}`;
      infSupl = infSupl ? `${infSupl}, ${note}` : note;
    }
    return {
      descriere: line.descriere,
      codArticolClient: line.codArticol,
      um: line.um,
      cantitate: line.quantity,
      pret,
      valoare,
      procTVA: tvaRate,
      tva,
      infSupl,
    };
  });
}

export type SagaXmlResult = { filename: string; xml: string; warnings: string[] };

/** Map a loaded invoice to the Saga model, applying VAT and BNR conversion rules. */
async function buildSagaModel(
  invoiceId: string
): Promise<{ invoice: LoadedInvoice; model: SagaInvoice; warnings: string[] }> {
  const invoice = await loadInvoice(invoiceId);
  if (!invoice) throw new Error("Invoice not found.");

  const warnings: string[] = [];
  const org = invoice.organization;
  const country = org.country || org.tara;
  const isRo = isRomania(country);
  const contractCurrency = (invoice.currency || "RON").toUpperCase();

  // VAT decision:
  //  - Romanian client       -> the organization's VAT % (or invoice override).
  //  - EU B2B (has a tax id)  -> 0% with intra-community reverse charge, unless
  //    the invoice has an explicit vatPercent override (exception).
  //  - any other foreign      -> 0% (export / out of scope), unless overridden.
  const hasVatOverride = invoice.vatPercent != null;
  const tvaRate = resolveInvoiceVatPercent(invoice, org);
  let taxareInversa = false;
  if (!isRo) {
    if (!hasVatOverride) {
      if (isEuCountry(country) && org.taxId) {
        taxareInversa = true;
        warnings.push("EU B2B client: applied 0% VAT with reverse charge (taxare inversă).");
      } else {
        warnings.push("Foreign client: applied 0% VAT.");
      }
    } else if (tvaRate > 0) {
      warnings.push(`Foreign client: using invoice VAT override ${trimNum(tvaRate)}% (exception).`);
    } else if (isEuCountry(country) && org.taxId) {
      taxareInversa = true;
      warnings.push("Foreign client: 0% VAT (invoice override).");
    }
  } else if (tvaRate === 0) {
    warnings.push("Romanian client has no VAT % set — invoiced at 0%. Set the organization's VAT % if this is wrong.");
  }

  const issueDate = invoice.issueDate ?? invoice.expectedInvoiceDate ?? new Date();
  const scadenta = invoice.paymentTermDays != null ? addDays(issueDate, invoice.paymentTermDays) : null;

  // Romanian client billed in RON but priced in a foreign currency -> convert at
  // the BNR reference rate. Foreign clients are invoiced in the contract currency.
  let moneda = isRo ? "RON" : contractCurrency;
  let rate = 1;
  if (isRo && contractCurrency !== "RON") {
    try {
      const bnr = await getBnrRonRate(contractCurrency, issueDate);
      rate = bnr.rate;
      moneda = "RON";
      warnings.push(`Converted ${contractCurrency} → RON at BNR rate ${trimNum(rate)} (${bnr.rateDate}).`);
    } catch (err) {
      throw new Error(
        `Romanian client billed in RON but priced in ${contractCurrency}, and the BNR rate could not be fetched: ${(err as Error).message}`
      );
    }
  }

  if (!invoice.number) warnings.push("This invoice has no number yet — <FacturaNumar> is empty.");

  const sagaInvoice: SagaInvoice = {
    supplier: buildSupplier(invoice, warnings),
    client: buildClient(invoice, isRo, warnings),
    numar: invoice.number || "",
    data: issueDate,
    scadenta,
    taxareInversa,
    tvaIncasare: false,
    infoSupl: invoice.invoiceInfo || invoice.contractRef || "",
    moneda,
    cotaTVA: taxareInversa ? 0 : tvaRate,
    lines: buildLines(invoice, tvaRate, rate, contractCurrency),
  };

  return { invoice, model: sagaInvoice, warnings };
}

/** Build the Saga XML for a single invoice id, applying BNR conversion as needed. */
export async function buildInvoiceSagaXml(invoiceId: string): Promise<SagaXmlResult> {
  const { invoice, model, warnings } = await buildSagaModel(invoiceId);
  const xml = buildSagaFacturiXml([model]);
  const datePart = model.data.toISOString().slice(0, 10);
  const filename = `F_${sanitizeFilePart(model.client.nume || invoice.number || invoice.id)}_${datePart}.xml`;
  return { filename, xml, warnings };
}

/** Build a single combined <Facturi> document from multiple invoice ids. */
export async function buildInvoicesSagaXml(invoiceIds: string[]): Promise<SagaXmlResult> {
  const models: SagaInvoice[] = [];
  const warnings: string[] = [];
  for (const id of invoiceIds) {
    let built;
    try {
      built = await buildSagaModel(id);
    } catch (err) {
      throw new Error(`Invoice ${id}: ${(err as Error).message}`);
    }
    models.push(built.model);
    for (const msg of built.warnings) warnings.push(`${built.model.numar || built.model.client.nume}: ${msg}`);
  }
  const xml = buildSagaFacturiXml(models);
  const datePart = new Date().toISOString().slice(0, 10);
  // A combined file is named after the issuing company; mixed issuers keep a count instead.
  const suppliers = new Set(models.map((m) => m.supplier.nume.trim()).filter(Boolean));
  const namePart = suppliers.size === 1 ? [...suppliers][0] : `Facturi_${models.length}`;
  const filename = `F_${sanitizeFilePart(namePart)}_${datePart}.xml`;
  return { filename, xml, warnings };
}
