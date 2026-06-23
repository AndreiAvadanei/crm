import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getFullyAuthenticatedSession } from "@/lib/auth/guards";
import { canViewDeal } from "@/lib/rbac";
import { readFile } from "@/lib/storage";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getFullyAuthenticatedSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const att = await prisma.attachment.findUnique({ where: { id } });
  if (!att) return new NextResponse("Not found", { status: 404 });
  if (!(await canViewDeal(session.user, att.dealId))) return new NextResponse("Forbidden", { status: 403 });

  try {
    const data = await readFile(att.storageKey);
    // Inline images (pasted into comments) are rendered in-page via <img>, so
    // serve them with an `inline` disposition. Everything else downloads.
    const isSvg = att.mimeType === "image/svg+xml" || att.filename.toLowerCase().endsWith(".svg");
    const isImage = !isSvg && (att.mimeType || "").startsWith("image/");
    const disposition = !isSvg && (att.inline || isImage) ? "inline" : "attachment";
    const contentType = isSvg ? "application/octet-stream" : att.mimeType || "application/octet-stream";
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `${disposition}; filename="${encodeURIComponent(att.filename)}"`,
        "Content-Length": String(att.size),
        "X-Content-Type-Options": "nosniff",
        // Immutable content (unique storage key per upload); cache privately.
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch {
    return new NextResponse("File missing on disk", { status: 410 });
  }
}
