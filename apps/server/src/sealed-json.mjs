// Small JSON file encrypted with AES-256-GCM; the key lives in the system keychain (account
// `local`). For short-lived data that contains message text (e.g. MCP approvals). Without a
// keychain nothing is written to disk: the data then lives in memory until the app quits.
// A file that cannot be decrypted (key lost) is replaced: the data is short-lived by design.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const KEY_ACCOUNT = 'local';

function keyFrom(vault, name) {
  if (!vault?.available) return null;
  try {
    let hex = vault.get(KEY_ACCOUNT, name);
    if (!/^[0-9a-f]{64}$/i.test(hex || '')) {
      hex = randomBytes(32).toString('hex');
      vault.set(KEY_ACCOUNT, name, hex);
      if (vault.get(KEY_ACCOUNT, name) !== hex) return null;
    }
    return Buffer.from(hex, 'hex');
  } catch {
    return null;
  }
}

export function seal(key, text) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return JSON.stringify({
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64')
  });
}
export function unseal(key, raw) {
  const box = JSON.parse(raw);
  if (box?.v !== 1) throw new TypeError('format');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]).toString('utf8');
}

/** Same interface as createJsonFile: get() and save(next), writes in call order. */
export async function createSealedJsonFile(filename, fallback, { vault, keyName }) {
  const key = keyFrom(vault, keyName);
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
      const write = queue.then(async () => {
        await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
        const tmp = `${filename}.${randomBytes(4).toString('hex')}.tmp`;
        try {
          await writeFile(tmp, seal(key, JSON.stringify(next)), { mode: 0o600 });
          await rename(tmp, filename);
        } catch (err) {
          await unlink(tmp).catch(() => {});
          throw err;
        }
      });
      queue = write.catch(() => {});
      return write;
    }
  };
  if (migrate && key) await file.save(value).catch(() => {});
  return file;
}
