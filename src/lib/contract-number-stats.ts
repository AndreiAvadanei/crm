import "server-only";
import { prisma } from "@/lib/db";
import { isAdmin } from "@/lib/rbac";
import { Prisma, type ContractType, type User } from "@/generated/prisma";

export type ContractSortKey =
  | "number"
  | "company"
  | "client"
  | "type"
  | "frame"
  | "expires"
  | "created";

export interface ContractNumberListOpts {
  search?: string;
  /** Restrict to a single owning company (Issuer). */
  issuerId?: string;
  /** Filter by direction. */
  type?: ContractType;
  /** Filter by frame agreement: "yes" | "no". */
  frame?: "yes" | "no";
  sort?: string;
  dir?: "asc" | "desc";
  page?: number;
  pageSize: number;
}

// Sort keys and filters that operate on confidential fields. For SALES users
// these are scoped to their own records so a hidden field never influences the
// ordering or membership of records they may only see by number.
const CONFIDENTIAL_SORTS = new Set<string>(["client", "type", "frame", "expires"]);

function orderByFor(sort: string | undefined, dir: "asc" | "desc"): Prisma.ContractNumberOrderByWithRelationInput {
  switch (sort) {
    case "number":
      return { number: dir };
    case "company":
      return { issuer: { name: dir } };
    case "client":
      return { clientName: dir };
    case "type":
      return { type: dir };
    case "frame":
      return { isFrameAgreement: dir };
    case "expires":
      return { expiresAt: dir };
    case "created":
      return { createdAt: dir };
    default:
      return { createdAt: "desc" };
  }
}

/**
 * A contract-number row prepared for the table. For a SALES user, records they
 * did not create expose only `number`, `issuerName` and `createdAt`; every other
 * field is masked to null and `canManage` is false. Admins and the creator see
 * the full record and `canManage` is true.
 */
export interface ContractNumberRow {
  id: string;
  number: string;
  issuerId: string;
  issuerName: string;
  organizationId: string | null;
  clientName: string | null;
  type: ContractType | null;
  isFrameAgreement: boolean | null;
  expiresAt: string | null;
  comment: string | null;
  createdById: string | null;
  createdByName: string | null;
  createdAt: string;
  canManage: boolean;
}

export interface PaginatedContractNumbers {
  contractNumbers: ContractNumberRow[];
  total: number;
  page: number;
  pageSize: number;
}

export async function getPaginatedContractNumbers(
  user: User,
  opts: ContractNumberListOpts
): Promise<PaginatedContractNumbers> {
  const admin = isAdmin(user);
  const and: Prisma.ContractNumberWhereInput[] = [];
  if (opts.issuerId) and.push({ issuerId: opts.issuerId });
  if (opts.type) and.push({ type: opts.type });
  if (opts.frame === "yes") and.push({ isFrameAgreement: true });
  if (opts.frame === "no") and.push({ isFrameAgreement: false });

  // SALES users may only view the confidential fields of their own records, so
  // any filter/sort that touches a confidential field is scoped to those.
  const usesConfidential = !!opts.type || !!opts.frame || CONFIDENTIAL_SORTS.has(opts.sort ?? "");
  if (!admin && usesConfidential) and.push({ createdById: user.id });

  if (opts.search) {
    const q = opts.search.trim();
    // Everyone can search by the contract number itself. The confidential fields
    // (client, comment) are only searchable on records the user is allowed to
    // see in full: their own for SALES users, or all records for admins.
    const or: Prisma.ContractNumberWhereInput[] = [{ number: { contains: q } }];
    const detailMatch: Prisma.ContractNumberWhereInput = {
      OR: [
        { clientName: { contains: q } },
        { comment: { contains: q } },
        { issuer: { name: { contains: q } } },
        { organization: { sourceName: { contains: q } } },
      ],
    };
    if (admin) {
      or.push(detailMatch);
    } else {
      or.push({ AND: [{ createdById: user.id }, detailMatch] });
    }
    and.push({ OR: or });
  }

  const where: Prisma.ContractNumberWhereInput = and.length ? { AND: and } : {};
  const page = Math.max(1, opts.page ?? 1);
  const dir: "asc" | "desc" = opts.dir === "asc" ? "asc" : "desc";
  const orderBy = orderByFor(opts.sort, dir);

  const [total, rows] = await Promise.all([
    prisma.contractNumber.count({ where }),
    prisma.contractNumber.findMany({
      where,
      orderBy,
      skip: (page - 1) * opts.pageSize,
      take: opts.pageSize,
      include: {
        issuer: { select: { id: true, name: true } },
        organization: { select: { id: true, sourceName: true } },
      },
    }),
  ]);

  return {
    contractNumbers: rows.map((c) => {
      const canManage = admin || c.createdById === user.id;
      const base = {
        id: c.id,
        number: c.number,
        issuerId: c.issuerId,
        issuerName: c.issuer.name,
        createdById: c.createdById,
        // Creator name stays visible even on masked rows so users know who owns
        // a number they can't otherwise see (helps avoid conflicts/reuse).
        createdByName: c.createdByName,
        createdAt: c.createdAt.toISOString(),
        canManage,
      };
      if (!canManage) {
        return {
          ...base,
          organizationId: null,
          clientName: null,
          type: null,
          isFrameAgreement: null,
          expiresAt: null,
          comment: null,
        };
      }
      return {
        ...base,
        organizationId: c.organizationId,
        clientName: c.clientName,
        type: c.type,
        isFrameAgreement: c.isFrameAgreement,
        expiresAt: c.expiresAt ? c.expiresAt.toISOString() : null,
        comment: c.comment,
        createdByName: c.createdByName,
      };
    }),
    total,
    page,
    pageSize: opts.pageSize,
  };
}
