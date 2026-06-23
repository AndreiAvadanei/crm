import DOMPurify from "isomorphic-dompurify";

// Allowlist for user-authored comment HTML coming from the TinyMCE editor.
// Intentionally narrow: basic formatting + links only. No scripts, no event
// handlers, no iframes/embeds, no images, no style attributes.
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
];

const ALLOWED_ATTR = ["href", "target", "rel"];

// Force all anchors to open safely and never leak the opener window.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node.hasAttribute("href")) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
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

/**
 * Returns the visible text content of comment HTML (tags stripped) — used to
 * decide whether a comment is effectively empty (e.g. "<p></p>").
 */
export function htmlToPlainText(html: string): string {
  const text = DOMPurify.sanitize(html, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
  return text.replace(/&nbsp;/gi, " ").trim();
}
