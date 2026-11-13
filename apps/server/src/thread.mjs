// Conversations across folders: messages are linked by Message-ID, In-Reply-To and
// References (RFC 5322 §3.6.4) – not by subject – including the own replies in "Sent".
import { fetchInfos } from './mailbox.mjs';
import { findSpecialFolder, selectableFolders } from './mail-actions.mjs';

const MAX_IDS = 30;
const MAX_MESSAGES = 60;
const ID = /<[^<>\s]{1,250}>/g;

export function parseIds(value) {
  return [...new Set(String(value || '').match(ID) || [])];
}

function headerValue(buffer, name) {
  const text = buffer ? buffer.toString('utf8') : '';
  const re = new RegExp(`^${name}:([\\s\\S]*?)(?=\\r?\\n[^\\s]|$)`, 'im');
  return (re.exec(text)?.[1] || '').replace(/\r?\n\s+/g, ' ').trim();
}

/** Folders that typically hold one conversation: the current one, Inbox, Sent, Archive. */
export function threadFolders(folders, current) {
  const list = selectableFolders(folders);
  const picks = [
    list.find(f => f.path === current),
    list.find(f => f.path.toUpperCase() === 'INBOX'),
    findSpecialFolder(list, '\\Sent'),
    findSpecialFolder(list, '\\Archive')
  ].filter(Boolean);
  return [...new Map(picks.map(f => [f.path, f])).values()];
}

async function searchIds(client, ids) {
  // One OR query per field keeps the request small; ids are bounded by MAX_IDS.
  const or = ids.flatMap(id => [
    { header: { 'message-id': id } },
    { header: { references: id } },
    { header: { 'in-reply-to': id } }
  ]);
  const found = await client.search(or.length === 1 ? or[0] : { or }, { uid: true });
  return Array.isArray(found) ? found : [];
}

export async function loadThread(client, folder, uid, { previewCache, accountKey = '' } = {}) {
  const folders = await client.list();
  let seed;
  let lock = await client.getMailboxLock(folder, { readOnly: true });
  try {
    seed = await client.fetchOne(
      String(uid),
      { uid: true, envelope: true, headers: ['references', 'in-reply-to', 'message-id'] },
      { uid: true }
    );
  } finally {
    lock.release();
  }
  if (!seed) return { messages: [] };
  const ids = new Set([
    ...parseIds(seed.envelope?.messageId),
    ...parseIds(headerValue(seed.headers, 'in-reply-to')),
    ...parseIds(headerValue(seed.headers, 'references'))
  ]);
  if (!ids.size) return { messages: [] };

  const results = new Map(); // `${folder}|${uid}` → info
  const targets = threadFolders(folders, folder);
  // Two rounds: the second picks up replies to replies that do not reference the seed.
  for (let round = 0; round < 2; round++) {
    const query = [...ids].slice(-MAX_IDS);
    let grew = false;
    for (const target of targets) {
      lock = await client.getMailboxLock(target.path, { readOnly: true });
      try {
        const uids = (await searchIds(client, query)).slice(-MAX_MESSAGES);
        const fresh = uids.filter(u => !results.has(`${target.path}|${u}`));
        if (!fresh.length) continue;
        const infos = await fetchInfos(client, fresh.join(','), {
          uidRange: true,
          previewCache,
          keyPrefix: `${accountKey}|${target.path}`
        });
        for (const info of infos) {
          results.set(`${target.path}|${info.uid}`, {
            ...info,
            folder: target.path,
            sent: target.specialUse === '\\Sent'
          });
          for (const id of parseIds(info.messageId))
            if (!ids.has(id)) {
              ids.add(id);
              grew = true;
            }
        }
      } finally {
        lock.release();
      }
    }
    if (!grew) break;
  }
  // The same message can live in two folders (e.g. sent to oneself): keep one per Message-ID.
  const byId = new Map();
  for (const m of results.values()) {
    const key = m.messageId || `${m.folder}|${m.uid}`;
    const prev = byId.get(key);
    if (!prev || (prev.folder !== folder && m.folder === folder)) byId.set(key, m);
  }
  const messages = [...byId.values()].sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(-MAX_MESSAGES);
  return { messages };
}
