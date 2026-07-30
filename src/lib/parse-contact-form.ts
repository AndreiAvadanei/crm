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

/** Escape a literal string for safe interpolation into a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parse a contact-form email body into structured lead fields. Returns null
 * when the body doesn't look like a contact-form submission, so callers can
 * fall back to other handling.
 *
 * Handles both the original Bit Sentinel "Contact a Cyber Security Specialist"
 * template and the newer "NEW CONTACT FORM SUBMISSION" template, which uses
 * different field labels (`Contact Name`, `Service Interest(s)`, `Submitted
 * From`) and a `--- MESSAGE ---` free-text block.
 */
export function parseContactFormEmail(raw: string): ContactFormData | null {
  const lower = raw.toLowerCase();
  const isContactForm =
    lower.includes("contact a cyber security specialist") ||
    lower.includes("this e-mail was sent from a contact form") ||
    lower.includes("new contact form submission");
  if (!isContactForm) return null;

  const normalized = raw.replace(/\r\n/g, "\n");

  // Labels that may appear inline on a single line (fallback when the body
  // isn't cleanly line-delimited). Escaped because some contain regex-special
  // characters like `(s)`.
  const inlineKeys = [
    "Full Name",
    "Contact Name",
    "Company",
    "Job title",
    "Services",
    "Service Interest(s)",
    "Service Interests",
    "Email",
    "Phone",
    "Tel",
    "Details",
    "Consent",
    "Referer",
    "Submitted From",
  ];
  const inlineKeyPattern = inlineKeys.map(escapeRegExp).join("|");
  const inlinePattern = new RegExp(
    String.raw`(?:^|\s)(${inlineKeyPattern}):\s*([\s\S]*?)(?=\s(?:${inlineKeyPattern}):|\s--|\s–|\s\[Created via e-mail|$)`,
    "gi",
  );

  const fields: Record<string, string> = {};
  let currentKey: string | null = null;
  for (const line of normalized.split("\n")) {
    const trimmed = line.trim();
    // Divider lines (`====`, `--- MESSAGE ---`) end the current field so their
    // following free text isn't appended to it.
    if (/^=+$/.test(trimmed) || /^[-–]{2,}/.test(trimmed)) {
      currentKey = null;
      continue;
    }
    const match = line.match(/^([A-Za-z][\w /()&.'-]*?)\s*:\s*(.*)$/);
    if (match) {
      currentKey = match[1].trim();
      fields[currentKey] = match[2].trim();
      continue;
    }
    if (currentKey && trimmed) {
      fields[currentKey] = `${fields[currentKey]}\n${trimmed}`.trim();
    }
  }
  for (const match of normalized.replace(/\n/g, " ").matchAll(inlinePattern)) {
    const key = match[1].trim();
    if (!fields[key]) fields[key] = match[2].trim();
  }

  // Case-insensitive label lookup so we can accept aliases across templates.
  const byLabel: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    byLabel[key.trim().toLowerCase()] = value;
  }
  const pick = (...labels: string[]): string | undefined => {
    for (const label of labels) {
      const value = byLabel[label];
      if (value && value.trim()) return value;
    }
    return undefined;
  };

  // Free-text message block used by the "NEW CONTACT FORM SUBMISSION" template.
  const messageMatch = normalized.match(
    /-{2,}\s*MESSAGE\s*-{2,}\s*\n([\s\S]*?)(?=\n\s*=+|\n\s*Submitted From|\n\s*\[Created via|$)/i,
  );
  const message = messageMatch ? cleanContactValue(messageMatch[1].replace(/\s+/g, " ")) : undefined;

  const data: ContactFormData = {
    fullName: cleanContactValue(pick("full name", "contact name", "name")),
    company: plausibleCompany(pick("company", "organization", "organisation")),
    jobTitle: cleanContactValue(pick("job title", "title", "position")),
    services: cleanContactValue(
      pick("services", "service", "service interest", "service interests", "service interest(s)"),
    ),
    email: plausibleEmail(pick("email", "e-mail")),
    phone: plausiblePhone(pick("phone", "tel", "telephone")),
    details: cleanContactValue(pick("details", "message")) ?? message,
    referer: cleanContactValue(pick("referer", "referrer", "submitted from")),
  };

  return Object.values(data).some(Boolean) ? data : null;
}

/**
 * Turn the noisy Bit Sentinel lead subject into a useful deal title.
 * Prefers "{company} - {services}" then the company name. Handles both the
 * legacy `- Bit Sentinel "Contact a Cyber Security Specialist"` suffix and the
 * newer `[COMPANY] New Contact Form Submission - ...` subject. Returns the
 * title unchanged when it carries no recognizable boilerplate.
 */
export function cleanBitSentinelLeadTitle(title: string, contact: ContactFormData | null): string {
  const legacySuffix = /\s*-\s*Bit Sentinel\s*["“]?Contact a Cyber Security Specialist["”]?\s*$/i;
  const newSubject = /new contact form submission/i;
  if (!legacySuffix.test(title) && !newSubject.test(title)) return title;
  if (contact?.company && contact.services) return `${contact.company} - ${contact.services}`;
  if (contact?.company) return contact.company;
  const cleaned = title.replace(legacySuffix, "").trim();
  return cleaned || title;
}
