/**
 * Guarded Jira CSV importer.
 *
 * Maps an exported Jira "Sales" project CSV into the CRM:
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
import { parse } from "csv-parse/sync";
import { PrismaClient } from "../src/generated/prisma";

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
const DOWNLOAD_FILES = args.includes("--download-files");
const VERIFY_DOWNLOADS = getArg("verify-downloads") ? Number(getArg("verify-downloads")) : 0;
const MAX_FILE_BYTES = (getArg("max-file-mb") ? Number(getArg("max-file-mb")) : 25) * 1024 * 1024;
const UPLOADS_ROOT = process.env.UPLOADS_DIR || "./data/uploads";

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
  return `${prefix} - ${filename}`;
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

// --------------------------- main --------------------------------
async function main() {
  console.log(`\nJira import — ${COMMIT ? "COMMIT (writing)" : "DRY RUN (no writes)"}\nFile: ${FILE}\n`);
  if (DOWNLOAD_FILES) console.log(`Attachment downloads: enabled, destination ${UPLOADS_ROOT}`);
  if (!COMMIT && VERIFY_DOWNLOADS > 0) console.log(`Attachment download verification: first ${VERIFY_DOWNLOADS} file(s), no DB writes`);

  const content = fs.readFileSync(FILE, "utf8");
  const rows: string[][] = parse(content, { skip_empty_lines: true, relax_column_count: true });
  const header = rows[0];
  const body = rows.slice(1);

  // Column index maps (handles duplicate headers).
  const single: Record<string, number> = {};
  const multi: Record<string, number[]> = {};
  const customField: Record<string, number[]> = {};
  header.forEach((h, i) => {
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
    tasks: 0,
    comments: 0,
    attachments: 0,
    filesDownloaded: 0,
    downloadsVerified: 0,
    invalidDates: 0,
    maxSal: 0,
  };

  async function createDealCommentOnce(dealId: string, body: string, createdAt: Date): Promise<boolean> {
    const text = body.trim();
    if (!text) return false;

    const secondStart = new Date(createdAt);
    secondStart.setMilliseconds(0);
    const secondEnd = new Date(secondStart.getTime() + 1000);
    const dupe = await prisma.comment.findFirst({
      where: { dealId, body: text, createdAt: { gte: secondStart, lt: secondEnd } },
    });
    if (dupe) return false;

    await prisma.comment.create({ data: { dealId, body: text, createdAt } });
    return true;
  }

  async function importDealAttachment(
    dealId: string,
    filename: string,
    sourceUrl: string | null,
    createdAt: Date,
  ): Promise<boolean> {
    let attachment = await prisma.attachment.findFirst({ where: { dealId, filename, sourceUrl } });
    let changed = false;

    if (!attachment) {
      // Create the DB marker before downloading. If the process dies mid-download, rerun fills this row.
      attachment = await prisma.attachment.create({
        data: {
          dealId,
          filename,
          storageKey: "",
          size: 0,
          mimeType: null,
          sourceUrl,
          createdAt,
        },
      });
      changed = true;
    }

    if (DOWNLOAD_FILES && sourceUrl && !attachment.storageKey) {
      const fetched = await fetchJiraAttachment(sourceUrl, filename);
      const saved = await saveDownloadedFile(fetched.data, filename);
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
    const key = name || "New";
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

  // Deal custom field defs.
  const defByKey = new Map<string, string>();
  for (const d of await prisma.customFieldDefinition.findMany({ where: { entity: "DEAL" } })) defByKey.set(d.key, d.id);

  // Tag cache.
  const tagCache = new Map<string, string>();
  async function tagId(name: string): Promise<string> {
    if (tagCache.has(name)) return tagCache.get(name)!;
    if (!COMMIT) {
      tagCache.set(name, `(tag:${name})`);
      return tagCache.get(name)!;
    }
    const t = await prisma.tag.upsert({ where: { name }, update: {}, create: { name, color: "#64748b" } });
    tagCache.set(name, t.id);
    return t.id;
  }

  // Client cache by company name.
  const clientCache = new Map<string, string>();

  type SubtaskRow = { row: string[]; parentKey: string };
  const subtasks: SubtaskRow[] = [];

  let processed = 0;
  for (const row of body) {
    if (processed >= LIMIT) break;
    const type = col(row, "Issue Type");
    const key = col(row, "Issue key");
    if (!key) continue;

    if (type === "Subtask") {
      subtasks.push({ row, parentKey: col(row, "Parent key") });
      processed++;
      continue;
    }
    if (type !== "Customer") continue; // ignore other types
    stats.customers++;
    processed++;

    const salesNum = salesNumberFromId(key);
    if (salesNum === null) {
      throw new Error(`Customer row has invalid Jira Issue key "${key}". Expected exact SAL number format, e.g. SAL-123.`);
    }
    stats.maxSal = Math.max(stats.maxSal, salesNum);

    // --- Client ---
    const companyName = first(row, ["Company Name", "Customer"]);
    let clientId: string | null = null;
    if (companyName) {
      if (clientCache.has(companyName)) {
        clientId = clientCache.get(companyName)!;
      } else if (COMMIT) {
        const existing = await prisma.client.findFirst({ where: { name: companyName } });
        const data = {
          name: companyName,
          website: first(row, ["Company Website", "Website", "Project URL"]) || null,
          country: cf(row, "Country") || null,
          size: cf(row, "Company size") || null,
          contactName: first(row, ["Main Contact Full Name", "Customer Title"]) || null,
          contactEmail: first(row, ["Main Contact Email", "Company Email"]) || null,
          contactPhone: first(row, ["Main Contact Phone number", "Phone Number"]) || null,
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
    const labels = cols(row, "Labels").filter(Boolean);
    const description = col(row, "Description") || null;
    const isClosed = WON.has(statusName) || LOST.has(statusName);

    if (COMMIT) {
      const tagConnect = [];
      for (const l of labels) tagConnect.push({ id: await tagId(l) });

      // Preserve the Jira SAL-ID exactly. The importer never calls nextSalesId() for Jira deals.
      const existing = await prisma.deal.findUnique({ where: { salesId: key } });
      const baseData = {
        title: col(row, "Summary") || key,
        description,
        amountEur: amount ?? null,
        clientId,
        pipelineId: pipeline.id,
        stageId: sId,
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
      const cfMap: Record<string, string> = {
        deal_type: first(row, ["Deal Type"]),
        type_of_engagement: first(row, ["Type of Engagement"]),
        deal_details: first(row, ["Deal Details"]),
        source: first(row, ["Source"]),
      };
      for (const [k, v] of Object.entries(cfMap)) {
        const defId = defByKey.get(k);
        if (defId && v) {
          await prisma.customFieldValue.upsert({
            where: { definitionId_entityId: { definitionId: defId, entityId: deal.id } },
            update: { value: v },
            create: { definitionId: defId, entity: "DEAL", entityId: deal.id, value: v },
          });
        }
      }

      // Comments
      for (const [index, c] of cols(row, "Comment").filter(Boolean).entries()) {
        const [dateStr, , bodyText] = splitN(c, 3);
        const when = orderedDate(requiredDate(dateStr, created, `${key} Comment`), index);
        const text = (bodyText ?? "").trim();
        if (await createDealCommentOnce(deal.id, text, when)) {
          stats.comments++;
        }
      }

      // Attachments (kept as reference to original Jira URL)
      for (const [index, a] of cols(row, "Attachment").filter(Boolean).entries()) {
        const [dateStr, , filename, url] = splitN(a, 4);
        const fname = (filename ?? "").trim() || "attachment";
        const sourceUrl = (url ?? "").trim() || null;
        const when = orderedDate(requiredDate(dateStr, created, `${key} Attachment`), index);
        if (await importDealAttachment(deal.id, fname, sourceUrl, when)) {
          stats.attachments++;
        }
      }
    } else {
      // dry run: count comments/attachments that would import
      for (const [index, c] of cols(row, "Comment").filter(Boolean).entries()) {
        const [dateStr] = splitN(c, 3);
        orderedDate(requiredDate(dateStr, created, `${key} Comment`), index);
        stats.comments++;
      }
      for (const [index, a] of cols(row, "Attachment").filter(Boolean).entries()) {
        const [dateStr, , filename, url] = splitN(a, 4);
        const fname = (filename ?? "").trim() || "attachment";
        const sourceUrl = (url ?? "").trim() || null;
        orderedDate(requiredDate(dateStr, created, `${key} Attachment`), index);
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
    const title = col(row, "Summary") || key || "Task";
    const status = WON.has(col(row, "Status")) || col(row, "Status") === "DONE" ? "DONE" : "OPEN";
    const due = optionalDate(col(row, "Due date"), `${key} Due date`);
    const created = optionalDate(col(row, "Created"), `${key} Created`);
    const updated = optionalDate(col(row, "Updated"), `${key} Updated`);
    const prefix = taskPrefix(key, title);
    if (COMMIT) {
      const deal = await prisma.deal.findUnique({ where: { salesId: parentKey }, select: { id: true } });
      if (!deal) continue;
      const dupe = await prisma.task.findFirst({ where: { dealId: deal.id, title } });
      if (!dupe) {
        await prisma.task.create({
          data: {
            dealId: deal.id,
            title,
            status: status as never,
            dueDate: due,
            completedAt: status === "DONE" ? optionalDate(col(row, "Resolved"), `${key} Resolved`) ?? created : null,
            createdAt: created ?? undefined,
            updatedAt: updated ?? undefined,
          },
        });
        stats.tasks++;
      }

      // Task-level detail is preserved on the parent deal with the Jira subtask context.
      const description = col(row, "Description");
      if (description) {
        const body = `${prefix}\nDescription:\n${description}`;
        if (await createDealCommentOnce(deal.id, body, created ?? new Date())) {
          stats.comments++;
        }
      }

      for (const [index, c] of cols(row, "Comment").filter(Boolean).entries()) {
        const [dateStr, , bodyText] = splitN(c, 3);
        const text = (bodyText ?? "").trim();
        if (!text) continue;

        const body = `${prefix}\nComment:\n${text}`;
        const when = orderedDate(requiredDate(dateStr, created, `${key} Comment`), index + 1);
        if (await createDealCommentOnce(deal.id, body, when)) {
          stats.comments++;
        }
      }

      for (const [index, a] of cols(row, "Attachment").filter(Boolean).entries()) {
        const [dateStr, , filename, url] = splitN(a, 4);
        const fname = prefixedTaskFilename(key, title, (filename ?? "").trim() || "attachment");
        const sourceUrl = (url ?? "").trim() || null;
        const when = orderedDate(requiredDate(dateStr, created, `${key} Attachment`), index);
        if (await importDealAttachment(deal.id, fname, sourceUrl, when)) {
          stats.attachments++;
        }
      }
    } else {
      stats.tasks++;
      if (col(row, "Description")) stats.comments++;
      for (const [index, c] of cols(row, "Comment").filter(Boolean).entries()) {
        const [dateStr] = splitN(c, 3);
        orderedDate(requiredDate(dateStr, created, `${key} Comment`), index + 1);
        stats.comments++;
      }
      for (const [index, a] of cols(row, "Attachment").filter(Boolean).entries()) {
        const [dateStr, , filename, url] = splitN(a, 4);
        const fname = prefixedTaskFilename(key, title, (filename ?? "").trim() || "attachment");
        const sourceUrl = (url ?? "").trim() || null;
        orderedDate(requiredDate(dateStr, created, `${key} Attachment`), index);
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
  console.log(`Tasks                : ${stats.tasks}`);
  console.log(`Comments             : ${stats.comments}`);
  console.log(`Attachments          : ${stats.attachments}`);
  console.log(`Files downloaded     : ${stats.filesDownloaded}`);
  console.log(`Downloads verified   : ${stats.downloadsVerified}`);
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
