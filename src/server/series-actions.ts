"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/guards";
import { isAdmin } from "@/lib/rbac";

type Result = { ok?: boolean; error?: string; id?: string };

async function ensureAdmin() {
  const user = await requireUser();
  if (!isAdmin(user)) throw new Error("Admins only");
  return user;
}

function parsePrefix(fd: FormData): string {
  return String(fd.get("prefix") ?? "").trim();
}

function parseNextNumber(fd: FormData): number {
  const n = Number.parseInt(String(fd.get("nextNumber") ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function flags(fd: FormData) {
  return {
    isActive: fd.get("isActive") === "on" || fd.get("isActive") === "1",
    isDefault: fd.get("isDefault") === "on" || fd.get("isDefault") === "1",
  };
}

function done() {
  revalidatePath("/admin/settings");
  revalidatePath("/invoices");
}

export async function createSeriesAction(fd: FormData): Promise<Result> {
  await ensureAdmin();
  const prefix = parsePrefix(fd);
  if (!prefix) return { error: "Series prefix is required." };
  const exists = await prisma.invoiceSeries.findUnique({ where: { prefix } });
  if (exists) return { error: "A series with this prefix already exists." };

  const { isActive, isDefault } = flags(fd);
  const series = await prisma.invoiceSeries.create({
    data: { prefix, nextNumber: parseNextNumber(fd), isActive, isDefault },
  });
  if (isDefault) {
    await prisma.invoiceSeries.updateMany({ where: { id: { not: series.id } }, data: { isDefault: false } });
  }
  done();
  return { ok: true, id: series.id };
}

export async function updateSeriesAction(id: string, fd: FormData): Promise<Result> {
  await ensureAdmin();
  const prefix = parsePrefix(fd);
  if (!prefix) return { error: "Series prefix is required." };
  const clash = await prisma.invoiceSeries.findFirst({ where: { prefix, id: { not: id } }, select: { id: true } });
  if (clash) return { error: "A series with this prefix already exists." };

  const { isActive, isDefault } = flags(fd);
  const series = await prisma.invoiceSeries.update({
    where: { id },
    data: { prefix, nextNumber: parseNextNumber(fd), isActive, isDefault },
  });
  if (isDefault) {
    await prisma.invoiceSeries.updateMany({ where: { id: { not: series.id } }, data: { isDefault: false } });
  }
  done();
  return { ok: true, id: series.id };
}

export async function deleteSeriesAction(id: string): Promise<Result> {
  await ensureAdmin();
  await prisma.invoiceSeries.delete({ where: { id } });
  done();
  return { ok: true };
}
