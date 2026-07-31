import "server-only";
import { prisma } from "@/lib/db";
import { sendEmail, renderEmailLayout } from "@/lib/email";
import { startOfDay, recencyCutoff } from "@/lib/filter-helpers";
import { urgencyLabel, type TaskUrgency } from "@/lib/task-urgency";
import { APP_NAME } from "@/lib/app-constants";

const APP_BASE_URL = (process.env.APP_BASE_URL || "http://localhost:3007").replace(/\/$/, "");

/** Deals that carry no activity for at least this many days count as "neglected". */
export const NEGLECTED_DAYS = 30;

/** HTML-escape interpolated values used inside email bodies. */
function esc(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(d);
}

function fmtAmount(v: number | null | undefined): string {
  if (v == null) return "—";
  return `€${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

/** Whole-day difference (today − date), floored. Negative for future dates. */
function daysAgo(d: Date | null | undefined, now: Date): number | null {
  if (!d) return null;
  const ms = startOfDay(now).getTime() - startOfDay(d).getTime();
  return Math.round(ms / 86_400_000);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DigestUser = { id: string; name: string; email: string };

export type TaskItem = {
  id: string;
  title: string;
  dealSalesId: string;
  dealTitle: string;
  dueDate: Date | null;
  urgency: TaskUrgency;
};

export type DealItem = {
  id: string;
  salesId: string;
  title: string;
  clientName: string | null;
  amountEur: number | null;
  dueDate: Date | null;
  stageName: string;
};

export type NeglectedDealItem = DealItem & {
  /** Days since the deal's last task create/update (null = never had a task). */
  taskInactiveDays: number | null;
  /** Days since any other activity (comment / attachment / audit / deal edit). */
  activityInactiveDays: number | null;
};

export type UserDigest = {
  user: DigestUser;
  generatedAt: Date;
  overdueTasks: TaskItem[];
  todayTasks: TaskItem[];
  overdueDeals: DealItem[];
  upcomingDeals: DealItem[];
  neglectedDeals: NeglectedDealItem[];
};

/** True when the digest carries at least one actionable row worth emailing. */
export function digestHasContent(d: UserDigest): boolean {
  return (
    d.overdueTasks.length > 0 ||
    d.todayTasks.length > 0 ||
    d.overdueDeals.length > 0 ||
    d.upcomingDeals.length > 0 ||
    d.neglectedDeals.length > 0
  );
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const OPEN_STAGE = { isWon: false, isLost: false } as const;

function toDealItem(d: {
  id: string;
  salesId: string;
  title: string;
  amountEur: unknown;
  dueDate: Date | null;
  client: { name: string } | null;
  stage: { name: string };
}): DealItem {
  return {
    id: d.id,
    salesId: d.salesId,
    title: d.title,
    clientName: d.client?.name ?? null,
    amountEur: d.amountEur != null ? Number(d.amountEur) : null,
    dueDate: d.dueDate,
    stageName: d.stage.name,
  };
}

/**
 * Compute the daily digest for a single user. Everything is scoped to what the
 * user personally owns / is assigned — tasks assigned to them and deals they
 * own — so the email reflects *their* priorities, not the whole pipeline.
 */
export async function buildUserDigest(user: DigestUser, now: Date = new Date()): Promise<UserDigest> {
  const today = startOfDay(now);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const weekEnd = new Date(today);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const dealSelect = {
    id: true,
    salesId: true,
    title: true,
    amountEur: true,
    dueDate: true,
    client: { select: { name: true } },
    stage: { select: { name: true } },
  } as const;

  const [overdueTasksRaw, todayTasksRaw, overdueDealsRaw, upcomingDealsRaw, neglectedCandidates] =
    await Promise.all([
      // Overdue tasks assigned to the user (still open, past due).
      prisma.task.findMany({
        where: {
          assigneeId: user.id,
          status: "OPEN",
          dueDate: { lt: today },
          deal: { deletedAt: null },
        },
        select: {
          id: true,
          title: true,
          dueDate: true,
          urgency: true,
          deal: { select: { salesId: true, title: true } },
        },
        orderBy: [{ urgency: "desc" }, { dueDate: "asc" }],
      }),
      // Tasks due today assigned to the user.
      prisma.task.findMany({
        where: {
          assigneeId: user.id,
          status: "OPEN",
          dueDate: { gte: today, lt: tomorrow },
          deal: { deletedAt: null },
        },
        select: {
          id: true,
          title: true,
          dueDate: true,
          urgency: true,
          deal: { select: { salesId: true, title: true } },
        },
        orderBy: [{ urgency: "desc" }, { dueDate: "asc" }],
      }),
      // Deals the user owns that are past due and still open.
      prisma.deal.findMany({
        where: {
          ownerId: user.id,
          deletedAt: null,
          dueDate: { lt: today },
          stage: OPEN_STAGE,
        },
        select: dealSelect,
        orderBy: [{ dueDate: "asc" }],
      }),
      // Deals the user owns due within the next 7 days.
      prisma.deal.findMany({
        where: {
          ownerId: user.id,
          deletedAt: null,
          dueDate: { gte: today, lt: weekEnd },
          stage: OPEN_STAGE,
        },
        select: dealSelect,
        orderBy: [{ dueDate: "asc" }],
      }),
      // Candidate deals for the "neglected" table: owned by the user, still
      // active (lead / active / closing — i.e. not won/lost), and either past
      // their deadline or with no deadline at all. The 30-day activity test is
      // applied in JS below since it spans several tables.
      prisma.deal.findMany({
        where: {
          ownerId: user.id,
          deletedAt: null,
          stage: OPEN_STAGE,
          OR: [{ dueDate: { lt: today } }, { dueDate: null }],
        },
        select: { ...dealSelect, updatedAt: true },
        orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
      }),
    ]);

  const mapTask = (t: {
    id: string;
    title: string;
    dueDate: Date | null;
    urgency: TaskUrgency;
    deal: { salesId: string; title: string };
  }): TaskItem => ({
    id: t.id,
    title: t.title,
    dueDate: t.dueDate,
    urgency: t.urgency,
    dealSalesId: t.deal.salesId,
    dealTitle: t.deal.title,
  });

  const neglectedDeals = await filterNeglected(neglectedCandidates, now);

  return {
    user,
    generatedAt: now,
    overdueTasks: overdueTasksRaw.map(mapTask),
    todayTasks: todayTasksRaw.map(mapTask),
    overdueDeals: overdueDealsRaw.map(toDealItem),
    upcomingDeals: upcomingDealsRaw.map(toDealItem),
    neglectedDeals,
  };
}

type NeglectedCandidate = Parameters<typeof toDealItem>[0] & { updatedAt: Date };

/**
 * Keep only candidates with no *task* activity in the last {@link NEGLECTED_DAYS}
 * days OR no *other* activity (comment / attachment / audit / deal edit) in that
 * window — deals that are quietly stalling and need a nudge.
 */
async function filterNeglected(candidates: NeglectedCandidate[], now: Date): Promise<NeglectedDealItem[]> {
  if (candidates.length === 0) return [];
  const ids = candidates.map((d) => d.id);
  const cutoffMs = recencyCutoff(NEGLECTED_DAYS, now).getTime();

  const [tasks, comments, attachments, audits] = await Promise.all([
    prisma.task.groupBy({ by: ["dealId"], where: { dealId: { in: ids } }, _max: { createdAt: true, updatedAt: true } }),
    prisma.comment.groupBy({ by: ["dealId"], where: { dealId: { in: ids } }, _max: { createdAt: true } }),
    prisma.attachment.groupBy({ by: ["dealId"], where: { dealId: { in: ids } }, _max: { createdAt: true } }),
    prisma.auditLog.groupBy({ by: ["entityId"], where: { entity: "Deal", entityId: { in: ids } }, _max: { createdAt: true } }),
  ]);

  const lastTask = new Map<string, number>();
  const lastOther = new Map<string, number>();
  const bump = (map: Map<string, number>, id: string | null, d: Date | null | undefined) => {
    if (!id || !d) return;
    const t = d.getTime();
    if (t > (map.get(id) ?? 0)) map.set(id, t);
  };
  for (const t of tasks) {
    bump(lastTask, t.dealId, t._max.createdAt);
    bump(lastTask, t.dealId, t._max.updatedAt);
  }
  for (const c of comments) bump(lastOther, c.dealId, c._max.createdAt);
  for (const a of attachments) bump(lastOther, a.dealId, a._max.createdAt);
  for (const a of audits) bump(lastOther, a.entityId, a._max.createdAt);
  // A deal's own edits count as "other" activity too.
  for (const d of candidates) bump(lastOther, d.id, d.updatedAt);

  const result: NeglectedDealItem[] = [];
  for (const d of candidates) {
    const taskMs = lastTask.get(d.id) ?? 0;
    const otherMs = lastOther.get(d.id) ?? 0;
    const noRecentTask = taskMs < cutoffMs;
    const noRecentOther = otherMs < cutoffMs;
    if (!noRecentTask && !noRecentOther) continue; // active on both axes → skip

    result.push({
      ...toDealItem(d),
      taskInactiveDays: taskMs ? daysAgo(new Date(taskMs), now) : null,
      activityInactiveDays: otherMs ? daysAgo(new Date(otherMs), now) : null,
    });
  }

  // Most-stale first (largest inactivity across either axis).
  result.sort((a, b) => {
    const av = Math.max(a.taskInactiveDays ?? 9999, a.activityInactiveDays ?? 9999);
    const bv = Math.max(b.taskInactiveDays ?? 9999, b.activityInactiveDays ?? 9999);
    return bv - av;
  });
  return result;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const CELL = "padding:8px 10px;border-bottom:1px solid #eef0f4;font-size:13px;color:#374151;vertical-align:top;";
const HEAD_CELL = "padding:8px 10px;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.4px;text-align:left;border-bottom:2px solid #e5e7eb;";

function dealLink(salesId: string, label: string): string {
  return `<a href="${APP_BASE_URL}/deals/${encodeURIComponent(salesId)}" style="color:#4f46e5;text-decoration:none;font-weight:600;">${esc(label)}</a>`;
}

function urgencyBadge(u: TaskUrgency): string {
  const colors: Record<TaskUrgency, string> = {
    LOW: "background:#f1f5f9;color:#475569;",
    MEDIUM: "background:#eef2ff;color:#4f46e5;",
    HIGH: "background:#fef3c7;color:#b45309;",
    CRITICAL: "background:#fee2e2;color:#b91c1c;",
  };
  return `<span style="display:inline-block;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600;${colors[u]}">${esc(urgencyLabel(u))}</span>`;
}

function sectionHeader(accent: string, title: string, count: number, subtitle: string): string {
  return `
    <tr><td style="padding:22px 0 8px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="width:4px;background:${accent};border-radius:2px;">&nbsp;</td>
        <td style="padding-left:10px;">
          <span style="font-size:15px;font-weight:700;color:#111827;">${esc(title)}</span>
          <span style="display:inline-block;margin-left:8px;padding:1px 8px;border-radius:9999px;background:${accent};color:#ffffff;font-size:11px;font-weight:700;">${count}</span>
          <div style="font-size:12px;color:#9ca3af;margin-top:2px;">${esc(subtitle)}</div>
        </td>
      </tr></table>
    </td></tr>`;
}

function tasksTable(items: TaskItem[]): string {
  const rows = items
    .map(
      (t) => `<tr>
        <td style="${CELL}"><strong style="color:#111827;">${esc(t.title)}</strong></td>
        <td style="${CELL}">${dealLink(t.dealSalesId, `${t.dealTitle} (${t.dealSalesId})`)}</td>
        <td style="${CELL}white-space:nowrap;">${fmtDate(t.dueDate)}</td>
        <td style="${CELL}white-space:nowrap;">${urgencyBadge(t.urgency)}</td>
      </tr>`
    )
    .join("");
  return `<tr><td style="padding:4px 0 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <tr><th style="${HEAD_CELL}">Task</th><th style="${HEAD_CELL}">Deal</th><th style="${HEAD_CELL}">Due</th><th style="${HEAD_CELL}">Priority</th></tr>
      ${rows}
    </table>
  </td></tr>`;
}

function dealsTable(items: DealItem[]): string {
  const rows = items
    .map(
      (d) => `<tr>
        <td style="${CELL}">${dealLink(d.salesId, d.title)}<div style="color:#9ca3af;font-size:11px;">${esc(d.salesId)}</div></td>
        <td style="${CELL}">${esc(d.clientName) || "—"}</td>
        <td style="${CELL}white-space:nowrap;">${fmtAmount(d.amountEur)}</td>
        <td style="${CELL}white-space:nowrap;">${fmtDate(d.dueDate)}</td>
        <td style="${CELL}white-space:nowrap;">${esc(d.stageName)}</td>
      </tr>`
    )
    .join("");
  return `<tr><td style="padding:4px 0 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <tr><th style="${HEAD_CELL}">Deal</th><th style="${HEAD_CELL}">Client</th><th style="${HEAD_CELL}">Amount</th><th style="${HEAD_CELL}">Due</th><th style="${HEAD_CELL}">Stage</th></tr>
      ${rows}
    </table>
  </td></tr>`;
}

function inactivityLabel(days: number | null): string {
  if (days == null) return `<span style="color:#b91c1c;font-weight:600;">never</span>`;
  if (days >= NEGLECTED_DAYS) return `<span style="color:#b45309;font-weight:600;">${days}d ago</span>`;
  return `${days}d ago`;
}

function neglectedTable(items: NeglectedDealItem[]): string {
  const rows = items
    .map(
      (d) => `<tr>
        <td style="${CELL}">${dealLink(d.salesId, d.title)}<div style="color:#9ca3af;font-size:11px;">${esc(d.salesId)}</div></td>
        <td style="${CELL}">${esc(d.clientName) || "—"}</td>
        <td style="${CELL}white-space:nowrap;">${fmtAmount(d.amountEur)}</td>
        <td style="${CELL}white-space:nowrap;">${d.dueDate ? fmtDate(d.dueDate) : '<span style="color:#9ca3af;">none</span>'}</td>
        <td style="${CELL}white-space:nowrap;">${inactivityLabel(d.taskInactiveDays)}</td>
        <td style="${CELL}white-space:nowrap;">${inactivityLabel(d.activityInactiveDays)}</td>
        <td style="${CELL}white-space:nowrap;">${esc(d.stageName)}</td>
      </tr>`
    )
    .join("");
  return `<tr><td style="padding:4px 0 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <tr>
        <th style="${HEAD_CELL}">Deal</th><th style="${HEAD_CELL}">Client</th><th style="${HEAD_CELL}">Amount</th>
        <th style="${HEAD_CELL}">Deadline</th><th style="${HEAD_CELL}">Last task</th><th style="${HEAD_CELL}">Last activity</th><th style="${HEAD_CELL}">Stage</th>
      </tr>
      ${rows}
    </table>
  </td></tr>`;
}

function statChip(label: string, value: number, accent: string): string {
  return `<td style="padding:0 6px 0 0;">
    <table role="presentation" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #eef0f4;border-radius:10px;">
      <tr><td style="padding:10px 14px;text-align:center;">
        <div style="font-size:22px;font-weight:800;color:${accent};line-height:1;">${value}</div>
        <div style="font-size:11px;color:#6b7280;margin-top:4px;white-space:nowrap;">${esc(label)}</div>
      </td></tr>
    </table>
  </td>`;
}

/** Build the digest subject + HTML + text for a user. */
export function renderUserDigest(digest: UserDigest): { subject: string; html: string; text: string } {
  const { user, overdueTasks, todayTasks, overdueDeals, upcomingDeals, neglectedDeals } = digest;
  const dateLabel = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(digest.generatedAt);

  const firstName = user.name.split(/\s+/)[0] || user.name;

  const stats = `
    <tr><td style="padding:4px 0 0;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        ${statChip("Overdue tasks", overdueTasks.length, "#dc2626")}
        ${statChip("Due today", todayTasks.length, "#2563eb")}
        ${statChip("Overdue deals", overdueDeals.length, "#dc2626")}
        ${statChip("Deals ≤ 7 days", upcomingDeals.length, "#7c3aed")}
        ${statChip("Neglected deals", neglectedDeals.length, "#b45309")}
      </tr></table>
    </td></tr>`;

  const sections: string[] = [];
  if (overdueTasks.length) {
    sections.push(sectionHeader("#dc2626", "Overdue tasks", overdueTasks.length, "Assigned to you and past their due date"));
    sections.push(tasksTable(overdueTasks));
  }
  if (todayTasks.length) {
    sections.push(sectionHeader("#2563eb", "Tasks due today", todayTasks.length, "On your plate for today"));
    sections.push(tasksTable(todayTasks));
  }
  if (overdueDeals.length) {
    sections.push(sectionHeader("#dc2626", "Overdue deals", overdueDeals.length, "Deals you own that are past their close date"));
    sections.push(dealsTable(overdueDeals));
  }
  if (upcomingDeals.length) {
    sections.push(sectionHeader("#7c3aed", "Deals closing in the next 7 days", upcomingDeals.length, "Deals you own with an upcoming close date"));
    sections.push(dealsTable(upcomingDeals));
  }
  if (neglectedDeals.length) {
    sections.push(
      sectionHeader(
        "#b45309",
        "Neglected deals",
        neglectedDeals.length,
        `Active deals (lead / active / closing) with no tasks or activity in ${NEGLECTED_DAYS}+ days, and a deadline in the past or none`
      )
    );
    sections.push(neglectedTable(neglectedDeals));
  }

  const allClear = sections.length === 0;
  const intro = allClear
    ? `<p style="margin:0 0 4px;">Good morning, ${esc(firstName)} — you're all caught up. Nothing overdue, nothing due today, and no neglected deals. 🎉</p>`
    : `<p style="margin:0 0 4px;">Good morning, ${esc(firstName)}. Here's what needs your attention today.</p>`;

  const body = `
    <p style="margin:0 0 14px;color:#6b7280;font-size:13px;">${esc(dateLabel)}</p>
    ${intro}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${allClear ? "" : stats}
      ${sections.join("\n")}
    </table>`;

  const html = renderEmailLayout("Your daily priorities", body, `${APP_BASE_URL}/dashboard`, "Open dashboard");
  const subject = allClear
    ? `Your daily priorities — all clear`
    : `Your daily priorities — ${overdueTasks.length} overdue task${overdueTasks.length === 1 ? "" : "s"}, ${overdueDeals.length} overdue deal${overdueDeals.length === 1 ? "" : "s"}`;

  const text = renderText(digest, dateLabel, firstName);
  return { subject, html, text };
}

function renderText(digest: UserDigest, dateLabel: string, firstName: string): string {
  const lines: string[] = [`${APP_NAME} — Your daily priorities`, dateLabel, ""];
  const taskLines = (items: TaskItem[]) =>
    items.map((t) => `  • ${t.title} — ${t.dealTitle} (${t.dealSalesId}) — due ${fmtDate(t.dueDate)} — ${urgencyLabel(t.urgency)}`);
  const dealLines = (items: DealItem[]) =>
    items.map((d) => `  • ${d.title} (${d.salesId}) — ${d.clientName ?? "—"} — ${fmtAmount(d.amountEur)} — due ${fmtDate(d.dueDate)} — ${d.stageName}`);

  const push = (title: string, arr: string[]) => {
    if (arr.length) lines.push(`${title} (${arr.length})`, ...arr, "");
  };

  push("OVERDUE TASKS", taskLines(digest.overdueTasks));
  push("TASKS DUE TODAY", taskLines(digest.todayTasks));
  push("OVERDUE DEALS", dealLines(digest.overdueDeals));
  push("DEALS CLOSING IN THE NEXT 7 DAYS", dealLines(digest.upcomingDeals));
  if (digest.neglectedDeals.length) {
    lines.push(`NEGLECTED DEALS (${digest.neglectedDeals.length})`);
    for (const d of digest.neglectedDeals) {
      const last = d.taskInactiveDays == null ? "no tasks" : `last task ${d.taskInactiveDays}d ago`;
      lines.push(`  • ${d.title} (${d.salesId}) — ${d.clientName ?? "—"} — ${fmtAmount(d.amountEur)} — deadline ${d.dueDate ? fmtDate(d.dueDate) : "none"} — ${last} — ${d.stageName}`);
    }
    lines.push("");
  }

  if (lines.length <= 3) lines.push("You're all caught up. Nothing needs your attention today.", "");
  lines.push(`Open dashboard: ${APP_BASE_URL}/dashboard`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Sample (for the settings preview when the viewer has no real data)
// ---------------------------------------------------------------------------

/** A realistic, fully-populated digest used to preview the email layout. */
export function sampleDigest(user: DigestUser, now: Date = new Date()): UserDigest {
  const day = (offset: number) => {
    const d = startOfDay(now);
    d.setDate(d.getDate() + offset);
    return d;
  };
  return {
    user,
    generatedAt: now,
    overdueTasks: [
      { id: "s1", title: "Send revised proposal", dealSalesId: "SAL-1042", dealTitle: "Acme security audit", dueDate: day(-3), urgency: "CRITICAL" },
      { id: "s2", title: "Chase signed NDA", dealSalesId: "SAL-1039", dealTitle: "Globex pentest retainer", dueDate: day(-1), urgency: "HIGH" },
    ],
    todayTasks: [
      { id: "s3", title: "Discovery call with CISO", dealSalesId: "SAL-1055", dealTitle: "Initech red-team", dueDate: day(0), urgency: "HIGH" },
      { id: "s4", title: "Follow up on quotation", dealSalesId: "SAL-1042", dealTitle: "Acme security audit", dueDate: day(0), urgency: "MEDIUM" },
    ],
    overdueDeals: [
      { id: "d1", salesId: "SAL-1039", title: "Globex pentest retainer", clientName: "Globex Corp", amountEur: 48000, dueDate: day(-6), stageName: "Negotiation" },
    ],
    upcomingDeals: [
      { id: "d2", salesId: "SAL-1055", title: "Initech red-team", clientName: "Initech", amountEur: 72000, dueDate: day(2), stageName: "Contracting" },
      { id: "d3", salesId: "SAL-1061", title: "Umbrella awareness training", clientName: "Umbrella LLC", amountEur: 15500, dueDate: day(5), stageName: "Quotation Sent" },
    ],
    neglectedDeals: [
      { id: "n1", salesId: "SAL-0987", title: "Soylent compliance gap", clientName: "Soylent Corp", amountEur: 26000, dueDate: day(-42), stageName: "Qualified", taskInactiveDays: 51, activityInactiveDays: 44 },
      { id: "n2", salesId: "SAL-0954", title: "Hooli cloud review", clientName: "Hooli", amountEur: 33000, dueDate: null, stageName: "New", taskInactiveDays: null, activityInactiveDays: 63 },
      { id: "n3", salesId: "SAL-0921", title: "Stark IoT assessment", clientName: "Stark Industries", amountEur: 58000, dueDate: day(-95), stageName: "Follow-up", taskInactiveDays: 38, activityInactiveDays: 38 },
    ],
  };
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export type DigestSendResult = {
  userId: string;
  email: string;
  status: "sent" | "skipped-empty" | "error";
  error?: string;
};

/**
 * Build and send one user's digest. When `includeEmpty` is false (default) and
 * the user has nothing to action, the send is skipped so nobody gets a daily
 * "all clear" email they don't need.
 */
export async function sendUserDigest(
  user: DigestUser,
  opts: { now?: Date; includeEmpty?: boolean; dryRun?: boolean } = {}
): Promise<DigestSendResult> {
  const now = opts.now ?? new Date();
  try {
    const digest = await buildUserDigest(user, now);
    if (!opts.includeEmpty && !digestHasContent(digest)) {
      return { userId: user.id, email: user.email, status: "skipped-empty" };
    }
    if (opts.dryRun) {
      return { userId: user.id, email: user.email, status: "sent" };
    }
    const { subject, html, text } = renderUserDigest(digest);
    await sendEmail({ to: user.email, subject, html, text });
    return { userId: user.id, email: user.email, status: "sent" };
  } catch (err) {
    console.error("[daily-digest] failed for user", user.id, err);
    return { userId: user.id, email: user.email, status: "error", error: (err as Error).message };
  }
}

/**
 * Run the digest for every ACTIVE (enabled) user that has an email. Sequential
 * to stay gentle on the mail provider; each user is isolated so one failure
 * never aborts the batch.
 */
export async function runDailyDigest(
  opts: { now?: Date; includeEmpty?: boolean; dryRun?: boolean } = {}
): Promise<{ total: number; sent: number; skipped: number; errors: number; results: DigestSendResult[] }> {
  const users = await prisma.user.findMany({
    where: { status: "ACTIVE", email: { not: "" } },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });

  const results: DigestSendResult[] = [];
  for (const user of users) {
    results.push(await sendUserDigest(user, opts));
  }

  return {
    total: users.length,
    sent: results.filter((r) => r.status === "sent").length,
    skipped: results.filter((r) => r.status === "skipped-empty").length,
    errors: results.filter((r) => r.status === "error").length,
    results,
  };
}
