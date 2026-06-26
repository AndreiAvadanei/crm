"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/guards";
import { isAdmin } from "@/lib/rbac";

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

function readIssuer(fd: FormData) {
  return {
    name: str(fd, "name") ?? "",
    legalName: str(fd, "legalName"),
    taxId: str(fd, "taxId"),
    regCom: str(fd, "regCom"),
    country: str(fd, "country"),
    county: str(fd, "county"),
    city: str(fd, "city"),
    address: str(fd, "address"),
    bankName: str(fd, "bankName"),
    iban: str(fd, "iban"),
    phone: str(fd, "phone"),
    email: str(fd, "email"),
    capital: str(fd, "capital"),
    infSupl: str(fd, "infSupl"),
    isActive: fd.get("isActive") === "on" || fd.get("isActive") === "1",
    isDefault: fd.get("isDefault") === "on" || fd.get("isDefault") === "1",
  };
}

function done() {
  revalidatePath("/admin/settings");
  revalidatePath("/invoices");
}

export async function createIssuerAction(fd: FormData): Promise<Result> {
  await ensureAdmin();
  const data = readIssuer(fd);
  if (!data.name) return { error: "Issuer name is required." };
  const exists = await prisma.issuer.findUnique({ where: { name: data.name } });
  if (exists) return { error: "An issuer with this name already exists." };

  const issuer = await prisma.issuer.create({ data });
  if (data.isDefault) {
    await prisma.issuer.updateMany({ where: { id: { not: issuer.id } }, data: { isDefault: false } });
  }
  done();
  return { ok: true, id: issuer.id };
}

export async function updateIssuerAction(id: string, fd: FormData): Promise<Result> {
  await ensureAdmin();
  const data = readIssuer(fd);
  if (!data.name) return { error: "Issuer name is required." };
  const clash = await prisma.issuer.findFirst({ where: { name: data.name, id: { not: id } }, select: { id: true } });
  if (clash) return { error: "An issuer with this name already exists." };

  const prev = await prisma.issuer.findUnique({ where: { id }, select: { name: true } });
  const issuer = await prisma.issuer.update({ where: { id }, data });
  if (data.isDefault) {
    await prisma.issuer.updateMany({ where: { id: { not: issuer.id } }, data: { isDefault: false } });
  }
  // Keep legacy free-text issuerName on linked invoices in sync after a rename.
  if (prev && prev.name !== data.name) {
    await prisma.invoice.updateMany({ where: { issuerId: id }, data: { issuerName: data.name } });
  }
  done();
  return { ok: true, id: issuer.id };
}

export async function deleteIssuerAction(id: string): Promise<Result> {
  await ensureAdmin();
  await prisma.issuer.delete({ where: { id } });
  done();
  return { ok: true };
}
