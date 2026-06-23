import "server-only";
import { prisma } from "@/lib/db";
import { clientVisibilityWhere } from "@/lib/rbac";
import { Prisma, InvoiceStatus, type User } from "@/generated/prisma";

export { INVOICE_STATUS_LABELS } from "@/lib/invoice-constants";

export interface InvoiceListOpts {
  search?: string;
  status?: InvoiceStatus;
  clientId?: string;
  organizationId?: string;
  currency?: string;
  page?: number;
  pageSize: number;
}

export interface InvoiceRow {
  id: string;
  number: string | null;
  externalRef: string | null;
  status: InvoiceStatus;
  organizationId: string;
  organizationName: string;
  clientId: string | null;
  clientName: string | null;
  salesId: string | null;
  hasDeal: boolean;
  currency: string | null;
  amountRaw: string | null;
  totalAmount: number | null;
  issueDate: Date | null;
  expectedInvoiceDate: Date | null;
  createdAt: Date;
  servicesDescription: string | null;
  fileUrls: string | null;
  issuerName: string | null;
  paymentTermDays: number | null;
  org: OrganizationBillingInfo;
}

export interface OrganizationBillingInfo {
  legalName: string | null;
  taxId: string | null;
  regNumber: string | null;
  bankName: string | null;
  iban: string | null;
  address: string | null;
  country: string | null;
}

export interface PaginatedInvoices {
  invoices: InvoiceRow[];
  total: number;
  page: number;
  pageSize: number;
  totalAmountSum: number;
}

export async function getPaginatedInvoices(user: User, opts: InvoiceListOpts): Promise<PaginatedInvoices> {
  const clientVis = await clientVisibilityWhere(user);
  // Scope through the organization's owning client (invoice.clientId can be null).
  const and: Prisma.InvoiceWhereInput[] = [{ organization: { client: clientVis } }];
  if (opts.status) and.push({ status: opts.status });
  if (opts.clientId) and.push({ clientId: opts.clientId });
  if (opts.organizationId) and.push({ organizationId: opts.organizationId });
  if (opts.currency) and.push({ currency: opts.currency });
  if (opts.search) {
    const q = opts.search.trim();
    and.push({
      OR: [
        { number: { contains: q } },
        { externalRef: { contains: q } },
        { salesIdSnapshot: { contains: q } },
        { servicesDescription: { contains: q } },
        { organization: { sourceName: { contains: q } } },
      ],
    });
  }
  const where: Prisma.InvoiceWhereInput = { AND: and };

  const page = Math.max(1, opts.page ?? 1);
  const [total, rows, agg] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({
      where,
      orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * opts.pageSize,
      take: opts.pageSize,
      include: {
        organization: {
          select: {
            id: true,
            sourceName: true,
            legalName: true,
            taxId: true,
            regNumber: true,
            bankName: true,
            iban: true,
            address: true,
            country: true,
          },
        },
        client: { select: { id: true, name: true } },
        deal: { select: { salesId: true } },
      },
    }),
    prisma.invoice.aggregate({ where, _sum: { totalAmount: true } }),
  ]);

  return {
    invoices: rows.map((i) => ({
      id: i.id,
      number: i.number,
      externalRef: i.externalRef,
      status: i.status,
      organizationId: i.organizationId,
      organizationName: i.organization.sourceName,
      clientId: i.clientId,
      clientName: i.client?.name ?? null,
      salesId: i.deal?.salesId ?? i.salesIdSnapshot ?? null,
      hasDeal: !!i.dealId,
      currency: i.currency,
      amountRaw: i.amountRaw,
      totalAmount: i.totalAmount == null ? null : Number(i.totalAmount),
      issueDate: i.issueDate,
      expectedInvoiceDate: i.expectedInvoiceDate,
      createdAt: i.createdAt,
      servicesDescription: i.servicesDescription,
      fileUrls: i.fileUrls,
      issuerName: i.issuerName,
      paymentTermDays: i.paymentTermDays,
      org: {
        legalName: i.organization.legalName,
        taxId: i.organization.taxId,
        regNumber: i.organization.regNumber,
        bankName: i.organization.bankName,
        iban: i.organization.iban,
        address: i.organization.address,
        country: i.organization.country,
      },
    })),
    total,
    page,
    pageSize: opts.pageSize,
    totalAmountSum: agg._sum.totalAmount == null ? 0 : Number(agg._sum.totalAmount),
  };
}
