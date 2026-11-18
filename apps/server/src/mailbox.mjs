// Read-only mailbox listing, paging, search and inbox monitoring.
// Every function uses EXAMINE (readOnly lock) and BODY.PEEK: listing never marks mail as read.
import { toMessageInfo } from './config.mjs';
import { attachPreviews, hasAttachments } from './previews.mjs';
import { isExpungedPlaceholder } from './imap-fetch.mjs';

// RFC822.SIZE costs nothing and identifies Dovecot's stand-in for an already expunged message.
const LIST_QUERY = { envelope: true, flags: true, internalDate: true, uid: true, bodyStructure: true, size: true };

export function safeImapInteger(value) {
  if (value === null || value === undefined) return null;
  const text = String(value);
  if (!/^(?:0|[1-9]\d{0,14})$/.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) && number >= 0 && number <= 4294967296 ? number : null;
}

/**
 * Keeps only complete answers to our own FETCH: a valid UID and the requested envelope,
 * one entry per UID. ImapFlow hands every untagged FETCH that arrives while the command
 * runs to the iterator, including unsolicited flag updates the server pushes for new or
 * changed mail (e.g. `* 12 FETCH (FLAGS (\Recent))`). Those carry no envelope and often
 * no UID; listed as is, they showed up as empty "(no subject)" messages that could not
 * be deleted. The same happens with the stand-in Dovecot returns for a message another
 * connection has just deleted or moved (see `isExpungedPlaceholder`).
 */
export function completeFetchResults(raw, requestedUids = null) {
  const wanted = requestedUids ? new Set(requestedUids.map(Number)) : null;
  const byUid = new Map();
  for (const message of raw) {
    const uid = message?.uid;
    if (!Number.isSafeInteger(uid) || uid < 1 || !message.envelope || isExpungedPlaceholder(message)) continue;
    if (wanted && !wanted.has(uid)) continue;
    if (!byUid.has(uid)) byUid.set(uid, message);
  }
  return [...byUid.values()];
}

export async function fetchInfos(client, range, { uidRange = false, previewCache, keyPrefix }) {
  const raw = [];
  for await (const message of client.fetch(range, LIST_QUERY, uidRange ? { uid: true } : undefined)) {
    raw.push(message);
  }
  const requested = uidRange && Array.isArray(range) ? range : null;
  const infos = completeFetchResults(raw, requested).map(message => ({
    ...toMessageInfo(message),
    hasAttachments: hasAttachments(message.bodyStructure),
    bodyStructure: message.bodyStructure
  }));
  await attachPreviews(client, infos, { cache: previewCache, keyPrefix });
  for (const info of infos) delete info.bodyStructure;
  return infos.sort((a, b) => b.uid - a.uid);
}

// UID windowing: an older page never asks the server for every UID below the cursor (on a
// 100k folder that was ~600 KB per page). It searches a window just below the cursor, sized
// from the folder's UID density, and widens it only when the window holds too few messages.
export const WINDOW_GROWTH = 2;
export const MAX_WINDOW_ROUNDS = 24;

/**
 * Selects the newest `limit` UIDs strictly below `beforeUid`, newest first.
 * `stats` ({ total, uidNext }) only tunes the first window; results are exact either way.
 * Returns `rounds` and `transferred` (UIDs the server sent) for the benchmark.
 */
export async function uidsBefore(client, beforeUid, limit, { total = 0, uidNext = 0 } = {}) {
  if (beforeUid <= 1) return { uids: [], more: false, rounds: 0, transferred: 0 };
  const want = limit + 1; // one extra UID tells whether an older page exists
  const density = total > 0 && uidNext > 1 ? Math.min(1, total / (uidNext - 1)) : 1;
  let span = Math.max(want, Math.ceil((want / Math.max(density, 1e-4)) * 1.25));
  let high = beforeUid - 1;
  const collected = [];
  let rounds = 0;
  let transferred = 0;
  while (high >= 1 && collected.length < want) {
    // Past the round limit the rest of the range is taken in one go, so the result stays exact.
    const low = rounds + 1 >= MAX_WINDOW_ROUNDS ? 1 : Math.max(1, high - span + 1);
    const found = await client.search({ uid: `${low}:${high}` }, { uid: true });
    rounds++;
    const list = Array.isArray(found) ? found : [];
    transferred += list.length;
    for (const uid of list) if (Number.isSafeInteger(uid) && uid >= low && uid <= high) collected.push(uid);
    high = low - 1;
    span = Math.min(4294967295, span * WINDOW_GROWTH);
  }
  const sorted = [...new Set(collected)].sort((a, b) => b - a);
  return { uids: sorted.slice(0, limit), more: sorted.length > limit, rounds, transferred };
}

/**
 * One page of a folder, newest first. Without `beforeUid` the newest messages are
 * returned; with it, the next older page. UID paging stays correct while new mail arrives.
 */
export async function listMessages(client, folder, { limit, beforeUid = null, previewCache, accountKey = '' }) {
  const lock = await client.getMailboxLock(folder, { readOnly: true });
  try {
    const total = Number(client.mailbox?.exists || 0);
    const uidValidity = String(client.mailbox?.uidValidity || '');
    const keyPrefix = `${accountKey}:${folder}:${uidValidity}`;
    const base = { folder, total, uidValidity, readOnly: true };
    if (!total) return { ...base, messages: [], hasMore: false, nextBeforeUid: null };
    let messages;
    let hasMore;
    if (beforeUid === null) {
      const start = Math.max(1, total - limit + 1);
      messages = (await fetchInfos(client, `${start}:*`, { previewCache, keyPrefix })).slice(0, limit);
      hasMore = start > 1;
    } else {
      const { uids, more } = await uidsBefore(client, beforeUid, limit, {
        total,
        uidNext: safeImapInteger(client.mailbox?.uidNext) || 0
      });
      messages = uids.length ? await fetchInfos(client, uids, { uidRange: true, previewCache, keyPrefix }) : [];
      hasMore = more;
    }
    const oldest = messages.length ? messages[messages.length - 1].uid : null;
    return { ...base, messages, hasMore: Boolean(hasMore && oldest), nextBeforeUid: hasMore ? oldest : null };
  } finally {
    lock.release();
  }
}

export function validateSearchQuery(value) {
  if (typeof value !== 'string') throw Object.assign(new Error('Suchbegriff fehlt.'), { statusCode: 400 });
  const q = value.trim();
  if (q.length < 2 || q.length > 80 || /[\x00-\x1f\x7f]/.test(value)) {
    throw Object.assign(new Error('Suche: 2 bis 80 Zeichen ohne Steuerzeichen eingeben.'), { statusCode: 400 });
  }
  return q;
}

/**
 * Server-side IMAP TEXT search in one folder, paged by UID. Later pages restrict the search to
 * UIDs below the cursor, so the server neither scans nor sends the part already shown.
 * `total` is the number of matches at or below the cursor (on the first page: all matches).
 */
export async function searchFolder(client, path, text, { limit, beforeUid = null, previewCache, accountKey = '' }) {
  const query = validateSearchQuery(text);
  const lock = await client.getMailboxLock(path, { readOnly: true });
  try {
    if (beforeUid !== null && beforeUid <= 1) {
      return { folder: path, query, total: 0, messages: [], readOnly: true, hasMore: false, nextBeforeUid: null };
    }
    const criteria = beforeUid === null ? { text: query } : { text: query, uid: `1:${beforeUid - 1}` };
    const ids = await client.search(criteria, { uid: true });
    if (!Array.isArray(ids)) throw Object.assign(new Error('IMAP-Suchfunktion nicht verfügbar.'), { statusCode: 502 });
    const all = [...new Set(ids.filter(n => Number.isSafeInteger(n) && n > 0))].sort((a, b) => b - a);
    const eligible = beforeUid === null ? all : all.filter(uid => uid < beforeUid);
    const window = eligible.slice(0, limit);
    const uidValidity = String(client.mailbox?.uidValidity || '');
    const messages = window.length
      ? await fetchInfos(client, window, {
          uidRange: true,
          previewCache,
          keyPrefix: `${accountKey}:${path}:${uidValidity}`
        })
      : [];
    const hasMore = eligible.length > window.length;
    return {
      folder: path,
      query,
      total: all.length,
      messages,
      readOnly: true,
      hasMore,
      nextBeforeUid: hasMore && messages.length ? messages[messages.length - 1].uid : null
    };
  } finally {
    lock.release();
  }
}

/**
 * Inbox state for notifications: UIDVALIDITY plus the highest UID and the newest headers.
 * UIDNEXT is monotonic even when messages are moved or expunged.
 */
export async function monitorInbox(client, { limit = 40, previewCache, accountKey = '' } = {}) {
  const capped = Number.isInteger(limit) ? Math.max(1, Math.min(limit, 40)) : 40;
  const lock = await client.getMailboxLock('INBOX', { readOnly: true });
  try {
    // On the long-lived IDLE connection the message count can lag behind when the server does not
    // push EXISTS right away (seen after deletes from another connection): NOOP collects pending
    // updates, otherwise the newest message was missing from the range below.
    await client.noop?.().catch(() => {});
    const status = client.mailbox || {};
    const validity = safeImapInteger(status.uidValidity);
    if (validity === null || validity < 1 || validity > 4294967295) {
      const error = new Error('UIDVALIDITY nicht verfügbar; sichere Benachrichtigungserkennung pausiert.');
      error.code = 'missing_uidvalidity';
      throw error;
    }
    const total = Number(status.exists || 0);
    const keyPrefix = `${accountKey}:INBOX:${validity}`;
    // `*` instead of the known count: if the count is behind the server (missing or misordered
    // EXISTS/EXPUNGE updates), the newest messages are still included.
    const messages =
      total > 0
        ? (await fetchInfos(client, `${Math.max(1, total - capped + 1)}:*`, { previewCache, keyPrefix })).slice(
            0,
            capped
          )
        : [];
    let unseen = null;
    try {
      const ids = await client.search({ seen: false }, { uid: true });
      if (Array.isArray(ids)) unseen = ids.length;
    } catch {
      /* counter is optional */
    }
    const uidNext = safeImapInteger(status.uidNext);
    const fetchedHigh = messages.reduce((highest, message) => Math.max(highest, message.uid || 0), 0);
    const highestUid = Math.min(4294967295, Math.max(fetchedHigh, uidNext === null ? 0 : uidNext - 1));
    return {
      folder: 'INBOX',
      readOnly: true,
      total,
      unseen,
      uidValidity: String(validity),
      highestUid,
      hasMore: total > capped,
      nextBeforeUid: total > capped && messages.length ? messages[messages.length - 1].uid : null,
      messages
    };
  } finally {
    lock.release();
  }
}
