import { createLru } from './memory-cache.mjs';

// Short text previews for the message list.
// Only the first few KiB of the first readable text part are fetched (BODY.PEEK,
// so the \Seen flag is never changed). Nothing is written to disk.

export const PREVIEW_BYTES = 3072;
export const PREVIEW_CHARS = 180;
const MAX_CACHE_ENTRIES = 6000;

const isAttachment = node => String(node?.disposition || '').toLowerCase() === 'attachment';

/** Finds the best part for a preview: text/plain before text/html, never attachments. */
export function findPreviewPart(structure) {
  if (!structure || typeof structure !== 'object') return null;
  const candidates = [];
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node.childNodes) && node.childNodes.length) {
      node.childNodes.forEach(walk);
      return;
    }
    const type = String(node.type || '').toLowerCase();
    if ((type === 'text/plain' || type === 'text/html') && !isAttachment(node)) {
      candidates.push({
        part: node.part || '1',
        type,
        encoding: String(node.encoding || '7bit').toLowerCase(),
        charset: String(node.parameters?.charset || 'utf-8').toLowerCase()
      });
    }
  };
  walk(structure);
  return candidates.find(c => c.type === 'text/plain') || candidates[0] || null;
}

/** True if any part is marked as an attachment. */
export function hasAttachments(structure) {
  let found = false;
  const walk = node => {
    if (found || !node || typeof node !== 'object') return;
    if (isAttachment(node)) {
      found = true;
      return;
    }
    if (Array.isArray(node.childNodes)) node.childNodes.forEach(walk);
  };
  walk(structure);
  return found;
}

function decodeQuotedPrintable(text) {
  const withoutSoftBreaks = text.replace(/=\r?\n/g, '').replace(/=[0-9A-F]?$/i, '');
  const bytes = [];
  for (let i = 0; i < withoutSoftBreaks.length; i++) {
    const ch = withoutSoftBreaks[i];
    if (ch === '=' && /^[0-9A-F]{2}$/i.test(withoutSoftBreaks.slice(i + 1, i + 3))) {
      bytes.push(parseInt(withoutSoftBreaks.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(withoutSoftBreaks.charCodeAt(i) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

function decodeTransfer(buffer, encoding) {
  if (encoding === 'base64') {
    const clean = buffer.toString('latin1').replace(/[^A-Za-z0-9+/]/g, '');
    return Buffer.from(clean.slice(0, clean.length - (clean.length % 4)), 'base64');
  }
  if (encoding === 'quoted-printable') return decodeQuotedPrintable(buffer.toString('latin1'));
  return buffer;
}

function decodeCharset(buffer, charset) {
  let decoder;
  try {
    decoder = new TextDecoder(charset || 'utf-8');
  } catch {
    decoder = new TextDecoder('utf-8');
  }
  return decoder.decode(buffer).replace(/�+$/, '');
}

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function htmlToText(html) {
  return html
    .replace(/<(style|script|head|title)[^>]*>[\s\S]*?(<\/\1>|$)/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d|td|th|table|blockquote)>/gi, '\n')
    .replace(/<[^>]*>?/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, code) => {
      if (code[0] === '#') {
        const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isInteger(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' ';
      }
      return ENTITIES[code.toLowerCase()] ?? match;
    });
}

/** Turns raw (possibly truncated) part bytes into a one-line preview. */
export function decodePreview(buffer, part, maxChars = PREVIEW_CHARS) {
  if (!Buffer.isBuffer(buffer) || !part) return '';
  let text = decodeCharset(decodeTransfer(buffer, part.encoding), part.charset);
  if (part.type === 'text/html') text = htmlToText(text);
  return text
    .split(/\r?\n/)
    .filter(line => !/^\s*>/.test(line) && !/^\s*-- ?$/.test(line))
    .join(' ')
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars);
}

/** LRU for previews: a preview never changes for a given UIDVALIDITY/UID. */
export const createPreviewCache = (max = MAX_CACHE_ENTRIES) => createLru(max);

/**
 * Adds `preview` to each message. Messages must carry `bodyStructure`.
 * Groups messages by part number so one FETCH covers many messages.
 * Previews are best effort: any error simply leaves the preview empty.
 */
export async function attachPreviews(client, items, { cache, keyPrefix }) {
  const groups = new Map();
  for (const item of items) {
    const key = `${keyPrefix}:${item.uid}`;
    const cached = cache?.get(key);
    if (cached !== undefined) {
      item.preview = cached;
      continue;
    }
    const part = findPreviewPart(item.bodyStructure);
    if (!part) {
      item.preview = '';
      cache?.set(key, '');
      continue;
    }
    if (!groups.has(part.part)) groups.set(part.part, []);
    groups.get(part.part).push({ item, part, key });
  }
  for (const [partKey, entries] of groups) {
    const byUid = new Map(entries.map(e => [e.item.uid, e]));
    try {
      for await (const msg of client.fetch(
        entries.map(e => e.item.uid),
        { uid: true, bodyParts: [{ key: partKey, maxLength: PREVIEW_BYTES }] },
        { uid: true }
      )) {
        const entry = byUid.get(msg.uid);
        if (!entry) continue;
        const raw = msg.bodyParts?.get(partKey) || msg.bodyParts?.get(partKey.toLowerCase());
        const preview = decodePreview(raw, entry.part);
        entry.item.preview = preview;
        cache?.set(entry.key, preview);
      }
    } catch {
      // A preview must never break the message list.
    }
    for (const entry of entries) if (entry.item.preview === undefined) entry.item.preview = '';
  }
  return items;
}
