import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDailyDigestSecret, getSetting, setSetting, SETTING_KEYS } from "@/lib/settings";
import { runDailyDigest } from "@/lib/daily-digest";

// Daily per-user priorities digest. Meant to be called once a day at 03:00 UTC
// by an external scheduler (Vercel Cron, a host cron job, or a Gmail/Apps Script
// timer). Authenticates via a shared secret configured in Admin -> Settings (or
// the CRON_SECRET env var), never the app session cookie.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Constant-time secret comparison that tolerates differing lengths. */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Pull the presented secret from common header/query locations. */
function presentedSecret(req: NextRequest): string | null {
  const header = req.headers.get("x-webhook-secret") || req.headers.get("x-cron-secret");
  if (header) return header.trim();
  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const query = req.nextUrl.searchParams.get("secret");
  return query ? query.trim() : null;
}

/** UTC calendar day (yyyy-mm-dd) used for the once-per-day idempotency guard. */
function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function handle(req: NextRequest) {
  const expected = await getDailyDigestSecret();
  if (!expected) {
    return NextResponse.json({ error: "Daily digest not configured" }, { status: 503 });
  }
  const provided = presentedSecret(req);
  if (!provided || !secretMatches(provided, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const dryRun = sp.get("dry") === "1";
  const force = sp.get("force") === "1";
  // `all=1` also emails users who have nothing to action (an "all clear" note).
  const includeEmpty = sp.get("all") === "1";

  const now = new Date();
  const today = utcDay(now);

  // Idempotency: skip if we already ran for this UTC day, unless forced or dry.
  if (!force && !dryRun) {
    const lastRun = await getSetting(SETTING_KEYS.dailyDigestLastRun);
    if (lastRun === today) {
      return NextResponse.json({ ok: true, skipped: true, reason: "already ran today", date: today });
    }
  }

  const summary = await runDailyDigest({ now, includeEmpty, dryRun });

  if (!dryRun) {
    await setSetting(SETTING_KEYS.dailyDigestLastRun, today);
  }

  return NextResponse.json({
    ok: true,
    date: today,
    dryRun,
    includeEmpty,
    ...summary,
  });
}

// Support GET (Vercel Cron / simple schedulers) and POST (curl / Apps Script).
export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
