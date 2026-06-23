/**
 * Shared parser for inbound website "contact form" lead emails (e.g. the Bit
 * Sentinel "Contact a Cyber Security Specialist" form). Used by BOTH the Jira
 * CSV importer (scripts/import-jira.ts) and the inbound-email webhook
 * (src/app/api/webhooks/inbound-email). Keep this file framework-agnostic — no
 * `server-only`, no `@/` alias imports — so the tsx importer can load it too.
 */

// Most application string columns are VARCHAR(191); mirror the importer's clamp.
export const DB_STRING_MAX = 191;

export type ContactFormData = {
  fullName?: string;
  company?: string;
  jobTitle?: string;
  services?: string;
  email?: string;
  phone?: string;
  details?: string;
  referer?: string;
};

/** Trim + clamp to the DB column length, adding an ellipsis when truncated. */
export function truncateDbString(value: string, max = DB_STRING_MAX): string {
  const clean = value.trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** Normalize to a non-empty trimmed/clamped string, or null. */
export function nullableDbString(value?: string | null, max = DB_STRING_MAX): string | null {
  const clean = value?.trim();
  return clean ? truncateDbString(clean, max) : null;
}

/** Strip Jira wiki mail links `[text|mailto:..]` and angle brackets. */
export function cleanContactValue(value?: string): string | undefined {
  const clean = value
    ?.trim()
    .replace(/^\[([^|]+)\|mailto:[^\]]+\]$/i, "$1")
    .replace(/^<(.+)>$/, "$1")
    .trim();
  return clean || undefined;
}

export function plausibleCompany(value?: string): string | undefined {
  const clean = cleanContactValue(value);
  if (!clean || clean.length > 120 || clean.includes("\n") || /#|⚡|🏰|🪩|🎡|🎈/.test(clean)) return undefined;
  return truncateDbString(clean);
}

export function plausibleEmail(value?: string): string | undefined {
  const clean = cleanContactValue(value);
  if (!clean || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return undefined;
  return clean;
}

export function plausiblePhone(value?: string): string | undefined {
  const clean = cleanContactValue(value);
  if (!clean || clean.length > 40 || /details:/i.test(clean) || !/[0-9]{5,}/.test(clean.replace(/\s+/g, ""))) {
    return undefined;
  }
  return truncateDbString(clean);
}

/**
 * Parse a contact-form email body into structured lead fields. Returns null
 * when the body doesn't look like a contact-form submission, so callers can
 * fall back to other handling.
 */
export function parseContactFormEmail(raw: string): ContactFormData | null {
  if (!raw.includes("Contact a Cyber Security Specialist") && !raw.includes("This e-mail was sent from a contact form")) {
    return null;
  }

  const normalized = raw.replace(/\r\n/g, "\n");
  const inlineKeys = ["Full Name", "Company", "Job title", "Services", "Email", "Phone", "Tel", "Details", "Consent", "Referer"];
  const inlineKeyPattern = inlineKeys.join("|");
  const inlinePattern = new RegExp(
    String.raw`(?:^|\s)(${inlineKeyPattern}):\s*([\s\S]*?)(?=\s(?:${inlineKeyPattern}):|\s--|\s–|\s\[Created via e-mail|$)`,
    "gi",
  );
  const fields: Record<string, string> = {};
  let currentKey: string | null = null;
  for (const line of normalized.split("\n")) {
    const match = line.match(/^([A-Za-z][A-Za-z ]+):\s*(.*)$/);
    if (match) {
      currentKey = match[1].trim();
      fields[currentKey] = match[2].trim();
      continue;
    }
    if (currentKey && line.trim() && !line.startsWith("--") && !line.startsWith("–")) {
      fields[currentKey] = `${fields[currentKey]}\n${line.trim()}`.trim();
    }
  }
  for (const match of normalized.replace(/\n/g, " ").matchAll(inlinePattern)) {
    const key = match[1].trim();
    if (!fields[key]) fields[key] = match[2].trim();
  }

  const data: ContactFormData = {
    fullName: cleanContactValue(fields["Full Name"]),
    company: plausibleCompany(fields.Company),
    jobTitle: cleanContactValue(fields["Job title"]),
    services: cleanContactValue(fields.Services),
    email: plausibleEmail(fields.Email),
    phone: plausiblePhone(fields.Phone || fields.Tel),
    details: cleanContactValue(fields.Details),
    referer: cleanContactValue(fields.Referer),
  };

  return Object.values(data).some(Boolean) ? data : null;
}

/**
 * Turn the noisy Bit Sentinel lead subject into a useful deal title.
 * Prefers "{company} - {services}" then the company name. Returns the title
 * unchanged when it doesn't carry the Bit Sentinel boilerplate suffix.
 */
export function cleanBitSentinelLeadTitle(title: string, contact: ContactFormData | null): string {
  const badLeadTitle = /\s*-\s*Bit Sentinel\s*["“]?Contact a Cyber Security Specialist["”]?\s*$/i;
  if (!badLeadTitle.test(title)) return title;
  const cleaned = title.replace(badLeadTitle, "").trim();
  if (contact?.company && contact.services) return `${contact.company} - ${contact.services}`;
  if (contact?.company) return contact.company;
  return cleaned || title;
}
