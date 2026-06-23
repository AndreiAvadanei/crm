"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/guards";
import { isAdmin } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { saveBrandingLogo, deleteBrandingLogo, type LogoMode } from "@/lib/branding";

type Result = { ok?: boolean; error?: string };

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function parseMode(m: unknown): LogoMode | null {
  return m === "light" || m === "dark" ? m : null;
}

async function audit(actorId: string, action: string, mode: LogoMode) {
  try {
    await prisma.auditLog.create({
      data: { actorId, action, entity: "Setting", entityId: `logo-${mode}`, meta: { mode } },
    });
  } catch {
    // ignore audit failures
  }
}

export async function uploadBrandingLogoAction(modeRaw: string, formData: FormData): Promise<Result> {
  const user = await requireUser();
  if (!isAdmin(user)) return { error: "Admins only." };

  const mode = parseMode(modeRaw);
  if (!mode) return { error: "Invalid mode." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "No file selected." };

  // PNG only — check MIME + extension, then verify the actual signature bytes.
  const looksPng = file.type === "image/png" || file.name.toLowerCase().endsWith(".png");
  if (!looksPng) return { error: "Only PNG files are allowed." };
  if (file.size > 2 * 1024 * 1024) return { error: "Logo must be under 2MB." };

  const buf = Buffer.from(await file.arrayBuffer());
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { error: "File is not a valid PNG." };
  }

  await saveBrandingLogo(mode, buf);
  await audit(user.id, "branding_logo_updated", mode);

  revalidatePath("/", "layout");
  revalidatePath("/admin/branding");
  return { ok: true };
}

export async function deleteBrandingLogoAction(modeRaw: string): Promise<Result> {
  const user = await requireUser();
  if (!isAdmin(user)) return { error: "Admins only." };

  const mode = parseMode(modeRaw);
  if (!mode) return { error: "Invalid mode." };

  await deleteBrandingLogo(mode);
  await audit(user.id, "branding_logo_removed", mode);

  revalidatePath("/", "layout");
  revalidatePath("/admin/branding");
  return { ok: true };
}
