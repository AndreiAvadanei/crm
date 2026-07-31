import { NextRequest, NextResponse } from "next/server";
import { getFullyAuthenticatedSession } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { buildUserDigest, renderUserDigest, sampleDigest, type DigestUser } from "@/lib/daily-digest";

// Renders the daily-digest email as a standalone HTML page so admins can see
// exactly how it will look. Session-authenticated (not the cron secret):
//   ?sample=1        → fully-populated example data (always looks complete)
//   ?userId=<id>     → preview another user's real digest (admins only)
//   (default)        → the signed-in user's own real digest
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getFullyAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const viewer = session.user;
  const sp = req.nextUrl.searchParams;

  const target: DigestUser = { id: viewer.id, name: viewer.name, email: viewer.email };

  // Admins may preview any user's real digest by id.
  const requestedId = sp.get("userId");
  if (requestedId && viewer.role === "ADMIN" && requestedId !== viewer.id) {
    const other = await prisma.user.findUnique({
      where: { id: requestedId },
      select: { id: true, name: true, email: true },
    });
    if (other) {
      target.id = other.id;
      target.name = other.name;
      target.email = other.email;
    }
  }

  const digest = sp.get("sample") === "1" ? sampleDigest(target) : await buildUserDigest(target);
  const { html } = renderUserDigest(digest);

  return new NextResponse(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
