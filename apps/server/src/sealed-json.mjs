// Small JSON file encrypted with AES-256-GCM; the key lives in the system keychain (account
// `local`). For short-lived data that contains message text (e.g. MCP approvals). Without a
// keychain nothing is written to disk: the data then lives in memory until the app quits.
// A file that cannot be decrypted (key lost) is replaced: the data is short-lived by design.
import { readFile, unlink } from 'node:fs/promises';
import { atomicWrite, keychainKey, seal, unseal } from './local-store.mjs';

// seal/unseal stay exported here for existing callers; the format lives in local-store.mjs.
export { seal, unseal };

/** Same interface as createJsonFile: get() and save(next), writes in call order. */
export async function createSealedJsonFile(filename, fallback, { vault, keyName }) {
  const key = keychainKey(vault, keyName, { create: true });
  let value = fallback;
  let migrate = false;
  const raw = await readFile(filename, 'utf8').catch(() => null);
  if (raw !== null) {
    let doc;
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.v === 1 && parsed.iv) doc = key ? JSON.parse(unseal(key, raw)) : null;
      else {
        doc = parsed; // written by an older version in plain text: encrypted at once below
        migrate = true;
      }
    } catch {
      doc = null;
    }
    value = doc && typeof doc === 'object' ? { ...fallback, ...doc } : fallback;
    // No key: the plain file is removed, its content stays in memory only.
    if (!key) await unlink(filename).catch(() => {});
  }
  let queue = Promise.resolve();
  const file = {
    get: () => value,
    persistent: Boolean(key),
    save(next) {
      value = next;
      if (!key) return Promise.resolve();
      const write = queue.then(() => atomicWrite(filename, seal(key, JSON.stringify(next))));
      queue = write.catch(() => {});
      return write;
    }
  };
  if (migrate && key) await file.save(value).catch(() => {});
  return file;
}
