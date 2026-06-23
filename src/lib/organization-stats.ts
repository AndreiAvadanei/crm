import "server-only";
import { prisma } from "@/lib/db";
import { clientVisibilityWhere } from "@/lib/rbac";
import { Prisma, type User } from "@/generated/prisma";

export interface OrganizationListOpts {
  search?: string;
  /** Restrict to a single owning client. */
  clientId?: string;
  page?: number;
  pageSize: number;
}

export interface OrganizationRow {
  id: string;
  sourceName: string;
  legalName: string | null;
  taxId: string | null;
  regNumber: string | null;
  country: string | null;
  bankName: string | null;
  iban: string | null;
  address: string | null;
  isDefault: boolean;
  clientId: string;
  clientName: string;
  invoiceCount: number;
  createdAt: Date;
}

export interface PaginatedOrganizations {
  organizations: OrganizationRow[];
  total: number;
  page: number;
  pageSize: number;
}

export async function getPaginatedOrganizations(
  user: User,
  opts: OrganizationListOpts
): Promise<PaginatedOrganizations> {
  const clientVis = await clientVisibilityWhere(user);
  const and: Prisma.OrganizationWhereInput[] = [{ client: clientVis }];
  if (opts.clientId) and.push({ clientId: opts.clientId });
  if (opts.search) {
    const q = opts.search.trim();
    and.push({
      OR: [
        { sourceName: { contains: q } },
        { legalName: { contains: q } },
        { taxId: { contains: q } },
        { iban: { contains: q } },
        { client: { name: { contains: q } } },
      ],
    });
  }
  const where: Prisma.OrganizationWhereInput = { AND: and };

  const page = Math.max(1, opts.page ?? 1);
  const [total, rows] = await Promise.all([
    prisma.organization.count({ where }),
    prisma.organization.findMany({
      where,
      orderBy: { sourceName: "asc" },
      skip: (page - 1) * opts.pageSize,
      take: opts.pageSize,
      include: { client: { select: { id: true, name: true } }, _count: { select: { invoices: true } } },
    }),
  ]);

  return {
    organizations: rows.map((o) => ({
      id: o.id,
      sourceName: o.sourceName,
      legalName: o.legalName,
      taxId: o.taxId,
      regNumber: o.regNumber,
      country: o.country,
      bankName: o.bankName,
      iban: o.iban,
      address: o.address,
      isDefault: o.isDefault,
      clientId: o.clientId,
      clientName: o.client.name,
      invoiceCount: o._count.invoices,
      createdAt: o.createdAt,
    })),
    total,
    page,
    pageSize: opts.pageSize,
  };
}
