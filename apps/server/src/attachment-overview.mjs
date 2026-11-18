// Attachment overview: every file in a folder, optionally only those exchanged with one
// contact, newest first. Read-only (EXAMINE, no body download): only BODYSTRUCTURE and the
// envelope are fetched, so even large folders are cheap to scan.
import { completeFetchResults } from './mailbox.mjs';

const SCAN_DEFAULT = 300;
const SCAN_MAX = 1000;
const BATCH = 100;
const MAX_ITEMS = 500;
const EMAIL = /^[^\s@<>,;]{1,64}@[^\s@<>,;]{1,255}$/;

const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode, code: 'invalid_request' });

/** Decoded size of a part from its encoded size (base64 adds a third). */
function decodedSize(node) {
  const size = Number(node.size) || 0;
  return String(node.encoding || '').toLowerCase() === 'base64' ? Math.floor((size * 3) / 4) : size;
}

/**
 * Files in a BODYSTRUCTURE: parts with `Content-Disposition: attachment`, plus named parts
 * that are not displayed in the body (no Content-ID, not inline). Body text and inline
 * logos referenced by the HTML are left out.
 */
export function attachmentsFromStructure(structure) {
  const files = [];
  const walk = node => {
    if (!node || typeof node !== 'object' || files.length >= 50) return;
    if (Array.isArray(node.childNodes) && node.childNodes.length) {
      node.childNodes.forEach(walk);
      return;
    }
    const type = String(node.type || 'application/octet-stream').toLowerCase();
    if (type === 'message/rfc822' && Array.isArray(node.childNodes)) return;
    const disposition = String(node.disposition || '').toLowerCase();
    const filename = String(node.dispositionParameters?.filename || node.parameters?.name || '').trim();
    const isFile =
      disposition === 'attachment' ||
      (filename && disposition !== 'inline' && !node.id && !/^text\/(plain|html)$/.test(type));
    if (!isFile) return;
    if (/^application\/(pgp-signature|pkcs7-signature|x-pkcs7-signature)$/.test(type)) return;
    files.push({
      filename: (filename || (type === 'message/rfc822' ? 'message.eml' : 'attachment')).slice(0, 255),
      mimeType: type,
      size: decodedSize(node)
    });
  };
  walk(structure);
  return files;
}

/** Validates the query parameters of GET /api/attachments. */
export function attachmentQuery(query = {}) {
  const contact = typeof query.contact === 'string' ? query.contact.trim().toLowerCase() : '';
  if (contact && !EMAIL.test(contact)) throw fail('Ungültige E-Mail-Adresse.');
  const q = typeof query.q === 'string' ? query.q.trim().slice(0, 120) : '';
  const raw = query.beforeUid;
  let beforeUid = null;
  if (raw !== undefined && raw !== null && raw !== '') {
    if (!/^[1-9]\d{0,9}$/.test(String(raw)) || Number(raw) > 4294967295) throw fail('Ungültige Position.');
    beforeUid = Number(raw);
  }
  return { contact: contact || null, q, beforeUid };
}

/**
 * @param client connected ImapFlow client
 * @param {string} folder
 * @param {{ contact?: string|null, q?: string, beforeUid?: number|null, scan?: number }} options
 *   `contact`: only messages from, to or copied to this address. `q`: filter on file name,
 *   sender and subject. `scan`: how many of the newest messages are inspected per page.
 */
export async function listAttachments(
  client,
  folder,
  { contact = null, q = '', beforeUid = null, scan = SCAN_DEFAULT } = {}
) {
  const window = Math.max(1, Math.min(Number(scan) || SCAN_DEFAULT, SCAN_MAX));
  const needle = String(q || '').toLowerCase();
  const lock = await client.getMailboxLock(folder, { readOnly: true });
  try {
    const criteria = contact ? { or: [{ from: contact }, { to: contact }, { cc: contact }] } : { all: true };
    const ids = await client.search(criteria, { uid: true });
    if (!Array.isArray(ids)) throw Object.assign(new Error('IMAP-Suchfunktion nicht verfügbar.'), { statusCode: 502 });
    const all = [...new Set(ids.filter(n => Number.isSafeInteger(n) && n > 0))].sort((a, b) => b - a);
    const eligible = beforeUid === null ? all : all.filter(uid => uid < beforeUid);
    const page = eligible.slice(0, window);
    const items = [];
    for (let i = 0; i < page.length && items.length < MAX_ITEMS; i += BATCH) {
      const batch = page.slice(i, i + BATCH);
      const raw = [];
      for await (const m of client.fetch(
        batch.join(','),
        { uid: true, envelope: true, internalDate: true, bodyStructure: true },
        { uid: true }
      ))
        raw.push(m);
      for (const m of completeFetchResults(raw, batch).sort((a, b) => b.uid - a.uid)) {
        const files = attachmentsFromStructure(m.bodyStructure);
        if (!files.length) continue;
        const from = m.envelope?.from?.[0] || {};
        const base = {
          uid: m.uid,
          folder,
          fromName: from.name || from.address || '',
          fromEmail: String(from.address || '').toLowerCase(),
          subject: m.envelope?.subject || '',
          date: m.internalDate?.toISOString?.() || m.envelope?.date?.toISOString?.() || null
        };
        for (const file of files) {
          const haystack = `${file.filename} ${base.fromName} ${base.fromEmail} ${base.subject}`.toLowerCase();
          if (needle && !haystack.includes(needle)) continue;
          items.push({ ...base, ...file });
        }
      }
    }
    const hasMore = eligible.length > page.length;
    return {
      folder,
      contact,
      items: items.slice(0, MAX_ITEMS),
      scanned: page.length,
      hasMore,
      nextBeforeUid: hasMore && page.length ? page[page.length - 1] : null
    };
  } finally {
    lock.release();
  }
}
