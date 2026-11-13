// Snooze ("Zurückstellen") and follow-up ("Nachfassen": remind when no reply arrives).
// Snoozed messages are moved to a server folder "Zurückgestellt" and come back to the
// inbox – unread – at the chosen time. Both lists live in followups.json in the app data
// folder (no message content, only IDs, subject, addresses and times).
import { randomUUID } from 'node:crypto';
import { newFolderPath } from './folders.mjs';
import { findSpecialFolder, selectableFolders } from './mail-actions.mjs';

export const SNOOZE_FOLDER_NAMES = ['Zurückgestellt', 'Snoozed'];
const MAX_ENTRIES = 2000;
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

/** Moves messages into the snooze folder; returns what is needed to bring them back. */
export async function snoozeMessages(client, { folder, uids }) {
  const target = await ensureSnoozeFolder(client);
  if (target === folder) throw fail('Die Nachricht ist bereits zurückgestellt.', 'already_snoozed', 409);
  if (!client.capabilities?.has?.('MOVE'))
    throw fail('Der IMAP-Server unterstützt kein sicheres MOVE.', 'move_unsupported', 409);
  const lock = await client.getMailboxLock(folder);
  try {
    const items = [];
    for await (const m of client.fetch(uids.join(','), { uid: true, envelope: true }, { uid: true })) {
      items.push({
        uid: String(m.uid),
        messageId: m.envelope?.messageId || null,
        subject: m.envelope?.subject || '',
        from: m.envelope?.from?.[0]?.address || ''
      });
    }
    if (!items.length) throw fail('Nachricht nicht mehr vorhanden. Bitte aktualisieren.', 'message_missing', 404);
    const moved = await client.messageMove(items.map(i => i.uid).join(','), target, { uid: true });
    if (!moved) throw fail('Verschieben wurde vom Server abgelehnt.', 'move_rejected', 409);
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

/** Brings one snoozed message back (unread) into its original folder or the inbox. */
export async function wakeMessage(client, entry) {
  const folders = selectableFolders(await client.list());
  const snooze = folders.find(f => f.path === entry.folder) || findSnoozeFolder(folders);
  if (!snooze) return { woke: false, reason: 'folder_missing' };
  const back =
    folders.find(f => f.path === entry.originalFolder) || folders.find(f => f.path.toUpperCase() === 'INBOX');
  const lock = await client.getMailboxLock(snooze.path);
  try {
    let uid = null;
    if (entry.messageId) {
      const found = await client.search({ header: { 'message-id': entry.messageId } }, { uid: true });
      uid = Array.isArray(found) && found.length ? String(found.at(-1)) : null;
    }
    if (!uid && entry.snoozeUid && String(client.mailbox?.uidValidity ?? '') === entry.uidValidity)
      uid = entry.snoozeUid;
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
  const save = next =>
    file.save({ snoozed: next.snoozed.slice(-MAX_ENTRIES), followups: next.followups.slice(-MAX_ENTRIES) });
  return {
    snoozed: accountId => data().snoozed.filter(s => !accountId || s.accountId === accountId),
    followups: accountId => data().followups.filter(f => !accountId || f.accountId === accountId),
    async addSnoozed(accountId, originalFolder, result, until) {
      const d = data();
      const added = result.items.map(i => ({
        id: randomUUID(),
        accountId,
        originalFolder,
        folder: result.folder,
        uidValidity: result.uidValidity,
        until,
        ...i
      }));
      await save({ ...d, snoozed: [...d.snoozed, ...added] });
      return added;
    },
    async removeSnoozed(id) {
      const d = data();
      await save({ ...d, snoozed: d.snoozed.filter(s => s.id !== id) });
    },
    async addFollowup(entry) {
      const d = data();
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
