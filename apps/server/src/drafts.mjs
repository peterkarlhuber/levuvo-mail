import nodemailer from 'nodemailer';
import { isEmail, MAX_SUBJECT_CHARS, MAX_BODY_CHARS, parseAttachments } from './send-utils.mjs';
import { validUid } from './message-utils.mjs';
import { selectableFolders, findSpecialFolder, childFolderPath } from './mail-actions.mjs';
import { readBody, readFromAddress } from './message-body.mjs';
import { fetchUidOne } from './imap-fetch.mjs';

const problem = (message, code = 'draft_invalid', statusCode = 400) =>
  Object.assign(new Error(message), { code, statusCode });
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
export const DRAFT_MAX_TEXT = MAX_BODY_CHARS;
export const DRAFT_MAX_BYTES = 12 * 1024 * 1024;
export const draftEnabled = (env = process.env) => env.ENABLE_DRAFTS === 'true';

export function findDraftFolder(folders, preferred = '') {
  const available = selectableFolders(folders);
  if (preferred) return available.find(f => f.path === preferred) || null;
  return (
    available.find(f => f.specialUse === '\\Drafts') ||
    available.find(f => /^(drafts|entwürfe|entwuerfe)$/i.test(f.path.split(/[./]/).at(-1) || '')) ||
    null
  );
}
export function parseDraftId(source) {
  if (!source || !Buffer.isBuffer(source)) return null;
  const headers = source
    .subarray(0, 16000)
    .toString('latin1')
    .split(/\r?\n\r?\n/, 1)[0];
  const match = headers.match(/(?:^|\r?\n)X-Levuvo-Draft-ID:\s*([a-f0-9-]{36})\s*(?=\r?\n|$)/i);
  return match && UUID.test(match[1]) ? match[1].toLowerCase() : null;
}
export function validateDraft(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw problem('Ungültiger Entwurf.');
  if (typeof input.draftId !== 'string' || !UUID.test(input.draftId)) throw problem('Ungültige Entwurfskennung.');
  for (const field of ['to', 'cc', 'bcc']) {
    if (!Array.isArray(input[field]) || input[field].length > 30 || input[field].some(a => !isEmail(a))) {
      throw problem(`Ungültige Adresse unter ${field.toUpperCase()}.`);
    }
  }
  if (new Set([...input.to, ...input.cc, ...input.bcc].map(a => a.toLowerCase())).size > 30)
    throw problem('Maximal 30 Empfänger.');
  if (typeof input.subject !== 'string' || input.subject.length > MAX_SUBJECT_CHARS || /[\r\n\0]/.test(input.subject))
    throw problem('Ungültiger Betreff.');
  const body = readBody(input, { allowEmpty: true });
  if (input.previousUid !== null && input.previousUid !== undefined && !validUid(String(input.previousUid)))
    throw problem('Ungültige bisherige Entwurfs-UID.');
  if (
    input.previousUid !== null &&
    input.previousUid !== undefined &&
    !/^\d{1,20}$/.test(String(input.uidValidity || ''))
  )
    throw problem('UIDVALIDITY fehlt.');
  if (
    input.inReplyTo !== undefined &&
    input.inReplyTo !== '' &&
    input.inReplyTo !== null &&
    (typeof input.inReplyTo !== 'string' || !/^<[^<>\r\n\0\s]+>$/.test(input.inReplyTo) || input.inReplyTo.length > 254)
  )
    throw problem('Ungültige Antwortreferenz.');
  // Base64 fields are validated and decoded with the same limits as SMTP sends.
  const attachments = parseAttachments(input.attachments || []);
  return {
    draftId: input.draftId.toLowerCase(),
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    subject: input.subject,
    text: body.text,
    html: body.html,
    inReplyTo: input.inReplyTo || undefined,
    from: readFromAddress(input.from),
    previousUid: input.previousUid == null ? null : String(input.previousUid),
    uidValidity: input.uidValidity == null ? null : String(input.uidValidity),
    attachments
  };
}
export async function composeDraft(mailbox, data) {
  const composer = nodemailer.createTransport({ streamTransport: true, buffer: true });
  const built = await composer.sendMail({
    from: mailbox,
    to: data.to,
    cc: data.cc,
    bcc: data.bcc,
    subject: data.subject,
    text: data.text,
    ...(data.html ? { html: data.html } : {}),
    attachments: data.attachments,
    ...(data.inReplyTo ? { inReplyTo: data.inReplyTo } : {}),
    headers: { 'X-Levuvo-Draft-ID': data.draftId, ...(data.extraHeaders || {}) },
    attachDataUrls: true,
    keepBcc: true,
    disableFileAccess: true,
    disableUrlAccess: true
  });
  if (built.message.length > DRAFT_MAX_BYTES)
    throw problem('Entwurf überschreitet die maximale Größe.', 'draft_too_large', 413);
  return built.message;
}

/** Mailboxes without any drafts folder get one on first save, like in other mail clients. */
async function createDraftsFolder(client, folders) {
  let path;
  try {
    path = childFolderPath(folders, 'Drafts', 'Entwürfe-Ordner');
  } catch {
    return null;
  }
  const created = await client.mailboxCreate(path).catch(() => null);
  return created ? { path } : null;
}

// APPEND first; previous version is moved to Trash only after APPEND returns a concrete UID.
// No permanent deletion or EXPUNGE is performed. UIDPLUS is required for verifiable APPENDUID.
export async function saveDraft(client, mailbox, input, preferredPath = '') {
  const data = validateDraft(input);
  const folders = await client.list();
  let folder = findDraftFolder(folders, preferredPath);
  if (!folder && !preferredPath) folder = await createDraftsFolder(client, folders);
  if (!folder)
    throw problem(
      'Entwürfe-Ordner fehlt. Bitte im Webmail deines Anbieters anlegen oder in den Kontoeinstellungen angeben.',
      'drafts_folder_missing',
      409
    );
  if (!client.capabilities?.has('UIDPLUS'))
    throw problem(
      'IMAP UIDPLUS fehlt. Automatisches Speichern wird sicherheitshalber nicht ausgeführt.',
      'uidplus_required',
      409
    );
  const trash = data.previousUid !== null ? findSpecialFolder(folders, '\\Trash') : null;
  if (data.previousUid !== null && (!trash || !client.capabilities?.has('MOVE'))) {
    throw problem(
      'Für sichere Entwurfsrevisionen sind Papierkorb und IMAP MOVE erforderlich.',
      'safe_move_required',
      409
    );
  }
  const lock = await client.getMailboxLock(folder.path);
  try {
    if (client.mailbox?.readOnly) throw problem('Entwürfe-Ordner ist schreibgeschützt.', 'drafts_readonly', 403);
    const validity = String(client.mailbox?.uidValidity || '');
    if (!/^\d+$/.test(validity)) throw problem('UIDVALIDITY nicht verfügbar.', 'uidvalidity_missing', 409);
    if (data.previousUid !== null) {
      if (data.uidValidity !== validity)
        throw problem('Der Entwürfe-Ordner wurde geändert. Bitte Entwurf erneut öffnen.', 'draft_conflict', 409);
      const meta = await fetchUidOne(client, data.previousUid, { size: true, flags: true });
      if (!meta || !meta.flags?.has('\\Draft') || !Number.isInteger(meta.size) || meta.size > DRAFT_MAX_BYTES) {
        throw problem(
          'Vorheriger Entwurf wurde verändert oder gelöscht. Bitte Ordner neu laden.',
          'draft_conflict',
          409
        );
      }
      const previous = await fetchUidOne(client, data.previousUid, { source: true });
      if (!previous?.source || parseDraftId(previous.source) !== data.draftId) {
        throw problem(
          'Vorheriger Entwurf wurde verändert oder gelöscht. Bitte Ordner neu laden.',
          'draft_conflict',
          409
        );
      }
    }
    const raw = await composeDraft(mailbox, data);
    const appended = await client.append(folder.path, raw, ['\\Draft', '\\Seen'], new Date());
    if (
      !appended?.uid ||
      !validUid(String(appended.uid)) ||
      (appended.uidValidity && String(appended.uidValidity) !== validity)
    ) {
      throw problem(
        'Speicherstatus unklar. Bitte Entwürfe-Ordner prüfen, nicht sofort wiederholen.',
        'draft_save_uncertain',
        502
      );
    }
    let previousRemoved = true;
    if (data.previousUid !== null) {
      try {
        previousRemoved = (await client.messageMove(data.previousUid, trash.path, { uid: true })) !== false;
      } catch {
        previousRemoved = false;
      }
    }
    return { saved: true, folder: folder.path, uid: appended.uid, uidValidity: validity, previousRemoved };
  } finally {
    lock.release();
  }
}

/** Removes the draft a sent/scheduled message was created from (moved to Trash, never expunged). */
export function validateReplaceDraft(input) {
  if (input === null || input === undefined) return null;
  if (
    typeof input !== 'object' ||
    !validUid(String(input.uid)) ||
    !/^\d{1,20}$/.test(String(input.uidValidity || '')) ||
    !UUID.test(String(input.draftId || ''))
  )
    throw problem('Ungültiger Entwurfsverweis.', 'draft_reference_invalid', 400);
  return {
    uid: String(input.uid),
    uidValidity: String(input.uidValidity),
    draftId: String(input.draftId).toLowerCase()
  };
}
export async function retireDraft(client, ref, preferredPath = '') {
  if (!ref) return { removed: false };
  const folders = await client.list();
  const folder = findDraftFolder(folders, preferredPath);
  const trash = findSpecialFolder(folders, '\\Trash');
  if (!folder || !trash) return { removed: false };
  const lock = await client.getMailboxLock(folder.path);
  try {
    if (String(client.mailbox?.uidValidity || '') !== ref.uidValidity) return { removed: false };
    const previous = await fetchUidOne(client, ref.uid, { source: true, flags: true });
    if (!previous?.source || !previous.flags?.has('\\Draft') || parseDraftId(previous.source) !== ref.draftId)
      return { removed: false };
    return { removed: (await client.messageMove(ref.uid, trash.path, { uid: true })) !== false };
  } catch {
    return { removed: false };
  } finally {
    lock.release();
  }
}
