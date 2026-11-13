// Encrypted local search index for offline full-text search across all folders.
// Per account one file, AES-256-GCM encrypted (key in the OS keychain), gzip inside.
// Stores per message: date, sender, recipients, subject and the first ~3000 characters
// of text. Attachments and HTML are never stored.
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
 * @param {{dir:string, getKey:(id:string)=>Promise<Buffer|null>, maxPerAccount?:number}} options
 */
export function createLocalIndex({ dir, getKey, maxPerAccount = 25_000 }) {
  const loaded = new Map(); // accountId -> { data, haystacks: Map }
  const file = id => path.join(dir, `${id.replace(/[^a-z0-9-]/gi, '')}.lvx`);

  async function open(id) {
    if (loaded.has(id)) return loaded.get(id);
    const key = await getKey(id);
    if (!key) return null;
    let data = { version: VERSION, folders: {}, updatedAt: null };
    let stored = false;
    try {
      data = await decryptAsync(key, await readFile(file(id)));
      stored = data.version === VERSION;
      if (!stored) data = { version: VERSION, folders: {}, updatedAt: null };
    } catch {
      /* missing or unreadable: start fresh */
    }
    const entry = { data, key, haystacks: new Map(), stored };
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

  /** Brings one folder up to date; at most `budget` new messages per call. */
  async function syncFolder(client, id, folderPath, budget) {
    const entry = await open(id);
    if (!entry) return { added: 0, removed: 0 };
    const lock = await client.getMailboxLock(folderPath, { readOnly: true });
    try {
      const uidValidity = String(client.mailbox?.uidValidity || '');
      let folder = entry.data.folders[folderPath];
      const reset = !folder || folder.uidValidity !== uidValidity;
      if (reset) folder = entry.data.folders[folderPath] = { uidValidity, items: {} };
      const all = Number(client.mailbox?.exists || 0) ? await client.search({ all: true }, { uid: true }) : [];
      const present = new Set((Array.isArray(all) ? all : []).map(String));
      let removed = 0;
      for (const uid of Object.keys(folder.items))
        if (!present.has(uid)) {
          delete folder.items[uid];
          entry.haystacks.delete(`${folderPath}\u0000${uid}`);
          removed++;
        }
      const room = Math.max(0, maxPerAccount - count(entry.data));
      const missing = [...present]
        .filter(uid => !folder.items[uid])
        .map(Number)
        .sort((a, b) => b - a)
        .slice(0, Math.min(budget, room));
      let added = 0;
      for (let i = 0; i < missing.length; i += BATCH) {
        const batch = missing.slice(i, i + BATCH);
        const raw = [];
        for await (const m of client.fetch(
          batch,
          { uid: true, envelope: true, internalDate: true, flags: true, bodyStructure: true },
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
            x: ''
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
              const raw = m.bodyParts?.get(key) || m.bodyParts?.get(key.toLowerCase());
              if (folder.items[m.uid]) folder.items[m.uid].x = decodePreview(raw, parts.get(m.uid), TEXT_CHARS);
            }
          } catch {
            /* text is optional */
          }
        }
      }
      return { added, removed, reset };
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
      for (const p of Object.keys(entry.data.folders))
        if (!valid.some(f => f.path === p)) {
          delete entry.data.folders[p];
          changed = true;
        }
      let left = budget;
      let added = 0;
      let removed = 0;
      for (const f of valid) {
        const result = await syncFolder(client, id, f.path, left);
        added += result.added;
        removed += result.removed;
        if (result.reset) changed = true;
        left -= result.added;
        if (left <= 0) break;
      }
      // Rewriting the whole encrypted index every 15 minutes without a change only costs time.
      if (changed || added || removed) {
        entry.data.updatedAt = new Date().toISOString();
        await save(id);
      }
      return { enabled: true, added, removed, complete: left > 0, total: count(entry.data) };
    },

    /** All terms must occur (diacritics/case-insensitive) in subject, sender, recipients or text. */
    async search(ids, query, { folder = null, limit = 100 } = {}) {
      const terms = normalize(query)
        .split(/\s+/)
        .filter(t => t.length >= 2)
        .slice(0, 8);
      if (!terms.length) return [];
      const hits = [];
      for (const id of ids) {
        const entry = await open(id);
        if (!entry) continue;
        for (const [folderPath, f] of Object.entries(entry.data.folders)) {
          if (folder && folder !== folderPath) continue;
          for (const [uid, m] of Object.entries(f.items)) {
            const key = `${folderPath}\u0000${uid}`;
            let hay = entry.haystacks.get(key);
            if (!hay) {
              hay = normalize(`${m.s} ${m.f} ${m.t} ${m.x}`);
              entry.haystacks.set(key, hay);
            }
            if (terms.every(t => hay.includes(t))) {
              hits.push({
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
              });
            }
          }
        }
      }
      return hits.sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, limit);
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
