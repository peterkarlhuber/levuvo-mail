// Encrypted local storage for shared spaces. Every member keeps a complete copy.
//
// Layout in the data folder:
//   spaces/<spaceId>.lvs      one file per space (state, operations, keys, outbox)
//   spaces/index.lvs          received invitations and IMAP cursors
//   spaces/blobs/<blob>.<n>   file chunks, already encrypted end to end with the per-file key
// The .lvs files use the shared format of the local files (local-store.mjs: AES-256-GCM, base64),
// bound to their file name as additional data, so one file copied over another does not open.
// Versions up to 2.3 wrote the same envelope in base64url; such files are read and rewritten in the
// shared format when the store opens (see migrateLegacy below).
// The local key ("spaces-key") and the space identity ("spaces-identity") live in the OS keychain
// under the account "local". Without the keychain spaces stay locked (fail closed), and existing
// files are never overwritten with a new key.
import { readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { atomicWrite, createWriteQueue, keychainKey, LOCAL_KEY_ACCOUNT, seal, unseal } from '../local-store.mjs';
import { createIdentity, open as openLegacy, validIdentity } from './crypto.mjs';

export const SPACES_ACCOUNT = LOCAL_KEY_ACCOUNT;
export const SPACES_KEY = 'spaces-key';
export const SPACES_IDENTITY = 'spaces-identity';
const SPACE_FILE = /^([a-f0-9]{32})\.lvs$/;
const BLOB_FILE = /^[a-f0-9]{16,64}\.\d{1,6}$/;
/** Leftover of a write that was cut off (crash, power loss): never the only copy of anything. */
const TMP_FILE = /\.[a-f0-9]{8,12}\.tmp$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });

/**
 * True for an envelope in the format of versions up to 2.3 (base64url, no padding). The 16-byte
 * GCM tag always needs padding in base64, so the tag alone tells the two formats apart.
 */
export const isLegacyBox = box => !(BASE64.test(box.iv) && BASE64.test(box.tag) && BASE64.test(box.data));

async function removeLeftovers(folder) {
  const names = await readdir(folder).catch(() => []);
  for (const name of names) if (TMP_FILE.test(name)) await rm(path.join(folder, name), { force: true });
}

/**
 * @param {object} o
 * @param {string} o.dir  the spaces folder
 * @param {{available:boolean,get:Function,set:Function}|null} o.vault
 */
export async function openSpaceStore({ dir, vault }) {
  const files = await readdir(dir).catch(err => {
    if (err.code === 'ENOENT') return [];
    throw err;
  });
  const existing = files.some(f => SPACE_FILE.test(f) || f === 'index.lvs');
  if (!vault?.available)
    throw fail('Räume brauchen den Schlüsselbund des Systems. Er ist gerade nicht verfügbar.', 'spaces_locked', 423);
  // A new key only for a folder without spaces: a fresh key would make existing files unreadable.
  const key = keychainKey(vault, SPACES_KEY, { create: !existing, account: SPACES_ACCOUNT });
  let identity;
  try {
    let rawIdentity = vault.get(SPACES_ACCOUNT, SPACES_IDENTITY);
    if (!rawIdentity && !existing && key) {
      rawIdentity = JSON.stringify(createIdentity());
      vault.set(SPACES_ACCOUNT, SPACES_IDENTITY, rawIdentity);
      rawIdentity = vault.get(SPACES_ACCOUNT, SPACES_IDENTITY);
    }
    identity = rawIdentity ? JSON.parse(rawIdentity) : null;
  } catch {
    identity = null;
  }
  if (!key || !validIdentity(identity))
    throw fail('Die Räume lassen sich mit dem Schlüssel aus dem Schlüsselbund nicht öffnen.', 'spaces_locked', 423);

  await removeLeftovers(dir);
  await removeLeftovers(path.join(dir, 'blobs'));

  const encode = (value, aad) => seal(key, JSON.stringify(value), aad);
  /** The content of a file in either format; `legacy` says whether it still needs rewriting. */
  const decode = (raw, aad) => {
    const box = JSON.parse(raw);
    if (box?.v !== 1 || typeof box.iv !== 'string' || typeof box.tag !== 'string' || typeof box.data !== 'string')
      throw new TypeError('format');
    if (isLegacyBox(box)) return { value: JSON.parse(openLegacy(key, box, aad).toString('utf8')), legacy: true };
    return { value: JSON.parse(unseal(key, box, aad)), legacy: false };
  };
  const legacyFiles = [];

  const spaceFile = id => path.join(dir, `${id}.lvs`);
  const writes = new Map();
  /** Writes are serialised per file; a failed write does not block later ones. */
  function queued(name, fn) {
    if (!writes.has(name)) writes.set(name, createWriteQueue());
    return writes.get(name).push(fn);
  }

  const spaces = new Map();
  for (const f of files) {
    const m = SPACE_FILE.exec(f);
    if (!m) continue;
    try {
      const { value, legacy } = decode(await readFile(path.join(dir, f), 'utf8'), `space.${m[1]}`);
      spaces.set(m[1], value);
      if (legacy) legacyFiles.push(m[1]);
    } catch {
      throw fail('Ein Raum lässt sich mit dem Schlüssel aus dem Schlüsselbund nicht öffnen.', 'spaces_locked', 423);
    }
  }
  let index = { invitations: [], cursors: {} };
  if (files.includes('index.lvs')) {
    try {
      const { value, legacy } = decode(await readFile(path.join(dir, 'index.lvs'), 'utf8'), 'spaces.index');
      index = { ...index, ...value };
      if (legacy) legacyFiles.push('index');
    } catch {
      throw fail(
        'Die Raumliste lässt sich mit dem Schlüssel aus dem Schlüsselbund nicht öffnen.',
        'spaces_locked',
        423
      );
    }
  }

  const blobDir = path.join(dir, 'blobs');
  const blobName = (blob, n) => {
    const name = `${blob}.${n}`;
    if (!BLOB_FILE.test(name)) throw fail('Ungültige Datei.', 'spaces_invalid');
    return path.join(blobDir, name);
  };

  const indexFile = path.join(dir, 'index.lvs');
  const writeIndex = () => {
    const snapshot = encode(index, 'spaces.index');
    return queued('index', () => atomicWrite(indexFile, snapshot));
  };
  const writeSpace = record => {
    const snapshot = encode(record, `space.${record.id}`);
    return queued(record.id, () => atomicWrite(spaceFile(record.id), snapshot));
  };

  // Migration of files from versions up to 2.3: only after every file opened with the key, one
  // atomic rewrite per file. A crash in between leaves each file in one of two readable formats,
  // and a failed write keeps the old file, which the next start tries again.
  for (const name of legacyFiles) {
    await (name === 'index' ? writeIndex() : writeSpace(spaces.get(name))).catch(() => {});
  }

  return {
    identity,
    ids: () => [...spaces.keys()],
    get: id => spaces.get(id) || null,
    all: () => [...spaces.values()],
    async save(record) {
      spaces.set(record.id, record);
      return writeSpace(record);
    },
    async remove(id) {
      spaces.delete(id);
      await queued(id, () => rm(spaceFile(id), { force: true }));
    },
    index: () => index,
    async saveIndex(next = index) {
      index = next;
      return writeIndex();
    },
    /** Read-modify-write on the index as it is now (never on an older copy someone kept). */
    async updateIndex(fn) {
      return this.saveIndex(fn(index) || index);
    },
    async putChunk(blob, n, data) {
      await atomicWrite(blobName(blob, n), data);
    },
    async getChunk(blob, n) {
      try {
        return await readFile(blobName(blob, n));
      } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
      }
    },
    async hasChunk(blob, n) {
      return stat(blobName(blob, n)).then(
        () => true,
        () => false
      );
    },
    async removeBlobs(blobs) {
      for (const { blob, chunks } of blobs)
        for (let n = 0; n < chunks; n++) await rm(blobName(blob, n), { force: true });
    }
  };
}
