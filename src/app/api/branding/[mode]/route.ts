import { NextRequest, NextResponse } from "next/server";
import { readBrandingLogo, type LogoMode } from "@/lib/branding";

// Public endpoint: logos are non-sensitive and rendered in the chrome.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ mode: string }> }) {
  const { mode } = await params;
  if (mode !== "light" && mode !== "dark") {
    return new NextResponse("Bad request", { status: 400 });
  }
  const data = await readBrandingLogo(mode as LogoMode);
  if (!data) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": "image/png",
      // Revalidate each load so re-uploads show immediately (mtime in ?v= busts it).
      "Cache-Control": "no-cache",
    },
  });
}
