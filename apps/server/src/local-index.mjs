// Encrypted local search index for offline full-text search across all folders.
// Per account one file, AES-256-GCM encrypted (key in the OS keychain), gzip inside.
// Stores per message: date, sender, recipients, subject and the first ~3000 characters
// of text. Attachments and HTML are never stored.
//
// Large mailboxes (AUD-011): a sync skips the full UID listing of a folder whose message count
// and UIDNEXT did not change, search pages through a date-ordered list instead of sorting every
// hit, and consumers such as the AI assistant read changes incrementally through `entries()` and
// `removedKeys()` instead of copying the whole index.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink, stat } from 'node:fs/promises';
import path from 'node:path';
import { gzip, gzipSync, gunzip, gunzipSync } from 'node:zlib';
import { promisify } from 'node:util';
import { findPreviewPart, decodePreview, hasAttachments } from './previews.mjs';
import { completeFetchResults } from './mailbox.mjs';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

const VERSION = 1;
const MAGIC = Buffer.from('LVX1');
const TEXT_CHARS = 3000;
const BATCH = 50;
// Removed keys are kept so incremental consumers can delete what they derived from them.
const MAX_TOMBSTONES = 20_000;
export const SEARCH_MAX_LIMIT = 200;

/** Stable key of one indexed message; changes when the folder's UIDVALIDITY changes. */
export function entryKey(folderPath, uidValidity, uid) {
  return `${folderPath}\u0000${uidValidity}\u0000${uid}`;
}

function freshData(identity) {
  const now = Date.now();
  return {
    version: VERSION,
    identity,
    generation: randomBytes(8).toString('hex'),
    folders: {},
    removed: [],
    removedFrom: now,
    updatedAt: null
  };
}

export function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export function encrypt(key, json) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(gzipSync(Buffer.from(JSON.stringify(json)))), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
}
export function decrypt(key, buffer) {
  if (!buffer.subarray(0, 4).equals(MAGIC)) throw new Error('Unbekanntes Indexformat.');
  const decipher = createDecipheriv('aes-256-gcm', key, buffer.subarray(4, 16));
  decipher.setAuthTag(buffer.subarray(16, 32));
  return JSON.parse(
    gunzipSync(Buffer.concat([decipher.update(buffer.subarray(32)), decipher.final()])).toString('utf8')
  );
}

// Same format as encrypt/decrypt, but compression runs in the libuv thread pool: a full index
// can be tens of megabytes and the server shares its event loop with the desktop app.
export async function encryptAsync(key, json) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(await gzipAsync(Buffer.from(JSON.stringify(json)))), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
}
export async function decryptAsync(key, buffer) {
  if (!buffer.subarray(0, 4).equals(MAGIC)) throw new Error('Unbekanntes Indexformat.');
  const decipher = createDecipheriv('aes-256-gcm', key, buffer.subarray(4, 16));
  decipher.setAuthTag(buffer.subarray(16, 32));
  const zipped = Buffer.concat([decipher.update(buffer.subarray(32)), decipher.final()]);
  return JSON.parse((await gunzipAsync(zipped)).toString('utf8'));
}

const SKIP = new Set(['\\Trash', '\\Junk', '\\Drafts']);
export function indexableFolders(folders) {
  return folders.filter(f => !f.flags?.has('\\Noselect') && !SKIP.has(f.specialUse) && typeof f.path === 'string');
}

/**
 * @param {{dir:string, getKey:(id:string)=>Promise<Buffer|null>, getIdentity?:(id:string)=>string|null,
 *   maxPerAccount?:number}} options
 * `getIdentity` names the mailbox an account ID currently points to. An index built for
 * another mailbox (server or login changed) is discarded instead of being searched.
 */
export function createLocalIndex({ dir, getKey, getIdentity = () => null, maxPerAccount = 25_000 }) {
  const loaded = new Map(); // accountId -> { data, haystacks: Map }
  const file = id => path.join(dir, `${id.replace(/[^a-z0-9-]/gi, '')}.lvx`);

  async function open(id) {
    if (loaded.has(id)) return loaded.get(id);
    const key = await getKey(id);
    if (!key) return null;
    const identity = getIdentity(id) || null;
    let data = freshData(identity);
    let stored = false;
    try {
      const read = await decryptAsync(key, await readFile(file(id)));
      // Files from before the identity check carry none and are adopted once.
      stored = read.version === VERSION && (!identity || !read.identity || read.identity === identity);
      if (stored) {
        data = read;
        if (identity) data.identity = identity;
        // Files from before incremental change tracking: history starts now.
        if (!data.generation) data.generation = randomBytes(8).toString('hex');
        if (!Array.isArray(data.removed)) data.removed = [];
        if (!Number.isFinite(data.removedFrom)) data.removedFrom = Date.now();
      }
    } catch {
      /* missing or unreadable: start fresh */
    }
    const entry = { data, key, haystacks: new Map(), order: null, stored };
    loaded.set(id, entry);
    return entry;
  }
  async function save(id) {
    const entry = loaded.get(id);
    if (!entry) return;
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const tmp = `${file(id)}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(tmp, await encryptAsync(entry.key, entry.data), { mode: 0o600 });
    await rename(tmp, file(id));
    entry.stored = true;
  }
  const count = data => Object.values(data.folders).reduce((n, f) => n + Object.keys(f.items).length, 0);

  function tombstone(entry, folderPath, uidValidity, uid, at) {
    entry.haystacks.delete(`${folderPath}\u0000${uid}`);
    entry.order = null;
    const removed = entry.data.removed;
    removed.push([entryKey(folderPath, uidValidity, uid), at]);
    if (removed.length > MAX_TOMBSTONES) {
      const cut = removed.splice(0, removed.length - MAX_TOMBSTONES);
      // Anyone asking for changes from before the oldest kept tombstone must rebuild.
      entry.data.removedFrom = Math.max(entry.data.removedFrom, cut.at(-1)[1]);
    }
  }

  /** Every indexed message of an account, newest first; rebuilt only after a change. */
  function ordered(entry) {
    if (entry.order) return entry.order;
    const list = [];
    for (const [folderPath, f] of Object.entries(entry.data.folders))
      for (const [uid, m] of Object.entries(f.items)) list.push({ folderPath, uid, m });
    list.sort((a, b) => String(b.m.d).localeCompare(String(a.m.d)) || Number(b.uid) - Number(a.uid));
    entry.order = list;
    return list;
  }

  function haystack(entry, folderPath, uid, m) {
    const key = `${folderPath}\u0000${uid}`;
    let hay = entry.haystacks.get(key);
    if (!hay) {
      hay = normalize(`${m.s} ${m.f} ${m.t} ${m.x}`);
      entry.haystacks.set(key, hay);
    }
    return hay;
  }

  function hitFor(id, folderPath, uid, m) {
    return {
      accountId: id,
      folder: folderPath,
      uid: Number(uid),
      subject: m.s || '(Ohne Betreff)',
      fromName: m.fn || 'Unbekannt',
      fromEmail: m.fe,
      date: m.d,
      unread: m.r,
      hasAttachments: m.a,
      preview: m.x.slice(0, 180)
    };
  }

  function searchTerms(query) {
    return normalize(query)
      .split(/\s+/)
      .filter(t => t.length >= 2)
      .slice(0, 8);
  }

  /**
   * Matches newest first, paged. Only the requested page is turned into result objects;
   * `total` counts every match.
   */
  async function searchPage(ids, query, { folder = null, limit = 100, cursor = null } = {}) {
    const size = Math.max(1, Math.min(SEARCH_MAX_LIMIT, Number.isInteger(limit) ? limit : 100));
    const offset = /^\d{1,9}$/.test(String(cursor ?? '')) ? Number(cursor) : 0;
    const terms = searchTerms(query);
    if (!terms.length) return { messages: [], total: 0, nextCursor: null };
    const matches = [];
    for (const id of ids) {
      const entry = await open(id);
      if (!entry) continue;
      for (const row of ordered(entry)) {
        if (folder && folder !== row.folderPath) continue;
        const hay = haystack(entry, row.folderPath, row.uid, row.m);
        if (terms.every(t => hay.includes(t))) matches.push({ id, ...row });
      }
    }
    // One account is already in date order; several are merged.
    if (ids.length > 1)
      matches.sort((a, b) => String(b.m.d).localeCompare(String(a.m.d)) || Number(b.uid) - Number(a.uid));
    const page = matches.slice(offset, offset + size).map(r => hitFor(r.id, r.folderPath, r.uid, r.m));
    const next = offset + page.length;
    return { messages: page, total: matches.length, nextCursor: next < matches.length ? String(next) : null };
  }

  /**
   * Read/unread can change on any device without a new UID. With CONDSTORE only messages
   * changed since the last run are fetched, otherwise the flags of the whole folder.
   */
  async function refreshFlags(client, folder) {
    if (!Object.keys(folder.items).length) return 0;
    const highest = client.mailbox?.highestModseq;
    const condstore = Boolean(highest) && Boolean(folder.modseq) && client.enabled?.has?.('CONDSTORE');
    let changed = 0;
    try {
      if (!condstore || BigInt(highest) > BigInt(folder.modseq)) {
        const options = condstore ? { uid: true, changedSince: BigInt(folder.modseq) } : { uid: true };
        for await (const m of client.fetch('1:*', { uid: true, flags: true }, options)) {
          const item = Number.isSafeInteger(m?.uid) && m.flags instanceof Set ? folder.items[m.uid] : null;
          if (!item) continue;
          const unread = !m.flags.has('\\Seen');
          if (item.r !== unread) {
            item.r = unread;
            changed++;
          }
        }
      }
      if (highest) folder.modseq = String(highest);
    } catch {
      /* flags are refreshed on the next run */
    }
    return changed;
  }

  /** Brings one folder up to date; at most `budget` new messages per call. */
  async function syncFolder(client, id, folderPath, budget) {
    const entry = await open(id);
    if (!entry) return { added: 0, removed: 0 };
    const lock = await client.getMailboxLock(folderPath, { readOnly: true });
    try {
      const uidValidity = String(client.mailbox?.uidValidity || '');
      const exists = Number(client.mailbox?.exists || 0);
      const uidNext = String(client.mailbox?.uidNext || '');
      const now = Date.now();
      let folder = entry.data.folders[folderPath];
      const reset = !folder || folder.uidValidity !== uidValidity;
      if (reset) {
        if (folder)
          for (const uid of Object.keys(folder.items)) tombstone(entry, folderPath, folder.uidValidity, uid, now);
        folder = entry.data.folders[folderPath] = { uidValidity, items: {} };
      }
      const room = Math.max(0, maxPerAccount - count(entry.data));
      // Same message count and UIDNEXT as after the last complete pass: nothing was added (UIDNEXT
      // would have grown) and nothing removed (the count would differ). The full UID listing,
      // ~600 KB on a 100k folder, is skipped; flags are still refreshed.
      const last = folder.seen;
      const unchanged =
        !reset &&
        uidNext &&
        last &&
        last.exists === exists &&
        last.uidNext === uidNext &&
        (!last.pending || room === 0);
      if (unchanged) {
        const flagsChanged = await refreshFlags(client, folder);
        return { added: 0, removed: 0, reset: false, flagsChanged, skipped: true };
      }
      const all = exists ? await client.search({ all: true }, { uid: true }) : [];
      const present = new Set((Array.isArray(all) ? all : []).map(String));
      let removed = 0;
      for (const uid of Object.keys(folder.items))
        if (!present.has(uid)) {
          delete folder.items[uid];
          tombstone(entry, folderPath, uidValidity, uid, now);
          removed++;
        }
      const flagsChanged = reset ? 0 : await refreshFlags(client, folder);
      if (reset && client.mailbox?.highestModseq) folder.modseq = String(client.mailbox.highestModseq);
      const notIndexed = [...present].filter(uid => !folder.items[uid]);
      const missing = notIndexed
        .map(Number)
        .sort((a, b) => b - a)
        .slice(0, Math.min(budget, room));
      const seenChanged = !last || last.exists !== exists || last.uidNext !== uidNext;
      folder.seen = { exists, uidNext, pending: notIndexed.length > missing.length };
      if (missing.length) entry.order = null;
      let added = 0;
      for (let i = 0; i < missing.length; i += BATCH) {
        const batch = missing.slice(i, i + BATCH);
        const raw = [];
        for await (const m of client.fetch(
          batch,
          { uid: true, envelope: true, internalDate: true, flags: true, bodyStructure: true, size: true },
          { uid: true }
        ))
          raw.push(m);
        const metas = completeFetchResults(raw, batch);
        const byPart = new Map();
        for (const m of metas) {
          const env = m.envelope || {};
          const from = env.from?.[0] || {};
          folder.items[m.uid] = {
            d: (m.internalDate || env.date)?.toISOString?.() || null,
            f: [from.name, from.address].filter(Boolean).join(' '),
            fe: from.address || '',
            fn: from.name || from.address || '',
            t: [...(env.to || []), ...(env.cc || [])]
              .map(a => a.address)
              .filter(Boolean)
              .join(' ')
              .slice(0, 500),
            s: env.subject || '',
            a: hasAttachments(m.bodyStructure),
            r: !m.flags?.has('\\Seen'),
            x: '',
            u: now
          };
          added++;
          const part = findPreviewPart(m.bodyStructure);
          if (part) {
            if (!byPart.has(part.part)) byPart.set(part.part, []);
            byPart.get(part.part).push({ uid: m.uid, part });
          }
        }
        for (const [key, list] of byPart) {
          const parts = new Map(list.map(x => [x.uid, x.part]));
          try {
            for await (const m of client.fetch(
              list.map(x => x.uid),
              { uid: true, bodyParts: [{ key, maxLength: TEXT_CHARS * 3 }] },
              { uid: true }
            )) {
              // Unsolicited FETCH responses (flag updates) carry no body part and are skipped.
              if (!parts.has(m?.uid) || !folder.items[m.uid]) continue;
              const raw = m.bodyParts?.get(key) || m.bodyParts?.get(key.toLowerCase());
              if (raw === undefined) continue;
              folder.items[m.uid].x = decodePreview(raw, parts.get(m.uid), TEXT_CHARS);
            }
          } catch {
            /* text is optional */
          }
        }
      }
      return { added, removed, reset, flagsChanged, seenChanged };
    } finally {
      lock.release();
    }
  }

  return {
    /** Indexes all folders of an account (incrementally). */
    async sync(client, id, folders, { budget = 2000 } = {}) {
      const entry = await open(id);
      if (!entry) return { enabled: false };
      const valid = indexableFolders(folders);
      let changed = !entry.stored;
      const now = Date.now();
      for (const p of Object.keys(entry.data.folders))
        if (!valid.some(f => f.path === p)) {
          const gone = entry.data.folders[p];
          for (const uid of Object.keys(gone.items)) tombstone(entry, p, gone.uidValidity, uid, now);
          delete entry.data.folders[p];
          changed = true;
        }
      let left = budget;
      let added = 0;
      let removed = 0;
      let skipped = 0;
      for (const f of valid) {
        const result = await syncFolder(client, id, f.path, left);
        added += result.added;
        removed += result.removed;
        if (result.reset || result.flagsChanged || result.seenChanged) changed = true;
        if (result.skipped) skipped++;
        left -= result.added;
        if (left <= 0) break;
      }
      // Rewriting the whole encrypted index every 15 minutes without a change only costs time.
      if (changed || added || removed) {
        entry.data.updatedAt = new Date().toISOString();
        await save(id);
      }
      return { enabled: true, added, removed, skipped, complete: left > 0, total: count(entry.data) };
    },

    /**
     * All terms must occur (diacritics/case-insensitive) in subject, sender, recipients or text.
     * Returns the newest `limit` hits; `searchPage` adds paging and the total count.
     */
    async search(ids, query, { folder = null, limit = 100 } = {}) {
      return (await searchPage(ids, query, { folder, limit })).messages;
    },
    searchPage,

    /**
     * Indexed messages, optionally only those indexed after `since` (ms since epoch), for
     * consumers that derive data from the index (e.g. embeddings). Keys come from `entryKey`.
     * Compare `generation` (from status) between runs: a new generation means rebuild.
     */
    async *entries(id, { since = null } = {}) {
      const entry = await open(id);
      if (!entry) return;
      const after = Number.isFinite(since) ? since : -Infinity;
      for (const [folderPath, f] of Object.entries(entry.data.folders))
        for (const [uid, m] of Object.entries(f.items)) {
          const updatedAt = Number.isFinite(m.u) ? m.u : 0;
          if (updatedAt <= after) continue;
          yield {
            key: entryKey(folderPath, f.uidValidity, uid),
            folder: folderPath,
            uid: Number(uid),
            date: m.d,
            fromName: m.fn,
            fromEmail: m.fe,
            subject: m.s,
            text: m.x,
            updatedAt
          };
        }
    },

    /**
     * Keys removed after `since` (ms since epoch). `null` means the history does not reach back
     * that far (or the index was rebuilt): the consumer must rebuild from `entries()`.
     */
    async removedKeys(id, since) {
      const entry = await open(id);
      if (!entry) return null;
      if (!Number.isFinite(since) || since < entry.data.removedFrom) return null;
      return entry.data.removed.filter(([, at]) => at > since).map(([key]) => key);
    },

    async text(id, folderPath, uid) {
      const entry = await open(id);
      const item = entry?.data.folders[folderPath]?.items[String(uid)];
      return item ? { subject: item.s, fromName: item.fn, fromEmail: item.fe, date: item.d, text: item.x } : null;
    },

    async status(id) {
      const entry = await open(id);
      if (!entry) return { enabled: false };
      let bytes = 0;
      try {
        bytes = (await stat(file(id))).size;
      } catch {
        /* not saved yet */
      }
      return {
        enabled: true,
        messages: count(entry.data),
        folders: Object.keys(entry.data.folders).length,
        updatedAt: entry.data.updatedAt,
        generation: entry.data.generation,
        bytes
      };
    },

    async clear(id) {
      loaded.delete(id);
      await unlink(file(id)).catch(() => {});
    },
    unload(id) {
      loaded.delete(id);
    }
  };
}
