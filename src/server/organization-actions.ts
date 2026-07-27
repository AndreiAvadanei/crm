"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma";
import { requireUser } from "@/lib/auth/guards";
import { canEditClient, isAdmin } from "@/lib/rbac";
import { logActivity } from "@/lib/activity";
import { fetchAnafCompany, type AnafCompany } from "@/lib/anaf";
import { getDefaultOrganizationTvaPercent } from "@/lib/settings";
import {
  importOrganizationsFromBuffer,
  previewOrganizationsFromBuffer,
  type OrgImportPreviewResult,
  type OrgImportResult,
} from "@/lib/org-import";

type Result = { ok?: boolean; error?: string; id?: string };

function str(fd: FormData, k: string) {
  const v = fd.get(k);
  return v == null ? undefined : String(v).trim() || undefined;
}
function bool(fd: FormData, k: string) {
  const v = fd.get(k);
  return v === "on" || v === "true" || v === "1";
}
function dateval(fd: FormData, k: string): Date | null {
  const v = str(fd, k);
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function tvaPercent(fd: FormData, fallback: string) {
  const raw = str(fd, "tvaPercent") ?? fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return String(Math.round(n * 100) / 100);
}

/** Build the writable column set shared by create/update. The canonical legacy
 * columns (country/regNumber/bankName/iban/address) are kept in sync with the
 * Romanian "tert" field set so existing display & invoice code keeps working. */
function orgData(fd: FormData) {
  const tara = str(fd, "tara") ?? null;
  const reg_com = str(fd, "reg_com") ?? null;
  const banca = str(fd, "banca") ?? null;
  const cont_banca = str(fd, "cont_banca") ?? null;
  const adresa = str(fd, "adresa") ?? null;
  return {
    legalName: str(fd, "legalName") ?? null,
    taxId: str(fd, "taxId") ?? null,
    // Canonical columns mirrored from the RO field set.
    country: tara,
    regNumber: reg_com,
    bankName: banca,
    iban: cont_banca,
    address: adresa,
    // Romanian accounting / "tert" fields.
    tara,
    judet: str(fd, "judet") ?? null,
    localitate: str(fd, "localitate") ?? null,
    adresa,
    cont_banca,
    banca,
    tel: str(fd, "tel") ?? null,
    email: str(fd, "email") ?? null,
    reg_com,
    delegat: str(fd, "delegat") ?? null,
    inf_supl: str(fd, "inf_supl") ?? null,
    tip_tert: str(fd, "tip_tert") ?? null,
    is_tva: bool(fd, "is_tva"),
    blocat: bool(fd, "blocat"),
    data_v_tva: dateval(fd, "data_v_tva"),
    data_s_tva: dateval(fd, "data_s_tva"),
    cod_post: str(fd, "cod_post") ?? null,
  };
}

async function setSoleDefault(clientId: string, orgId: string) {
  await prisma.organization.updateMany({
    where: { clientId, NOT: { id: orgId } },
    data: { isDefault: false },
  });
}

export async function createOrganizationAction(formData: FormData): Promise<Result> {
  const user = await requireUser();
  const clientId = str(formData, "clientId");
  const sourceName = str(formData, "sourceName");
  if (!clientId) return { error: "Client is required." };
  if (!sourceName) return { error: "Organization name is required." };
  if (!(await canEditClient(user, clientId))) return { error: "Not allowed." };

  const isDefault = bool(formData, "isDefault");
  const defaultTvaPercent = await getDefaultOrganizationTvaPercent();
  const tva = tvaPercent(formData, defaultTvaPercent);
  if (tva == null) return { error: "VAT percent must be a number between 0 and 100." };
  try {
    const org = await prisma.organization.create({
      data: { clientId, sourceName, isDefault, tvaPercent: tva, ...orgData(formData) },
    });
    if (isDefault) await setSoleDefault(clientId, org.id);
    await logActivity({
      actorId: user.id,
      action: "organization_created",
      entity: "Organization",
      entityId: org.id,
      meta: { name: org.sourceName, clientId },
    });
    revalidatePath("/organizations");
    revalidatePath(`/clients/${clientId}`);
    return { ok: true, id: org.id };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { error: `An organization named "${sourceName}" already exists.` };
    }
    throw e;
  }
}

export async function updateOrganizationAction(orgId: string, formData: FormData): Promise<Result> {
  const user = await requireUser();
  const existing = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!existing) return { error: "Not found." };
  if (!(await canEditClient(user, existing.clientId))) return { error: "Not allowed." };

  const clientId = str(formData, "clientId") ?? existing.clientId;
  if (clientId !== existing.clientId && !(await canEditClient(user, clientId))) {
    return { error: "Not allowed to move to that client." };
  }
  const sourceName = str(formData, "sourceName") ?? existing.sourceName;
  const isDefault = bool(formData, "isDefault");
  const tva = tvaPercent(formData, existing.tvaPercent.toString());
  if (tva == null) return { error: "VAT percent must be a number between 0 and 100." };

  try {
    await prisma.organization.update({
      where: { id: orgId },
      data: { clientId, sourceName, isDefault, tvaPercent: tva, ...orgData(formData) },
    });
    if (isDefault) await setSoleDefault(clientId, orgId);
    await logActivity({
      actorId: user.id,
      action: "organization_updated",
      entity: "Organization",
      entityId: orgId,
      meta: { name: sourceName, clientId },
    });
    revalidatePath("/organizations");
    revalidatePath(`/clients/${existing.clientId}`);
    if (clientId !== existing.clientId) revalidatePath(`/clients/${clientId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { error: `An organization named "${sourceName}" already exists.` };
    }
    throw e;
  }
}

export async function deleteOrganizationAction(orgId: string): Promise<Result> {
  const user = await requireUser();
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    include: { _count: { select: { invoices: true } } },
  });
  if (!org) return { error: "Not found." };
  if (!(await canEditClient(user, org.clientId))) return { error: "Not allowed." };
  if (org._count.invoices > 0) {
    return { error: `Cannot delete: ${org._count.invoices} invoice(s) reference this organization.` };
  }
  await prisma.organization.delete({ where: { id: orgId } });
  await logActivity({
    actorId: user.id,
    action: "organization_deleted",
    entity: "Organization",
    entityId: orgId,
    meta: { name: org.sourceName, clientId: org.clientId },
  });
  revalidatePath("/organizations");
  revalidatePath(`/clients/${org.clientId}`);
  return { ok: true };
}

/** Serializable org field set for the edit form (Decimal -> string, Date -> YYYY-MM-DD). */
export type OrgEditData = {
  sourceName: string;
  legalName: string;
  taxId: string;
  tara: string;
  judet: string;
  localitate: string;
  cod_post: string;
  adresa: string;
  reg_com: string;
  banca: string;
  cont_banca: string;
  tel: string;
  email: string;
  is_tva: boolean;
  blocat: boolean;
  data_v_tva: string;
  data_s_tva: string;
  tip_tert: string;
  delegat: string;
  inf_supl: string;
  tvaPercent: string;
  isDefault: boolean;
  clientId: string;
};

const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

/** Load a single organization's full field set for the edit dialog. */
export async function getOrganizationForEditAction(
  id: string
): Promise<{ ok?: boolean; error?: string; org?: OrgEditData }> {
  const user = await requireUser();
  const o = await prisma.organization.findUnique({ where: { id } });
  if (!o) return { error: "Not found." };
  if (!(await canEditClient(user, o.clientId))) return { error: "Not allowed." };
  return {
    ok: true,
    org: {
      sourceName: o.sourceName ?? "",
      legalName: o.legalName ?? "",
      taxId: o.taxId ?? "",
      tara: o.tara ?? o.country ?? "",
      judet: o.judet ?? "",
      localitate: o.localitate ?? "",
      cod_post: o.cod_post ?? "",
      adresa: o.adresa ?? o.address ?? "",
      reg_com: o.reg_com ?? o.regNumber ?? "",
      banca: o.banca ?? o.bankName ?? "",
      cont_banca: o.cont_banca ?? o.iban ?? "",
      tel: o.tel ?? "",
      email: o.email ?? "",
      is_tva: o.is_tva,
      blocat: o.blocat,
      data_v_tva: isoDate(o.data_v_tva),
      data_s_tva: isoDate(o.data_s_tva),
      tip_tert: o.tip_tert ?? "",
      delegat: o.delegat ?? "",
      inf_supl: o.inf_supl ?? "",
      tvaPercent: o.tvaPercent.toString(),
      isDefault: o.isDefault,
      clientId: o.clientId,
    },
  };
}

/** Admin-only: bulk upsert organizations from an uploaded .xls/.xlsx workbook
 * (SAGA/WinMentor "clienti" export). Keyed on Organization.sourceName. */
export async function previewOrganizationsImportAction(
  formData: FormData
): Promise<{ ok?: boolean; error?: string; result?: OrgImportPreviewResult }> {
  const user = await requireUser();
  if (!isAdmin(user)) return { error: "Doar adminii pot importa." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Selectați un fișier." };
  const name = file.name.toLowerCase();
  if (!name.endsWith(".xls") && !name.endsWith(".xlsx")) {
    return { error: "Fișierul trebuie să fie .xls sau .xlsx." };
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const defaultTvaPercent = await getDefaultOrganizationTvaPercent();
    const result = await previewOrganizationsFromBuffer(buffer, { defaultTvaPercent });
    return { ok: true, result };
  } catch (e) {
    return { error: `Previzualizare eșuată: ${(e as Error).message}` };
  }
}

export async function importOrganizationsAction(
  formData: FormData
): Promise<{ ok?: boolean; error?: string; result?: OrgImportResult }> {
  const user = await requireUser();
  if (!isAdmin(user)) return { error: "Doar adminii pot importa." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Selectați un fișier." };
  const name = file.name.toLowerCase();
  if (!name.endsWith(".xls") && !name.endsWith(".xlsx")) {
    return { error: "Fișierul trebuie să fie .xls sau .xlsx." };
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await importOrganizationsFromBuffer(buffer, {
      defaultTvaPercent: await getDefaultOrganizationTvaPercent(),
    });
    if (result.errors.length > 0 && result.total === 0) {
      return { error: result.errors.join(" ") };
    }
    await logActivity({
      actorId: user.id,
      action: "organizations_imported",
      entity: "Organization",
      meta: { file: file.name, ...result, errors: result.errors.slice(0, 20) },
    });
    revalidatePath("/organizations");
    return { ok: true, result };
  } catch (e) {
    return { error: `Import eșuat: ${(e as Error).message}` };
  }
}

/** Look up Romanian company data by CUI/VAT (strips the RO prefix). Used by the
 * org form's "Fetch from ANAF" button. Returns a normalized field subset. */
export async function fetchAnafCompanyAction(
  cui: string
): Promise<{ ok?: boolean; error?: string; data?: AnafCompany }> {
  await requireUser();
  if (!cui || !cui.trim()) return { error: "Introduceți un CUI/VAT." };
  const data = await fetchAnafCompany(cui);
  if (!data) return { error: "Nu am găsit date ANAF pentru acest CUI." };
  return { ok: true, data };
}
