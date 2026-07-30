import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  getDefaultDealOwnerId,
  getTaskWebhookDefaults,
  getTaskWebhookSecret,
} from "@/lib/settings";
import { logActivity } from "@/lib/activity";
import { TASK_URGENCY_VALUES, type TaskUrgency } from "@/lib/task-urgency";

// Called by an external system to attach a follow-up task to an existing deal,
// identified by its salesId (`sales_id`). Authenticates via a shared secret
// configured in Admin → Settings, not the app session cookie.
export const dynamic = "force-dynamic";

/** Shape posted by the caller. Only `sales_id` is required; the rest override
 * the admin-configured task defaults for this single request. */
type CreateTaskPayload = {
  sales_id?: string;
  salesId?: string;
  // Optional per-call overrides.
  title?: string;
  text?: string;
  urgency?: string;
  priority?: string;
  due_days?: number | string;
  dueDays?: number | string;
};

/** Constant-time secret comparison that tolerates differing lengths. */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Pull the presented secret from common header/query locations. */
function presentedSecret(req: NextRequest): string | null {
  const header = req.headers.get("x-webhook-secret");
  if (header) return header.trim();
  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const query = req.nextUrl.searchParams.get("secret");
  return query ? query.trim() : null;
}

/** Parse an optional integer day-count override (0–365), else null. */
function parseDueDays(value: number | string | undefined): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 365) return null;
  return n;
}

/** Date at UTC midnight, `days` from today. */
function dueDateFromToday(days: number): Date {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export async function POST(req: NextRequest) {
  // 1. Auth — reject unless a secret is configured and matches.
  const expected = await getTaskWebhookSecret();
  if (!expected) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }
  const provided = presentedSecret(req);
  if (!provided || !secretMatches(provided, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Parse payload. `sales_id` may also arrive as a query param for convenience.
  let payload: CreateTaskPayload = {};
  try {
    const text = await req.text();
    if (text.trim()) payload = JSON.parse(text) as CreateTaskPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const salesIdRaw =
    payload.sales_id ??
    payload.salesId ??
    req.nextUrl.searchParams.get("sales_id") ??
    req.nextUrl.searchParams.get("salesId") ??
    undefined;
  const salesId = typeof salesIdRaw === "string" ? salesIdRaw.trim().toUpperCase() : "";
  if (!salesId) {
    return NextResponse.json({ error: "Missing sales_id" }, { status: 422 });
  }

  // 3. Resolve the target deal (skip soft-deleted ones).
  const deal = await prisma.deal.findUnique({
    where: { salesId },
    select: { id: true, salesId: true, title: true, ownerId: true, deletedAt: true },
  });
  if (!deal || deal.deletedAt) {
    return NextResponse.json({ error: "Deal not found", salesId }, { status: 404 });
  }

  // 4. Assemble task fields from admin defaults, allowing per-call overrides.
  const defaults = await getTaskWebhookDefaults();

  const overrideTitle = (payload.title ?? payload.text)?.trim();
  const title = overrideTitle || defaults.title;

  const overrideUrgencyRaw = (payload.urgency ?? payload.priority)?.toUpperCase();
  const urgency: TaskUrgency =
    overrideUrgencyRaw && (TASK_URGENCY_VALUES as string[]).includes(overrideUrgencyRaw)
      ? (overrideUrgencyRaw as TaskUrgency)
      : defaults.urgency;

  const overrideDueDays = parseDueDays(payload.due_days ?? payload.dueDays);
  const dueDays = overrideDueDays ?? defaults.dueDays;
  const dueDate = dueDateFromToday(dueDays);

  // 5. Assign to the deal owner, else the configured default assignee, else
  // leave unassigned.
  const assigneeId = deal.ownerId ?? (await getDefaultDealOwnerId());

  // 6. Create the task.
  const task = await prisma.task.create({
    data: {
      dealId: deal.id,
      title,
      type: "TASK",
      urgency,
      assigneeId,
      dueDate,
    },
    select: { id: true },
  });

  // 7. Audit (logged against the parent Deal so the feed can link to it).
  await logActivity({
    actorId: null,
    action: "task_created",
    entity: "Deal",
    entityId: deal.id,
    meta: {
      taskTitle: title,
      salesId: deal.salesId,
      title: deal.title,
      source: "webhook",
    },
  });

  return NextResponse.json(
    {
      ok: true,
      taskId: task.id,
      dealId: deal.id,
      salesId: deal.salesId,
      title,
      urgency,
      dueDate: dueDate.toISOString().slice(0, 10),
      assigneeId,
    },
    { status: 201 },
  );
}
