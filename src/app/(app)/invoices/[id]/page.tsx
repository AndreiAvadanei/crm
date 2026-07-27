import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Info, Pencil } from "lucide-react";
import { requireFullAuth } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { clientVisibilityWhere, dealVisibilityWhere, invoiceVisibilityWhere, isAdmin } from "@/lib/rbac";
import { LIST_FETCH_CAP } from "@/lib/app-constants";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DeleteButton } from "@/components/shared/delete-button";
import { getActiveIssuers } from "@/lib/issuers";
import { getActiveSeries } from "@/lib/series";
import { getActivePartNumbers } from "@/lib/part-number-catalog";
import { computeInvoiceTotals } from "@/lib/invoice-totals";
import { resolveInvoiceVatPercent, resolveOrgVatPercent } from "@/lib/invoice-vat";
import { SagaXmlDownloadButton } from "@/components/invoices/saga-xml-button";
import { InvoiceFormDialog, type InvoiceData } from "@/components/invoices/invoice-form-dialog";
import { GenerateInvoiceDialog } from "@/components/invoices/generate-invoice-dialog";
import { deleteInvoiceAction } from "@/server/invoice-actions";
import { INVOICE_STATUS_LABELS } from "@/lib/invoice-stats";
import { invoiceStatusVariant } from "@/lib/invoice-constants";
import { formatDate } from "@/lib/utils";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const invoice = await prisma.invoice.findUnique({ where: { id }, select: { number: true, externalRef: true } });
  return { title: invoice?.number || invoice?.externalRef || "Invoice" };
}

function fmtAmount(value: number | null, currency: string | null): string {
  if (value == null) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: (currency || "RON").toUpperCase(), maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency ?? ""}`.trim();
  }
}

function amountTone(value: number | null | undefined): string {
  return value != null && value < 0 ? "text-destructive" : "";
}

function asOriginalValues(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function originalTitle(values: Record<string, unknown>, keys: string[]): string {
  return keys.map((key) => `${key}: ${values[key] ?? "—"}`).join("\n");
}

function OriginalInfo({ values, keys }: { values: Record<string, unknown>; keys: string[] }) {
  const hasAny = keys.some((key) => values[key] != null && String(values[key]).trim() !== "");
  if (!hasAny) return null;
  return (
    <span title={originalTitle(values, keys)} className="inline-flex cursor-help align-middle text-muted-foreground">
      <Info className="h-3.5 w-3.5" />
    </span>
  );
}

function decimalNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Coerce the stored partNumberValues JSON into a string map for the form. */
function asStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = v == null ? "" : String(v);
  return out;
}

export default async function InvoiceDetailPage({ params }: Props) {
  const user = await requireFullAuth();
  const { id } = await params;
  const [clientVis, dealVis, invoiceVis] = await Promise.all([
    clientVisibilityWhere(user),
    dealVisibilityWhere(user),
    invoiceVisibilityWhere(user),
  ]);

  const invoice = await prisma.invoice.findFirst({
    where: { AND: [{ id }, invoiceVis] },
    include: {
      organization: { include: { client: { select: { id: true, name: true, ownerId: true } } } },
      client: { select: { id: true, name: true } },
      deal: { select: { salesId: true, title: true } },
      lines: { orderBy: { createdAt: "asc" } },
      partNumber: { select: { code: true, title: true } },
      relatedInvoice: { select: { id: true, number: true, issueDate: true, organization: { select: { sourceName: true } } } },
    },
  });
  if (!invoice) notFound();

  const admin = isAdmin(user);
  const canManage = admin || invoice.organization.client.ownerId === user.id;
  // Articles are the source of truth: predict amounts when the stored totals are missing.
  const vatPercent = resolveInvoiceVatPercent(invoice, invoice.organization);
  const predicted = invoice.lines.length
    ? computeInvoiceTotals(
        invoice.lines.map((l) => ({
          quantity: l.quantity == null ? null : Number(l.quantity),
          unitPrice: l.unitPrice == null ? null : Number(l.unitPrice),
          value: l.value == null ? null : Number(l.value),
        })),
        vatPercent
      )
    : null;
  const storedTotal = invoice.totalAmount == null ? null : Number(invoice.totalAmount);
  const storedBase = invoice.totalBaseAmount == null ? null : Number(invoice.totalBaseAmount);
  const storedVat = invoice.vatAmount == null ? null : Number(invoice.vatAmount);
  const total = storedTotal ?? predicted?.total ?? null;
  const totalBase = storedBase ?? predicted?.base ?? null;
  const vatAmount = storedVat ?? predicted?.vat ?? null;
  const isPredicted = storedBase == null && predicted != null;
  const unpaidAmount = invoice.unpaidAmount == null ? null : Number(invoice.unpaidAmount);
  const articlesSummary =
    invoice.lines.map((l) => l.serviceDescription).filter((s): s is string => !!s && s.trim().length > 0).join(", ") || null;
  const issueDateInput = invoice.issueDate ? invoice.issueDate.toISOString().slice(0, 10) : null;
  const original = asOriginalValues(invoice.originalValues);

  const [orgs, deals, issuers, partNumbers, seriesList] = canManage
    ? await Promise.all([
        prisma.organization.findMany({
          where: { client: clientVis },
          orderBy: { sourceName: "asc" },
          select: { id: true, sourceName: true, country: true, tvaPercent: true },
          take: LIST_FETCH_CAP,
        }),
        prisma.deal.findMany({
          where: dealVis,
          orderBy: [{ salesId: "desc" }],
          select: { salesId: true, title: true },
          take: LIST_FETCH_CAP,
        }),
        getActiveIssuers(),
        getActivePartNumbers(),
        getActiveSeries(),
      ])
    : [[], [], [], [], []];

  const formData: InvoiceData = {
    id: invoice.id,
    organizationId: invoice.organizationId,
    salesId: invoice.deal?.salesId ?? invoice.salesIdSnapshot ?? null,
    number: invoice.number,
    status: invoice.status,
    currency: invoice.currency,
    totalAmount: total,
    paymentTermDays: invoice.paymentTermDays,
    issueDate: issueDateInput,
    expectedInvoiceDate: invoice.expectedInvoiceDate ? invoice.expectedInvoiceDate.toISOString().slice(0, 10) : null,
    issuerName: invoice.issuerName,
    issuerId: invoice.issuerId,
    partNumberId: invoice.partNumberId,
    partNumberValues: asStringMap(invoice.partNumberValues),
    relatedInvoiceId: invoice.relatedInvoiceId,
    selfIssued: invoice.selfIssued,
    seriesId: invoice.seriesId,
    contractRef: invoice.contractRef,
    fileUrls: invoice.fileUrls,
    paid: invoice.paid,
    vatPercent,
    lines: invoice.lines.map((line) => ({
      serviceDescription: line.serviceDescription ?? "",
      textSupplement: line.textSupplement ?? "",
      unitOfMeasure: line.unitOfMeasure ?? "",
      quantity: line.quantity == null ? "" : String(line.quantity),
      unitPrice: line.unitPrice == null ? "" : String(line.unitPrice),
      value: line.value == null ? "" : String(line.value),
      total: line.total == null ? "" : String(line.total),
    })),
  };

  const fileUrls = (invoice.fileUrls ?? "").split(/[\r\n,]+/).map((s) => s.trim()).filter(Boolean);

  return (
    <div className="pb-10">
      <PageHeader
        title={invoice.number || invoice.externalRef || "Invoice"}
        description={invoice.organization.sourceName}
      >
        {canManage && (
          <>
            {invoice.status === "IN_ASTEPTARE" && (
              <GenerateInvoiceDialog
                invoice={{
                  id: invoice.id,
                  number: invoice.number,
                  externalRef: invoice.externalRef,
                  organizationName: invoice.organization.sourceName,
                  clientName: invoice.client?.name ?? invoice.organization.client.name,
                  salesId: formData.salesId,
                  issuerName: invoice.issuerName,
                  totalBaseAmount: storedBase,
                  vatAmount: storedVat,
                  totalAmount: storedTotal,
                  predictedBaseAmount: predicted?.base ?? null,
                  predictedTotalAmount: predicted?.total ?? null,
                  articlesSummary,
                  articleCount: invoice.lines.length,
                  currency: invoice.currency,
                  paymentTermDays: invoice.paymentTermDays,
                  org: {
                    legalName: invoice.organization.legalName,
                    taxId: invoice.organization.taxId,
                    regNumber: invoice.organization.regNumber,
                    bankName: invoice.organization.bankName,
                    iban: invoice.organization.iban,
                    address: invoice.organization.address,
                    country: invoice.organization.country,
                  },
                }}
                trigger={<Button variant="outline">Generate invoice</Button>}
              />
            )}
            <SagaXmlDownloadButton invoiceId={invoice.id} />
            <InvoiceFormDialog
              invoice={formData}
              organizations={orgs.map((o) => ({
                id: o.id,
                name: o.sourceName,
                defaultVatPercent: resolveOrgVatPercent(o),
                configuredTvaPercent: Number(o.tvaPercent) || 21,
              }))}
              deals={deals}
              issuers={issuers}
              series={seriesList}
              partNumbers={partNumbers}
              trigger={
                <Button variant="outline">
                  <Pencil /> Edit
                </Button>
              }
            />
            <DeleteButton
              variant="outline"
              redirectTo="/invoices"
              onDelete={deleteInvoiceAction.bind(null, invoice.id)}
              title="Delete invoice?"
              description="This action cannot be undone."
            />
          </>
        )}
      </PageHeader>

      <div className="grid gap-6 p-4 md:grid-cols-3 md:p-6">
        <div className="space-y-6 md:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row label="Status"><Badge variant={invoiceStatusVariant(invoice.status)}>{INVOICE_STATUS_LABELS[invoice.status]}</Badge></Row>
              <Row label="Total"><span className={amountTone(total)}>{fmtAmount(total, invoice.currency)}</span></Row>
              <Row label="Currency">{invoice.currency ?? "—"}</Row>
              <Row label="Issue date">{formatDate(invoice.issueDate)}</Row>
              <Row label="Expected to invoice">{formatDate(invoice.expectedInvoiceDate)}</Row>
              <Row label="Paid"><Badge variant={invoice.paid ? "success" : "outline"}>{invoice.paid ? "Paid" : "Unpaid"}</Badge></Row>
              <Row label="Payment term">{invoice.paymentTermDays != null ? `${invoice.paymentTermDays} days` : "—"}</Row>
              <Row label="Issuer">{invoice.issuerName ?? "—"}</Row>
              <Row label="Part number">
                {invoice.partNumberCode || invoice.partNumber?.code ? (
                  <span className="font-mono text-xs" title={invoice.partNumber?.title ?? undefined}>
                    {invoice.partNumberCode || invoice.partNumber?.code}
                  </span>
                ) : (
                  "—"
                )}
              </Row>
              <Row label="Created by">{invoice.createdByName ?? "—"}</Row>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Links</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row label="Client">
                {invoice.client ? (
                  <Link href={`/clients/${invoice.client.id}`} className="hover:text-primary">
                    {invoice.client.name}
                  </Link>
                ) : (
                  <Link href={`/clients/${invoice.organization.client.id}`} className="hover:text-primary">
                    {invoice.organization.client.name}
                  </Link>
                )}
              </Row>
              <Row label="Organization">
                <Link href={`/invoices?organization=${invoice.organizationId}`} className="hover:text-primary">
                  {invoice.organization.sourceName}
                </Link>
              </Row>
              <Row label="Deal">
                {formData.salesId ? (
                  invoice.deal ? (
                    <Link href={`/deals/${formData.salesId}`} className="font-mono text-xs hover:text-primary">
                      {formData.salesId}
                    </Link>
                  ) : (
                    <span className="font-mono text-xs text-muted-foreground" title="Deal not found in CRM">
                      {formData.salesId}
                    </span>
                  )
                ) : (
                  "—"
                )}
              </Row>
              <Row label="Related invoice">
                {invoice.relatedInvoice ? (
                  <Link href={`/invoices/${invoice.relatedInvoice.id}`} className="hover:text-primary">
                    {invoice.relatedInvoice.number || "(no number)"}
                    {invoice.relatedInvoice.issueDate ? ` · ${formatDate(invoice.relatedInvoice.issueDate)}` : ""}
                  </Link>
                ) : (
                  "—"
                )}
              </Row>
              <Row label="Source ref">{invoice.externalRef ?? "—"}</Row>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6 md:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Issued invoice information</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
              <Detail label="Invoice number" values={original} keys={["nr_iesire"]}>{invoice.number ?? "—"}</Detail>
              <Detail label="Issued date" values={original} keys={["data"]}>{formatDate(invoice.issueDate)}</Detail>
              <Detail label="Currency" values={original} keys={["cod_valuta"]}>{invoice.currency ?? "—"}</Detail>
              <Detail label="Base total" values={original} keys={["baza_tva", "total"]}>
                <span className={amountTone(totalBase)}>
                  {fmtAmount(totalBase, invoice.currency)}{isPredicted && totalBase != null ? " (predicted)" : ""}
                </span>
              </Detail>
              <Detail label="VAT" values={original} keys={["tva", "tva_val"]}>{fmtAmount(vatAmount, invoice.currency)}</Detail>
              <Detail label="Total" values={original} keys={["total", "baza_tva"]}>
                <span className={amountTone(total)}>
                  {fmtAmount(total, invoice.currency)}{isPredicted && total != null ? " (predicted)" : ""}
                </span>
              </Detail>
              <Detail label="Outstanding" values={original} keys={["neachitat"]}>
                {invoice.paid ? "Paid" : <span className={amountTone(unpaidAmount)}>{fmtAmount(unpaidAmount, invoice.currency)}</span>}
              </Detail>
              <Detail label="Payment term" values={original} keys={["scadent"]}>
                {invoice.paymentTermDays != null ? `${invoice.paymentTermDays} days` : "—"}
              </Detail>
              <div className="sm:col-span-2">
                <Detail label="Invoice info" values={original} keys={["inf_suplm"]}>{invoice.invoiceInfo ?? "—"}</Detail>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Operator request information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Detail label="Expected to invoice">{formatDate(invoice.expectedInvoiceDate)}</Detail>
              <Detail label="Issuer">{invoice.issuerName ?? "—"}</Detail>
              <Detail label="Created by">{invoice.createdByName ?? "—"}</Detail>
              <Detail label="Contract reference">{invoice.contractRef ?? "—"}</Detail>
              <p className="text-xs text-muted-foreground">
                Services and amounts are taken from the articles below.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Articles ({invoice.lines.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {invoice.lines.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Service</TableHead>
                      <TableHead>UM</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Unit price</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoice.lines.map((line) => {
                      const lineOriginal = asOriginalValues(line.originalValues);
                      return (
                        <TableRow key={line.id}>
                          <TableCell className="max-w-[22rem]">
                            <div className="flex items-start gap-1">
                              <div>
                                <div className="whitespace-pre-wrap">{line.serviceDescription ?? "—"}</div>
                                {line.textSupplement && (
                                  <div className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{line.textSupplement}</div>
                                )}
                              </div>
                              <OriginalInfo values={lineOriginal} keys={["denumire1", "text_supl"]} />
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="inline-flex items-center gap-1">
                              {line.unitOfMeasure ?? "—"}
                              <OriginalInfo values={lineOriginal} keys={["um"]} />
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <span className="inline-flex items-center justify-end gap-1">
                              {decimalNumber(line.quantity)?.toLocaleString("en-US", { maximumFractionDigits: 4 }) ?? "—"}
                              <OriginalInfo values={lineOriginal} keys={["cantitate"]} />
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <span className="inline-flex items-center justify-end gap-1">
                              {decimalNumber(line.unitPrice)?.toLocaleString("en-US", { maximumFractionDigits: 4 }) ?? "—"}
                              <OriginalInfo values={lineOriginal} keys={["pret_unitar"]} />
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <span className={`inline-flex items-center justify-end gap-1 ${amountTone(decimalNumber(line.value))}`}>
                              {fmtAmount(decimalNumber(line.value), invoice.currency)}
                              <OriginalInfo values={lineOriginal} keys={["valoare"]} />
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <span className={`inline-flex items-center justify-end gap-1 ${amountTone(decimalNumber(line.total))}`}>
                              {fmtAmount(decimalNumber(line.total), invoice.currency)}
                              <OriginalInfo values={lineOriginal} keys={["total1"]} />
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">No articles recorded for this invoice.</p>
              )}
            </CardContent>
          </Card>

          {fileUrls.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Documents</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {fileUrls.map((url, idx) => (
                  <a key={idx} href={url} target="_blank" rel="noreferrer" className="block truncate text-primary hover:underline">
                    {url}
                  </a>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}

function Detail({
  label,
  children,
  values,
  keys = [],
}: {
  label: string;
  children: React.ReactNode;
  values?: Record<string, unknown>;
  keys?: string[];
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border bg-muted/20 px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex max-w-[70%] items-center gap-1 text-right font-medium">
        {children}
        {values && keys.length > 0 && <OriginalInfo values={values} keys={keys} />}
      </span>
    </div>
  );
}
