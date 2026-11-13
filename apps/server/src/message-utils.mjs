import { parseUnsubscribe, publicUnsubscribe } from './unsubscribe.mjs';
export const MAX_MESSAGE_BYTES = 12 * 1024 * 1024;
export const MAX_HTML_CHARS = 350_000;
export const MAX_TEXT_CHARS = 500_000;

export function validFolder(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 255 && !/[\0\r\n]/.test(value);
}

export function validUid(value) {
  return (
    typeof value === 'string' &&
    /^[1-9]\d*$/.test(value) &&
    Number.isSafeInteger(Number(value)) &&
    Number(value) <= 4294967295
  );
}

export function validAttachmentIndex(value) {
  return (
    typeof value === 'string' &&
    /^(0|[1-9]\d*)$/.test(value) &&
    Number.isSafeInteger(Number(value)) &&
    Number(value) <= 1000
  );
}

export function flatAddresses(items) {
  if (!Array.isArray(items)) return [];
  return items
    .flatMap(item => (item?.group ? flatAddresses(item.group) : [item]))
    .filter(item => typeof item?.address === 'string')
    .map(item => ({ name: String(item.name || ''), email: item.address }));
}

export function cleanFilename(filename, index) {
  const base = String(filename || `Anhang-${index + 1}.bin`)
    .replace(/[\\/\0-\x1f\x7f]/g, '_')
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, '')
    .trim()
    .slice(0, 160);
  return base && base !== '.' && base !== '..' ? base : `Anhang-${index + 1}.bin`;
}

export function attachmentInfo(att, index) {
  return {
    index,
    filename: cleanFilename(att.filename, index),
    mimeType: att.mimeType || 'application/octet-stream',
    size: att.content?.byteLength ?? 0,
    inline: Boolean(att.related || att.disposition === 'inline')
  };
}

const INLINE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_INLINE_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_INLINE_TOTAL_BYTES = 8 * 1024 * 1024;

/**
 * Replaces cid: references with data: URIs for embedded raster images, so they
 * display inside the isolated mail frame (which only permits data: images).
 * SVG is never inlined because it can carry active content.
 */
export function inlineCidImages(html, attachments) {
  if (!html || !Array.isArray(attachments)) return { html, inlined: new Set() };
  const byCid = new Map();
  let total = 0;
  attachments.forEach((att, index) => {
    const cid = String(att.contentId || '')
      .replace(/^<|>$/g, '')
      .trim()
      .toLowerCase();
    const type = String(att.mimeType || '').toLowerCase();
    const size = att.content?.byteLength ?? 0;
    if (!cid || !INLINE_IMAGE_TYPES.has(type) || size <= 0 || size > MAX_INLINE_IMAGE_BYTES) return;
    if (total + size > MAX_INLINE_TOTAL_BYTES || byCid.has(cid)) return;
    total += size;
    byCid.set(cid, { index, uri: `data:${type};base64,${attachmentBytes(att).toString('base64')}` });
  });
  const inlined = new Set();
  const replaced = html.replace(/(\ssrc\s*=\s*)(["']?)cid:([^"'\s>]+)\2/gi, (match, prefix, quote, cid) => {
    let key = cid.trim().toLowerCase();
    try {
      key = decodeURIComponent(key);
    } catch {
      /* keep raw */
    }
    const hit = byCid.get(key);
    if (!hit) return match;
    inlined.add(hit.index);
    return `${prefix}"${hit.uri}"`;
  });
  return { html: replaced, inlined };
}

/** External images or backgrounds (tracking pixels are usually exactly that). */
export function hasRemoteContent(html) {
  return (
    /<img\b[^>]*\ssrc\s*=\s*["']?\s*(?:https?:)?\/\//i.test(html || '') ||
    /url\(\s*["']?\s*(?:https?:)?\/\//i.test(html || '') ||
    /\sbackground\s*=\s*["']?\s*(?:https?:)?\/\//i.test(html || '')
  );
}

export function publicMessage(parsed, uid, folder) {
  const rawHtml = (parsed.html || '').slice(0, MAX_HTML_CHARS);
  const { html, inlined } = inlineCidImages(rawHtml, parsed.attachments || []);
  return {
    uid,
    folder,
    from: flatAddresses(parsed.from ? [parsed.from] : []),
    to: flatAddresses(parsed.to),
    cc: flatAddresses(parsed.cc),
    bcc: flatAddresses(parsed.bcc),
    replyTo: flatAddresses(parsed.replyTo),
    subject: parsed.subject || '(Ohne Betreff)',
    date: parsed.date || null,
    messageId: typeof parsed.messageId === 'string' ? parsed.messageId : null,
    text: (parsed.text || '').slice(0, MAX_TEXT_CHARS),
    html,
    remoteContent: hasRemoteContent(rawHtml),
    unsubscribe: publicUnsubscribe(parseUnsubscribe(parsed.headers)),
    textTruncated: (parsed.text?.length || 0) > MAX_TEXT_CHARS,
    htmlTruncated: (parsed.html?.length || 0) > MAX_HTML_CHARS,
    attachments: (parsed.attachments || []).map((att, index) => ({
      ...attachmentInfo(att, index),
      inline: inlined.has(index) || attachmentInfo(att, index).inline,
      embedded: inlined.has(index)
    })),
    readOnly: true
  };
}

export function attachmentBytes(att) {
  if (att.content instanceof ArrayBuffer) return Buffer.from(att.content);
  if (ArrayBuffer.isView(att.content))
    return Buffer.from(att.content.buffer, att.content.byteOffset, att.content.byteLength);
  throw new Error('Unbekanntes Anhangformat');
}

export function downloadHeaders(filename) {
  // RFC 5987 encoded filename* prevents header injection; ASCII fallback is intentionally generic.
  return {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="download.bin"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox"
  };
}
