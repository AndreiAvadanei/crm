/**
 * Guarded Jira CSV importer.
 *
 * Maps an exported Jira "Sales" project CSV into Bit Sentinel:
 *   - Customer issues   -> Deals (+ auto Clients), salesId = Issue key
 *   - Subtask issues    -> Tasks linked to their parent deal (via Parent key);
 *                          descriptions/comments/attachments are preserved on the parent deal with task context
 *   - Labels            -> Tags
 *   - Custom field (...) -> deal/client fields & custom field values
 *   - Comment columns   -> deal comments
 *   - Attachment columns -> attachment records (original Jira URL kept)
 *
 * Idempotent (upsert on salesId). Defaults to a DRY RUN.
 *
 *   npm run import:jira -- --file ./jira.csv --dry-run   (preview, no writes)
 *   npm run import:jira -- --file ./jira.csv --commit    (apply)
 *   npm run import:jira -- --file ./jira.csv --dry-run --verify-downloads 2
 *   npm run import:jira -- --file ./jira.csv --commit --download-files
 */
import "dotenv/config";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import argon2 from "argon2";
import { parse } from "csv-parse/sync";
import { PrismaClient } from "../src/generated/prisma";
import { parseContactFormEmail, cleanBitSentinelLeadTitle } from "../src/lib/parse-contact-form";

const prisma = new PrismaClient();

// ----------------------------- args -----------------------------
const args = process.argv.slice(2);
const getArg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const FILE = getArg("file") || "./jira.csv";
const COMMIT = args.includes("--commit");
const LIMIT = getArg("limit") ? Number(getArg("limit")) : Infinity;
const MAX_DEALS = getArg("max-deals") ? Number(getArg("max-deals")) : Infinity;
const RESET_CRM_DATA = args.includes("--reset-crm-data");
const CONFIRM_RESET_CRM_DATA = args.includes("--yes-delete-crm-data");
const DOWNLOAD_FILES = args.includes("--download-files");
const VERIFY_DOWNLOADS = getArg("verify-downloads") ? Number(getArg("verify-downloads")) : 0;
const MAX_FILE_BYTES = (getArg("max-file-mb") ? Number(getArg("max-file-mb")) : 25) * 1024 * 1024;
const UPLOADS_ROOT = process.env.UPLOADS_DIR || "./data/uploads";
const IMPORT_USER_EMAIL_DOMAIN = process.env.IMPORT_USER_EMAIL_DOMAIN || "import.local";
const DB_STRING_MAX = 191;

// --------------------------- helpers -----------------------------
const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

function parseJiraDate(raw?: string): Date | null {
  if (!raw) return null;
  // e.g. "08/Jan/22 11:26" or "25/Mar/22"
  const m = raw.trim().match(/^(\d{1,2})\/([A-Za-z]{3})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }
  const day = Number(m[1]);
  const mon = MONTHS[m[2] as keyof typeof MONTHS] ?? 0;
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  const hh = m[4] ? Number(m[4]) : 0;
  const mm = m[5] ? Number(m[5]) : 0;
  return new Date(year, mon, day, hh, mm);
}

/** Split into at most n parts on ';', last part keeps the remainder. */
function splitN(str: string, n: number): string[] {
  const out: string[] = [];
  let rest = str;
  for (let i = 0; i < n - 1; i++) {
    const idx = rest.indexOf(";");
    if (idx === -1) {
      out.push(rest);
      return out;
    }
    out.push(rest.slice(0, idx));
    rest = rest.slice(idx + 1);
  }
  out.push(rest);
  return out;
}

function taskPrefix(issueKey: string, title: string): string {
  return `[Subtask ${issueKey}: ${title}]`;
}

function prefixedTaskFilename(issueKey: string, title: string, filename: string): string {
  const cleanedTitle = title.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  const prefix = `${issueKey} - ${cleanedTitle || "Task"}`;
  return truncateDbString(`${prefix} - ${filename}`);
}

function taskTitle(issueKey: string, summary: string): string {
  const clean = summary.trim();
  return truncateDbString(clean ? `${clean} (${issueKey})` : issueKey);
}

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

async function saveDownloadedFile(data: Buffer, originalName: string): Promise<{ storageKey: string; size: number }> {
  const now = new Date();
  const dir = path.join(String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, "0"));
  const key = path.join(dir, `${crypto.randomUUID()}-${safeName(originalName)}`);
  await fs.promises.mkdir(path.join(UPLOADS_ROOT, dir), { recursive: true });
  await fs.promises.writeFile(path.join(UPLOADS_ROOT, key), data);
  return { storageKey: key, size: data.length };
}

async function deleteStoredFile(storageKey: string): Promise<void> {
  if (!storageKey) return;
  await fs.promises.unlink(path.join(UPLOADS_ROOT, storageKey)).catch(() => {});
}

function jiraAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN) {
    headers.Authorization = `Basic ${Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString("base64")}`;
  }
  if (process.env.JIRA_COOKIE) headers.Cookie = process.env.JIRA_COOKIE;
  return headers;
}

async function fetchJiraAttachment(url: string, filename: string): Promise<{ data: Buffer; mimeType: string | null }> {
  const response = await fetch(url, { headers: jiraAuthHeaders(), redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Failed to download Jira attachment "${filename}" (${response.status} ${response.statusText}) from ${url}`);
  }

  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_FILE_BYTES) {
    throw new Error(`Jira attachment "${filename}" is ${contentLength} bytes, over the ${MAX_FILE_BYTES} byte limit.`);
  }

  const data = Buffer.from(await response.arrayBuffer());
  if (data.length > MAX_FILE_BYTES) {
    throw new Error(`Jira attachment "${filename}" is ${data.length} bytes, over the ${MAX_FILE_BYTES} byte limit.`);
  }

  return { data, mimeType: response.headers.get("content-type") };
}

const LOST = new Set(["Not Qualified", "Closed Lost", "Closed Lost to competition"]);
const WON = new Set(["DONE"]);
const SALES_ID_RE = /^SAL-(\d+)$/;

function salesNumberFromId(salesId: string): number | null {
  const match = salesId.match(SALES_ID_RE);
  if (!match) return null;
  return Number(match[1]);
}

function orderedDate(date: Date, sequence: number): Date {
  // Jira CSV timestamps are minute-precision. Millisecond offsets preserve stable in-row ordering
  // without changing the human-visible Jira date/time.
  return new Date(date.getTime() + sequence);
}

function truncateDbString(value: string, max = DB_STRING_MAX): string {
  const clean = value.trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function nullableDbString(value?: string | null, max = DB_STRING_MAX): string | null {
  const clean = value?.trim();
  return clean ? truncateDbString(clean, max) : null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function jiraTextToCommentHtml(value: string): string {
  return value
    .trim()
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function visibleTextFromCommentBody(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p>/gi, "\n\n")
    .replace(/<\/?p>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();
}

function slugAccount(account: string): string {
  return account.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "unknown";
}

function placeholderEmail(account: string): string {
  return truncateDbString(`jira-${slugAccount(account)}@${IMPORT_USER_EMAIL_DOMAIN}`);
}

function avatarColor(account: string): string {
  const colors = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6"];
  let hash = 0;
  for (const ch of account) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return colors[hash % colors.length];
}

function normalizeHeader(header: string): string {
  return header.replace(/^\uFEFF/, "").trim();
}

function customFieldKey(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function inferCustomFieldType(label: string, value: string): "TEXT" | "TEXTAREA" | "NUMBER" | "DATE" | "BOOLEAN" | "URL" {
  const lower = label.toLowerCase();
  if (/^https?:\/\//i.test(value)) return "URL";
  if (/date|data|semnat|start/i.test(label) && parseJiraDate(value)) return "DATE";
  if (/^(da|nu|yes|no|true|false)$/i.test(value)) return "BOOLEAN";
  if (/value|amount|eur|number|valoare/i.test(lower) && Number.isFinite(Number(value.replace(/[^0-9.-]/g, "")))) return "NUMBER";
  if (value.length > 300 || value.includes("\n")) return "TEXTAREA";
  return "TEXT";
}

// Contact-form parsing lives in src/lib/contact-form-parse.ts (shared with the
// inbound-email webhook). `ContactFormData`, `parseContactFormEmail` and
// `cleanBitSentinelLeadTitle` are imported at the top of this file.

// --------------------------- main --------------------------------
async function main() {
  console.log(`\nJira import — ${COMMIT ? "COMMIT (writing)" : "DRY RUN (no writes)"}\nFile: ${FILE}\n`);
  if (DOWNLOAD_FILES) console.log(`Attachment downloads: enabled, destination ${UPLOADS_ROOT}`);
  if (!COMMIT && VERIFY_DOWNLOADS > 0) console.log(`Attachment download verification: first ${VERIFY_DOWNLOADS} file(s), no DB writes`);
  if (RESET_CRM_DATA) console.log("Bit Sentinel data reset: requested");
  if (RESET_CRM_DATA && !COMMIT) {
    throw new Error("--reset-crm-data is destructive and requires --commit.");
  }
  if (RESET_CRM_DATA && !CONFIRM_RESET_CRM_DATA) {
    throw new Error("--reset-crm-data requires explicit confirmation: add --yes-delete-crm-data.");
  }

  const content = fs.readFileSync(FILE, "utf8");
  const rows: string[][] = parse(content, { skip_empty_lines: true, relax_column_count: true });
  const header = rows[0];
  const body = rows.slice(1);

  // Column index maps (handles duplicate headers).
  const single: Record<string, number> = {};
  const multi: Record<string, number[]> = {};
  const customField: Record<string, number[]> = {};
  header.forEach((rawHeader, i) => {
    const h = normalizeHeader(rawHeader);
    if (single[h] === undefined) single[h] = i;
    (multi[h] ??= []).push(i);
    const cf = h.match(/^Custom field \((.+)\)$/);
    if (cf) (customField[cf[1]] ??= []).push(i);
  });

  const col = (row: string[], name: string) => (single[name] !== undefined ? (row[single[name]] ?? "").trim() : "");
  const cols = (row: string[], name: string) => (multi[name] ?? []).map((i) => (row[i] ?? "").trim());
  const cf = (row: string[], name: string) => {
    for (const i of customField[name] ?? []) {
      const v = (row[i] ?? "").trim();
      if (v) return v;
    }
    return "";
  };
  const cfAll = (row: string[], name: string) => (customField[name] ?? []).map((i) => (row[i] ?? "").trim()).filter(Boolean);
  const first = (row: string[], names: string[]) => {
    for (const n of names) {
      const v = cf(row, n);
      if (v) return v;
    }
    return "";
  };

  const stats = {
    customers: 0,
    subtasks: 0,
    dealsCreated: 0,
    dealsUpdated: 0,
    clients: 0,
    users: 0,
    tasks: 0,
    comments: 0,
    attachments: 0,
    filesDownloaded: 0,
    downloadsVerified: 0,
    contactForms: 0,
    invalidDates: 0,
    maxSal: 0,
  };

  const jiraUserNames = new Map<string, string>();
  const rememberJiraUser = (account: string, displayName?: string) => {
    const id = account.trim();
    if (!id) return;
    const name = displayName?.trim();
    if (name && !jiraUserNames.has(id)) jiraUserNames.set(id, name);
    if (!jiraUserNames.has(id)) jiraUserNames.set(id, id);
  };
  const rememberColumnUser = (row: string[], nameColumn: string, idColumn: string) => {
    rememberJiraUser(col(row, idColumn), col(row, nameColumn));
  };
  const rememberPairedUsers = (row: string[], nameColumn: string, idColumn: string) => {
    const names = cols(row, nameColumn);
    const ids = cols(row, idColumn);
    ids.forEach((id, index) => rememberJiraUser(id, names[index]));
  };
  const parseJiraAccountFromTuple = (value: string, parts: number) => splitN(value, parts)[1]?.trim() ?? "";

  const userCache = new Map<string, string | null>();
  const importPasswordHash = COMMIT ? await argon2.hash(crypto.randomBytes(32).toString("hex"), { type: argon2.argon2id }) : "";
  async function userIdForJiraAccount(account: string, displayName?: string): Promise<string | null> {
    const jiraAccount = account.trim();
    if (!jiraAccount) return null;
    rememberJiraUser(jiraAccount, displayName);
    if (userCache.has(jiraAccount)) return userCache.get(jiraAccount)!;

    if (!COMMIT) {
      userCache.set(jiraAccount, `(user:${jiraAccount})`);
      return userCache.get(jiraAccount)!;
    }

    const name = truncateDbString(jiraUserNames.get(jiraAccount) ?? displayName?.trim() ?? jiraAccount);
    const existingMap = await prisma.jiraUserMap.findUnique({ where: { jiraAccount }, include: { user: true } });
    if (existingMap?.userId) {
      if (name && existingMap.displayName !== name) {
        await prisma.jiraUserMap.update({ where: { jiraAccount }, data: { displayName: name } });
      }
      userCache.set(jiraAccount, existingMap.userId);
      return existingMap.userId;
    }

    const email = placeholderEmail(jiraAccount);
    const user = await prisma.user.upsert({
      where: { email },
      update: { name },
      create: {
        email,
        name,
        passwordHash: importPasswordHash,
        role: "SALES",
        mustChangePassword: true,
        twoFactorEnabled: false,
        avatarColor: avatarColor(jiraAccount),
      },
    });

    await prisma.jiraUserMap.upsert({
      where: { jiraAccount },
      update: { displayName: name, userId: user.id },
      create: { jiraAccount, displayName: name, userId: user.id },
    });
    userCache.set(jiraAccount, user.id);
    stats.users++;
    return user.id;
  }

  for (const row of body) {
    rememberColumnUser(row, "Assignee", "Assignee Id");
    rememberColumnUser(row, "Reporter", "Reporter Id");
    rememberColumnUser(row, "Creator", "Creator Id");
    rememberPairedUsers(row, "Watchers", "Watchers Id");
    for (const c of cols(row, "Comment").filter(Boolean)) rememberJiraUser(parseJiraAccountFromTuple(c, 3));
    for (const a of cols(row, "Attachment").filter(Boolean)) rememberJiraUser(parseJiraAccountFromTuple(a, 4));
  }
  if (!COMMIT) stats.users = jiraUserNames.size;

  async function createDealCommentOnce(dealId: string, body: string, createdAt: Date, authorId?: string | null): Promise<boolean> {
    const rawText = body.trim();
    if (!rawText) return false;
    const html = jiraTextToCommentHtml(rawText);
    const visibleText = visibleTextFromCommentBody(html);

    const secondStart = new Date(createdAt);
    secondStart.setMilliseconds(0);
    const secondEnd = new Date(secondStart.getTime() + 1000);
    const candidates = await prisma.comment.findMany({
      where: { dealId, createdAt: { gte: secondStart, lt: secondEnd } },
    });
    const dupe = candidates.find((c) => visibleTextFromCommentBody(c.body) === visibleText);
    if (dupe) {
      if (authorId && !dupe.authorId) {
        await prisma.comment.update({ where: { id: dupe.id }, data: { authorId } });
        return true;
      }
      return false;
    }

    await prisma.comment.create({ data: { dealId, body: html, createdAt, authorId: authorId ?? null } });
    return true;
  }

  async function importDealAttachment(
    dealId: string,
    filename: string,
    sourceUrl: string | null,
    createdAt: Date,
    uploadedById?: string | null,
  ): Promise<boolean> {
    const safeFilename = truncateDbString(filename);
    let attachment = await prisma.attachment.findFirst({ where: { dealId, filename: safeFilename, sourceUrl } });
    let changed = false;

    if (!attachment) {
      // Create the DB marker before downloading. If the process dies mid-download, rerun fills this row.
      attachment = await prisma.attachment.create({
        data: {
          dealId,
          filename: safeFilename,
          storageKey: "",
          size: 0,
          mimeType: null,
          sourceUrl,
          createdAt,
          uploadedById: uploadedById ?? null,
        },
      });
      changed = true;
    } else if (uploadedById && !attachment.uploadedById) {
      attachment = await prisma.attachment.update({ where: { id: attachment.id }, data: { uploadedById } });
      changed = true;
    }

    if (DOWNLOAD_FILES && sourceUrl && !attachment.storageKey) {
      const fetched = await fetchJiraAttachment(sourceUrl, safeFilename);
      const saved = await saveDownloadedFile(fetched.data, safeFilename);
      await prisma.attachment.update({
        where: { id: attachment.id },
        data: {
          storageKey: saved.storageKey,
          size: saved.size,
          mimeType: fetched.mimeType,
        },
      });
      stats.filesDownloaded++;
      changed = true;
    }

    return changed;
  }

  const dateProblems: string[] = [];
  const noteBadDate = (raw: string, context: string) => {
    stats.invalidDates++;
    if (dateProblems.length < 10) dateProblems.push(`${context}: "${raw}"`);
  };
  const optionalDate = (raw: string, context: string): Date | null => {
    if (!raw) return null;
    const parsed = parseJiraDate(raw);
    if (!parsed) noteBadDate(raw, context);
    return parsed;
  };
  const requiredDate = (raw: string, fallback: Date | null, context: string): Date => {
    if (!raw) return fallback ?? new Date();
    const parsed = parseJiraDate(raw);
    if (!parsed) noteBadDate(raw, context);
    return parsed ?? fallback ?? new Date();
  };

  let verifiedDownloads = 0;
  async function prepareAttachmentDownload(
    sourceUrl: string | null,
    filename: string,
  ): Promise<{ storageKey: string; size: number; mimeType: string | null } | undefined> {
    if (!sourceUrl) return undefined;

    if (!COMMIT && verifiedDownloads < VERIFY_DOWNLOADS) {
      const fetched = await fetchJiraAttachment(sourceUrl, filename);
      verifiedDownloads++;
      stats.downloadsVerified++;
      console.log(`Verified download ${verifiedDownloads}/${VERIFY_DOWNLOADS}: ${filename} (${fetched.data.length} bytes)`);
      return undefined;
    }

    return undefined;
  }

  // Stage cache (create-if-missing).
  const stages = new Map<string, string>();
  const pipeline = await prisma.pipeline.findFirst({ where: { isDefault: true }, include: { stages: true } });
  if (!pipeline) throw new Error("No default pipeline. Run the seed first.");
  for (const s of pipeline.stages) stages.set(s.name, s.id);

  async function stageId(name: string): Promise<string> {
    const key = truncateDbString(name || "New");
    if (stages.has(key)) return stages.get(key)!;
    if (!COMMIT) {
      stages.set(key, `(new:${key})`);
      return stages.get(key)!;
    }
    const order = (await prisma.stage.count({ where: { pipelineId: pipeline!.id } })) + 1;
    const s = await prisma.stage.create({
      data: {
        pipelineId: pipeline!.id,
        name: key,
        order,
        color: "#64748b",
        probability: WON.has(key) ? 100 : LOST.has(key) ? 0 : 40,
        isWon: WON.has(key),
        isLost: LOST.has(key),
      },
    });
    stages.set(key, s.id);
    return s.id;
  }

  // Custom field defs.
  const defCache = new Map<string, string>();
  for (const d of await prisma.customFieldDefinition.findMany()) defCache.set(`${d.entity}:${d.key}`, d.id);

  async function customFieldDefId(entity: "DEAL" | "CLIENT", label: string, value: string): Promise<string> {
    const safeLabel = truncateDbString(label);
    const key = customFieldKey(safeLabel);
    const cacheKey = `${entity}:${key}`;
    const cached = defCache.get(cacheKey);
    if (cached) return cached;
    if (!COMMIT) {
      defCache.set(cacheKey, `(field:${cacheKey})`);
      return defCache.get(cacheKey)!;
    }
    const order = await prisma.customFieldDefinition.count({ where: { entity } });
    const def = await prisma.customFieldDefinition.upsert({
      where: { entity_key: { entity, key } },
      update: { label: safeLabel },
      create: { entity, key, label: safeLabel, type: inferCustomFieldType(safeLabel, value), order },
    });
    defCache.set(cacheKey, def.id);
    return def.id;
  }

  async function saveCustomValue(entity: "DEAL" | "CLIENT", entityId: string, label: string, value: string) {
    const clean = value.trim();
    if (!clean) return;
    const definitionId = await customFieldDefId(entity, label, clean);
    if (!COMMIT) return;
    await prisma.customFieldValue.upsert({
      where: { definitionId_entityId: { definitionId, entityId } },
      update: { value: clean },
      create: { definitionId, entity, entityId, value: clean },
    });
  }

  const dealCustomFields = new Map([
    ["Deal Type", "Deal Type"],
    ["Type of Engagement", "Type of Engagement"],
    ["Deal Details", "Deal Details"],
    ["Source", "Source"],
    ["Contractare Google Drive", "Contractare Google Drive"],
    ["Ofertare Google Drive", "Ofertare Google Drive"],
  ]);

  function customValuesFor(row: string[]): Array<[string, string]> {
    const out = new Map<string, string>();
    for (const [label, displayLabel] of dealCustomFields) {
      const indexes = customField[label] ?? [];
      for (const i of indexes) {
        const value = (row[i] ?? "").trim();
        if (value) {
          out.set(displayLabel, out.has(displayLabel) ? `${out.get(displayLabel)}\n${value}` : value);
        }
      }
    }
    return [...out.entries()];
  }

  function dealTagsFor(row: string[]): string[] {
    return [...new Set([...cols(row, "Labels"), ...cfAll(row, "Tip proiect")].map((v) => v.trim()).filter(Boolean))];
  }

  // Tag cache.
  const tagCache = new Map<string, string>();
  async function tagId(name: string): Promise<string> {
    const safeName = truncateDbString(name);
    if (tagCache.has(safeName)) return tagCache.get(safeName)!;
    if (!COMMIT) {
      tagCache.set(safeName, `(tag:${safeName})`);
      return tagCache.get(safeName)!;
    }
    const t = await prisma.tag.upsert({ where: { name: safeName }, update: {}, create: { name: safeName, color: "#64748b" } });
    tagCache.set(safeName, t.id);
    return t.id;
  }

  // Client cache by company name.
  const clientCache = new Map<string, string>();

  async function resetCrmImportData() {
    const attachments = await prisma.attachment.findMany({ select: { storageKey: true } });
    await prisma.$transaction([
      prisma.auditLog.deleteMany({ where: { entity: { in: ["Deal", "Client", "Task", "Comment", "Attachment"] } } }),
      prisma.share.deleteMany({ where: { subject: { in: ["DEAL", "CLIENT"] } } }),
      prisma.customFieldValue.deleteMany({ where: { entity: { in: ["DEAL", "CLIENT"] } } }),
      prisma.attachment.deleteMany(),
      prisma.comment.deleteMany(),
      prisma.task.deleteMany(),
      prisma.deal.deleteMany(),
      prisma.client.deleteMany(),
      prisma.counter.updateMany({ where: { name: "deal_sal" }, data: { value: 0 } }),
    ]);
    await Promise.all(attachments.map((a) => deleteStoredFile(a.storageKey)));
    console.log(`Reset complete: deleted ${attachments.length} attachment file reference(s), all deals/tasks/comments/files/clients.`);
  }

  if (RESET_CRM_DATA) {
    await resetCrmImportData();
  }

  type SubtaskRow = { row: string[]; parentKey: string };
  const subtasks: SubtaskRow[] = [];
  const selectedDealKeys = new Set<string>();
  if (Number.isFinite(MAX_DEALS)) {
    for (const row of body) {
      if (selectedDealKeys.size >= MAX_DEALS) break;
      if (col(row, "Issue Type") !== "Customer") continue;
      const key = col(row, "Issue key");
      if (key) selectedDealKeys.add(key);
    }
  }
  const shouldImportDeal = (key: string) => !Number.isFinite(MAX_DEALS) || selectedDealKeys.has(key);

  let processed = 0;
  for (const row of body) {
    if (processed >= LIMIT) break;
    const type = col(row, "Issue Type");
    const key = col(row, "Issue key");
    if (!key) continue;

    if (type === "Subtask") {
      const parentKey = col(row, "Parent key");
      if (!shouldImportDeal(parentKey)) continue;
      subtasks.push({ row, parentKey });
      processed++;
      continue;
    }
    if (type !== "Customer") continue; // ignore other types
    if (!shouldImportDeal(key)) continue;
    stats.customers++;
    processed++;

    const salesNum = salesNumberFromId(key);
    if (salesNum === null) {
      throw new Error(`Customer row has invalid Jira Issue key "${key}". Expected exact SAL number format, e.g. SAL-123.`);
    }
    stats.maxSal = Math.max(stats.maxSal, salesNum);

    const contactForm = parseContactFormEmail(col(row, "Description"));
    if (contactForm) stats.contactForms++;

    // --- Client ---
    const rawCompanyName = contactForm?.company || first(row, ["Company Name", "Customer"]);
    const companyName = nullableDbString(rawCompanyName);
    let clientId: string | null = null;
    if (companyName) {
      if (clientCache.has(companyName)) {
        clientId = clientCache.get(companyName)!;
      } else if (COMMIT) {
        const existing = await prisma.client.findFirst({ where: { name: companyName } });
        const data = {
          name: companyName,
          website: nullableDbString(first(row, ["Company Website", "Website", "Project URL"])),
          country: nullableDbString(cf(row, "Country")),
          size: nullableDbString(cf(row, "Company size")),
          contactName: nullableDbString(contactForm?.fullName || first(row, ["Main Contact Full Name", "Customer Title"])),
          contactEmail: nullableDbString(contactForm?.email || first(row, ["Main Contact Email", "Company Email"])),
          contactPhone: nullableDbString(contactForm?.phone || first(row, ["Main Contact Phone number", "Phone Number"])),
        };
        const client = existing
          ? await prisma.client.update({ where: { id: existing.id }, data })
          : await prisma.client.create({ data });
        clientId = client.id;
        clientCache.set(companyName, clientId);
        if (!existing) stats.clients++;
      } else {
        clientCache.set(companyName, `(client:${companyName})`);
        stats.clients++;
      }
    }

    // --- Deal ---
    const statusName = col(row, "Status");
    const sId = await stageId(statusName);
    const amountRaw = cf(row, "Estimated Value (EUR)");
    const amount = amountRaw ? Number(amountRaw.replace(/[^0-9.]/g, "")) : null;
    const created = optionalDate(col(row, "Created"), `${key} Created`);
    const updated = optionalDate(col(row, "Updated"), `${key} Updated`);
    const resolved = optionalDate(col(row, "Resolved"), `${key} Resolved`);
    const due = optionalDate(col(row, "Due date"), `${key} Due date`);
    const labels = dealTagsFor(row);
    const rawTitle = cleanBitSentinelLeadTitle(col(row, "Summary") || key, contactForm);
    const title = truncateDbString(rawTitle);
    const descriptionParts = [];
    if (rawTitle !== title) descriptionParts.push(`Original Jira title:\n${rawTitle}`);
    if (col(row, "Description")) descriptionParts.push(col(row, "Description"));
    const description = descriptionParts.length > 0 ? descriptionParts.join("\n\n") : null;
    const isClosed = WON.has(statusName) || LOST.has(statusName);
    const ownerId = await userIdForJiraAccount(col(row, "Assignee Id"), col(row, "Assignee"));

    if (COMMIT) {
      const tagConnect = [];
      for (const l of labels) tagConnect.push({ id: await tagId(l) });

      // Preserve the Jira SAL-ID exactly. The importer never calls nextSalesId() for Jira deals.
      const existing = await prisma.deal.findUnique({ where: { salesId: key } });
      const baseData = {
        title,
        description,
        amountEur: amount ?? null,
        clientId,
        pipelineId: pipeline.id,
        stageId: sId,
        ownerId,
        dueDate: due,
        closedAt: isClosed ? resolved ?? created : null,
        createdAt: created ?? undefined,
        updatedAt: updated ?? undefined,
      };
      const deal = existing
        ? await prisma.deal.update({ where: { id: existing.id }, data: baseData })
        : await prisma.deal.create({ data: { salesId: key, ...baseData } });
      existing ? stats.dealsUpdated++ : stats.dealsCreated++;

      // Tags (replace set on each run for idempotency)
      await prisma.deal.update({ where: { id: deal.id }, data: { tags: { set: tagConnect } } });

      // Custom field values
      for (const [label, value] of customValuesFor(row)) {
        await saveCustomValue("DEAL", deal.id, label, value);
      }

      // Comments
      for (const [index, c] of cols(row, "Comment").filter(Boolean).entries()) {
        const [dateStr, authorAccount, bodyText] = splitN(c, 3);
        const when = orderedDate(requiredDate(dateStr, created, `${key} Comment`), index);
        const text = (bodyText ?? "").trim();
        const authorId = await userIdForJiraAccount(authorAccount);
        if (await createDealCommentOnce(deal.id, text, when, authorId)) {
          stats.comments++;
        }
      }

      // Attachments (kept as reference to original Jira URL)
      for (const [index, a] of cols(row, "Attachment").filter(Boolean).entries()) {
        const [dateStr, uploaderAccount, filename, url] = splitN(a, 4);
        const fname = (filename ?? "").trim() || "attachment";
        const sourceUrl = (url ?? "").trim() || null;
        const when = orderedDate(requiredDate(dateStr, created, `${key} Attachment`), index);
        const uploadedById = await userIdForJiraAccount(uploaderAccount);
        if (await importDealAttachment(deal.id, fname, sourceUrl, when, uploadedById)) {
          stats.attachments++;
        }
      }
    } else {
      // dry run: count comments/attachments that would import
      for (const [index, c] of cols(row, "Comment").filter(Boolean).entries()) {
        const [dateStr, authorAccount] = splitN(c, 3);
        orderedDate(requiredDate(dateStr, created, `${key} Comment`), index);
        await userIdForJiraAccount(authorAccount);
        stats.comments++;
      }
      for (const [index, a] of cols(row, "Attachment").filter(Boolean).entries()) {
        const [dateStr, uploaderAccount, filename, url] = splitN(a, 4);
        const fname = (filename ?? "").trim() || "attachment";
        const sourceUrl = (url ?? "").trim() || null;
        orderedDate(requiredDate(dateStr, created, `${key} Attachment`), index);
        await userIdForJiraAccount(uploaderAccount);
        await prepareAttachmentDownload(sourceUrl, fname);
        stats.attachments++;
      }
      stats.dealsCreated++;
      for (const l of labels) await tagId(l);
    }
  }

  // --- Subtasks -> tasks ---
  for (const { row, parentKey } of subtasks) {
    if (!parentKey) continue;
    const key = col(row, "Issue key");
    const title = taskTitle(key, col(row, "Summary"));
    const status = WON.has(col(row, "Status")) || col(row, "Status") === "DONE" ? "DONE" : "OPEN";
    const due = optionalDate(col(row, "Due date"), `${key} Due date`);
    const created = optionalDate(col(row, "Created"), `${key} Created`);
    const updated = optionalDate(col(row, "Updated"), `${key} Updated`);
    const prefix = taskPrefix(key, title);
    const assigneeId = await userIdForJiraAccount(col(row, "Assignee Id"), col(row, "Assignee"));
    if (COMMIT) {
      const deal = await prisma.deal.findUnique({ where: { salesId: parentKey }, select: { id: true } });
      if (!deal) continue;
      const oldTitle = col(row, "Summary") || key;
      const dupe = await prisma.task.findFirst({ where: { dealId: deal.id, OR: [{ title }, { title: oldTitle }, { title: key }] } });
      const taskData = {
        status: status as never,
        assigneeId,
        dueDate: due,
        completedAt: status === "DONE" ? optionalDate(col(row, "Resolved"), `${key} Resolved`) ?? created : null,
        createdAt: created ?? undefined,
        updatedAt: updated ?? undefined,
      };
      if (!dupe) {
        await prisma.task.create({
          data: {
            dealId: deal.id,
            title,
            ...taskData,
          },
        });
        stats.tasks++;
      } else {
        await prisma.task.update({ where: { id: dupe.id }, data: taskData });
      }

      // Task-level detail is preserved on the parent deal with the Jira subtask context.
      const description = col(row, "Description");
      if (description) {
        const body = `${prefix}\nDescription:\n${description}`;
        const authorId = await userIdForJiraAccount(col(row, "Creator Id"), col(row, "Creator"));
        if (await createDealCommentOnce(deal.id, body, created ?? new Date(), authorId)) {
          stats.comments++;
        }
      }

      for (const [index, c] of cols(row, "Comment").filter(Boolean).entries()) {
        const [dateStr, authorAccount, bodyText] = splitN(c, 3);
        const text = (bodyText ?? "").trim();
        if (!text) continue;

        const body = `${prefix}\nComment:\n${text}`;
        const when = orderedDate(requiredDate(dateStr, created, `${key} Comment`), index + 1);
        const authorId = await userIdForJiraAccount(authorAccount);
        if (await createDealCommentOnce(deal.id, body, when, authorId)) {
          stats.comments++;
        }
      }

      for (const [index, a] of cols(row, "Attachment").filter(Boolean).entries()) {
        const [dateStr, uploaderAccount, filename, url] = splitN(a, 4);
        const fname = prefixedTaskFilename(key, title, (filename ?? "").trim() || "attachment");
        const sourceUrl = (url ?? "").trim() || null;
        const when = orderedDate(requiredDate(dateStr, created, `${key} Attachment`), index);
        const uploadedById = await userIdForJiraAccount(uploaderAccount);
        if (await importDealAttachment(deal.id, fname, sourceUrl, when, uploadedById)) {
          stats.attachments++;
        }
      }
    } else {
      stats.tasks++;
      if (col(row, "Description")) {
        await userIdForJiraAccount(col(row, "Creator Id"), col(row, "Creator"));
        stats.comments++;
      }
      for (const [index, c] of cols(row, "Comment").filter(Boolean).entries()) {
        const [dateStr, authorAccount] = splitN(c, 3);
        orderedDate(requiredDate(dateStr, created, `${key} Comment`), index + 1);
        await userIdForJiraAccount(authorAccount);
        stats.comments++;
      }
      for (const [index, a] of cols(row, "Attachment").filter(Boolean).entries()) {
        const [dateStr, uploaderAccount, filename, url] = splitN(a, 4);
        const fname = prefixedTaskFilename(key, title, (filename ?? "").trim() || "attachment");
        const sourceUrl = (url ?? "").trim() || null;
        orderedDate(requiredDate(dateStr, created, `${key} Attachment`), index);
        await userIdForJiraAccount(uploaderAccount);
        await prepareAttachmentDownload(sourceUrl, fname);
        stats.attachments++;
      }
    }
  }

  // Bump SAL counter so new deals don't collide with imported ids.
  if (COMMIT && stats.maxSal > 0) {
    await prisma.counter.upsert({ where: { name: "deal_sal" }, update: {}, create: { name: "deal_sal", value: 0 } });
    await prisma.$executeRaw`UPDATE Counter SET value = ${stats.maxSal} WHERE name = 'deal_sal' AND value < ${stats.maxSal}`;
  }

  console.log("Summary");
  console.log("-------");
  console.log(`Customer rows parsed : ${stats.customers}`);
  console.log(`Subtask rows parsed  : ${subtasks.length}`);
  console.log(`Deals created        : ${stats.dealsCreated}`);
  console.log(`Deals updated        : ${stats.dealsUpdated}`);
  console.log(`Clients              : ${stats.clients}`);
  console.log(`Users                : ${stats.users}`);
  console.log(`Tasks                : ${stats.tasks}`);
  console.log(`Comments             : ${stats.comments}`);
  console.log(`Attachments          : ${stats.attachments}`);
  console.log(`Files downloaded     : ${stats.filesDownloaded}`);
  console.log(`Downloads verified   : ${stats.downloadsVerified}`);
  console.log(`Contact forms parsed : ${stats.contactForms}`);
  console.log(`Invalid dates        : ${stats.invalidDates}`);
  console.log(`Max SAL number       : ${stats.maxSal}`);
  if (dateProblems.length > 0) {
    console.log("\nInvalid date samples:");
    for (const problem of dateProblems) console.log(`- ${problem}`);
    throw new Error("Jira import has invalid dates. Fix the CSV or date parser before committing.");
  }
  console.log(`\n${COMMIT ? "Import complete." : "Dry run complete — re-run with --commit to apply."}\n`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
