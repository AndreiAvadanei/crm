import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getFullyAuthenticatedSession } from "@/lib/auth/guards";
import { canEditDeal } from "@/lib/rbac";
import { saveFile } from "@/lib/storage";
import { logActivity } from "@/lib/activity";

// Image types we accept for inline (pasted / uploaded) rich-text images.
const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB

/**
 * Inline image upload target for the TinyMCE editor (comments). Accepts a
 * multipart `file` field, stores it via the shared storage layer and records an
 * Attachment flagged `inline: true`. Returns `{ location }` — the access-checked
 * URL TinyMCE embeds in the comment HTML. Only fully authenticated users who can
 * edit the deal may upload; the served image is likewise gated by canViewDeal.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ dealId: string }> }) {
  const session = await getFullyAuthenticatedSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { dealId } = await params;
  if (!(await canEditDeal(session.user, dealId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "No image provided." }, { status: 400 });
  }
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return NextResponse.json({ error: "Unsupported image type." }, { status: 415 });
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "Image exceeds 10MB." }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const filename = file.name || "pasted-image";
  const { storageKey, size } = await saveFile(buffer, filename);

  const attachment = await prisma.attachment.create({
    data: {
      dealId,
      filename,
      storageKey,
      size,
      mimeType: file.type,
      inline: true,
      uploadedById: session.user.id,
    },
  });

  await logActivity({
    actorId: session.user.id,
    action: "file_uploaded",
    entity: "Deal",
    entityId: dealId,
    meta: { filename, inline: true },
  });

  // TinyMCE expects { location } pointing at the embeddable image URL.
  return NextResponse.json({ location: `/api/attachments/${attachment.id}` });
}
