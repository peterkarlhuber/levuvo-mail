// Text of mail attachments for "Ask your mailbox": plain text, CSV, Markdown, HTML and PDF.
// Attachments are third-party content: the text only ever goes to the model inside an
// untrusted-data frame, never into the search index and never to disk. Limits keep a hostile
// or huge file from stalling the server: size, page count, characters and a time budget.
import { attachmentBytes } from './message-utils.mjs';
import { htmlToText } from './html-mail.mjs';

export const ATTACHMENT_TEXT_LIMITS = Object.freeze({
  files: 4,
  bytes: 8 * 1024 * 1024,
  pages: 30,
  chars: 8000,
  totalChars: 16000,
  timeoutMs: 8000
});

const TEXT_TYPES =
  /^(text\/(plain|csv|markdown|x-markdown|html|calendar|tab-separated-values)|application\/(json|xml))$/;
const TEXT_EXT = /\.(txt|csv|tsv|md|markdown|json|xml|html?|ics|log)$/i;
const PDF = /^application\/(pdf|x-pdf)$/;

/** Which extractor handles this attachment, or null. */
export function textKind(info) {
  const type = String(info?.mimeType || '').toLowerCase();
  const name = String(info?.filename || '');
  if (PDF.test(type) || /\.pdf$/i.test(name)) return 'pdf';
  if (TEXT_TYPES.test(type) || (type === 'application/octet-stream' && TEXT_EXT.test(name))) return 'text';
  return null;
}

const squash = text =>
  String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), ms);
    })
  ]).finally(() => clearTimeout(timer));
}

/** Text of a PDF: scripting and eval are off, only the text layer of the first pages is read. */
export async function pdfText(
  bytes,
  { pages = ATTACHMENT_TEXT_LIMITS.pages, chars = ATTACHMENT_TEXT_LIMITS.chars } = {}
) {
  const { getDocumentProxy } = await import('unpdf');
  const doc = await getDocumentProxy(new Uint8Array(bytes), {
    isEvalSupported: false,
    enableXfa: false,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
    verbosity: 0
  });
  try {
    let out = '';
    const count = Math.min(doc.numPages, pages);
    for (let n = 1; n <= count && out.length < chars; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      out += content.items.map(i => (i.str ?? '') + (i.hasEOL ? '\n' : ' ')).join('') + '\n\n';
      page.cleanup();
    }
    return squash(out).slice(0, chars);
  } finally {
    await Promise.resolve(doc.destroy?.() ?? doc.cleanup?.()).catch(() => {});
  }
}

/** Text of one attachment, or '' when it has none (images, archives, encrypted PDFs, errors). */
export async function attachmentText(info, bytes, limits = ATTACHMENT_TEXT_LIMITS) {
  const kind = textKind(info);
  if (!kind || !bytes?.length || bytes.length > limits.bytes) return '';
  try {
    if (kind === 'pdf') return await withTimeout(pdfText(bytes, limits), limits.timeoutMs);
    const raw = Buffer.from(bytes).toString('utf8');
    const type = String(info?.mimeType || '').toLowerCase();
    const text = type === 'text/html' || /\.html?$/i.test(String(info?.filename || '')) ? htmlToText(raw) : raw;
    return squash(text).slice(0, limits.chars);
  } catch {
    return '';
  }
}

/**
 * Text of the readable attachments of a parsed message (detail.attachments + parsed.attachments
 * share their order). Returns [{ index, filename, mimeType, text }] for files that had text.
 */
export async function attachmentTexts(detail, parsed, limits = ATTACHMENT_TEXT_LIMITS) {
  const infos = Array.isArray(detail?.attachments) ? detail.attachments : [];
  const parts = Array.isArray(parsed?.attachments) ? parsed.attachments : [];
  const out = [];
  let total = 0;
  for (let i = 0; i < infos.length && out.length < limits.files && total < limits.totalChars; i++) {
    if (!textKind(infos[i]) || !parts[i]) continue;
    const text = (await attachmentText(infos[i], attachmentBytes(parts[i]), limits)).slice(
      0,
      limits.totalChars - total
    );
    if (!text) continue;
    total += text.length;
    out.push({ index: i, filename: String(infos[i].filename || '').slice(0, 255), mimeType: infos[i].mimeType, text });
  }
  return out;
}
