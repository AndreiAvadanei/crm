import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { requireFullAuth } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { clientVisibilityWhere, dealVisibilityWhere, isAdmin } from "@/lib/rbac";
import { LIST_FETCH_CAP } from "@/lib/app-constants";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DeleteButton } from "@/components/shared/delete-button";
import { InvoiceFormDialog, type InvoiceData } from "@/components/invoices/invoice-form-dialog";
import { GenerateInvoiceDialog } from "@/components/invoices/generate-invoice-dialog";
import { deleteInvoiceAction } from "@/server/invoice-actions";
import { INVOICE_STATUS_LABELS } from "@/lib/invoice-stats";
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

export default async function InvoiceDetailPage({ params }: Props) {
  const user = await requireFullAuth();
  const { id } = await params;
  const [clientVis, dealVis] = await Promise.all([clientVisibilityWhere(user), dealVisibilityWhere(user)]);

  const invoice = await prisma.invoice.findFirst({
    where: { AND: [{ id }, { organization: { client: clientVis } }] },
    include: {
      organization: { include: { client: { select: { id: true, name: true, ownerId: true } } } },
      client: { select: { id: true, name: true } },
      deal: { select: { salesId: true, title: true } },
    },
  });
  if (!invoice) notFound();

  const admin = isAdmin(user);
  const canManage = admin || invoice.organization.client.ownerId === user.id;
  const total = invoice.totalAmount == null ? null : Number(invoice.totalAmount);
  const issueDateInput = invoice.issueDate ? invoice.issueDate.toISOString().slice(0, 10) : null;

  const [orgs, deals] = canManage
    ? await Promise.all([
        prisma.organization.findMany({
          where: { client: clientVis },
          orderBy: { sourceName: "asc" },
          select: { id: true, sourceName: true },
          take: LIST_FETCH_CAP,
        }),
        prisma.deal.findMany({
          where: dealVis,
          orderBy: [{ salesId: "desc" }],
          select: { salesId: true, title: true },
          take: LIST_FETCH_CAP,
        }),
      ])
    : [[], []];

  const formData: InvoiceData = {
    id: invoice.id,
    organizationId: invoice.organizationId,
    salesId: invoice.deal?.salesId ?? invoice.salesIdSnapshot ?? null,
    number: invoice.number,
    status: invoice.status,
    currency: invoice.currency,
    totalAmount: total,
    amountRaw: invoice.amountRaw,
    paymentTermDays: invoice.paymentTermDays,
    issueDate: issueDateInput,
    expectedInvoiceDate: invoice.expectedInvoiceDate ? invoice.expectedInvoiceDate.toISOString().slice(0, 10) : null,
    issuerName: invoice.issuerName,
    servicesDescription: invoice.servicesDescription,
    contractRef: invoice.contractRef,
    fileUrls: invoice.fileUrls,
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
                  amountRaw: invoice.amountRaw,
                  totalAmount: total,
                  currency: invoice.currency,
                  paymentTermDays: invoice.paymentTermDays,
                  servicesDescription: invoice.servicesDescription,
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
            <InvoiceFormDialog
              invoice={formData}
              organizations={orgs.map((o) => ({ id: o.id, name: o.sourceName }))}
              deals={deals}
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
              <Row label="Status"><Badge>{INVOICE_STATUS_LABELS[invoice.status]}</Badge></Row>
              <Row label="Total">{fmtAmount(total, invoice.currency)}</Row>
              <Row label="Currency">{invoice.currency ?? "—"}</Row>
              <Row label="Issue date">{formatDate(invoice.issueDate)}</Row>
              <Row label="Expected to invoice">{formatDate(invoice.expectedInvoiceDate)}</Row>
              <Row label="Payment term">{invoice.paymentTermDays != null ? `${invoice.paymentTermDays} days` : "—"}</Row>
              <Row label="Issuer">{invoice.issuerName ?? "—"}</Row>
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
              <Row label="Source ref">{invoice.externalRef ?? "—"}</Row>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6 md:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Services</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {invoice.servicesDescription ? (
                <p className="whitespace-pre-wrap">{invoice.servicesDescription}</p>
              ) : (
                <p className="text-muted-foreground">No description.</p>
              )}
              {invoice.contractRef && (
                <p className="mt-3 text-muted-foreground">Contract: {invoice.contractRef}</p>
              )}
              {invoice.amountRaw && (
                <p className="mt-1 text-muted-foreground">Amount note: {invoice.amountRaw}</p>
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
