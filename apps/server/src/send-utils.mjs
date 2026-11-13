import { readPasswordProtection } from './protected-message.mjs';
import { readBody, readReference, readFromAddress, MAX_BODY_CHARS } from './message-body.mjs';
import { cleanFilename } from './message-utils.mjs';

export const MAX_ATTACHMENTS = 8;
export const MAX_TOTAL_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_RECIPIENTS = 30;
export { MAX_BODY_CHARS };
export const MAX_SUBJECT_CHARS = 250;

export function smtpConfig(env = process.env) {
  const inboundUser = String(env.IMAP_USER || '').trim();
  const inboundPassword = String(env.IMAP_PASSWORD || '');
  const user = String(env.SMTP_USER || inboundUser).trim();
  const password = String(env.SMTP_PASSWORD || inboundPassword);
  const port = Number(env.SMTP_PORT || 587);
  return {
    host: String(env.SMTP_HOST || 'mail.your-server.de').trim(),
    port,
    user,
    password,
    configured: Boolean(user && password && isEmail(user) && [465, 587].includes(port)),
    enabled: env.ENABLE_SEND === 'true'
  };
}

export function isEmail(input) {
  return (
    typeof input === 'string' &&
    input.length <= 254 &&
    /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i.test(
      input
    )
  );
}

function invalid(message) {
  const error = new Error(message);
  error.statusCode = 400;
  throw error;
}

function readAddresses(input, label) {
  if (!Array.isArray(input) || input.some(v => !isEmail(v))) invalid(`Ungültige E-Mail-Adresse unter ${label}.`);
  return input.map(value => value.trim());
}

function isCanonicalBase64(encoded) {
  if (encoded.length % 4 !== 0) return false;
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  const chars = encoded.slice(0, encoded.length - padding);
  return !/[^A-Za-z0-9+/]/.test(chars) && padding <= 2;
}

export function parseAttachments(input) {
  if (!Array.isArray(input) || input.length > MAX_ATTACHMENTS) invalid(`Maximal ${MAX_ATTACHMENTS} Anhänge erlaubt.`);
  let total = 0;
  return input.map((file, i) => {
    if (
      !file ||
      typeof file !== 'object' ||
      Array.isArray(file) ||
      typeof file.name !== 'string' ||
      file.name.length > 180 ||
      typeof file.contentBase64 !== 'string'
    )
      invalid(`Anhang ${i + 1} ist ungültig.`);
    const encoded = file.contentBase64;
    if (encoded.length > Math.ceil(MAX_TOTAL_ATTACHMENT_BYTES / 3) * 4 + 4) invalid('Anhänge sind zu groß.');
    if (!isCanonicalBase64(encoded)) invalid(`Anhang ${i + 1} ist ungültig.`);
    const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
    const byteLength = (encoded.length / 4) * 3 - padding;
    total += byteLength;
    if (total > MAX_TOTAL_ATTACHMENT_BYTES) invalid('Anhänge dürfen zusammen maximal 8 MiB groß sein.');
    const buffer = Buffer.from(encoded, 'base64');
    return {
      filename: cleanFilename(file.name, i),
      content: buffer,
      contentType: attachmentType(file.name),
      contentDisposition: 'attachment'
    };
  });
}

// Content type from the file extension (so recipients get previews); unknown → octet-stream.
const TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  heic: 'image/heic',
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  ics: 'text/calendar',
  vcf: 'text/vcard',
  asc: 'application/pgp-keys',
  zip: 'application/zip',
  doc: 'application/msword',
  xls: 'application/vnd.ms-excel',
  ppt: 'application/vnd.ms-powerpoint',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  eml: 'message/rfc822'
};
export function attachmentType(name) {
  const ext = /\.([a-z0-9]{1,5})$/i.exec(String(name || ''))?.[1]?.toLowerCase();
  return (ext && TYPES[ext]) || 'application/octet-stream';
}

export function validateSendPayload(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('Ungültige Nachricht.');
  if (typeof input.requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.requestId))
    invalid('Ungültige Versandkennung.');
  if (input.confirm !== 'SEND') invalid('Versand muss ausdrücklich bestätigt werden.');
  const to = readAddresses(input.to, 'An');
  const cc = readAddresses(input.cc, 'CC');
  const bcc = readAddresses(input.bcc, 'BCC');
  if (!to.length) invalid('Mindestens ein Empfänger unter An ist erforderlich.');
  const unique = new Set([...to, ...cc, ...bcc].map(v => v.toLowerCase()));
  if (unique.size > MAX_RECIPIENTS) invalid(`Maximal ${MAX_RECIPIENTS} Empfänger erlaubt.`);
  if (typeof input.subject !== 'string' || input.subject.length > MAX_SUBJECT_CHARS || /[\r\n\0]/.test(input.subject))
    invalid('Ungültiger Betreff.');
  const body = readBody(input);
  return {
    requestId: input.requestId,
    to,
    cc,
    bcc,
    subject: input.subject.trim() || '(Ohne Betreff)',
    text: body.text,
    html: body.html,
    editorHtml: body.editorHtml,
    inReplyTo: readReference(input.inReplyTo),
    references: readReference(input.references),
    from: readFromAddress(input.from),
    security: readSecurity(input.security),
    attachments: parseAttachments(input.attachments)
  };
}

/** Optional end-to-end protection requested in the composer. */
export function readSecurity(value) {
  if (value === undefined || value === null) return { method: null, sign: false, encrypt: false };
  if (typeof value !== 'object' || Array.isArray(value)) invalid('Ungültige Verschlüsselungsoption.');
  if (value.method === 'password') {
    try {
      return { method: 'password', sign: false, encrypt: true, ...readPasswordProtection(value) };
    } catch (err) {
      invalid(err.message);
    }
  }
  const method = value.method === 'pgp' || value.method === 'smime' ? value.method : null;
  const sign = value.sign === true;
  const encrypt = value.encrypt === true;
  if ((sign || encrypt) && !method) invalid('Bitte PGP oder S/MIME wählen.');
  return { method: sign || encrypt ? method : null, sign, encrypt };
}

export function publicSendStatus(smtp, inbox) {
  return {
    configured: inbox.configured,
    mailbox: inbox.configured ? inbox.user : null,
    readOnly: true, // Lesezugriff und bestehende Postfächer bleiben im Read-only-Modus.
    smtpConfigured: smtp.configured,
    sendEnabled: Boolean(inbox.configured && smtp.configured && smtp.enabled)
  };
}

// A user-provided SENT_FOLDER is an exact mailbox path from IMAP LIST.
// Never silently fall back to a different folder when it is configured.
export function findSentFolder(folders, preferredPath = '') {
  const selectable = folders.filter(folder => typeof folder.path === 'string' && !folder.flags?.has('\\Noselect'));
  const preferred = String(preferredPath || '').trim();
  if (preferred) {
    return (
      selectable.find(f => f.path === preferred) ||
      selectable.find(f => f.path.toLowerCase() === preferred.toLowerCase()) ||
      null
    );
  }
  return (
    selectable.find(f => f.specialUse === '\\Sent') ||
    selectable.find(f =>
      /^(sent|sent items|sent messages|sent mail|sentmail|gesendet|gesendete nachrichten|gesendete elemente)$/i.test(
        f.name || f.path
      )
    ) ||
    selectable.find(f =>
      /^(?:INBOX[./])?(?:sent|sent items|sent messages|gesendet|gesendete nachrichten)$/i.test(f.path)
    ) ||
    null
  );
}
