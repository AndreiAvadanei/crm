"use server";

import { promises as fs } from "fs";
import path from "path";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/guards";
import { isAdmin } from "@/lib/rbac";
import { invoiceVisibilityWhere } from "@/lib/rbac";
import { normalizeCode, importPartNumbersFromBuffer, type PartNumberImportResult } from "@/lib/part-number-import";

type Result = { ok?: boolean; error?: string; id?: string };

function str(fd: FormData, k: string): string | null {
  const v = fd.get(k);
  const s = v == null ? "" : String(v).trim();
  return s || null;
}

async function ensureAdmin() {
  const user = await requireUser();
  if (!isAdmin(user)) throw new Error("Admins only");
  return user;
}

function readPartNumber(fd: FormData) {
  const rawCode = str(fd, "code");
  return {
    code: rawCode ? normalizeCode(rawCode) : null,
    group: str(fd, "group"),
    title: str(fd, "title"),
    limitations: str(fd, "limitations"),
    category: str(fd, "category"),
    subCategory: str(fd, "subCategory"),
    subSubCategory: str(fd, "subSubCategory"),
    type: str(fd, "type"),
    description: str(fd, "description"),
    active: fd.get("active") === "on" || fd.get("active") === "1",
  };
}

function done() {
  revalidatePath("/admin/settings");
  revalidatePath("/invoices");
}

export async function createPartNumberAction(fd: FormData): Promise<Result> {
  await ensureAdmin();
  const { code, ...rest } = readPartNumber(fd);
  if (!code) return { error: "Part number code is required." };
  const exists = await prisma.partNumber.findUnique({ where: { code }, select: { id: true } });
  if (exists) return { error: "A part number with this code already exists." };

  const max = await prisma.partNumber.aggregate({ _max: { order: true } });
  const pn = await prisma.partNumber.create({ data: { code, ...rest, order: (max._max.order ?? 0) + 1 } });
  done();
  return { ok: true, id: pn.id };
}

export async function updatePartNumberAction(id: string, fd: FormData): Promise<Result> {
  await ensureAdmin();
  const { code, ...rest } = readPartNumber(fd);
  if (!code) return { error: "Part number code is required." };
  const clash = await prisma.partNumber.findFirst({ where: { code, id: { not: id } }, select: { id: true } });
  if (clash) return { error: "A part number with this code already exists." };

  await prisma.partNumber.update({ where: { id }, data: { code, ...rest } });
  done();
  return { ok: true, id };
}

export async function deletePartNumberAction(id: string): Promise<Result> {
  await ensureAdmin();
  await prisma.partNumber.delete({ where: { id } });
  done();
  return { ok: true };
}

/**
 * One-click auto-populate from the bundled part-numbers matrix
 * (`data-init/part-numbers.xlsx`). Upserts by code, so it's safe to re-run after
 * the matrix file is updated.
 */
export async function importPartNumbersFromMatrixAction(): Promise<Result & { result?: PartNumberImportResult }> {
  await ensureAdmin();
  const filePath = path.join(process.cwd(), "data-init", "part-numbers.xlsx");
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(filePath);
  } catch {
    return { error: "Could not read data-init/part-numbers.xlsx on the server. Upload the matrix file instead." };
  }
  const result = await importPartNumbersFromBuffer(buffer);
  done();
  return { ok: true, result };
}

/** Import part numbers from an uploaded .xlsx matrix file (upsert by code). */
export async function importPartNumbersFromUploadAction(fd: FormData): Promise<Result & { result?: PartNumberImportResult }> {
  await ensureAdmin();
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose an .xlsx matrix file first." };
  if (!/\.xlsx?$/i.test(file.name)) return { error: "Only .xls/.xlsx files are supported." };
  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await importPartNumbersFromBuffer(buffer);
  done();
  return { ok: true, result };
}

export type RelatedInvoiceOption = {
  id: string;
  number: string | null;
  organizationName: string;
  issueDate: string | null;
  amount: string | null;
  currency: string | null;
  partNumberId: string | null;
  partNumberCode: string | null;
  partNumberValues: Record<string, string> | null;
};

function asStringMap(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = v == null ? "" : String(v);
  return Object.keys(out).length ? out : null;
}

/**
 * Invoices belonging to the same customer (the organization's owning client) so
 * the wizard can link split-project invoices. Scoped to what the user may see.
 */
export async function getRelatedInvoiceOptionsAction(
  organizationId: string,
  excludeInvoiceId?: string
): Promise<{ ok?: boolean; error?: string; options?: RelatedInvoiceOption[] }> {
  const user = await requireUser();
  if (!organizationId) return { ok: true, options: [] };
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { clientId: true } });
  if (!org) return { ok: true, options: [] };

  const visibility = await invoiceVisibilityWhere(user);
  const invoices = await prisma.invoice.findMany({
    where: {
      AND: [
        visibility,
        { organization: { clientId: org.clientId } },
        excludeInvoiceId ? { id: { not: excludeInvoiceId } } : {},
      ],
    },
    orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
    take: 200,
    select: {
      id: true,
      number: true,
      issueDate: true,
      amountRaw: true,
      totalAmount: true,
      currency: true,
      partNumberId: true,
      partNumberCode: true,
      partNumberValues: true,
      organization: { select: { sourceName: true } },
    },
  });

  return {
    ok: true,
    options: invoices.map((i) => ({
      id: i.id,
      number: i.number,
      organizationName: i.organization.sourceName,
      issueDate: i.issueDate ? i.issueDate.toISOString().slice(0, 10) : null,
      amount: i.amountRaw ?? (i.totalAmount == null ? null : String(i.totalAmount)),
      currency: i.currency,
      partNumberId: i.partNumberId,
      partNumberCode: i.partNumberCode,
      partNumberValues: asStringMap(i.partNumberValues),
    })),
  };
}
