import DOMPurify from "isomorphic-dompurify";

// Allowlist for user-authored comment HTML coming from the TinyMCE editor.
// Intentionally narrow: basic formatting, links, and inline images that were
// uploaded to our own protected attachments route. No scripts, no event
// handlers, no iframes/embeds, no style attributes, no external/data images.
const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "strike",
  "ul",
  "ol",
  "li",
  "a",
  "blockquote",
  "code",
  "pre",
  "span",
  "img",
  "figure",
  "figcaption",
  "hr",
  "h1",
  "h2",
  "h3",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "colgroup",
  "col",
];

const ALLOWED_ATTR = [
  "href",
  "target",
  "rel",
  "src",
  "alt",
  "width",
  "height",
  "title",
  "colspan",
  "rowspan",
];

// Only allow inline images that point at our own access-checked attachments
// route. Blocks external hotlinking, tracking pixels and data: URIs.
// We accept the canonical absolute path as well as forms the editor may emit
// (page-relative `../api/...`, leading `./`, or a full same-style origin) and
// normalize them all back to `/api/attachments/{id}`.
const ATTACHMENT_SRC =
  /^(?:https?:\/\/[^/]+)?(?:\.{0,2}\/)*api\/attachments\/([A-Za-z0-9_-]+)\/?$/;

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  // Force all anchors to open safely and never leak the opener window.
  if (node.tagName === "A" && node.hasAttribute("href")) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
  // Drop any image whose src isn't one of our protected attachment URLs,
  // otherwise rewrite it to the canonical access-checked path.
  if (node.tagName === "IMG") {
    const src = node.getAttribute("src") || "";
    const match = src.match(ATTACHMENT_SRC);
    if (!match) {
      node.remove();
      return;
    }
    node.setAttribute("src", `/api/attachments/${match[1]}`);
    node.setAttribute("loading", "lazy");
    node.setAttribute("decoding", "async");
  }
});

/**
 * Sanitize comment HTML to the safe allowlist above. Used both on write
 * (before persisting) and on render (defense in depth).
 */
export function sanitizeCommentHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // Block dangerous URI schemes (javascript:, data:) on links.
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input"],
    FORBID_ATTR: ["style", "onerror", "onload", "onclick"],
    ALLOW_DATA_ATTR: false,
  });
}

// Matches, in priority order:
//  1. Jira/Confluence smart-link wiki markup: [label|url] or [label|url|smart-link]
//  2. Bare http(s) URLs
//  3. Bare www. URLs
const LINKIFY_RE =
  /\[([^[\]|\n]+)\|([^[\]|\n]+)(?:\|[^[\]\n]*)?\]|(https?:\/\/[^\s<>"'[\]]+)|(www\.[^\s<>"'[\]]+)/gi;

function isLinkLike(value: string): boolean {
  return /^(https?:\/\/|mailto:|www\.)/i.test(value.trim());
}

function normalizeHref(value: string): string {
  const v = value.trim();
  return /^www\./i.test(v) ? `https://${v}` : v;
}

function anchor(href: string, label: string): string {
  // target/rel are forced on by the DOMPurify afterSanitizeAttributes hook.
  return `<a href="${href}">${label}</a>`;
}

function replaceLinkToken(
  match: string,
  jiraLabel: string | undefined,
  jiraUrl: string | undefined,
  httpUrl: string | undefined,
  wwwUrl: string | undefined
): string {
  // Jira smart-link markup.
  if (jiraLabel !== undefined && jiraUrl !== undefined) {
    if (!isLinkLike(jiraUrl)) return match;
    return anchor(normalizeHref(jiraUrl), jiraLabel.trim());
  }
  // Bare URL — strip trailing punctuation so "(see https://x.com)." stays clean.
  const raw = httpUrl ?? wwwUrl ?? "";
  const trailing = raw.match(/[).,;:!?'"]+$/);
  const clean = trailing ? raw.slice(0, raw.length - trailing[0].length) : raw;
  const tail = trailing ? trailing[0] : "";
  return anchor(normalizeHref(clean), clean) + tail;
}

/**
 * Converts Jira smart-link markup and bare URLs in a comment body into anchor
 * tags so they render as clickable links. Skips text already inside <a> tags to
 * avoid creating nested anchors, and leaves all other markup untouched. Run this
 * BEFORE sanitizeCommentHtml so the generated anchors pass the allowlist.
 */
export function linkifyCommentBody(html: string): string {
  let anchorDepth = 0;
  return html.replace(/(<\/?a\b[^>]*>)|(<[^>]+>)|([^<]+)/gi, (full, aTag, otherTag, text) => {
    if (aTag) {
      if (/^<a\b/i.test(aTag)) anchorDepth++;
      else anchorDepth = Math.max(0, anchorDepth - 1);
      return aTag;
    }
    if (otherTag) return otherTag;
    if (anchorDepth > 0) return text; // don't linkify inside existing links
    return text.replace(LINKIFY_RE, replaceLinkToken);
  });
}

/**
 * Render-time pipeline for comment bodies: linkify URLs/smart-links, then
 * sanitize to the safe allowlist.
 */
export function renderCommentHtml(body: string): string {
  return sanitizeCommentHtml(linkifyCommentBody(body));
}

/**
 * Returns the visible text content of comment HTML (tags stripped) — used to
 * decide whether a comment is effectively empty (e.g. "<p></p>").
 */
export function htmlToPlainText(html: string): string {
  const text = DOMPurify.sanitize(html, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
  return text.replace(/&nbsp;/gi, " ").trim();
}

/**
 * A comment is non-empty if it has visible text OR embeds at least one image —
 * so image-only comments (e.g. a pasted screenshot) are allowed.
 */
export function commentHasContent(html: string): boolean {
  return htmlToPlainText(html).length > 0 || /<img\b/i.test(html);
}
