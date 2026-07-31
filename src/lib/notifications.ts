import "server-only";
import { prisma } from "@/lib/db";
import { sendEmail, renderEmailLayout } from "@/lib/email";
import { htmlToPlainText } from "@/lib/sanitize";
import { urgencyLabel, type TaskUrgency } from "@/lib/task-urgency";

const APP_BASE_URL = process.env.APP_BASE_URL || "http://localhost:3007";

/** HTML-escape interpolated values used inside email bodies. */
function esc(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type Recipient = { id: string; email: string; name: string };

/** Fetch ACTIVE users (with a real email) for the given ids, de-duped. */
async function activeRecipients(ids: Iterable<string>, excludeId?: string): Promise<Recipient[]> {
  const set = new Set<string>();
  for (const id of ids) if (id && id !== excludeId) set.add(id);
  if (set.size === 0) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: [...set] }, status: "ACTIVE", email: { not: "" } },
    select: { id: true, email: true, name: true },
  });
  return users.filter((u) => !!u.email);
}

/**
 * Notify on a new deal: ALL active admins + the deal owner + users the deal is
 * explicitly shared with (Share subject=DEAL). The actor (creator) is excluded.
 */
export async function notifyNewDeal(dealId: string, actorId: string): Promise<void> {
  try {
    const deal = await prisma.deal.findUnique({
      where: { id: dealId },
      include: { owner: true, client: true, stage: true },
    });
    if (!deal) return;

    const [admins, shares] = await Promise.all([
      prisma.user.findMany({ where: { role: "ADMIN", status: "ACTIVE" }, select: { id: true } }),
      prisma.share.findMany({ where: { subject: "DEAL", subjectId: dealId }, select: { userId: true } }),
    ]);

    const candidateIds = [
      ...admins.map((a) => a.id),
      ...(deal.ownerId ? [deal.ownerId] : []),
      ...shares.map((s) => s.userId),
    ];
    const recipients = await activeRecipients(candidateIds, actorId);
    if (recipients.length === 0) return;

    const url = `${APP_BASE_URL}/deals/${deal.salesId}`;
    const amount = deal.amountEur != null ? `€${Number(deal.amountEur).toLocaleString("en-US")}` : "—";
    const subject = `New deal: ${deal.title} (${deal.salesId})`;
    const bodyHtml = `
      <p style="margin:0 0 12px;">A new deal was created.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.6;">
        <tr><td style="color:#6b7280;padding-right:12px;">Title</td><td><strong>${esc(deal.title)}</strong></td></tr>
        <tr><td style="color:#6b7280;padding-right:12px;">Client</td><td>${esc(deal.client?.name) || "—"}</td></tr>
        <tr><td style="color:#6b7280;padding-right:12px;">Amount</td><td>${amount}</td></tr>
        <tr><td style="color:#6b7280;padding-right:12px;">Stage</td><td>${esc(deal.stage?.name) || "—"}</td></tr>
        <tr><td style="color:#6b7280;padding-right:12px;">Owner</td><td>${esc(deal.owner?.name) || "—"}</td></tr>
      </table>`;
    const html = renderEmailLayout(subject, bodyHtml, url, "View deal");
    const text = `A new deal was created.

Title: ${deal.title}
Client: ${deal.client?.name ?? "—"}
Amount: ${amount}
Stage: ${deal.stage?.name ?? "—"}
Owner: ${deal.owner?.name ?? "—"}

View deal: ${url}`;

    await sendEmail({ to: recipients.map((r) => r.email), subject, html, text });
  } catch (err) {
    console.error("[notifications] notifyNewDeal failed", err);
  }
}

/**
 * Notify on a new comment: the deal OWNER + the explicitly selected user ids.
 * The comment author (actor) is excluded.
 */
export async function notifyNewComment(
  dealId: string,
  commentId: string,
  actorId: string,
  explicitUserIds: string[]
): Promise<void> {
  try {
    const [deal, comment] = await Promise.all([
      prisma.deal.findUnique({ where: { id: dealId }, select: { salesId: true, title: true, ownerId: true } }),
      prisma.comment.findUnique({ where: { id: commentId }, include: { author: true } }),
    ]);
    if (!deal || !comment) return;

    const candidateIds = [...(deal.ownerId ? [deal.ownerId] : []), ...explicitUserIds];
    const recipients = await activeRecipients(candidateIds, actorId);
    if (recipients.length === 0) return;

    const url = `${APP_BASE_URL}/deals/${deal.salesId}`;
    const author = comment.author?.name ?? "Someone";
    const snippetFull = htmlToPlainText(comment.body);
    const snippet = snippetFull.length > 280 ? `${snippetFull.slice(0, 280)}…` : snippetFull;
    const subject = `New comment on ${deal.title} (${deal.salesId})`;
    const bodyHtml = `
      <p style="margin:0 0 12px;"><strong>${esc(author)}</strong> commented on <strong>${esc(deal.title)}</strong>:</p>
      <blockquote style="margin:0;padding:12px 16px;border-left:3px solid #e5e7eb;background:#f9fafb;border-radius:6px;color:#374151;white-space:pre-wrap;">${esc(snippet)}</blockquote>`;
    const html = renderEmailLayout(subject, bodyHtml, url, "View comment");
    const text = `${author} commented on ${deal.title} (${deal.salesId}):

${snippet}

View comment: ${url}`;

    await sendEmail({ to: recipients.map((r) => r.email), subject, html, text });
  } catch (err) {
    console.error("[notifications] notifyNewComment failed", err);
  }
}

/**
 * Notify a user that a deal has just been shared with them. Sent only to the
 * newly-granted user; the actor (admin who shared) is excluded. No-op if the
 * recipient is inactive / has no email.
 */
export async function notifyDealShared(
  dealId: string,
  sharedWithUserId: string,
  actorId: string
): Promise<void> {
  try {
    const recipients = await activeRecipients([sharedWithUserId], actorId);
    if (recipients.length === 0) return;

    const [deal, actor] = await Promise.all([
      prisma.deal.findUnique({
        where: { id: dealId },
        include: { owner: true, client: true, stage: true },
      }),
      prisma.user.findUnique({ where: { id: actorId }, select: { name: true } }),
    ]);
    if (!deal) return;

    const url = `${APP_BASE_URL}/deals/${deal.salesId}`;
    const sharedBy = actor?.name ?? "An admin";
    const amount = deal.amountEur != null ? `€${Number(deal.amountEur).toLocaleString("en-US")}` : "—";
    const subject = `Shared with you: ${deal.title} (${deal.salesId})`;
    const bodyHtml = `
      <p style="margin:0 0 12px;"><strong>${esc(sharedBy)}</strong> gave you access to a deal.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.6;">
        <tr><td style="color:#6b7280;padding-right:12px;">Title</td><td><strong>${esc(deal.title)}</strong></td></tr>
        <tr><td style="color:#6b7280;padding-right:12px;">Client</td><td>${esc(deal.client?.name) || "—"}</td></tr>
        <tr><td style="color:#6b7280;padding-right:12px;">Amount</td><td>${amount}</td></tr>
        <tr><td style="color:#6b7280;padding-right:12px;">Stage</td><td>${esc(deal.stage?.name) || "—"}</td></tr>
        <tr><td style="color:#6b7280;padding-right:12px;">Owner</td><td>${esc(deal.owner?.name) || "—"}</td></tr>
      </table>`;
    const html = renderEmailLayout(subject, bodyHtml, url, "View deal");
    const text = `${sharedBy} gave you access to a deal.

Title: ${deal.title}
Client: ${deal.client?.name ?? "—"}
Amount: ${amount}
Stage: ${deal.stage?.name ?? "—"}
Owner: ${deal.owner?.name ?? "—"}

View deal: ${url}`;

    await sendEmail({ to: recipients.map((r) => r.email), subject, html, text });
  } catch (err) {
    console.error("[notifications] notifyDealShared failed", err);
  }
}

/**
 * Notify the assignee that a task has just been assigned to them. Sent only to
 * the task's assignee; the actor (if any) is excluded so nobody is emailed about
 * a task they created for themselves. No-op if the task is unassigned or the
 * assignee is inactive / has no email.
 */
export async function notifyTaskAssigned(taskId: string, actorId: string | null): Promise<void> {
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { deal: { select: { salesId: true, title: true } } },
    });
    if (!task || !task.assigneeId) return;

    const recipients = await activeRecipients([task.assigneeId], actorId ?? undefined);
    if (recipients.length === 0) return;

    const url = `${APP_BASE_URL}/deals/${task.deal.salesId}`;
    const due = task.dueDate ? task.dueDate.toISOString().slice(0, 10) : "—";
    const priority = urgencyLabel(task.urgency as TaskUrgency);
    const subject = `New task: ${task.title} (${task.deal.salesId})`;
    const bodyHtml = `
      <p style="margin:0 0 12px;">A task was assigned to you.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.6;">
        <tr><td style="color:#6b7280;padding-right:12px;">Task</td><td><strong>${esc(task.title)}</strong></td></tr>
        <tr><td style="color:#6b7280;padding-right:12px;">Deal</td><td>${esc(task.deal.title)} (${esc(task.deal.salesId)})</td></tr>
        <tr><td style="color:#6b7280;padding-right:12px;">Due date</td><td>${esc(due)}</td></tr>
        <tr><td style="color:#6b7280;padding-right:12px;">Priority</td><td>${esc(priority)}</td></tr>
      </table>`;
    const html = renderEmailLayout(subject, bodyHtml, url, "View task");
    const text = `A task was assigned to you.

Task: ${task.title}
Deal: ${task.deal.title} (${task.deal.salesId})
Due date: ${due}
Priority: ${priority}

View task: ${url}`;

    await sendEmail({ to: recipients.map((r) => r.email), subject, html, text });
  } catch (err) {
    console.error("[notifications] notifyTaskAssigned failed", err);
  }
}
