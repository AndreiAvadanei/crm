import "server-only";
import { ServerClient, Attachment } from "postmark";
import { APP_NAME } from "@/lib/app-constants";

export type EmailAttachment = {
  name: string;
  /** Raw file contents; encoded to base64 for the provider. */
  content: string | Buffer;
  contentType: string;
};

type SendArgs = {
  to: string | string[];
  cc?: string | string[];
  from?: string;
  replyTo?: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: EmailAttachment[];
};

/** Strip tags to a readable plain-text body for the multipart fallback. */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>(?!\n)/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/**
 * Wrap body content in a simple inline-styled responsive HTML shell with an
 * app header, optional CTA button, and footer.
 */
export function renderEmailLayout(title: string, bodyHtml: string, ctaUrl?: string, ctaLabel?: string): string {
  const cta =
    ctaUrl && ctaLabel
      ? `<tr><td style="padding:24px 0 8px;">
           <a href="${ctaUrl}" style="display:inline-block;background:#6366f1;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:8px;">${ctaLabel}</a>
         </td></tr>`
      : "";
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light only" />
  </head>
  <body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2937;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
            <tr>
              <td style="background:#111827;padding:16px 24px;">
                <span style="color:#ffffff;font-size:16px;font-weight:700;letter-spacing:.3px;">${APP_NAME}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;">
                <h1 style="margin:0 0 12px;font-size:18px;font-weight:700;color:#111827;">${title}</h1>
                <div style="font-size:14px;line-height:1.6;color:#374151;">${bodyHtml}</div>
                <table role="presentation" cellpadding="0" cellspacing="0"><tbody>${cta}</tbody></table>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px;border-top:1px solid #e5e7eb;">
                <span style="font-size:12px;color:#9ca3af;">This is an automated message from ${APP_NAME}. Please do not reply.</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * Send a transactional email via Postmark. Dev no-op when not configured, and
 * never throws — failures are caught and logged so callers (notifications) are
 * safe to await without risking the underlying mutation.
 */
export async function sendEmail({ to, cc, from: fromOverride, replyTo, subject, html, text, attachments }: SendArgs): Promise<void> {
  const apiKey = process.env.POSTMARK_API_KEY;
  const from = fromOverride || process.env.EMAIL_FROM;
  const messageStream = process.env.POSTMARK_MESSAGE_STREAM || "outbound";

  if (!apiKey || !from) {
    console.warn("[email] not configured, skipping send", { subject });
    return;
  }

  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (recipients.length === 0) return;
  const ccRecipients = (Array.isArray(cc) ? cc : cc ? [cc] : []).filter(Boolean);

  const textBody = text ?? htmlToText(html);

  const postmarkAttachments = (attachments ?? []).map(
    (att) =>
      new Attachment(
        att.name,
        (Buffer.isBuffer(att.content) ? att.content : Buffer.from(att.content, "utf-8")).toString("base64"),
        att.contentType,
        null
      )
  );

  try {
    const client = new ServerClient(apiKey);
    await client.sendEmail({
      From: from,
      To: recipients.join(","),
      Cc: ccRecipients.length ? ccRecipients.join(",") : undefined,
      ReplyTo: replyTo,
      Subject: subject,
      HtmlBody: html,
      TextBody: textBody,
      MessageStream: messageStream,
      Attachments: postmarkAttachments.length ? postmarkAttachments : undefined,
    });
  } catch (err) {
    console.error("[email] send error", err);
  }
}
