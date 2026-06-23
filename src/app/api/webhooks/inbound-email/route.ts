import { createHash, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { nextSalesId } from "@/lib/sequence";
import { getDefaultDealOwnerId, getInboundWebhookSecret } from "@/lib/settings";
import { notifyNewDeal } from "@/lib/notifications";
import { logActivity } from "@/lib/activity";
import {
  parseContactFormEmail,
  cleanBitSentinelLeadTitle,
  truncateDbString,
  nullableDbString,
  type ContactFormData,
} from "@/lib/parse-contact-form";

// This endpoint is called by an external poller (e.g. a Google Apps Script that
// forwards matching Gmail lead emails). It authenticates via a shared secret
// configured in Admin → Settings, not the app session cookie.
export const dynamic = "force-dynamic";

/** Shape posted by the Gmail Apps Script forwarder. All fields optional/defensive. */
type InboundEmailPayload = {
  gmailMessageId?: string;
  from?: string;
  to?: string;
  replyTo?: string;
  subject?: string;
  date?: string;
  plainBody?: string;
  htmlBody?: string;
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

/** Extract a bare email address from strings like `Name <a@b.com>` or `a@b.com`. */
function extractEmail(value?: string): string | undefined {
  if (!value) return undefined;
  const m = value.match(/[^\s<>"]+@[^\s<>"]+\.[^\s<>"]+/);
  return m ? m[0].toLowerCase() : undefined;
}

/**
 * Stable idempotency key for an inbound email. Prefer the provider message id
 * (Gmail); fall back to a content hash so retries without an id are still
 * de-duplicated.
 */
function dedupeKey(payload: InboundEmailPayload, bodyText: string): string {
  const id = payload.gmailMessageId?.trim();
  if (id) return id;
  return `sha256:${createHash("sha256")
    .update(`${payload.from ?? ""}|${payload.subject ?? ""}|${payload.date ?? ""}|${bodyText}`)
    .digest("hex")}`;
}

export async function POST(req: NextRequest) {
  // 1. Auth — reject unless a secret is configured and matches.
  const expected = await getInboundWebhookSecret();
  if (!expected) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }
  const provided = presentedSecret(req);
  if (!provided || !secretMatches(provided, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Parse payload.
  let payload: InboundEmailPayload;
  try {
    payload = (await req.json()) as InboundEmailPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const bodyText = payload.plainBody || payload.htmlBody || "";
  if (!bodyText.trim()) {
    return NextResponse.json({ error: "Empty email body" }, { status: 422 });
  }

  // 3. Idempotency — the poller may re-send the same message. We claim the
  // messageId in InboundLead (unique) BEFORE doing any work, so two concurrent
  // identical deliveries can't both create a deal. The claim row is updated with
  // the resulting ids on success, and removed on failure so retries can re-run.
  const messageId = dedupeKey(payload, bodyText);
  const already = await prisma.inboundLead.findUnique({
    where: { messageId },
    select: { dealId: true, clientId: true, status: true },
  });
  if (already) return duplicateResponse(already);

  let lead: { id: string };
  try {
    lead = await prisma.inboundLead.create({
      data: {
        messageId,
        fromAddr: nullableDbString(payload.from),
        subject: nullableDbString(payload.subject),
        status: "processing",
        payload: JSON.stringify(payload),
      },
      select: { id: true },
    });
  } catch (err) {
    // Lost the claim race with a concurrent identical delivery → it's a dup.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const claimed = await prisma.inboundLead.findUnique({
        where: { messageId },
        select: { dealId: true, clientId: true, status: true },
      });
      return claimed
        ? duplicateResponse(claimed)
        : NextResponse.json({ ok: true, duplicate: true, status: "duplicate" }, { status: 200 });
    }
    throw err;
  }

  // From here on we own the claim; on any failure we release it so the poller's
  // next retry can reprocess the email cleanly.
  try {
    return await processLead({ payload, bodyText, leadId: lead.id });
  } catch (err) {
    await prisma.inboundLead.delete({ where: { id: lead.id } }).catch(() => {});
    await logActivity({
      actorId: null,
      action: "deal_created",
      entity: "Deal",
      meta: { source: "inbound-email", error: String(err), failed: true, gmailMessageId: payload.gmailMessageId?.trim() ?? null },
    });
    return NextResponse.json({ error: "Failed to process inbound email" }, { status: 500 });
  }
}

/** Build the standard "already processed" 200 response, with the deal's salesId. */
async function duplicateResponse(rec: { dealId: string | null; clientId: string | null; status: string }) {
  const deal = rec.dealId
    ? await prisma.deal.findUnique({ where: { id: rec.dealId }, select: { salesId: true } })
    : null;
  return NextResponse.json(
    {
      ok: true,
      duplicate: true,
      status: rec.status,
      dealId: rec.dealId,
      salesId: deal?.salesId ?? null,
      clientId: rec.clientId,
    },
    { status: 200 },
  );
}

/** Create the client (if new) + deal, auto-assign, finalize the claim, notify. */
async function processLead({
  payload,
  bodyText,
  leadId,
}: {
  payload: InboundEmailPayload;
  bodyText: string;
  leadId: string;
}) {
  // 4. Parse the lead fields out of the contact-form email body.
  const contact: ContactFormData | null = parseContactFormEmail(bodyText);

  const contactEmail = contact?.email ?? extractEmail(payload.replyTo) ?? extractEmail(payload.from);
  const contactName = contact?.fullName;
  const company = contact?.company;

  // 5. Resolve / create the client. Dedupe by company name, else by email.
  let clientId: string | null = null;
  let createdClient = false;
  if (company) {
    const existing = await prisma.client.findFirst({ where: { name: company } });
    if (existing) {
      clientId = existing.id;
      // Backfill contact details we now know but were previously missing.
      await prisma.client.update({
        where: { id: existing.id },
        data: {
          contactName: existing.contactName ?? nullableDbString(contactName),
          contactEmail: existing.contactEmail ?? nullableDbString(contactEmail),
          contactPhone: existing.contactPhone ?? nullableDbString(contact?.phone),
        },
      });
    } else {
      const client = await prisma.client.create({
        data: {
          name: truncateDbString(company),
          contactName: nullableDbString(contactName),
          contactEmail: nullableDbString(contactEmail),
          contactPhone: nullableDbString(contact?.phone),
        },
      });
      clientId = client.id;
      createdClient = true;
    }
  } else if (contactEmail) {
    const existing = await prisma.client.findFirst({ where: { contactEmail } });
    if (existing) {
      clientId = existing.id;
    } else {
      const client = await prisma.client.create({
        data: {
          name: truncateDbString(contactName || contactEmail),
          contactName: nullableDbString(contactName),
          contactEmail: nullableDbString(contactEmail),
          contactPhone: nullableDbString(contact?.phone),
        },
      });
      clientId = client.id;
      createdClient = true;
    }
  }

  // 6. Default pipeline + first stage (e.g. "New").
  const pipeline = await prisma.pipeline.findFirst({
    where: { isDefault: true },
    include: { stages: { orderBy: { order: "asc" }, take: 1 } },
  });
  if (!pipeline || pipeline.stages.length === 0) {
    // Throw (not return) so the caller releases the idempotency claim and a
    // retry can succeed once a pipeline exists.
    throw new Error("No pipeline configured");
  }
  const stageId = pipeline.stages[0].id;

  // 7. Auto-assign to the configured default owner (may be null → unassigned).
  const ownerId = await getDefaultDealOwnerId();

  // 8. Build title + description and create the deal with a fresh SAL id.
  const rawTitle = cleanBitSentinelLeadTitle(
    payload.subject?.trim() || company || contactName || "Website lead",
    contact,
  );
  const title = truncateDbString(rawTitle);

  const deal = await prisma.$transaction(async (tx) => {
    const salesId = await nextSalesId(tx);
    return tx.deal.create({
      data: {
        salesId,
        title,
        description: bodyText,
        clientId,
        pipelineId: pipeline.id,
        stageId,
        ownerId,
      },
    });
  });

  // 9. Finalize the idempotency claim with the resulting ids.
  await prisma.inboundLead.update({
    where: { id: leadId },
    data: { status: "created", dealId: deal.id, clientId },
  });

  // 10. Audit + notifications. actorId is null (no human); passing "" as the
  // notify actor means nobody is excluded from the new-deal email.
  await logActivity({
    actorId: null,
    action: "deal_created",
    entity: "Deal",
    entityId: deal.id,
    meta: {
      title: deal.title,
      salesId: deal.salesId,
      source: "inbound-email",
      gmailMessageId: payload.gmailMessageId?.trim() ?? null,
    },
  });
  if (createdClient && clientId) {
    await logActivity({
      actorId: null,
      action: "client_created",
      entity: "Client",
      entityId: clientId,
      meta: { name: company ?? contactName ?? contactEmail, source: "inbound-email" },
    });
  }
  await notifyNewDeal(deal.id, "");

  return NextResponse.json(
    {
      ok: true,
      duplicate: false,
      status: "created",
      dealId: deal.id,
      salesId: deal.salesId,
      clientId,
      createdClient,
      assignedTo: ownerId,
      parsed: contact ? true : false,
    },
    { status: 201 },
  );
}
