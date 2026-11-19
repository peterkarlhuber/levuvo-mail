// Out-of-office reply content shared by every way Levuvo Mail stores it on the server
// (Sieve on IMAP servers, Microsoft Graph, Gmail). The text is formatted HTML from the same
// editor as the signature; the account signature (with logo) can be appended. A plain-text
// version is always produced for recipients and servers without HTML.
import { randomBytes } from 'node:crypto';
import { escapeHtml, htmlToText, sanitizeOutgoingHtml } from './html-mail.mjs';

export const VACATION_LIMITS = {
  /** Editor HTML including embedded images. */
  html: 600 * 1024,
  text: 20000,
  images: 4,
  /** All embedded images together (decoded bytes), body and signature. */
  imageBytes: 400 * 1024
};
const SIGNATURE_SEPARATOR = '<p>-- </p>';
const DATA_IMAGE = /^data:(image\/(?:png|jpeg|gif|webp));base64,([a-z0-9+/=\s]+)$/i;
const IMG_SRC = /(<img\b[^>]*?\ssrc\s*=\s*)(["'])([^"']*)\2/gi;
const fail = (message, code = 'vacation_invalid', statusCode = 400) =>
  Object.assign(new Error(message), { code, statusCode });

/** Plain text (older versions stored only this) as editor HTML. */
export function textToHtml(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  return t
    .split(/\n{2,}/)
    .map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/** Bytes of the embedded (data:) images in sanitized HTML. */
export function embeddedImages(html) {
  const list = [];
  for (const m of String(html || '').matchAll(IMG_SRC)) {
    const data = DATA_IMAGE.exec(m[3]);
    if (data) list.push({ type: data[1].toLowerCase(), base64: data[2].replace(/\s+/g, '') });
  }
  return list;
}

/** Sanitized editor HTML for the reply text (no images bigger than the limits). */
export function cleanVacationHtml(value, label = 'Text') {
  if (typeof value !== 'string' || value.length > VACATION_LIMITS.html) throw fail(`Ungültiger Wert: ${label}.`);
  const html = value.trim() ? sanitizeOutgoingHtml(value) : '';
  return htmlToText(html).trim() || /<img\b/i.test(html) ? html : '';
}

/**
 * The reply as it is sent: text, optionally followed by the signature, as HTML and plain text.
 * Throws when the images together exceed the limits (they travel in every reply).
 */
export function composeVacation({ bodyHtml = '', includeSignature = false }, signatureHtml = '') {
  const sig = includeSignature && signatureHtml ? sanitizeOutgoingHtml(signatureHtml) : '';
  const html = sig ? `${bodyHtml}${SIGNATURE_SEPARATOR}${sig}` : bodyHtml;
  const images = embeddedImages(html);
  const bytes = images.reduce((n, i) => n + Math.floor((i.base64.length * 3) / 4), 0);
  if (images.length > VACATION_LIMITS.images || bytes > VACATION_LIMITS.imageBytes)
    throw fail(
      'Die Abwesenheitsnotiz enthält zu viele oder zu große Bilder (höchstens 4 Bilder, zusammen 400 KB).',
      'vacation_too_large',
      413
    );
  // `tail`: what follows the text (separator and signature), for callers that treat it apart.
  return { html, text: htmlToText(html).slice(0, VACATION_LIMITS.text), tail: html.slice(bodyHtml.length) };
}

/**
 * Replaces embedded images by `cid:` references. Returns the HTML and the parts to attach.
 * `prefix` keeps body and signature images apart (only body images belong to the stored model).
 */
export function toCidImages(html, prefix = 'img') {
  const parts = [];
  const out = String(html || '').replace(IMG_SRC, (match, before, quote, src) => {
    const data = DATA_IMAGE.exec(src);
    if (!data) return match;
    const cid = `${prefix}${parts.length + 1}@levuvo`;
    parts.push({ cid, type: data[1].toLowerCase(), base64: data[2].replace(/\s+/g, '') });
    return `${before}${quote}cid:${cid}${quote}`;
  });
  return { html: out, parts };
}

/** Puts images referenced by `cid:` back as data URIs (inverse of toCidImages). */
export function fromCidImages(html, parts) {
  const byCid = new Map(parts.map(p => [p.cid.toLowerCase(), p]));
  return String(html || '').replace(IMG_SRC, (match, before, quote, src) => {
    const part = /^cid:(.+)$/i.exec(src) && byCid.get(src.slice(4).toLowerCase());
    return part ? `${before}${quote}data:${part.type};base64,${part.base64}${quote}` : match;
  });
}

/**
 * Embedded images removed (providers whose reply settings only keep web images: Microsoft 365,
 * Gmail). Images from https addresses stay.
 */
export function withoutEmbeddedImages(html) {
  let removed = 0;
  const out = String(html || '').replace(/<img\b[^>]*>/gi, tag => {
    const src = /\ssrc\s*=\s*(["'])([^"']*)\1/i.exec(tag)?.[2] || '';
    if (/^https:\/\//i.test(src)) return tag;
    removed += 1;
    return '';
  });
  return { html: out, removed };
}

const wrap76 = b64 => b64.replace(/.{1,76}/g, '$&\r\n').trimEnd();
const base64Utf8 = text => wrap76(Buffer.from(text, 'utf8').toString('base64'));

/**
 * MIME entity for Sieve `vacation :mime` (RFC 5230 §4.4): text and HTML alternatives, the
 * images inline (multipart/related with Content-ID), so the logo shows without loading
 * anything from the internet. `html` references the `parts` by `cid:` (see toCidImages).
 */
export function vacationMime({ html, text, parts = [] }, { boundary = () => randomBytes(12).toString('hex') } = {}) {
  const cidHtml = html;
  const document =
    '<!doctype html><html><head><meta charset="utf-8"></head>' +
    `<body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1a1a1a">${cidHtml}</body></html>`;
  const alt = `alt-${boundary()}`;
  const textPart = [
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Utf8(text)
  ].join('\r\n');
  const htmlPart = [
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Utf8(document)
  ].join('\r\n');
  let rich = htmlPart;
  if (parts.length) {
    const rel = `rel-${boundary()}`;
    rich = [
      `Content-Type: multipart/related; boundary="${rel}"`,
      '',
      `--${rel}`,
      htmlPart,
      ...parts.flatMap((p, i) => [
        `--${rel}`,
        [
          `Content-Type: ${p.type}; name="logo-${i + 1}.${p.type.split('/')[1]}"`,
          'Content-Transfer-Encoding: base64',
          `Content-ID: <${p.cid}>`,
          `Content-Disposition: inline; filename="logo-${i + 1}.${p.type.split('/')[1]}"`,
          '',
          wrap76(p.base64)
        ].join('\r\n')
      ]),
      `--${rel}--`
    ].join('\r\n');
  }
  return [
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    '',
    `--${alt}`,
    textPart,
    `--${alt}`,
    rich,
    `--${alt}--`,
    ''
  ].join('\r\n');
}

/** Image parts of a MIME entity built by vacationMime (to restore the editor content). */
export function mimeImageParts(mime) {
  const parts = [];
  const re =
    /Content-Type: (image\/(?:png|jpeg|gif|webp));[^\r\n]*\r\nContent-Transfer-Encoding: base64\r\nContent-ID: <([^>\r\n]+)>\r\n[^\r\n]*\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/g;
  for (const m of String(mime || '').matchAll(re))
    parts.push({ type: m[1], cid: m[2], base64: m[3].replace(/\s+/g, '') });
  return parts;
}
