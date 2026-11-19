// Encrypted local storage for shared spaces. Every member keeps a complete copy.
//
// Layout in the data folder:
//   spaces/<spaceId>.lvs      one file per space (state, operations, keys, outbox), AES-256-GCM
//   spaces/index.lvs          received invitations and IMAP cursors, AES-256-GCM
//   spaces/blobs/<blob>.<n>   file chunks, already encrypted with the per-file key
// The local key ("spaces-key") and the space identity ("spaces-identity") live in the OS keychain
// under the account "local". Without the keychain spaces stay locked (fail closed), and existing
// files are never overwritten with a new key.
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, unlink, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createIdentity, open, seal, validIdentity } from './crypto.mjs';

export const SPACES_ACCOUNT = 'local';
export const SPACES_KEY = 'spaces-key';
export const SPACES_IDENTITY = 'spaces-identity';
const SPACE_FILE = /^([a-f0-9]{32})\.lvs$/;
const BLOB_FILE = /^[a-f0-9]{16,64}\.\d{1,6}$/;
const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });

async function atomicWrite(filename, content) {
  await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  const tmp = `${filename}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await writeFile(tmp, content, { mode: 0o600 });
    await rename(tmp, filename);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
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
  let key;
  let identity;
  try {
    let hex = vault.get(SPACES_ACCOUNT, SPACES_KEY);
    let rawIdentity = vault.get(SPACES_ACCOUNT, SPACES_IDENTITY);
    if (!hex && !existing) {
      hex = randomBytes(32).toString('hex');
      vault.set(SPACES_ACCOUNT, SPACES_KEY, hex);
    }
    if (!rawIdentity && !existing) {
      rawIdentity = JSON.stringify(createIdentity());
      vault.set(SPACES_ACCOUNT, SPACES_IDENTITY, rawIdentity);
    }
    key = /^[0-9a-f]{64}$/i.test(hex || '') ? Buffer.from(hex, 'hex') : null;
    identity = rawIdentity ? JSON.parse(rawIdentity) : null;
  } catch {
    key = null;
  }
  if (!key || !validIdentity(identity))
    throw fail('Die Räume lassen sich mit dem Schlüssel aus dem Schlüsselbund nicht öffnen.', 'spaces_locked', 423);

  const encode = (value, aad) => JSON.stringify({ v: 1, ...seal(key, JSON.stringify(value), aad) });
  const decode = (raw, aad) => {
    const box = JSON.parse(raw);
    return JSON.parse(open(key, box, aad).toString('utf8'));
  };

  const spaceFile = id => path.join(dir, `${id}.lvs`);
  const writes = new Map();
  /** Writes are serialised per file; a failed write does not block later ones. */
  function queued(name, fn) {
    const run = (writes.get(name) || Promise.resolve()).catch(() => {}).then(fn);
    writes.set(name, run);
    return run;
  }

  const spaces = new Map();
  for (const f of files) {
    const m = SPACE_FILE.exec(f);
    if (!m) continue;
    try {
      spaces.set(m[1], decode(await readFile(path.join(dir, f), 'utf8'), `space.${m[1]}`));
    } catch {
      throw fail('Ein Raum lässt sich mit dem Schlüssel aus dem Schlüsselbund nicht öffnen.', 'spaces_locked', 423);
    }
  }
  let index = { invitations: [], cursors: {} };
  if (files.includes('index.lvs')) {
    try {
      index = { ...index, ...decode(await readFile(path.join(dir, 'index.lvs'), 'utf8'), 'spaces.index') };
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

  return {
    identity,
    ids: () => [...spaces.keys()],
    get: id => spaces.get(id) || null,
    all: () => [...spaces.values()],
    async save(record) {
      spaces.set(record.id, record);
      const snapshot = encode(record, `space.${record.id}`);
      return queued(record.id, () => atomicWrite(spaceFile(record.id), snapshot));
    },
    async remove(id) {
      spaces.delete(id);
      await queued(id, () => rm(spaceFile(id), { force: true }));
    },
    index: () => index,
    async saveIndex(next = index) {
      index = next;
      const snapshot = encode(index, 'spaces.index');
      return queued('index', () => atomicWrite(path.join(dir, 'index.lvs'), snapshot));
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
