// Automatic bundles for the message list: newsletters, invoices and notifications.
// Purely local and header-based – the body is never needed, so the list can be
// classified from the headers fetched with the envelope.

/** Header names the list fetch has to request for classification. */
export const BUNDLE_HEADERS = [
  'list-id',
  'list-unsubscribe',
  'precedence',
  'auto-submitted',
  'x-auto-response-suppress'
];

export const BUNDLES = ['newsletter', 'invoice', 'notification'];

const INVOICE_SUBJECT =
  /\b(rechnung|rechnungs?nr|invoice|receipt|quittung|beleg|zahlungsbest[äa]tigung|payment (?:confirmation|receipt)|gutschrift|credit note|abrechnung|kontoauszug|faktura|factura|facture)\b/i;
const INVOICE_FILE = /(rechnung|invoice|receipt|quittung|beleg|gutschrift|faktura|factura|facture)[^/]*\.pdf$/i;
const NOTIFICATION_LOCAL =
  /^(no-?reply|do-?not-?reply|donotreply|notifications?|notify|alerts?|mailer-daemon|postmaster|automated|system|bounce[s]?|calendar-notification|security|account-?security)([+._-].*)?$/i;
const NEWSLETTER_LOCAL = /^(news(letter)?s?|marketing|promo(tions?)?|angebote?|deals|offers?|mailing)([+._-].*)?$/i;

/**
 * Normalises raw header input (Buffer/string block from IMAP, array of {key,value}
 * from postal-mime, or a plain object) into a lower-case name → value map.
 */
export function headerMap(input) {
  const map = {};
  if (!input) return map;
  if (Buffer.isBuffer(input) || typeof input === 'string') {
    const unfolded = String(input).replace(/\r?\n[ \t]+/g, ' ');
    for (const line of unfolded.split(/\r?\n/)) {
      const i = line.indexOf(':');
      if (i < 1) continue;
      const key = line.slice(0, i).trim().toLowerCase();
      map[key] = map[key] ? `${map[key]}, ${line.slice(i + 1).trim()}` : line.slice(i + 1).trim();
    }
    return map;
  }
  if (Array.isArray(input)) {
    for (const h of input) if (h?.key) map[String(h.key).toLowerCase()] = String(h.value ?? '');
    return map;
  }
  for (const [k, v] of Object.entries(input)) map[k.toLowerCase()] = String(v ?? '');
  return map;
}

/**
 * @param {{ fromEmail?: string, subject?: string, headers?: unknown, attachmentNames?: string[] }} message
 * @returns {'newsletter' | 'invoice' | 'notification' | null}
 */
export function classifyMessage({ fromEmail = '', subject = '', headers = null, attachmentNames = [] } = {}) {
  const h = headerMap(headers);
  const local = String(fromEmail).toLowerCase().split('@')[0] || '';
  // Invoices first: they often come from no-reply addresses or mailing systems.
  if (INVOICE_SUBJECT.test(subject) || attachmentNames.some(n => INVOICE_FILE.test(String(n)))) return 'invoice';
  const autoSubmitted = (h['auto-submitted'] || '').toLowerCase();
  const precedence = (h.precedence || '').toLowerCase();
  const listMail = Boolean(h['list-unsubscribe'] || h['list-id']) || /^(bulk|list)$/.test(precedence);
  if (NEWSLETTER_LOCAL.test(local) && listMail) return 'newsletter';
  if ((autoSubmitted && autoSubmitted !== 'no') || NOTIFICATION_LOCAL.test(local)) return 'notification';
  // Discussion lists (List-Id without unsubscribe offer, e.g. a team list) stay in the inbox.
  if (h['list-unsubscribe'] || /^bulk$/.test(precedence)) return 'newsletter';
  return null;
}
