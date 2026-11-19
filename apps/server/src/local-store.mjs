// Shared building blocks for the local data files (ARC-LEV-003): one atomic write, one encryption
// format and one way to get a key from the system keychain. The stores keep their own policy for
// a missing key (calendar, contacts and tasks lock; short-lived files start over).
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmod, mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Keychain account that holds the keys of the local files. */
export const LOCAL_KEY_ACCOUNT = 'local';

/**
 * Encrypts text as `{"v":1,"iv","tag","data"}` (AES-256-GCM, random 96-bit IV, base64).
 * `aad` (optional) binds the content to a context, e.g. the file it belongs to: it is not stored,
 * and unseal() must be given the same value, so a file copied over another one does not open.
 */
export function seal(key, text, aad = '') {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'));
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return JSON.stringify({
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64')
  });
}

/**
 * Decrypts what seal() wrote (with the same `aad`). Throws on another format, a wrong key, another
 * context or a changed file.
 */
export function unseal(key, raw, aad = '') {
  const box = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (box?.v !== 1 || typeof box.iv !== 'string' || typeof box.tag !== 'string' || typeof box.data !== 'string')
    throw new TypeError('format');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
  if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]).toString('utf8');
}

/** True when the file content was written by seal() (as opposed to an old plain-text file). */
export const isSealed = raw => typeof raw === 'string' && raw.trimStart().startsWith('{"v":1');

/**
 * The 256-bit key `name` from the keychain, or null (no keychain, or no key and `create` false).
 * A key is only created when `create` is true: a fresh key for an existing encrypted file would
 * make it unreadable. A created key counts only if the keychain gives it back.
 */
export function keychainKey(vault, name, { create = false, account = LOCAL_KEY_ACCOUNT } = {}) {
  if (!vault?.available) return null;
  try {
    let hex = vault.get(account, name);
    if (!/^[0-9a-f]{64}$/i.test(hex || '')) {
      if (!create) return null;
      hex = randomBytes(32).toString('hex');
      vault.set(account, name, hex);
      if (vault.get(account, name) !== hex) return null;
    }
    return Buffer.from(hex, 'hex');
  } catch {
    return null;
  }
}

/**
 * Writes a file so that a crash leaves either the old or the new content, never half of it:
 * a private temporary file next to the target, then rename. The folder is created (0700).
 */
export async function atomicWrite(filename, content, { mode = 0o600 } = {}) {
  await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  const tmp = `${filename}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(tmp, content, { flag: 'wx', mode });
    await chmod(tmp, mode); // the umask may have narrowed or widened the mode on creation
    await rename(tmp, filename);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

/**
 * Runs writes one after another in call order. Each write reports its own error, and a failed
 * write does not block the later ones. flush() waits for the last one (and reports its error).
 */
export function createWriteQueue() {
  let last = Promise.resolve();
  return {
    push(run) {
      const next = last.catch(() => {}).then(run);
      last = next;
      return next;
    },
    flush: () => last
  };
}
