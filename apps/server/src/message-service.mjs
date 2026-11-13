import PostalMime from 'postal-mime';
import { MAX_MESSAGE_BYTES, publicMessage, attachmentBytes } from './message-utils.mjs';
import { parseDraftId } from './drafts.mjs';
import { analyzeMessage } from './security-analysis.mjs';
import { parseItip } from './calendar-model.mjs';
import { findProtectedBox } from './protected-message.mjs';
import { fetchUidOne } from './imap-fetch.mjs';

const PARSE_OPTIONS = {
  attachmentEncoding: 'arraybuffer',
  maxNestingDepth: 48,
  maxHeadersSize: 256 * 1024,
  maxRfc822NestingDepth: 3,
  maxPartCount: 500,
  maxForwardedAddresses: 500
};
const tooLarge = message => Object.assign(new Error(message), { statusCode: 413 });

async function parse(source) {
  try {
    return await PostalMime.parse(source, PARSE_OPTIONS);
  } catch {
    throw Object.assign(new Error('Nachrichteninhalt konnte nicht sicher verarbeitet werden.'), { statusCode: 422 });
  }
}

/** First text/calendar part (iMIP invitation, reply or cancellation). */
export function findCalendarPart(parsed) {
  const att = (parsed.attachments || []).find(
    a => /^text\/calendar/i.test(a.mimeType || '') || /\.ics$/i.test(a.filename || '')
  );
  if (!att) return null;
  try {
    return attachmentBytes(att).toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Loads a message read-only (EXAMINE + BODY.PEEK: opening never marks as read).
 * Optional `crypto` ({ pgp, smime }) unwraps PGP/MIME and S/MIME transparently;
 * `context.knownSender(email)` feeds the phishing analysis; `context.ownAddresses`
 * determines the own participation status in invitations.
 */
export async function loadParsedMessage(client, folder, uid, { crypto = null, context = {} } = {}) {
  const lock = await client.getMailboxLock(folder, { readOnly: true });
  try {
    const meta = await fetchUidOne(client, uid, { size: true, flags: true });
    if (!meta) return null;
    if (!Number.isSafeInteger(meta.size) || meta.size < 0 || meta.size > MAX_MESSAGE_BYTES) {
      throw tooLarge('Nachricht ist zu groß oder konnte nicht sicher geprüft werden (max. 12 MiB).');
    }
    const msg = await fetchUidOne(client, uid, { source: true });
    if (!msg?.source) return null;
    if (msg.source.byteLength > MAX_MESSAGE_BYTES) throw tooLarge('Nachricht überschreitet 12 MiB.');

    let source = msg.source;
    let parsed = await parse(source);
    let cryptoInfo = null;
    if (crypto) {
      const from = parsed.from?.address || '';
      const opened =
        (await crypto.pgp?.open(source).catch(() => null)) ||
        (await crypto.smime?.open(source, from).catch(() => null));
      if (opened) {
        cryptoInfo = {
          method: opened.method,
          encrypted: opened.encrypted,
          signatures: opened.signatures || [],
          locked: Boolean(opened.locked),
          error: opened.error || null
        };
        if (opened.raw) {
          source = Buffer.isBuffer(opened.raw) ? opened.raw : Buffer.from(opened.raw, 'binary');
          parsed = await parse(source);
        }
      } else if (crypto.pgp && /-----BEGIN PGP (MESSAGE|SIGNED MESSAGE)-----/.test(parsed.text || '')) {
        const inline = await crypto.pgp.openInline(parsed.text).catch(() => null);
        if (inline) {
          cryptoInfo = {
            method: 'pgp',
            encrypted: inline.encrypted,
            signatures: inline.signatures || [],
            locked: Boolean(inline.locked),
            error: inline.error || null,
            inline: true
          };
          if (typeof inline.text === 'string') {
            parsed.text = inline.text;
            parsed.html = '';
          }
        }
      }
    }

    const detail = publicMessage(parsed, uid, folder);
    detail.flagged = Boolean(meta.flags?.has('\\Flagged'));
    detail.unread = !meta.flags?.has('\\Seen');
    detail.crypto = cryptoInfo;
    const fromEmail = String(parsed.from?.address || '').toLowerCase();
    let known = null;
    try {
      known = context.knownSender ? await context.knownSender(fromEmail) : null;
    } catch {
      known = null;
    }
    detail.security = analyzeMessage(parsed, { knownSender: known });
    detail.pgpKeys = (parsed.attachments || [])
      .map((a, index) => ({ a, index }))
      .filter(
        ({ a }) =>
          /application\/pgp-keys/i.test(a.mimeType || '') ||
          (/\.asc$/i.test(a.filename || '') && (a.content?.byteLength || 0) < 100_000)
      )
      .map(({ index }) => index);

    const shielded = findProtectedBox(parsed.attachments);
    if (shielded) detail.protected = { hint: shielded.hint || '' };
    const ics = findCalendarPart(parsed);
    if (ics) {
      try {
        const itip = parseItip(ics);
        if (itip?.method) {
          const own = (context.ownAddresses || []).map(e => e.toLowerCase());
          const me = itip.attendees.find(a => own.includes(a.email));
          detail.invitation = {
            ...itip,
            myStatus: me?.partstat || null,
            isOrganizer: Boolean(itip.organizer && own.includes(itip.organizer.email))
          };
        }
      } catch {
        /* malformed calendar data is shown as a normal attachment */
      }
    }
    if (meta.flags?.has('\\Draft')) {
      detail.draftId = parseDraftId(msg.source);
      detail.uidValidity = String(client.mailbox?.uidValidity || '');
      const sendAt = /^x-levuvo-send-at:\s*(.+)$/im.exec(msg.source.subarray(0, 16000).toString('latin1'))?.[1]?.trim();
      if (sendAt && !Number.isNaN(Date.parse(sendAt))) detail.scheduledFor = new Date(sendAt).toISOString();
    }
    return { detail, parsed, source: msg.source, ics };
  } finally {
    lock.release();
  }
}
