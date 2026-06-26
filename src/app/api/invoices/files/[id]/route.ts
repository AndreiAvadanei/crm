import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getFullyAuthenticatedSession } from "@/lib/auth/guards";
import { invoiceVisibilityWhere } from "@/lib/rbac";
import { readFile } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getFullyAuthenticatedSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const file = await prisma.invoiceFile.findUnique({
    where: { id },
    include: { invoice: { select: { id: true, organizationId: true } } },
  });
  if (!file) return new NextResponse("Not found", { status: 404 });

  // Authorize through the invoice's visibility (owning client OR issue-date share).
  const invoiceVis = await invoiceVisibilityWhere(session.user);
  const allowed = await prisma.invoice.findFirst({
    where: { AND: [{ id: file.invoice.id }, invoiceVis] },
    select: { id: true },
  });
  if (!allowed) return new NextResponse("Forbidden", { status: 403 });

  try {
    const data = await readFile(file.storageKey);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": file.mimeType || "application/pdf",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(file.filename)}"`,
        "Content-Length": String(file.size || data.length),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch {
    return new NextResponse("File missing on disk", { status: 410 });
  }
}
