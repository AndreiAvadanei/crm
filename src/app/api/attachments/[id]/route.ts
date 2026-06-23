import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { canViewDeal } from "@/lib/rbac";
import { readFile } from "@/lib/storage";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const att = await prisma.attachment.findUnique({ where: { id } });
  if (!att) return new NextResponse("Not found", { status: 404 });
  if (!(await canViewDeal(session.user, att.dealId))) return new NextResponse("Forbidden", { status: 403 });

  try {
    const data = await readFile(att.storageKey);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": att.mimeType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(att.filename)}"`,
        "Content-Length": String(att.size),
      },
    });
  } catch {
    return new NextResponse("File missing on disk", { status: 410 });
  }
}
