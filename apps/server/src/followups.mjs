// Snooze ("Zurückstellen") and follow-up ("Nachfassen": remind when no reply arrives).
// Snoozed messages are moved to a server folder "Zurückgestellt" and come back to the
// inbox – unread – at the chosen time. Both lists live in followups.json in the app data
// folder (no message content, only IDs, subject, addresses and times).
import { randomUUID } from 'node:crypto';
import { newFolderPath } from './folders.mjs';
import { findSpecialFolder, selectableFolders } from './mail-actions.mjs';
import { isRequestedFetchResult, uidSet } from './imap-fetch.mjs';

export const SNOOZE_FOLDER_NAMES = ['Zurückgestellt', 'Snoozed'];
export const MAX_ENTRIES = 2000;
const MAX_AHEAD_MS = 366 * 86_400_000;
const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });

export function validateWhen(value, now = Date.now()) {
  const at = Date.parse(String(value || ''));
  if (!Number.isFinite(at)) throw fail('Ungültiger Zeitpunkt.', 'when_invalid');
  if (at < now + 60_000) throw fail('Der Zeitpunkt muss in der Zukunft liegen.', 'when_past');
  if (at > now + MAX_AHEAD_MS) throw fail('Höchstens ein Jahr im Voraus.', 'when_too_far');
  return new Date(at).toISOString();
}

export function messageIdOf(raw) {
  const text = Buffer.isBuffer(raw) ? raw.subarray(0, 32_000).toString('latin1') : String(raw || '').slice(0, 32_000);
  const head = text.split(/\r?\n\r?\n/, 1)[0];
  return /^message-id:\s*(<[^<>\s]+>)/im.exec(head)?.[1] || null;
}

export function findSnoozeFolder(folders) {
  return (
    selectableFolders(folders).find(f => SNOOZE_FOLDER_NAMES.includes(f.path.split(f.delimiter || '/').at(-1))) || null
  );
}

async function ensureSnoozeFolder(client) {
  const folders = await client.list();
  const existing = findSnoozeFolder(folders);
  if (existing) return existing.path;
  const path = newFolderPath(selectableFolders(folders), SNOOZE_FOLDER_NAMES[0]);
  await client.mailboxCreate(path);
  return path;
}

/**
 * Moves messages into the snooze folder; returns what is needed to bring them back.
 * `beforeMove(plan)` runs after the messages were read and before the MOVE: the caller stores
 * its tracking entries there, so a crash after the MOVE never leaves an untracked message.
 */
export async function snoozeMessages(client, { folder, uids, beforeMove = async () => {} }) {
  const target = await ensureSnoozeFolder(client);
  if (target === folder) throw fail('Die Nachricht ist bereits zurückgestellt.', 'already_snoozed', 409);
  if (!client.capabilities?.has?.('MOVE'))
    throw fail('Der IMAP-Server unterstützt kein sicheres MOVE.', 'move_unsupported', 409);
  const lock = await client.getMailboxLock(folder);
  try {
    const items = [];
    const query = { uid: true, envelope: true, internalDate: true, size: true };
    const wanted = uidSet(uids);
    const seen = new Set();
    for await (const m of client.fetch(uids.join(','), query, { uid: true })) {
      // Skip unsolicited FETCH responses (flag updates, foreign UIDs) and duplicates.
      // Date and size are optional (only used to find the message again).
      if (!isRequestedFetchResult(m, { envelope: true }, wanted) || seen.has(m.uid)) continue;
      seen.add(m.uid);
      items.push({
        uid: String(m.uid),
        messageId: m.envelope?.messageId || null,
        subject: m.envelope?.subject || '',
        from: m.envelope?.from?.[0]?.address || '',
        // Finds the message again when the server reports neither a new UID nor a Message-ID.
        print: printOf(m)
      });
    }
    if (!items.length) throw fail('Nachricht nicht mehr vorhanden. Bitte aktualisieren.', 'message_missing', 404);
    await beforeMove({ folder: target, uidValidity: '', items });
    let moved;
    try {
      moved = await client.messageMove(items.map(i => i.uid).join(','), target, { uid: true });
    } catch (err) {
      // A NO/BAD answer proves nothing moved; anything else leaves the outcome open.
      throw Object.assign(err, { moveRefused: ['NO', 'BAD'].includes(String(err?.responseStatus || '')) });
    }
    if (!moved)
      throw Object.assign(fail('Verschieben wurde vom Server abgelehnt.', 'move_rejected', 409), { moveRefused: true });
    const map = moved.uidMap instanceof Map ? moved.uidMap : new Map();
    return {
      folder: target,
      uidValidity: String(moved.uidValidity ?? ''),
      items: items.map(i => ({ ...i, snoozeUid: map.get(Number(i.uid)) ? String(map.get(Number(i.uid))) : null }))
    };
  } finally {
    lock.release();
  }
}

/** Date, size, sender and subject: together they identify a message without a Message-ID. */
function printOf(m) {
  const date = m.internalDate instanceof Date ? m.internalDate.toISOString() : String(m.internalDate || '');
  if (!date || !Number.isSafeInteger(m.size)) return null; // too weak to identify a message
  return [date, String(m.size), m.envelope?.from?.[0]?.address || '', m.envelope?.subject || ''].join('|');
}

const MAX_PRINT_SCAN = 5000;
/** UID of the tracked message in the currently selected folder, or null. */
async function locateInOpenFolder(client, entry, { trustUid = false } = {}) {
  if (entry.messageId) {
    const found = await client.search({ header: { 'message-id': entry.messageId } }, { uid: true });
    if (Array.isArray(found) && found.length) return String(found.at(-1));
  }
  if (trustUid && entry.snoozeUid && String(client.mailbox?.uidValidity ?? '') === entry.uidValidity)
    return entry.snoozeUid;
  // No Message-ID and no COPYUID answer: compare date, size, sender and subject. The
  // snooze folder is small, so a scan of its envelopes is cheap.
  if (!entry.print || !Number(client.mailbox?.exists || 0) || client.mailbox.exists > MAX_PRINT_SCAN) return null;
  const query = { uid: true, envelope: true, internalDate: true, size: true };
  const hits = [];
  for await (const m of client.fetch('1:*', query, { uid: true }))
    if (isRequestedFetchResult(m, { envelope: true }) && printOf(m) === entry.print) hits.push(m.uid);
  // Two identical candidates cannot be told apart: better to report it than to guess.
  return hits.length === 1 ? String(hits[0]) : null;
}

/** Where a tracked message is now: 'snoozed', 'original' (never moved) or null. */
export async function locateSnoozed(client, entry) {
  const folders = selectableFolders(await client.list());
  for (const [where, path] of [
    ['snoozed', entry.folder],
    ['original', entry.originalFolder]
  ]) {
    if (!folders.some(f => f.path === path)) continue;
    const lock = await client.getMailboxLock(path, { readOnly: true });
    try {
      const uid = await locateInOpenFolder(client, entry, { trustUid: where === 'snoozed' });
      if (uid) return { where, uid, uidValidity: String(client.mailbox?.uidValidity ?? '') };
    } finally {
      lock.release();
    }
  }
  return null;
}

/** Brings one snoozed message back (unread) into its original folder or the inbox. */
export async function wakeMessage(client, entry) {
  const folders = selectableFolders(await client.list());
  const snooze = folders.find(f => f.path === entry.folder) || findSnoozeFolder(folders);
  if (!snooze) return { woke: false, reason: 'folder_missing' };
  const back =
    folders.find(f => f.path === entry.originalFolder) || folders.find(f => f.path.toUpperCase() === 'INBOX');
  const lock = await client.getMailboxLock(snooze.path);
  try {
    const uid = await locateInOpenFolder(client, entry, { trustUid: true });
    if (!uid) return { woke: false, reason: 'message_missing' };
    await client.messageFlagsRemove(uid, ['\\Seen'], { uid: true }).catch(() => {});
    const moved = await client.messageMove(uid, back.path, { uid: true });
    return { woke: Boolean(moved), folder: back.path };
  } finally {
    lock.release();
  }
}

/** True when a message in Inbox/Archive answers `messageId` (In-Reply-To or References). */
export async function hasReply(client, messageId) {
  const folders = selectableFolders(await client.list());
  const targets = [folders.find(f => f.path.toUpperCase() === 'INBOX'), findSpecialFolder(folders, '\\Archive')].filter(
    Boolean
  );
  for (const f of targets) {
    const lock = await client.getMailboxLock(f.path, { readOnly: true });
    try {
      const found = await client.search(
        { or: [{ header: { 'in-reply-to': messageId } }, { header: { references: messageId } }] },
        { uid: true }
      );
      if (Array.isArray(found) && found.length) return true;
    } finally {
      lock.release();
    }
  }
  return false;
}

/** The followups.json store (snoozed messages and follow-up reminders). */
export function createFollowupStore(file) {
  const data = () => ({ snoozed: [], followups: [], ...file.get() });
  // Never trims: a dropped snooze entry would leave its message in "Zurückgestellt" for good
  // (F-FUN-001). New entries are refused at the limit instead (see `assertRoom`).
  const save = next => file.save({ snoozed: next.snoozed, followups: next.followups });
  const assertRoom = (list, adding) => {
    if (list.length + adding > MAX_ENTRIES)
      throw fail(
        'Höchstens 2000 Einträge möglich. Bitte zuerst zurückgestellte Nachrichten oder Erinnerungen erledigen.',
        'followups_limit',
        409
      );
  };
  return {
    snoozed: accountId => data().snoozed.filter(s => !accountId || s.accountId === accountId),
    followups: accountId => data().followups.filter(f => !accountId || f.accountId === accountId),
    async addSnoozed(accountId, originalFolder, result, until, extra = {}) {
      const d = data();
      assertRoom(d.snoozed, result.items.length);
      const added = result.items.map(i => ({
        id: randomUUID(),
        accountId,
        originalFolder,
        folder: result.folder,
        uidValidity: result.uidValidity,
        until,
        ...i,
        ...extra
      }));
      await save({ ...d, snoozed: [...d.snoozed, ...added] });
      return added;
    },
    /** Records the result of the MOVE for entries stored as `pending` before it. */
    async finishSnoozed(entries, result) {
      const d = data();
      const byUid = new Map(result.items.map(i => [i.uid, i]));
      const done = new Map(
        entries.map(e => [
          e.id,
          { uidValidity: result.uidValidity, snoozeUid: byUid.get(e.uid)?.snoozeUid || null, state: 'snoozed' }
        ])
      );
      await save({ ...d, snoozed: d.snoozed.map(s => (done.has(s.id) ? { ...s, ...done.get(s.id) } : s)) });
    },
    async updateSnoozed(id, patch) {
      const d = data();
      await save({ ...d, snoozed: d.snoozed.map(s => (s.id === id ? { ...s, ...patch } : s)) });
    },
    async removeSnoozedMany(ids) {
      const drop = new Set(ids);
      const d = data();
      await save({ ...d, snoozed: d.snoozed.filter(s => !drop.has(s.id)) });
    },
    async removeSnoozed(id) {
      const d = data();
      await save({ ...d, snoozed: d.snoozed.filter(s => s.id !== id) });
    },
    async addFollowup(entry) {
      const d = data();
      assertRoom(d.followups, 1);
      const item = { id: randomUUID(), state: 'waiting', createdAt: new Date().toISOString(), ...entry };
      await save({ ...d, followups: [...d.followups, item] });
      return item;
    },
    async updateFollowup(id, patch) {
      const d = data();
      await save({ ...d, followups: d.followups.map(f => (f.id === id ? { ...f, ...patch } : f)) });
    },
    async removeFollowup(id) {
      const d = data();
      await save({ ...d, followups: d.followups.filter(f => f.id !== id) });
    },
    async forgetAccount(accountId) {
      const d = data();
      await save({
        snoozed: d.snoozed.filter(s => s.accountId !== accountId),
        followups: d.followups.filter(f => f.accountId !== accountId)
      });
    }
  };
}
