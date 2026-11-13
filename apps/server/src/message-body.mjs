// Shared validation of message bodies for sending, drafts and scheduled mail.
import { sanitizeOutgoingHtml, htmlToText, wrapHtmlDocument } from './html-mail.mjs';

export const MAX_BODY_CHARS = 100_000;
const problem = message => Object.assign(new Error(message), { statusCode: 400, code: 'body_invalid' });

/**
 * HTML mode: `html` is sanitized and a text part is derived from it.
 * Text mode: only `text` is used (plain text mail, no HTML part).
 */
export function readBody(input, { allowEmpty = false } = {}) {
  if (typeof input.html === 'string' && input.html.trim()) {
    const clean = sanitizeOutgoingHtml(input.html);
    const text = htmlToText(clean);
    const hasImage = /<img\b/i.test(clean);
    if (!allowEmpty && !text.trim() && !hasImage) throw problem('Der Nachrichtentext fehlt.');
    if (text.length > MAX_BODY_CHARS) throw problem('Der Nachrichtentext ist zu lang.');
    return { html: wrapHtmlDocument(clean), editorHtml: clean, text };
  }
  if (input.text !== undefined && typeof input.text !== 'string') throw problem('Ungültiger Nachrichtentext.');
  const text = input.text || '';
  if (text.includes('\0') || text.length > MAX_BODY_CHARS) throw problem('Der Nachrichtentext ist zu lang.');
  if (!allowEmpty && !text.trim()) throw problem('Der Nachrichtentext fehlt oder ist zu lang.');
  return { html: null, editorHtml: null, text };
}

export function readReference(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 998 || !/^(<[^<>\r\n\0\s]+>\s?){1,20}$/.test(value.trim())) {
    throw Object.assign(new Error('Ungültige Antwortreferenz.'), { statusCode: 400 });
  }
  return value.trim();
}

export function readFromAddress(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 254)
    throw Object.assign(new Error('Ungültiger Absender.'), { statusCode: 400 });
  return value.trim().toLowerCase();
}
