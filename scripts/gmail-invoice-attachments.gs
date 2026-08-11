/**
 * Gmail -> Webhook: forward invoice PDFs from replies.
 *
 * Scans the mailbox for REPLIES to the CRM "Generate invoice" emails that come
 * back WITH attachments (the issued invoice PDFs), then:
 *   1. parses the invoice id, short code and the platform user who initiated it
 *      (from the parseable footer tokens added by the CRM),
 *   2. sends each PDF (base64-encoded) together with that metadata to a webhook,
 *   3. records processed message ids so nothing is handled twice.
 *
 * No Google Drive involvement — the files travel straight to the webhook.
 *
 * The CRM email footer contains:
 *   [INVOICE-ID: <id>]
 *   [INVOICE-INITIATOR-NAME: <name>]
 *   [INVOICE-INITIATOR-EMAIL: <email>]
 * and the subject contains "(#NNNNN)" and "REF-<id>-REF".
 */

const CONFIG = {
  // Only keep these attachment types (lowercased extensions). Empty array = keep all.
  ALLOWED_EXTENSIONS: ['pdf'],

  // Skip files larger than this (UrlFetchApp POST payload cap is ~50MB).
  MAX_FILE_BYTES: 40 * 1024 * 1024,

  // Label workflow (created automatically if missing). A Gmail filter pre-tags
  // incoming invoice replies with PENDING_LABEL; the script moves them to
  // PROCESSED_LABEL once their attachments are forwarded. See setup notes below.
  PENDING_LABEL: 'invoice-attachment-pending',
  PROCESSED_LABEL: 'invoice-attachment-processed',

  // Where the invoice PDFs + metadata are sent.
  WEBHOOK_URL: 'https://sls.bsscockpit.com/api/webhooks/invoice-files?secret=11pRKlkGvb_qSV8V7eeRc82McTXbMWF6eHjHhNTcRIo',

  // Script Property key used to dedupe at the message level.
  PROCESSED_PROP_KEY: 'processedInvoiceMessageIds',
};

function captureInvoiceAttachments() {
  const pendingLabel = getOrCreateLabel_(CONFIG.PENDING_LABEL);
  const processedLabel = getOrCreateLabel_(CONFIG.PROCESSED_LABEL);
  const processed = loadProcessedIds_();

  // Exact, label-driven scope: only threads tagged pending and not yet processed.
  const query = 'label:' + CONFIG.PENDING_LABEL + ' -label:' + CONFIG.PROCESSED_LABEL + ' has:attachment';
  const threads = GmailApp.search(query);

  for (const thread of threads) {
    let threadTouched = false;

    for (const message of thread.getMessages()) {
      const messageId = message.getId();
      if (processed[messageId]) continue;

      const attachments = message.getAttachments({
        includeInlineImages: false,
        includeAttachments: true,
      });
      if (!attachments.length) continue;

      const subject = message.getSubject() || '';
      const body = message.getPlainBody() || '';
      const html = message.getBody() || '';

      const invoiceId = parseInvoiceId_(subject, body, html);
      const shortCode = parseShortCode_(subject, body, html);
      // Skip messages that aren't related to a CRM invoice request.
      if (!invoiceId && !shortCode) continue;

      const initiatorName = parseToken_(body, html, 'INVOICE-INITIATOR-NAME');
      const initiatorEmail = parseToken_(body, html, 'INVOICE-INITIATOR-EMAIL');

      const kept = CONFIG.ALLOWED_EXTENSIONS.length
        ? attachments.filter((a) => isAllowedAttachment_(a))
        : attachments;
      if (!kept.length) continue;

      // A single reply can carry several invoice PDFs; encode each one inline.
      const files = [];
      for (let idx = 0; idx < kept.length; idx++) {
        const attachment = kept[idx];
        const size = attachment.getSize();
        if (size > CONFIG.MAX_FILE_BYTES) {
          Logger.log('Skipping oversized attachment "%s" (%s bytes)', attachment.getName(), size);
          continue;
        }
        files.push({
          name: attachment.getName(),
          contentType: attachment.getContentType(),
          size: size,
          contentBase64: Utilities.base64Encode(attachment.copyBlob().getBytes()),
        });
      }
      if (!files.length) continue;

      postWebhook_({
        gmailMessageId: messageId,
        threadId: thread.getId(),
        from: message.getFrom(),
        to: message.getTo(),
        subject: subject,
        date: message.getDate().toISOString(),
        invoiceId: invoiceId,
        shortCode: shortCode,
        initiatedByName: initiatorName,
        initiatedByEmail: initiatorEmail,
        fileCount: files.length,
        files: files,
      });

      processed[messageId] = Date.now();
      threadTouched = true;
    }

    if (threadTouched) {
      thread.addLabel(processedLabel);
      thread.removeLabel(pendingLabel);
    }
  }

  saveProcessedIds_(processed);
}

/**
 * One-time helper: ensures both labels exist. In Gmail, create a filter that
 * matches your invoice replies (see notes at the bottom of this file) and set it
 * to "Apply the label: invoice-attachment-pending".
 */
function setupInvoiceLabels() {
  getOrCreateLabel_(CONFIG.PENDING_LABEL);
  getOrCreateLabel_(CONFIG.PROCESSED_LABEL);
  Logger.log('Labels ready: "%s" (filter -> apply this) and "%s".', CONFIG.PENDING_LABEL, CONFIG.PROCESSED_LABEL);
}

/* ----------------------------- helpers ----------------------------- */

function parseInvoiceId_(subject, body, html) {
  // Prefer the explicit footer token, fall back to the REF-<id>-REF wrapper.
  const fromToken = parseToken_(body, html, 'INVOICE-ID');
  if (fromToken) return fromToken;
  const m = (subject + '\n' + body + '\n' + html).match(/REF-([A-Za-z0-9_-]+)-REF/);
  return m ? m[1] : '';
}

function parseShortCode_(subject, body, html) {
  const m = (subject + '\n' + body + '\n' + html).match(/\(#(\d+)\)/);
  return m ? m[1] : '';
}

function parseToken_(body, html, key) {
  const re = new RegExp('\\[' + key + ':\\s*([^\\]]+)\\]');
  let m = (body || '').match(re);
  if (!m) m = (html || '').match(re);
  return m ? m[1].trim() : '';
}

/**
 * Keep an attachment only if its extension is allowed AND (for PDFs) its content
 * type really is application/pdf, so mislabelled files don't slip through.
 */
function isAllowedAttachment_(attachment) {
  const ext = extOf_(attachment.getName());
  if (CONFIG.ALLOWED_EXTENSIONS.indexOf(ext) === -1) return false;
  if (ext === 'pdf') {
    const type = (attachment.getContentType() || '').toLowerCase();
    return type.indexOf('pdf') !== -1;
  }
  return true;
}

function extOf_(name) {
  const i = (name || '').lastIndexOf('.');
  return i === -1 ? '' : name.substring(i + 1).toLowerCase();
}

function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

function loadProcessedIds_() {
  const raw = PropertiesService.getScriptProperties().getProperty(CONFIG.PROCESSED_PROP_KEY);
  return raw ? JSON.parse(raw) : {};
}

function saveProcessedIds_(map) {
  // Keep the store from growing unbounded: retain the most recent 1000 ids.
  const entries = Object.keys(map).map((k) => [k, map[k]]);
  entries.sort((a, b) => b[1] - a[1]);
  const trimmed = {};
  entries.slice(0, 1000).forEach((e) => (trimmed[e[0]] = e[1]));
  PropertiesService.getScriptProperties().setProperty(CONFIG.PROCESSED_PROP_KEY, JSON.stringify(trimmed));
}

function postWebhook_(payload) {
  if (!CONFIG.WEBHOOK_URL) return;
  UrlFetchApp.fetch(CONFIG.WEBHOOK_URL, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
}

/* =====================================================================
 * SETUP (one-time)
 * =====================================================================
 * 1. Run setupInvoiceLabels() once to create the labels:
 *      - invoice-attachment-pending
 *      - invoice-attachment-processed
 *
 * 2. Create a Gmail filter that tags incoming invoice replies as PENDING.
 *    Gmail Settings -> Filters -> Create a new filter. Use the "Has the words"
 *    box (it matches subject + body, so it catches the quoted CRM markers even
 *    in replies). Recommended criteria:
 *
 *      Has the words:  "-REF" has:attachment
 *      (or, stricter)  "INVOICE-ID:" has:attachment
 *
 *    Then choose: "Apply the label: invoice-attachment-pending".
 *    Optionally tick "Also apply filter to matching conversations".
 *
 *    Notes:
 *      - The CRM subject/body always contains REF-<id>-REF and the footer token
 *        [INVOICE-ID: <id>]; replies quote them, so the filter reliably matches.
 *      - has:attachment keeps the bare acknowledgement replies out.
 *
 * 3. Add a time-driven trigger for captureInvoiceAttachments()
 *    (Apps Script -> Triggers -> Add Trigger -> e.g. every 5 minutes).
 *
 * The script then only scans
 *   label:invoice-attachment-pending -label:invoice-attachment-processed has:attachment
 * and moves each handled thread from pending -> processed.
 *
 * Webhook payload shape (one POST per message):
 *   {
 *     gmailMessageId, threadId, from, to, subject, date,
 *     invoiceId, shortCode, initiatedByName, initiatedByEmail,
 *     fileCount,
 *     files: [ { name, contentType, size, contentBase64 }, ... ]
 *   }
 * ===================================================================== */
