// Send later ("Später senden"): the finished message is stored in the Drafts folder with
// X-Levuvo-Send-At. The send state lives in IMAP keywords on that message, so it survives
// restarts and is shared by every device that runs Levuvo Mail for the account:
//   scheduled → claimed ($LevuvoClaimOwner/$LevuvoClaimOther) → sending ($LevuvoSending)
//   → sent ($LevuvoSent, then moved to Trash) | failed ($LevuvoFailed, nothing was sent)
//   | uncertain ($LevuvoSending left behind: SMTP may have run; never retried automatically).
// No automatic retry after an uncertain SMTP result (same policy as normal sending).
import { createHash } from 'node:crypto';
import PostalMime from 'postal-mime';
import { findDraftFolder } from './drafts.mjs';
import { childFolderPath, findSpecialFolder, selectableFolders } from './mail-actions.mjs';
import { fetchUidOne, isRequestedFetchResult, uidSet } from './imap-fetch.mjs';
import { findSentFolder } from './send-utils.mjs';

export const SCHEDULED_FLAG = '$LevuvoScheduled';
export const SENDING_FLAG = '$LevuvoSending';
export const FAILED_FLAG = '$LevuvoFailed';
export const SENT_FLAG = '$LevuvoSent';
export const CLAIM_OWNER_FLAG = '$LevuvoClaimOwner';
export const CLAIM_OTHER_FLAG = '$LevuvoClaimOther';
const STATE_FLAGS = [SENDING_FLAG, FAILED_FLAG, SENT_FLAG, CLAIM_OWNER_FLAG, CLAIM_OTHER_FLAG];
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
/** Puts a fresh Date header (RFC 5322) in front of the message. */
export function withDate(raw, date) {
  const text = Buffer.isBuffer(raw) ? raw.toString('binary') : String(raw);
  return Buffer.from(`Date: ${date.toUTCString().replace('GMT', '+0000')}\r\n${text}`, 'binary');
}

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

export async function scheduleMessage(client, raw, preferredDrafts = '', { draftId = '' } = {}) {
  const folder = findDraftFolder(await client.list(), preferredDrafts);
  if (!folder)
    throw problem('Entwürfe-Ordner fehlt. Geplante Nachrichten werden dort gespeichert.', 'drafts_folder_missing', 409);
  const lock = await client.getMailboxLock(folder.path);
  try {
    // Without keywords the send state cannot be stored on the server: refuse instead of risking
    // a message that is sent twice or never.
    if (!keywordsAllowed(client.mailbox))
      throw problem(
        'Dieser Mailserver speichert keine Statusmarkierungen. „Später senden“ ist hier nicht verfügbar.',
        'schedule_unsupported',
        409
      );
    // Idempotency: the same request ID never creates a second scheduled message.
    const existing = draftId ? await findScheduledInOpenFolder(client, draftId) : null;
    if (existing) return { folder: folder.path, uid: existing.uid, existing: true };
  } finally {
    lock.release();
  }
  let appended;
  try {
    appended = await client.append(folder.path, raw, ['\\Draft', '\\Seen', SCHEDULED_FLAG], new Date());
  } catch (err) {
    // Only a definite refusal (NO/BAD) proves nothing was stored. After a network error the
    // server may have stored the message already, so a second APPEND could duplicate it.
    if (!isServerRefusal(err)) throw unconfirmed(err);
    try {
      appended = await client.append(folder.path, raw, ['\\Draft', '\\Seen'], new Date());
    } catch (second) {
      if (isServerRefusal(second))
        throw problem('Speichern der geplanten Nachricht fehlgeschlagen.', 'schedule_failed', 502);
      throw unconfirmed(second);
    }
  }
  if (!appended) throw problem('Speichern der geplanten Nachricht fehlgeschlagen.', 'schedule_failed', 502);
  return { folder: folder.path, uid: appended.uid || null };
}

function unconfirmed(cause) {
  return Object.assign(problem('Speichern der geplanten Nachricht nicht bestätigt.', 'schedule_unconfirmed', 502), {
    uncertain: true,
    cause
  });
}

/** True when the IMAP server answered the command with NO or BAD (nothing was changed). */
export function isServerRefusal(err) {
  return ['NO', 'BAD'].includes(String(err?.responseStatus || '').toUpperCase());
}

/** False when the selected mailbox only allows a fixed set of flags that lacks our keywords. */
export function keywordsAllowed(mailbox) {
  const allowed = mailbox?.permanentFlags;
  if (!(allowed instanceof Set) || !allowed.size || allowed.has('\\*')) return true;
  return STATE_FLAGS.every(f => allowed.has(f));
}

async function findScheduledInOpenFolder(client, draftId) {
  const found = await client.search({ header: { 'x-levuvo-draft-id': draftId } }, { uid: true });
  if (!Array.isArray(found) || !found.length) return null;
  const query = { uid: true, headers: ['x-levuvo-draft-id', 'x-levuvo-send-at'] };
  const wanted = uidSet(found);
  for await (const m of client.fetch(found, query, { uid: true })) {
    if (!isRequestedFetchResult(m, query, wanted)) continue;
    const header = m.headers?.toString('utf8') || '';
    if (headerValue(header, 'x-levuvo-draft-id') === draftId && headerValue(header, 'x-levuvo-send-at'))
      return { uid: m.uid };
  }
  return null;
}

/** Looks for the scheduled message stored under `draftId` (used after an unconfirmed APPEND). */
export async function findScheduled(client, draftId, preferredDrafts = '') {
  const folder = findDraftFolder(await client.list(), preferredDrafts);
  if (!folder || !draftId) return null;
  const lock = await client.getMailboxLock(folder.path, { readOnly: true });
  try {
    const hit = await findScheduledInOpenFolder(client, draftId);
    return hit ? { folder: folder.path, uid: hit.uid } : null;
  } finally {
    lock.release();
  }
}

function headerValue(header, name) {
  const re = new RegExp(`(?:^|\\n)${name}:[ \\t]*([^\\r\\n]*)`, 'i');
  return re.exec(header)?.[1]?.trim() || '';
}

/**
 * State of a scheduled message, derived from its keywords:
 * scheduled → claimed → sending → sent, or failed. `uncertain` means SMTP may have started
 * but no confirmation was recorded (crash, lost connection): never retried automatically.
 */
export function scheduleState(flags) {
  if (!(flags instanceof Set)) return 'scheduled';
  if (flags.has(SENT_FLAG)) return 'sent';
  if (flags.has(FAILED_FLAG)) return 'failed';
  if (flags.has(SENDING_FLAG)) return 'uncertain';
  if (flags.has(CLAIM_OWNER_FLAG) || flags.has(CLAIM_OTHER_FLAG)) return 'claimed';
  return 'scheduled';
}

export async function listScheduled(client, preferredDrafts = '') {
  const folder = findDraftFolder(await client.list(), preferredDrafts);
  if (!folder) return { folder: null, items: [] };
  const lock = await client.getMailboxLock(folder.path, { readOnly: true });
  try {
    const uids = await client.search({ header: { 'x-levuvo-send-at': '' } }, { uid: true });
    if (!Array.isArray(uids) || !uids.length) return { folder: folder.path, items: [] };
    const items = [];
    const query = {
      uid: true,
      envelope: true,
      flags: true,
      headers: ['x-levuvo-send-at', 'x-levuvo-scheduler', 'x-levuvo-draft-id']
    };
    const wanted = uidSet(uids);
    const seen = new Set();
    for await (const m of client.fetch(uids, query, { uid: true })) {
      // Skip unsolicited FETCH responses (flag updates, foreign UIDs) and duplicates.
      if (!isRequestedFetchResult(m, query, wanted) || seen.has(m.uid)) continue;
      seen.add(m.uid);
      const header = m.headers?.toString('utf8') || '';
      const sendAt = headerValue(header, 'x-levuvo-send-at');
      if (!sendAt || Number.isNaN(Date.parse(sendAt))) continue;
      items.push({
        uid: m.uid,
        sendAt: new Date(sendAt).toISOString(),
        subject: m.envelope?.subject || '(Ohne Betreff)',
        to: (m.envelope?.to || []).map(a => a.address).filter(Boolean),
        messageId: m.envelope?.messageId || null,
        owner: headerValue(header, 'x-levuvo-scheduler') || null,
        state: scheduleState(m.flags)
      });
    }
    return {
      folder: folder.path,
      uidValidity: String(client.mailbox?.uidValidity ?? ''),
      items: items.sort((a, b) => a.sendAt.localeCompare(b.sendAt))
    };
  } finally {
    lock.release();
  }
}

/** How long a scheduled message is retried after temporary errors before it counts as failed. */
export const RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;
/** A device that did not schedule the message waits this long, so the owner can send it first. */
export const TAKEOVER_GRACE_MS = 2 * 60 * 1000;
/** A claim without $LevuvoSending that stays this long belongs to a device that stopped. */
export const CLAIM_LEASE_MS = 10 * 60 * 1000;
/** A send that failed for a temporary reason is tried again after this long. */
export const RETRY_DELAY_MS = 60 * 1000;
// SMTP stages before the message content is transferred: a failure here means nothing was sent.
const SAFE_STAGES = new Set(['CONN', 'EHLO', 'HELO', 'LHLO', 'STARTTLS', 'AUTH', 'MAIL FROM', 'RCPT TO']);
const safeStage = err => {
  // Errors before any SMTP contact (OAuth token, SMTP settings) are marked by the caller.
  if (err?.beforeSmtp === true) return true;
  const stage = String(err?.command || '').toUpperCase();
  return SAFE_STAGES.has(stage) || stage.startsWith('AUTH');
};

/**
 * True for errors where the message certainly was not delivered and a retry is harmless:
 * connection, TLS or login problems and temporary (4xx) refusals before DATA. Anything during
 * or after DATA stays final, because a retry could send the message twice.
 */
export function isRetryableSubmitError(err) {
  if (!safeStage(err)) return false;
  const code = Number(err?.responseCode || 0);
  return !(code >= 500 && code < 600);
}

/** True when the error happened before DATA: the message was certainly not sent. */
export function isDefinitiveSubmitFailure(err) {
  return safeStage(err);
}

async function freshFlags(client, uid) {
  const current = await fetchUidOne(client, uid, { flags: true });
  return current?.flags instanceof Set ? current.flags : null;
}

const OWNER_POLLS = 10;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Claims one message for this device and marks it $LevuvoSending. Returns true when this
 * device may submit it now.
 *
 * Mutual exclusion between the owner (the device that scheduled it) and any other device:
 * each first sets its own claim flag, then re-reads the flags from the server.
 * - The other device yields whenever it sees the owner's claim (removes its own flag).
 * - The owner waits while the other device's claim is present: that device either yields
 *   or has already won and sets $LevuvoSending, which makes the owner stop.
 * Because the other device only proceeds when its read came before the owner's claim, both
 * can never proceed together; the owner never yields to a running other device, so both
 * do not keep backing off either.
 */
async function claim(client, item, { mine, now, claims, folderKey, pollMs, folders }) {
  const own = mine ? CLAIM_OWNER_FLAG : CLAIM_OTHER_FLAG;
  const theirs = mine ? CLAIM_OTHER_FLAG : CLAIM_OWNER_FLAG;
  const uid = String(item.uid);
  const final = f => f.has(SENDING_FLAG) || f.has(SENT_FLAG) || f.has(FAILED_FLAG);
  let flags = await freshFlags(client, item.uid);
  if (!flags || final(flags)) return false;
  // A claim without $LevuvoSending is only held for moments by a running device; one that
  // stays longer than the lease belongs to a device that stopped before SMTP and is released.
  // The owner's own claim can only be left over from this device's previous run.
  const held = [theirs, ...(mine ? [] : [own])].filter(f => flags.has(f));
  const key = `${folderKey}:${uid}`;
  if (held.length && claims.has(key) && now - claims.get(key) >= CLAIM_LEASE_MS) {
    await client.messageFlagsRemove(uid, held, { uid: true }).catch(() => {});
    claims.delete(key);
    return false; // the next run starts from a clean state
  }
  if (held.length && !(mine && held.length === 1 && held[0] === theirs)) {
    claims.set(key, claims.get(key) ?? now);
    return false;
  }
  if ((await client.messageFlagsAdd(uid, [own], { uid: true })) === false) return false;
  for (let poll = 0; ; poll++) {
    flags = await freshFlags(client, item.uid);
    if (!flags?.has(own) || final(flags)) return false;
    if (!flags.has(theirs)) break;
    if (!mine || poll >= OWNER_POLLS) {
      // Other device: yield to the owner. Owner: the other claim did not go away (stopped
      // device); remember it for the lease and try again later.
      await client.messageFlagsRemove(uid, [own], { uid: true }).catch(() => {});
      if (mine) claims.set(key, claims.get(key) ?? now);
      return false;
    }
    await sleep(pollMs);
  }
  claims.delete(key);
  let lockPath = null;
  if (!mine) {
    lockPath = await takeoverLock(client, folders, { key, folderKey, uid, now, claims });
    if (!lockPath) {
      await client.messageFlagsRemove(uid, [own], { uid: true }).catch(() => {});
      return false;
    }
    // Won the lock: the owner may have claimed meanwhile (it never waits for the lock).
    flags = await freshFlags(client, item.uid);
    if (!flags?.has(own) || flags.has(theirs) || final(flags)) {
      await client.messageFlagsRemove(uid, [own], { uid: true }).catch(() => {});
      await tryDelete(client, lockPath);
      return false;
    }
  }
  if ((await client.messageFlagsAdd(uid, [SENDING_FLAG], { uid: true })) === false) {
    if (lockPath) await tryDelete(client, lockPath);
    return false;
  }
  return lockPath || true;
}

// Takeover lock. Keywords cannot tell two other devices apart (both set $LevuvoClaimOther), and
// IMAP has no compare-and-swap for flags. Creating a mailbox is atomic: of several devices that
// CREATE the same name, exactly one succeeds. A device that is not the owner therefore only sends
// after it created the lock folder for this message; it deletes the folder afterwards.
const LOCK_PREFIX = 'Levuvo-Sendelock-';
const lockName = (folderKey, uid) =>
  `${LOCK_PREFIX}${createHash('sha256').update(`${folderKey}:${uid}`).digest('hex').slice(0, 16)}`;
const tryCreate = (client, path) =>
  Promise.resolve()
    .then(() => client.mailboxCreate(path))
    .catch(() => null);
const tryDelete = (client, path) =>
  Promise.resolve()
    .then(() => client.mailboxDelete(path))
    .catch(() => null);
const isLockFolder = f => (f.path.split(/[./]/).at(-1) || '').startsWith(LOCK_PREFIX);

async function takeoverLock(client, folders, { key, folderKey, uid, now, claims }) {
  let path;
  try {
    path = childFolderPath(folders, lockName(folderKey, uid), 'Levuvo');
  } catch {
    return null; // hierarchy unknown: no safe lock, so no takeover
  }
  const made = await tryCreate(client, path);
  if (made?.created === true) {
    claims.delete(`lock:${key}`);
    return path;
  }
  // Held by another device. One that stopped before $LevuvoSending leaves it behind: released
  // after the lease, the next run competes again.
  const since = claims.get(`lock:${key}`) ?? now;
  claims.set(`lock:${key}`, since);
  if (now - since >= CLAIM_LEASE_MS) {
    await tryDelete(client, path);
    claims.delete(`lock:${key}`);
  }
  return null;
}

async function cleanUp(client, uid, trash) {
  if (trash && client.capabilities?.has?.('MOVE'))
    return Boolean(await client.messageMove(String(uid), trash.path, { uid: true }).catch(() => false));
  return Boolean(await client.messageFlagsAdd(String(uid), ['\\Deleted'], { uid: true }).catch(() => false));
}

/**
 * Sends every due message at most once. `submit(envelopeRecipients, raw)` performs SMTP;
 * `saveSent(raw)` stores the copy; `wasSent(messageId)` (optional) looks for the message in
 * the Sent folder to settle an unconfirmed state. `instanceId` identifies this installation.
 *
 * Claim protocol (see claim()): the device that scheduled a message (X-Levuvo-Scheduler)
 * uses $LevuvoClaimOwner, every other device $LevuvoClaimOther and only after
 * TAKEOVER_GRACE_MS. Then $LevuvoSending marks "SMTP may start", $LevuvoSent "SMTP accepted".
 */
export async function sendDue(
  client,
  {
    preferredDrafts = '',
    now = Date.now(),
    submit,
    saveSent,
    wasSent = null,
    instanceId = '',
    claims = new Map(),
    pollMs = 300
  }
) {
  const { folder, uidValidity = '', items } = await listScheduled(client, preferredDrafts);
  const results = [];
  // The next run: the next scheduled time, the end of another device's grace period, the end of
  // a stale claim's lease, and soon again after a retry, so nothing waits for the 10-minute run.
  const nextAt = () => {
    const times = [];
    for (const i of items) {
      const at = Date.parse(i.sendAt);
      if (!Number.isFinite(at)) continue;
      const foreign = Boolean(i.owner) && i.owner !== instanceId;
      if (i.state === 'scheduled') times.push(foreign ? at + TAKEOVER_GRACE_MS : at);
      if (i.state === 'claimed') times.push(Math.max(at, now) + CLAIM_LEASE_MS);
    }
    if (results.some(r => r.retry)) times.push(now + RETRY_DELAY_MS);
    const future = times.filter(ms => ms > now).sort((a, b) => a - b);
    return future.length ? new Date(future[0]).toISOString() : null;
  };
  const isDue = i => {
    if (!['scheduled', 'claimed'].includes(i.state)) return false;
    const at = Date.parse(i.sendAt);
    const mine = Boolean(instanceId) && i.owner === instanceId;
    return mine || !i.owner ? at <= now : at + TAKEOVER_GRACE_MS <= now;
  };
  const due = items.filter(isDue);
  const leftovers = items.filter(i => i.state === 'sent' || (i.state === 'uncertain' && wasSent && i.messageId));
  if (!due.length && !leftovers.length) return { results, next: nextAt() };
  const folders = selectableFolders(await client.list());
  const trash = findSpecialFolder(folders, '\\Trash');
  const folderKey = `${folder}:${uidValidity}`;
  // Lock folders whose message is no longer waiting (sent by the owner, removed) are left over.
  const waiting = new Set(
    items.filter(i => ['scheduled', 'claimed'].includes(i.state)).map(i => lockName(folderKey, String(i.uid)))
  );
  for (const f of folders.filter(isLockFolder))
    if (!waiting.has(f.path.split(/[./]/).at(-1))) await tryDelete(client, f.path);
  const lock = await client.getMailboxLock(folder);
  try {
    for (const item of leftovers) {
      // Unconfirmed: the copy in "Sent" proves the message went out (absence proves nothing).
      if (item.state === 'uncertain') {
        if (!(await wasSent(item.messageId).catch(() => false))) continue;
        await client.messageFlagsAdd(String(item.uid), [SENT_FLAG], { uid: true }).catch(() => {});
        results.push({ uid: item.uid, sent: true, confirmed: true, subject: item.subject });
      }
      await cleanUp(client, item.uid, trash);
    }
    for (const item of due) {
      const mine = Boolean(instanceId) && item.owner === instanceId;
      const claimed = await claim(client, item, { mine, now, claims, folderKey, pollMs, folders });
      if (!claimed) continue;
      try {
        await sendClaimed(item);
      } finally {
        if (typeof claimed === 'string') await tryDelete(client, claimed);
      }
    }
  } finally {
    lock.release();
  }
  return { results, next: nextAt() };

  async function sendClaimed(item) {
    const current = await fetchUidOne(client, item.uid, { flags: true, source: true });
    if (!current?.source) {
      // Claimed but unreadable: release, nothing was sent.
      await client
        .messageFlagsRemove(String(item.uid), [SENDING_FLAG, CLAIM_OWNER_FLAG, CLAIM_OTHER_FLAG], { uid: true })
        .catch(() => {});
      return;
    }
    let recipients;
    let raw;
    try {
      const parsed = await PostalMime.parse(current.source);
      recipients = [...(parsed.to || []), ...(parsed.cc || []), ...(parsed.bcc || [])]
        .flatMap(a => (a.group ? a.group : [a]))
        .map(a => a.address)
        .filter(Boolean);
      // The Date header is the moment of sending, not the moment the message was scheduled.
      raw = withDate(stripHeaders(current.source, ['bcc', 'x-levuvo-*', 'date']), new Date(now));
    } catch {
      // Unreadable message: nothing was sent. Shown as failed instead of "unconfirmed".
      await client.messageFlagsAdd(String(item.uid), [FAILED_FLAG], { uid: true }).catch(() => {});
      await client.messageFlagsRemove(String(item.uid), [SENDING_FLAG], { uid: true }).catch(() => {});
      results.push({ uid: item.uid, sent: false });
      return;
    }
    if (!recipients.length) {
      await client.messageFlagsAdd(String(item.uid), [FAILED_FLAG], { uid: true }).catch(() => {});
      await client.messageFlagsRemove(String(item.uid), [SENDING_FLAG], { uid: true }).catch(() => {});
      results.push({ uid: item.uid, sent: false });
      return;
    }
    try {
      await submit(recipients, raw);
    } catch (err) {
      if (isRetryableSubmitError(err) && now - Date.parse(item.sendAt) < RETRY_WINDOW_MS) {
        // Nothing reached the server's DATA phase: release the claim, the next run tries again.
        await client
          .messageFlagsRemove(String(item.uid), [SENDING_FLAG, CLAIM_OWNER_FLAG, CLAIM_OTHER_FLAG], { uid: true })
          .catch(() => {});
        results.push({ uid: item.uid, sent: false, retry: true });
        return;
      }
      if (isDefinitiveSubmitFailure(err)) {
        // Refused before DATA: certainly not sent, shown as failed.
        await client.messageFlagsAdd(String(item.uid), [FAILED_FLAG], { uid: true }).catch(() => {});
        await client.messageFlagsRemove(String(item.uid), [SENDING_FLAG], { uid: true }).catch(() => {});
        results.push({ uid: item.uid, sent: false });
      } else {
        // During or after DATA: delivery unknown. $LevuvoSending stays, the message is shown as
        // unconfirmed and never sent again automatically.
        results.push({ uid: item.uid, sent: false, uncertain: true });
      }
      return;
    }
    await client.messageFlagsAdd(String(item.uid), [SENT_FLAG], { uid: true }).catch(() => {});
    await saveSent(raw).catch(() => {});
    await cleanUp(client, item.uid, trash);
    results.push({ uid: item.uid, sent: true, subject: item.subject });
  }
}

/** True when a message with this Message-ID is in the Sent folder (settles "unconfirmed"). */
export async function foundInSent(client, messageId, preferredPath = '') {
  if (!messageId) return false;
  const sent = findSentFolder(await client.list(), preferredPath);
  if (!sent) return false;
  const lock = await client.getMailboxLock(sent.path, { readOnly: true });
  try {
    const found = await client.search({ header: { 'message-id': messageId } }, { uid: true });
    return Array.isArray(found) && found.length > 0;
  } finally {
    lock.release();
  }
}
