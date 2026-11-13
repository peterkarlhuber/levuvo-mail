// Send later ("Später senden"): the finished message is stored in the Drafts folder with
// X-Levuvo-Send-At. While Levuvo Mail runs, due messages are claimed with the
// $LevuvoSending keyword, submitted once via SMTP, copied to Sent and moved to Trash.
// No automatic retry after an uncertain SMTP result (same policy as normal sending).
import PostalMime from 'postal-mime';
import { findDraftFolder } from './drafts.mjs';
import { findSpecialFolder } from './mail-actions.mjs';

export const SCHEDULED_FLAG = '$LevuvoScheduled';
export const SENDING_FLAG = '$LevuvoSending';
export const FAILED_FLAG = '$LevuvoFailed';
const MAX_AHEAD_MS = 366 * 24 * 3600 * 1000;
const problem = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });

export function validateSendAt(value, now = Date.now()) {
  const date = new Date(typeof value === 'string' ? value : NaN);
  if (Number.isNaN(date.getTime())) throw problem('Ungültiger Sendezeitpunkt.', 'send_at_invalid');
  if (date.getTime() < now + 30_000) throw problem('Der Sendezeitpunkt muss in der Zukunft liegen.', 'send_at_past');
  if (date.getTime() > now + MAX_AHEAD_MS) throw problem('Höchstens ein Jahr im Voraus planen.', 'send_at_too_far');
  return date;
}

/** Removes Bcc and internal headers from a raw RFC 5322 message (folded lines included). */
export function stripHeaders(raw, names) {
  const text = Buffer.isBuffer(raw) ? raw.toString('binary') : String(raw);
  const split = text.search(/\r?\n\r?\n/);
  if (split < 0) return Buffer.from(text, 'binary');
  const head = text.slice(0, split);
  const rest = text.slice(split);
  const lines = head.split(/\r?\n/);
  const kept = [];
  let skipping = false;
  for (const line of lines) {
    if (/^[ \t]/.test(line)) {
      if (!skipping) kept.push(line);
      continue;
    }
    const key = line.slice(0, line.indexOf(':')).trim().toLowerCase();
    skipping = names.some(n => (n.endsWith('*') ? key.startsWith(n.slice(0, -1)) : key === n));
    if (!skipping) kept.push(line);
  }
  return Buffer.from(kept.join('\r\n') + rest, 'binary');
}

export async function scheduleMessage(client, raw, preferredDrafts = '') {
  const folder = findDraftFolder(await client.list(), preferredDrafts);
  if (!folder)
    throw problem('Entwürfe-Ordner fehlt. Geplante Nachrichten werden dort gespeichert.', 'drafts_folder_missing', 409);
  let appended;
  try {
    appended = await client.append(folder.path, raw, ['\\Draft', '\\Seen', SCHEDULED_FLAG], new Date());
  } catch {
    appended = await client.append(folder.path, raw, ['\\Draft', '\\Seen'], new Date());
  }
  if (!appended) throw problem('Speichern der geplanten Nachricht fehlgeschlagen.', 'schedule_failed', 502);
  return { folder: folder.path, uid: appended.uid || null };
}

export async function listScheduled(client, preferredDrafts = '') {
  const folder = findDraftFolder(await client.list(), preferredDrafts);
  if (!folder) return { folder: null, items: [] };
  const lock = await client.getMailboxLock(folder.path, { readOnly: true });
  try {
    const uids = await client.search({ header: { 'x-levuvo-send-at': '' } }, { uid: true });
    if (!Array.isArray(uids) || !uids.length) return { folder: folder.path, items: [] };
    const items = [];
    for await (const m of client.fetch(
      uids,
      { uid: true, envelope: true, flags: true, headers: ['x-levuvo-send-at'] },
      { uid: true }
    )) {
      const header = m.headers?.toString('utf8') || '';
      const sendAt = /x-levuvo-send-at:\s*([^\r\n]+)/i.exec(header)?.[1]?.trim();
      if (!sendAt || Number.isNaN(Date.parse(sendAt))) continue;
      items.push({
        uid: m.uid,
        sendAt: new Date(sendAt).toISOString(),
        subject: m.envelope?.subject || '(Ohne Betreff)',
        to: (m.envelope?.to || []).map(a => a.address).filter(Boolean),
        state: m.flags?.has(FAILED_FLAG) ? 'failed' : m.flags?.has(SENDING_FLAG) ? 'sending' : 'scheduled'
      });
    }
    return { folder: folder.path, items: items.sort((a, b) => a.sendAt.localeCompare(b.sendAt)) };
  } finally {
    lock.release();
  }
}

/** How long a scheduled message is retried after temporary errors before it counts as failed. */
export const RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;
// SMTP stages before the message content is transferred: a failure here means nothing was sent.
const SAFE_STAGES = new Set(['CONN', 'EHLO', 'HELO', 'LHLO', 'STARTTLS', 'AUTH', 'MAIL FROM', 'RCPT TO']);

/**
 * True for errors where the message certainly was not delivered and a retry is harmless:
 * connection, TLS or login problems and temporary (4xx) refusals before DATA. Anything during
 * or after DATA stays final, because a retry could send the message twice.
 */
export function isRetryableSubmitError(err) {
  const stage = String(err?.command || '').toUpperCase();
  const safe = SAFE_STAGES.has(stage) || stage.startsWith('AUTH');
  if (!safe) return false;
  const code = Number(err?.responseCode || 0);
  return !(code >= 500 && code < 600);
}

/**
 * Sends every due message once. `submit(envelopeRecipients, raw)` must perform SMTP;
 * `saveSent(raw)` stores the copy. Returns a summary per message.
 */
export async function sendDue(client, { preferredDrafts = '', now = Date.now(), submit, saveSent }) {
  const { folder, items } = await listScheduled(client, preferredDrafts);
  const due = items.filter(i => i.state === 'scheduled' && Date.parse(i.sendAt) <= now);
  const results = [];
  if (!due.length) return { results, next: items.find(i => i.state === 'scheduled')?.sendAt || null };
  const trash = findSpecialFolder(await client.list(), '\\Trash');
  const lock = await client.getMailboxLock(folder);
  try {
    for (const item of due) {
      // Claim first: a second Levuvo instance sees $LevuvoSending and skips the message.
      const current = await client.fetchOne(String(item.uid), { uid: true, flags: true, source: true }, { uid: true });
      if (!current?.source || current.flags?.has(SENDING_FLAG) || current.flags?.has(FAILED_FLAG)) continue;
      await client.messageFlagsAdd(String(item.uid), [SENDING_FLAG], { uid: true });
      const parsed = await PostalMime.parse(current.source);
      const recipients = [...(parsed.to || []), ...(parsed.cc || []), ...(parsed.bcc || [])]
        .flatMap(a => (a.group ? a.group : [a]))
        .map(a => a.address)
        .filter(Boolean);
      const raw = stripHeaders(current.source, ['bcc', 'x-levuvo-*']);
      try {
        await submit(recipients, raw);
      } catch (err) {
        if (isRetryableSubmitError(err) && now - Date.parse(item.sendAt) < RETRY_WINDOW_MS) {
          // Nothing reached the server's DATA phase: release the claim, the next run tries again.
          await client.messageFlagsRemove(String(item.uid), [SENDING_FLAG], { uid: true }).catch(() => {});
          results.push({ uid: item.uid, sent: false, retry: true });
          continue;
        }
        await client.messageFlagsAdd(String(item.uid), [FAILED_FLAG], { uid: true }).catch(() => {});
        results.push({ uid: item.uid, sent: false });
        continue;
      }
      await saveSent(raw).catch(() => {});
      if (trash && client.capabilities?.has?.('MOVE'))
        await client.messageMove(String(item.uid), trash.path, { uid: true }).catch(() => {});
      else await client.messageFlagsAdd(String(item.uid), ['\\Deleted'], { uid: true }).catch(() => {});
      results.push({ uid: item.uid, sent: true, subject: item.subject });
    }
  } finally {
    lock.release();
  }
  return { results, next: items.find(i => i.state === 'scheduled' && Date.parse(i.sendAt) > now)?.sendAt || null };
}
