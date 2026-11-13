// Read-only mailbox listing, paging, search and inbox monitoring.
// Every function uses EXAMINE (readOnly lock) and BODY.PEEK: listing never marks mail as read.
import { toMessageInfo } from './config.mjs';
import { attachPreviews, hasAttachments } from './previews.mjs';

const LIST_QUERY = { envelope: true, flags: true, internalDate: true, uid: true, bodyStructure: true };

export function safeImapInteger(value) {
  if (value === null || value === undefined) return null;
  const text = String(value);
  if (!/^(?:0|[1-9]\d{0,14})$/.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) && number >= 0 && number <= 4294967296 ? number : null;
}

export async function fetchInfos(client, range, { uidRange = false, previewCache, keyPrefix }) {
  const raw = [];
  for await (const message of client.fetch(range, LIST_QUERY, uidRange ? { uid: true } : undefined)) {
    raw.push(message);
  }
  const infos = raw.map(message => ({
    ...toMessageInfo(message),
    hasAttachments: hasAttachments(message.bodyStructure),
    bodyStructure: message.bodyStructure
  }));
  await attachPreviews(client, infos, { cache: previewCache, keyPrefix });
  for (const info of infos) delete info.bodyStructure;
  return infos.sort((a, b) => b.uid - a.uid);
}

/** Selects the newest `limit` UIDs strictly below `beforeUid`. */
async function uidsBefore(client, beforeUid, limit) {
  if (beforeUid <= 1) return { uids: [], more: false };
  const found = await client.search({ uid: `1:${beforeUid - 1}` }, { uid: true });
  const all = (Array.isArray(found) ? found : [])
    .filter(uid => Number.isSafeInteger(uid) && uid > 0 && uid < beforeUid)
    .sort((a, b) => a - b);
  return { uids: all.slice(-limit), more: all.length > limit };
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
      messages = await fetchInfos(client, `${start}:${total}`, { previewCache, keyPrefix });
      hasMore = start > 1;
    } else {
      const { uids, more } = await uidsBefore(client, beforeUid, limit);
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

/** Server-side IMAP TEXT search in one folder, paged by UID. */
export async function searchFolder(client, path, text, { limit, beforeUid = null, previewCache, accountKey = '' }) {
  const query = validateSearchQuery(text);
  const lock = await client.getMailboxLock(path, { readOnly: true });
  try {
    const ids = await client.search({ text: query }, { uid: true });
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
    const status = client.mailbox || {};
    const validity = safeImapInteger(status.uidValidity);
    if (validity === null || validity < 1 || validity > 4294967295) {
      const error = new Error('UIDVALIDITY nicht verfügbar; sichere Benachrichtigungserkennung pausiert.');
      error.code = 'missing_uidvalidity';
      throw error;
    }
    const total = Number(status.exists || 0);
    const keyPrefix = `${accountKey}:INBOX:${validity}`;
    const messages =
      total > 0
        ? await fetchInfos(client, `${Math.max(1, total - capped + 1)}:${total}`, { previewCache, keyPrefix })
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
