// Encrypted local search index for offline full-text search across all folders.
// Per account one SQLite database, encrypted as a whole with SQLCipher (AES-256, HMAC-SHA512;
// the raw 256-bit key lives in the OS keychain). Stores per message: date, sender, recipients,
// subject and the first ~3000 characters of text. Attachments and HTML are never stored.
//
// Large mailboxes (AUD-011): SQLite writes only what changed, so the index is no longer one file
// rewritten as a whole and holds up to `maxPerAccount` (default 250,000) messages. Full-text
// search uses FTS5: word prefixes in all fields, plus substrings (trigrams) in subject, sender
// and recipients. A sync skips the full UID listing of a folder whose message count and UIDNEXT
// did not change. Features built on the index (the AI assistant) read changes incrementally
// through `entries()` / `removedKeys()` and keep their embeddings in the same encrypted file.
//
// Index files from before 2.3 (`<id>.lvx`, AES-256-GCM encrypted gzip JSON) are migrated on first
// open and then deleted.
import { createDecipheriv, createCipheriv, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, chmodSync, existsSync, statSync, unlinkSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { findPreviewPart, decodePreview, hasAttachments } from './previews.mjs';
import { completeFetchResults } from './mailbox.mjs';

const require = createRequire(import.meta.url);

const SCHEMA = 1;
const MAGIC = Buffer.from('LVX1');
const TEXT_CHARS = 3000;
const BATCH = 50;
// Removed keys are kept so incremental consumers can delete what they derived from them.
const MAX_TOMBSTONES = 20_000;
export const SEARCH_MAX_LIMIT = 200;
export const MAX_VECTOR_DIM = 4096;
const SCAN_CHUNK = 5000;

/** Stable key of one indexed message; changes when the folder's UIDVALIDITY changes. */
export function entryKey(folderPath, uidValidity, uid) {
  return `${folderPath}\u0000${uidValidity}\u0000${uid}`;
}

export function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

// Format of the index files before 2.3; still used to migrate them.
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

const SKIP = new Set(['\\Trash', '\\Junk', '\\Drafts']);
export function indexableFolders(folders) {
  return folders.filter(f => !f.flags?.has('\\Noselect') && !SKIP.has(f.specialUse) && typeof f.path === 'string');
}

let DatabaseClass;
function loadDatabase() {
  if (DatabaseClass === undefined) {
    try {
      DatabaseClass = require('better-sqlite3-multiple-ciphers');
    } catch {
      DatabaseClass = null; // native module missing: the index stays off instead of failing the app
    }
  }
  return DatabaseClass;
}

const DDL = `
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS folders (path TEXT PRIMARY KEY, uid_validity TEXT NOT NULL, modseq TEXT, seen TEXT);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  folder TEXT NOT NULL,
  uid INTEGER NOT NULL,
  d TEXT, f TEXT, fe TEXT, fn TEXT, t TEXT, s TEXT,
  a INTEGER NOT NULL DEFAULT 0,
  r INTEGER NOT NULL DEFAULT 0,
  x TEXT NOT NULL DEFAULT '',
  u INTEGER NOT NULL DEFAULT 0,
  UNIQUE (folder, uid)
);
CREATE INDEX IF NOT EXISTS messages_date ON messages (d DESC, uid DESC);
CREATE INDEX IF NOT EXISTS messages_updated ON messages (u);
CREATE VIRTUAL TABLE IF NOT EXISTS words USING fts5 (
  hay, content = '', contentless_delete = 1, tokenize = 'unicode61 remove_diacritics 2'
);
CREATE VIRTUAL TABLE IF NOT EXISTS heads USING fts5 (hay, content = '', contentless_delete = 1, tokenize = 'trigram');
CREATE TABLE IF NOT EXISTS removed (id INTEGER PRIMARY KEY, key TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS removed_at ON removed (at);
CREATE TABLE IF NOT EXISTS vectors (
  id INTEGER PRIMARY KEY,
  model TEXT NOT NULL,
  key TEXT NOT NULL,
  folder TEXT NOT NULL,
  uid INTEGER NOT NULL,
  dim INTEGER NOT NULL,
  scale REAL NOT NULL,
  embedding BLOB NOT NULL,
  UNIQUE (model, key)
);
CREATE INDEX IF NOT EXISTS vectors_key ON vectors (key);
CREATE INDEX IF NOT EXISTS vectors_scan ON vectors (model, id);
`;

const ftsString = term => `"${term.replace(/"/g, '""')}"`;

/** Unit-length copy of a vector, or null when it is not usable. */
function unitVector(vector) {
  const source = vector instanceof Float32Array ? vector : Array.isArray(vector) ? Float32Array.from(vector) : null;
  if (!source || !source.length || source.length > MAX_VECTOR_DIM) return null;
  let norm = 0;
  for (let i = 0; i < source.length; i++) {
    if (!Number.isFinite(source[i])) return null;
    norm += source[i] * source[i];
  }
  if (!(norm > 0)) return null;
  const scale = 1 / Math.sqrt(norm);
  const out = new Float32Array(source.length);
  for (let i = 0; i < source.length; i++) out[i] = source[i] * scale;
  return out;
}

/**
 * Symmetric int8 quantization of a unit vector: 1 byte per dimension instead of 4, so a 100k
 * × 1024 embedding set is ~100 MB on disk and in memory. Ranking stays practically identical.
 */
function quantize(unit) {
  let max = 0;
  for (let i = 0; i < unit.length; i++) max = Math.max(max, Math.abs(unit[i]));
  const scale = max / 127;
  const out = new Int8Array(unit.length);
  for (let i = 0; i < unit.length; i++) out[i] = Math.round(unit[i] / scale);
  return { scale, bytes: Buffer.from(out.buffer) };
}

const validModel = model => typeof model === 'string' && /^[\w.:/@+-]{1,100}$/.test(model);
const tick = () => new Promise(resolve => setImmediate(resolve));

/**
 * @param {{dir:string, getKey:(id:string)=>Promise<Buffer|null>, getIdentity?:(id:string)=>string|null,
 *   maxPerAccount?:number}} options
 * `getIdentity` names the mailbox an account ID currently points to. An index built for
 * another mailbox (server or login changed) is discarded instead of being searched.
 */
export function createLocalIndex({ dir, getKey, getIdentity = () => null, maxPerAccount = 250_000 }) {
  const loaded = new Map(); // accountId -> entry
  const base = id => path.join(dir, id.replace(/[^a-z0-9-]/gi, ''));
  const dbFile = id => `${base(id)}.lvdb`;
  const legacyFile = id => `${base(id)}.lvx`;

  function removeFiles(id) {
    for (const suffix of ['', '-wal', '-shm', '-journal'])
      try {
        unlinkSync(`${dbFile(id)}${suffix}`);
      } catch {
        /* not there */
      }
  }
  function protect(id) {
    for (const suffix of ['', '-wal', '-shm'])
      try {
        chmodSync(`${dbFile(id)}${suffix}`, 0o600);
      } catch {
        /* not there (or not supported on this file system) */
      }
  }

  function connect(Database, id, key) {
    const db = new Database(dbFile(id));
    try {
      db.pragma(`cipher = 'sqlcipher'`);
      db.pragma('legacy = 4');
      // Raw 256-bit key (hex only, no user input): no passphrase KDF on every open.
      db.pragma(`key = "x'${key.toString('hex')}'"`);
      db.prepare('SELECT count(*) FROM sqlite_master').get(); // fails with SQLITE_NOTADB on a wrong key
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = NORMAL');
      db.pragma('secure_delete = ON');
      db.exec(DDL);
      return db;
    } catch (err) {
      db.close();
      throw err;
    }
  }

  async function open(id) {
    if (loaded.has(id)) return loaded.get(id);
    const key = await getKey(id);
    if (!key || key.length !== 32) return null;
    const Database = loadDatabase();
    if (!Database) return null;
    // Two callers may open at the same time; only one connection per account.
    if (loaded.has(id)) return loaded.get(id);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    let db;
    try {
      db = connect(Database, id, key);
    } catch {
      // Wrong key (key lost or replaced) or a damaged file: the index is rebuilt from the server.
      removeFiles(id);
      try {
        db = connect(Database, id, key);
      } catch {
        return null; // still locked or unreadable (e.g. held open elsewhere on Windows): index off for now
      }
    }
    protect(id);
    const identity = getIdentity(id) || null;
    const meta = Object.fromEntries(
      db
        .prepare('SELECT k, v FROM meta')
        .all()
        .map(r => [r.k, r.v])
    );
    const fresh = !meta.generation;
    if (!fresh && identity && meta.identity && meta.identity !== identity) {
      // Same account ID, another mailbox: never search the old data. Wiped inside the database,
      // so it also holds when the file cannot be deleted (open elsewhere on Windows).
      wipe(db);
    }
    const entry = { db, statements: new Map(), vectorCache: new Map() };
    const setMeta = db.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v');
    entry.meta = (k, v) =>
      v === undefined ? db.prepare('SELECT v FROM meta WHERE k = ?').pluck().get(k) : setMeta.run(k, String(v));
    if (!entry.meta('generation')) {
      db.transaction(() => {
        entry.meta('schema', SCHEMA);
        entry.meta('generation', randomBytes(8).toString('hex'));
        entry.meta('removedFrom', Date.now());
        if (identity) entry.meta('identity', identity);
      })();
      migrateLegacy(entry, id, key, identity);
    } else if (identity && !entry.meta('identity')) entry.meta('identity', identity);
    loaded.set(id, entry);
    return entry;
  }

  /** Removes every row, including FTS data and vectors. */
  function wipe(db) {
    db.transaction(() => {
      for (const table of ['messages', 'folders', 'removed', 'vectors', 'meta']) db.exec(`DELETE FROM ${table}`);
      db.exec("INSERT INTO words (words) VALUES ('delete-all')");
      db.exec("INSERT INTO heads (heads) VALUES ('delete-all')");
    })();
  }

  /** Imports an index file from before 2.3 once, then deletes it. */
  function migrateLegacy(entry, id, key, identity) {
    const file = legacyFile(id);
    if (!existsSync(file)) return;
    try {
      const data = decrypt(key, readFileSync(file));
      const usable = data.version === 1 && (!identity || !data.identity || data.identity === identity);
      if (usable) {
        const now = Date.now();
        entry.db.transaction(() => {
          for (const [folderPath, folder] of Object.entries(data.folders || {})) {
            if (typeof folderPath !== 'string' || !folder || typeof folder.items !== 'object') continue;
            upsertFolder(entry, folderPath, String(folder.uidValidity || ''), folder.modseq || null, null);
            for (const [uid, m] of Object.entries(folder.items))
              if (/^\d{1,10}$/.test(uid) && m && typeof m === 'object')
                insertMessage(entry, folderPath, Number(uid), { ...m, u: Number.isFinite(m.u) ? m.u : now });
          }
          if (data.updatedAt) entry.meta('updatedAt', data.updatedAt);
        })();
      }
    } catch {
      /* unreadable (other key, damaged): rebuilt from the server */
    }
    try {
      unlinkSync(file);
    } catch {
      /* already gone */
    }
  }

  function stmt(entry, sql) {
    let s = entry.statements.get(sql);
    if (!s) {
      s = entry.db.prepare(sql);
      entry.statements.set(sql, s);
    }
    return s;
  }

  function upsertFolder(entry, folderPath, uidValidity, modseq, seen) {
    stmt(
      entry,
      `INSERT INTO folders (path, uid_validity, modseq, seen) VALUES (?, ?, ?, ?)
       ON CONFLICT (path) DO UPDATE SET uid_validity = excluded.uid_validity, modseq = excluded.modseq, seen = excluded.seen`
    ).run(folderPath, uidValidity, modseq, seen === null ? null : JSON.stringify(seen));
  }

  function insertMessage(entry, folderPath, uid, m) {
    const row = {
      d: m.d || null,
      f: String(m.f || ''),
      fe: String(m.fe || ''),
      fn: String(m.fn || ''),
      t: String(m.t || '').slice(0, 500),
      s: String(m.s || ''),
      a: m.a ? 1 : 0,
      r: m.r ? 1 : 0,
      x: String(m.x || '').slice(0, TEXT_CHARS),
      u: Number.isFinite(m.u) ? m.u : Date.now()
    };
    const info = stmt(
      entry,
      `INSERT INTO messages (folder, uid, d, f, fe, fn, t, s, a, r, x, u) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (folder, uid) DO NOTHING`
    ).run(folderPath, uid, row.d, row.f, row.fe, row.fn, row.t, row.s, row.a, row.r, row.x, row.u);
    if (!info.changes) return false;
    const rowid = info.lastInsertRowid;
    stmt(entry, 'INSERT INTO words (rowid, hay) VALUES (?, ?)').run(
      rowid,
      normalize(`${row.s} ${row.f} ${row.t} ${row.x}`)
    );
    stmt(entry, 'INSERT INTO heads (rowid, hay) VALUES (?, ?)').run(rowid, normalize(`${row.s} ${row.f} ${row.t}`));
    return true;
  }

  function deleteMessage(entry, rowid, key, at) {
    stmt(entry, 'DELETE FROM words WHERE rowid = ?').run(rowid);
    stmt(entry, 'DELETE FROM heads WHERE rowid = ?').run(rowid);
    stmt(entry, 'DELETE FROM messages WHERE id = ?').run(rowid);
    if (stmt(entry, 'DELETE FROM vectors WHERE key = ?').run(key).changes) entry.vectorCache.clear();
    stmt(entry, 'INSERT INTO removed (key, at) VALUES (?, ?)').run(key, at);
  }

  function deleteFolder(entry, folderPath, uidValidity, at) {
    const rows = stmt(entry, 'SELECT id, uid FROM messages WHERE folder = ?').all(folderPath);
    for (const r of rows) deleteMessage(entry, r.id, entryKey(folderPath, uidValidity, r.uid), at);
    return rows.length;
  }

  function trimTombstones(entry) {
    const total = stmt(entry, 'SELECT count(*) FROM removed').pluck().get();
    if (total <= MAX_TOMBSTONES) return;
    const cut = stmt(entry, 'SELECT id, at FROM removed ORDER BY id LIMIT 1 OFFSET ?').get(total - MAX_TOMBSTONES - 1);
    stmt(entry, 'DELETE FROM removed WHERE id <= ?').run(cut.id);
    // Anyone asking for changes from before the oldest kept tombstone must rebuild.
    entry.meta('removedFrom', Math.max(Number(entry.meta('removedFrom')) || 0, cut.at));
  }

  const countAll = entry => stmt(entry, 'SELECT count(*) FROM messages').pluck().get();

  /**
   * Read/unread can change on any device without a new UID. With CONDSTORE only messages
   * changed since the last run are fetched, otherwise the flags of the whole folder.
   */
  async function refreshFlags(client, entry, folderPath, modseq) {
    if (!stmt(entry, 'SELECT 1 FROM messages WHERE folder = ? LIMIT 1').get(folderPath)) return { changed: 0, modseq };
    const highest = client.mailbox?.highestModseq;
    const condstore = Boolean(highest) && Boolean(modseq) && client.enabled?.has?.('CONDSTORE');
    const updates = [];
    let next = modseq;
    try {
      if (!condstore || BigInt(highest) > BigInt(modseq)) {
        const read = stmt(entry, 'SELECT id, r FROM messages WHERE folder = ? AND uid = ?');
        const options = condstore ? { uid: true, changedSince: BigInt(modseq) } : { uid: true };
        for await (const m of client.fetch('1:*', { uid: true, flags: true }, options)) {
          if (!Number.isSafeInteger(m?.uid) || !(m.flags instanceof Set)) continue;
          const row = read.get(folderPath, m.uid);
          if (!row) continue;
          const unread = m.flags.has('\\Seen') ? 0 : 1;
          if (row.r !== unread) updates.push([unread, row.id]);
        }
      }
      if (highest) next = String(highest);
    } catch {
      /* flags are refreshed on the next run */
    }
    if (updates.length) {
      const write = stmt(entry, 'UPDATE messages SET r = ? WHERE id = ?');
      entry.db.transaction(() => {
        for (const [r, rowid] of updates) write.run(r, rowid);
      })();
    }
    return { changed: updates.length, modseq: next };
  }

  /** Brings one folder up to date; at most `budget` new messages per call. */
  async function syncFolder(client, entry, folderPath, budget) {
    const lock = await client.getMailboxLock(folderPath, { readOnly: true });
    try {
      const uidValidity = String(client.mailbox?.uidValidity || '');
      const exists = Number(client.mailbox?.exists || 0);
      const uidNext = String(client.mailbox?.uidNext || '');
      const now = Date.now();
      const row = stmt(entry, 'SELECT uid_validity, modseq, seen FROM folders WHERE path = ?').get(folderPath);
      const reset = !row || row.uid_validity !== uidValidity;
      let removed = 0;
      let modseq = row?.modseq || null;
      let last = null;
      try {
        last = row?.seen ? JSON.parse(row.seen) : null;
      } catch {
        last = null;
      }
      if (reset) {
        if (row) entry.db.transaction(() => (removed += deleteFolder(entry, folderPath, row.uid_validity, now)))();
        modseq = client.mailbox?.highestModseq ? String(client.mailbox.highestModseq) : null;
        last = null;
        upsertFolder(entry, folderPath, uidValidity, modseq, null);
      }
      const room = Math.max(0, maxPerAccount - countAll(entry));
      // Same message count and UIDNEXT as after the last complete pass: nothing was added (UIDNEXT
      // would have grown) and nothing removed (the count would differ). The full UID listing,
      // ~600 KB on a 100k folder, is skipped; flags are still refreshed.
      const unchanged =
        !reset &&
        uidNext &&
        last &&
        last.exists === exists &&
        last.uidNext === uidNext &&
        (!last.pending || room === 0);
      if (unchanged) {
        const flags = await refreshFlags(client, entry, folderPath, modseq);
        if (flags.modseq !== modseq)
          stmt(entry, 'UPDATE folders SET modseq = ? WHERE path = ?').run(flags.modseq, folderPath);
        return { added: 0, removed: 0, reset: false, flagsChanged: flags.changed, skipped: true };
      }
      const all = exists ? await client.search({ all: true }, { uid: true }) : [];
      const present = new Set((Array.isArray(all) ? all : []).filter(n => Number.isSafeInteger(n) && n > 0));
      const indexed = stmt(entry, 'SELECT id, uid FROM messages WHERE folder = ?').all(folderPath);
      const gone = indexed.filter(r => !present.has(r.uid));
      if (gone.length)
        entry.db.transaction(() => {
          for (const r of gone) deleteMessage(entry, r.id, entryKey(folderPath, uidValidity, r.uid), now);
        })();
      removed += gone.length;
      let flagsChanged = 0;
      if (!reset) {
        const flags = await refreshFlags(client, entry, folderPath, modseq);
        flagsChanged = flags.changed;
        modseq = flags.modseq;
      }
      const known = new Set(indexed.map(r => r.uid));
      const notIndexed = [...present].filter(uid => !known.has(uid));
      const missing = notIndexed.sort((a, b) => b - a).slice(0, Math.min(budget, room));
      const seen = { exists, uidNext, pending: notIndexed.length > missing.length };
      // Written only when something differs: an unchanged run leaves the file untouched.
      if (reset || modseq !== (row?.modseq || null) || JSON.stringify(seen) !== JSON.stringify(last))
        upsertFolder(entry, folderPath, uidValidity, modseq, seen);
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
        const items = new Map();
        const byPart = new Map();
        for (const m of completeFetchResults(raw, batch)) {
          const env = m.envelope || {};
          const from = env.from?.[0] || {};
          items.set(m.uid, {
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
          });
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
              if (!parts.has(m?.uid) || !items.has(m.uid)) continue;
              const body = m.bodyParts?.get(key) || m.bodyParts?.get(key.toLowerCase());
              if (body === undefined) continue;
              items.get(m.uid).x = decodePreview(body, parts.get(m.uid), TEXT_CHARS);
            }
          } catch {
            /* text is optional */
          }
        }
        entry.db.transaction(() => {
          for (const [uid, item] of items) if (insertMessage(entry, folderPath, uid, item)) added++;
        })();
      }
      return { added, removed, reset, flagsChanged };
    } finally {
      lock.release();
    }
  }

  function hitFor(id, r) {
    return {
      accountId: id,
      folder: r.folder,
      uid: r.uid,
      subject: r.s || '(Ohne Betreff)',
      fromName: r.fn || 'Unbekannt',
      fromEmail: r.fe,
      date: r.d,
      unread: Boolean(r.r),
      hasAttachments: Boolean(r.a),
      preview: String(r.x || '').slice(0, 180)
    };
  }

  function searchTerms(query) {
    return normalize(query)
      .split(/\s+/)
      .filter(t => t.length >= 2)
      .slice(0, 8);
  }

  /**
   * Row IDs of every message matching all terms: each term is a word prefix anywhere, or a
   * substring of subject, sender or recipients. Answered from the FTS indexes alone.
   */
  function matchingIds(entry, terms, folder) {
    let result = null;
    const ordered = [...terms].sort((a, b) => b.length - a.length); // longer terms are more selective
    for (const term of ordered) {
      const ids = new Set(
        stmt(entry, 'SELECT rowid FROM words WHERE words MATCH ?')
          .pluck()
          .all(`${ftsString(term)}*`)
      );
      if (term.length >= 3)
        for (const rowid of stmt(entry, 'SELECT rowid FROM heads WHERE heads MATCH ?').pluck().all(ftsString(term)))
          ids.add(rowid);
      result = result ? new Set([...result].filter(rowid => ids.has(rowid))) : ids;
      if (!result.size) return result;
    }
    if (folder) {
      const inFolder = new Set(stmt(entry, 'SELECT id FROM messages WHERE folder = ?').pluck().all(folder));
      result = new Set([...result].filter(rowid => inFolder.has(rowid)));
    }
    return result;
  }

  const PAGE_COLUMNS = 'id, folder, uid, d, fn, fe, s, r, a, substr(x, 1, 180) AS x';
  // Below this many hits they are sorted directly; above, the date index is walked until the
  // page is full, which stops early exactly when there are many hits.
  const DIRECT_SORT_MAX = 5000;

  /** The newest `count` of the matching rows of one account. */
  function newestRows(entry, ids, count) {
    if (!ids.size || count < 1) return [];
    if (ids.size <= DIRECT_SORT_MAX)
      return stmt(
        entry,
        `SELECT ${PAGE_COLUMNS} FROM messages WHERE id IN (SELECT value FROM json_each(?))
         ORDER BY d DESC, uid DESC LIMIT ?`
      ).all(JSON.stringify([...ids]), count);
    const picked = [];
    for (const rowid of stmt(entry, 'SELECT id FROM messages ORDER BY d DESC, uid DESC').pluck().iterate()) {
      if (!ids.has(rowid)) continue;
      picked.push(rowid);
      if (picked.length >= count) break; // ends the statement
    }
    const byId = new Map(
      stmt(entry, `SELECT ${PAGE_COLUMNS} FROM messages WHERE id IN (SELECT value FROM json_each(?))`)
        .all(JSON.stringify(picked))
        .map(r => [r.id, r])
    );
    return picked.map(rowid => byId.get(rowid)).filter(Boolean);
  }

  /**
   * Matches newest first, paged. Only the requested page is read; `total` counts every match.
   */
  async function searchPage(ids, query, { folder = null, limit = 100, cursor = null } = {}) {
    const size = Math.max(1, Math.min(SEARCH_MAX_LIMIT, Number.isInteger(limit) ? limit : 100));
    const offset = /^\d{1,9}$/.test(String(cursor ?? '')) ? Number(cursor) : 0;
    const terms = searchTerms(query);
    if (!terms.length) return { messages: [], total: 0, nextCursor: null };
    let total = 0;
    let rows = [];
    for (const id of ids) {
      const entry = await open(id);
      if (!entry) continue;
      try {
        const matches = matchingIds(entry, terms, typeof folder === 'string' ? folder : null);
        total += matches.size;
        // Each account contributes at most offset+size rows; merged by date below.
        rows = rows.concat(newestRows(entry, matches, offset + size).map(r => ({ id, r })));
      } catch {
        /* a query term FTS cannot parse finds nothing instead of failing */
      }
    }
    if (ids.length > 1) rows.sort((a, b) => String(b.r.d).localeCompare(String(a.r.d)) || b.r.uid - a.r.uid);
    const messages = rows.slice(offset, offset + size).map(({ id, r }) => hitFor(id, r));
    const next = offset + messages.length;
    return { messages, total, nextCursor: next < total && messages.length ? String(next) : null };
  }

  /** All vectors of one model as one contiguous int8 block (cached until they change). */
  async function vectorSet(entry, model) {
    if (entry.vectorCache.has(model)) return entry.vectorCache.get(model);
    const count = stmt(entry, 'SELECT count(*) FROM vectors WHERE model = ?').pluck().get(model);
    const dim = stmt(entry, 'SELECT dim FROM vectors WHERE model = ? LIMIT 1').pluck().get(model);
    if (!count || !dim) return null;
    const set = {
      dim,
      count: 0,
      data: new Int8Array(count * dim),
      scales: new Float32Array(count),
      keys: new Array(count),
      folders: new Array(count),
      uids: new Array(count)
    };
    const read = stmt(
      entry,
      `SELECT id, key, folder, uid, dim, scale, embedding FROM vectors WHERE model = ? AND id > ? ORDER BY id LIMIT ${SCAN_CHUNK}`
    );
    let lastId = 0;
    for (;;) {
      const rows = read.all(model, lastId);
      if (!rows.length) break;
      lastId = rows.at(-1).id;
      for (const r of rows) {
        if (r.dim !== dim || set.count >= count) continue;
        const n = set.count++;
        set.data.set(new Int8Array(r.embedding.buffer, r.embedding.byteOffset, dim), n * dim);
        set.scales[n] = r.scale;
        set.keys[n] = r.key;
        set.folders[n] = r.folder;
        set.uids[n] = r.uid;
      }
      await tick();
    }
    entry.vectorCache.set(model, set);
    return set;
  }

  return {
    /** Indexes all folders of an account (incrementally). */
    async sync(client, id, folders, { budget = 2000 } = {}) {
      const entry = await open(id);
      if (!entry) return { enabled: false };
      const valid = indexableFolders(folders);
      const now = Date.now();
      let changed = false;
      let removed = 0;
      for (const f of stmt(entry, 'SELECT path, uid_validity FROM folders').all())
        if (!valid.some(v => v.path === f.path)) {
          entry.db.transaction(() => {
            removed += deleteFolder(entry, f.path, f.uid_validity, now);
            stmt(entry, 'DELETE FROM folders WHERE path = ?').run(f.path);
          })();
          changed = true;
        }
      let left = budget;
      let added = 0;
      let skipped = 0;
      for (const f of valid) {
        const result = await syncFolder(client, entry, f.path, left);
        added += result.added;
        removed += result.removed;
        if (result.reset || result.flagsChanged) changed = true;
        if (result.skipped) skipped++;
        left -= result.added;
        if (left <= 0) break;
      }
      if (changed || added || removed) {
        entry.meta('updatedAt', new Date().toISOString());
        trimTombstones(entry);
      }
      protect(id);
      return { enabled: true, added, removed, skipped, complete: left > 0, total: countAll(entry) };
    },

    /**
     * All terms must occur (diacritics/case-insensitive) as word beginnings in subject, sender,
     * recipients or text, or anywhere inside subject, sender or recipients.
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
      const after = Number.isFinite(since) ? since : -1;
      let lastId = 0;
      for (;;) {
        const rows = stmt(
          entry,
          `SELECT m.id, m.folder, m.uid, m.d, m.fn, m.fe, m.s, m.x, m.u, f.uid_validity FROM messages m
           JOIN folders f ON f.path = m.folder WHERE m.id > ? AND m.u > ? ORDER BY m.id LIMIT 500`
        ).all(lastId, after);
        if (!rows.length) return;
        lastId = rows.at(-1).id;
        for (const r of rows)
          yield {
            key: entryKey(r.folder, r.uid_validity, r.uid),
            folder: r.folder,
            uid: r.uid,
            date: r.d,
            fromName: r.fn,
            fromEmail: r.fe,
            subject: r.s,
            text: r.x,
            updatedAt: r.u
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
      if (!Number.isFinite(since) || since < Number(entry.meta('removedFrom'))) return null;
      return stmt(entry, 'SELECT key FROM removed WHERE at > ? ORDER BY id').pluck().all(since);
    },

    /**
     * Stores embeddings for indexed messages (same encrypted file), normalized to unit length and
     * quantized to int8. Keys that are not (or no longer) in the index are skipped. All vectors
     * of a model share one dimension. Removing a message or rebuilding the index removes its vectors.
     */
    async putVectors(id, model, items) {
      const entry = await open(id);
      if (!entry) return { stored: 0, skipped: Array.isArray(items) ? items.length : 0 };
      if (!validModel(model)) throw Object.assign(new Error('Ungültiger Modellname.'), { statusCode: 400 });
      const find = stmt(
        entry,
        `SELECT m.folder, m.uid FROM messages m JOIN folders f ON f.path = m.folder
         WHERE m.folder = ? AND m.uid = ? AND f.uid_validity = ?`
      );
      const write = stmt(
        entry,
        `INSERT INTO vectors (model, key, folder, uid, dim, scale, embedding) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (model, key) DO UPDATE SET dim = excluded.dim, scale = excluded.scale, embedding = excluded.embedding`
      );
      let expected = stmt(entry, 'SELECT dim FROM vectors WHERE model = ? LIMIT 1').pluck().get(model) || null;
      let stored = 0;
      let skipped = 0;
      entry.db.transaction(() => {
        for (const item of Array.isArray(items) ? items : []) {
          const parts = typeof item?.key === 'string' ? item.key.split('\u0000') : [];
          const vector = unitVector(item?.vector);
          const uid = Number(parts[2]);
          const hit = parts.length === 3 && Number.isSafeInteger(uid) ? find.get(parts[0], uid, parts[1]) : null;
          if (!hit || !vector || (expected && vector.length !== expected)) {
            skipped++;
            continue;
          }
          expected = vector.length;
          const { scale, bytes } = quantize(vector);
          write.run(model, item.key, hit.folder, hit.uid, vector.length, scale, bytes);
          stored++;
        }
      })();
      if (stored) entry.vectorCache.delete(model);
      return { stored, skipped };
    },

    /**
     * The `limit` most similar messages to `vector` (cosine similarity, 1 = same direction),
     * exact search over all vectors of the model. The first search loads them into memory
     * (1 byte per dimension); later ones only compute.
     */
    async searchVectors(id, model, vector, { limit = 20, folder = null } = {}) {
      const entry = await open(id);
      if (!entry || !validModel(model)) return [];
      const query = unitVector(vector);
      if (!query) return [];
      const size = Math.max(1, Math.min(SEARCH_MAX_LIMIT, Number.isInteger(limit) ? limit : 20));
      const set = await vectorSet(entry, model);
      if (!set || set.dim !== query.length) return [];
      const { dim, data, scales, folders, count } = set;
      const best = []; // ascending by score, at most `size`
      for (let n = 0; n < count; n++) {
        if (folder && folders[n] !== folder) continue;
        let dot = 0;
        const offset = n * dim;
        for (let i = 0; i < dim; i++) dot += data[offset + i] * query[i];
        const score = dot * scales[n];
        if (best.length === size && score <= best[0].score) continue;
        let at = best.findIndex(b => b.score > score);
        if (at < 0) at = best.length;
        best.splice(at, 0, { n, score });
        if (best.length > size) best.shift();
        if (n % 20_000 === 19_999) await tick();
      }
      return best.reverse().map(b => ({
        key: set.keys[b.n],
        folder: folders[b.n],
        uid: set.uids[b.n],
        score: Math.round(b.score * 1e6) / 1e6
      }));
    },

    /** Removes all vectors of one model. */
    async dropVectors(id, model) {
      const entry = await open(id);
      if (!entry || !validModel(model)) return { removed: 0 };
      entry.vectorCache.delete(model);
      return { removed: stmt(entry, 'DELETE FROM vectors WHERE model = ?').run(model).changes };
    },

    async text(id, folderPath, uid) {
      const entry = await open(id);
      const r = entry
        ? stmt(entry, 'SELECT s, fn, fe, d, x FROM messages WHERE folder = ? AND uid = ?').get(folderPath, Number(uid))
        : null;
      return r ? { subject: r.s, fromName: r.fn, fromEmail: r.fe, date: r.d, text: r.x } : null;
    },

    async status(id) {
      const entry = await open(id);
      if (!entry) return { enabled: false };
      let bytes = 0;
      for (const suffix of ['', '-wal'])
        try {
          bytes += statSync(`${dbFile(id)}${suffix}`).size;
        } catch {
          /* not there */
        }
      return {
        enabled: true,
        messages: countAll(entry),
        folders: stmt(entry, 'SELECT count(*) FROM folders').pluck().get(),
        vectors: stmt(entry, 'SELECT count(*) FROM vectors').pluck().get(),
        updatedAt: entry.meta('updatedAt') || null,
        generation: entry.meta('generation'),
        bytes
      };
    },

    async clear(id) {
      const entry = loaded.get(id);
      loaded.delete(id);
      try {
        // Emptied first: if the file cannot be deleted (Windows: open elsewhere), nothing remains in it.
        if (entry) wipe(entry.db);
        entry?.db.close();
      } catch {
        /* already closed */
      }
      removeFiles(id);
      try {
        unlinkSync(legacyFile(id));
      } catch {
        /* not there */
      }
    },
    unload(id) {
      const entry = loaded.get(id);
      loaded.delete(id);
      try {
        entry?.db.close();
      } catch {
        /* already closed */
      }
    },
    /** Closes every open database (shutdown). */
    close() {
      for (const id of [...loaded.keys()]) this.unload(id);
    }
  };
}
