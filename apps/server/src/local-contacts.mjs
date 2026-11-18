// Contacts "on this device": an address book that works without any CardDAV or cloud account.
// Contacts are kept as vCards (same model as CardDAV, so import/export and moving to a connected
// address book later behave identically), encrypted with AES-256-GCM. The key lives in the OS
// keychain; without it the address book is unavailable instead of silently unencrypted.
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildVCard, parseVCard } from './vcard.mjs';

export const LOCAL_CONTACTS_ACCOUNT = 'local';
export const LOCAL_BOOK_URL = 'local-contacts:';
export const LOCAL_CONTACTS_LABEL = 'Auf diesem Gerät';
const KEY_NAME = 'contacts-key';
const MAX_CONTACTS = 20_000;
const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });

export const isLocalContact = url => String(url || '').startsWith(LOCAL_BOOK_URL);

function encrypt(key, text) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return JSON.stringify({
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: body.toString('base64')
  });
}
function decrypt(key, raw) {
  const box = JSON.parse(raw);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]).toString('utf8');
}

/**
 * @param {object} o
 * @param {string} o.filename
 * @param {{ available: boolean, get(id, kind): string, set(id, kind, v): void } | null} o.vault
 */
export async function createLocalContacts({ filename, vault }) {
  let raw = null;
  try {
    raw = await readFile(filename, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const exists = raw !== null && raw.trim() !== '';
  let key = null;
  if (vault?.available) {
    try {
      let hex = vault.get(LOCAL_CONTACTS_ACCOUNT, KEY_NAME);
      // A new key only while no address book file exists: a fresh key for an existing file would
      // make it unreadable and the next save would overwrite every contact.
      if (!hex && !exists) {
        hex = randomBytes(32).toString('hex');
        vault.set(LOCAL_CONTACTS_ACCOUNT, KEY_NAME, hex);
      }
      key = /^[0-9a-f]{64}$/i.test(hex || '') ? Buffer.from(hex, 'hex') : null;
    } catch {
      key = null;
    }
  }
  // Fail closed: contacts are never written in plain text, and an existing file stays untouched
  // until the key is available again.
  if (!key)
    throw fail(
      'Die Kontakte auf diesem Gerät brauchen den Schlüsselbund des Systems. Er ist gerade nicht verfügbar.',
      'local_locked',
      423
    );
  let state = { contacts: [] };
  if (exists) {
    let text;
    try {
      text = decrypt(key, raw);
    } catch {
      throw fail(
        'Die Kontakte auf diesem Gerät lassen sich mit dem Schlüssel aus dem Schlüsselbund nicht öffnen.',
        'local_locked',
        423
      );
    }
    const parsed = JSON.parse(text);
    state = { contacts: Array.isArray(parsed?.contacts) ? parsed.contacts : [] };
  }

  let writing = Promise.resolve();
  function persist() {
    const snapshot = JSON.stringify(state);
    // A failed write reports its own error but does not block every later one.
    const run = writing
      .catch(() => {})
      .then(async () => {
        await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
        const tmp = `${filename}.${randomBytes(4).toString('hex')}.tmp`;
        try {
          await writeFile(tmp, encrypt(key, snapshot), { mode: 0o600 });
          await rename(tmp, filename);
        } catch (err) {
          await unlink(tmp).catch(() => {});
          throw err;
        }
      });
    writing = run;
    return run;
  }

  const etag = () => `"${randomBytes(6).toString('hex')}"`;
  const entryOf = url => {
    const entry = state.contacts.find(c => c.url === url);
    if (!entry) throw fail('Kontakt nicht gefunden.', 'contact_missing', 404);
    return entry;
  };
  const book = {
    accountId: LOCAL_CONTACTS_ACCOUNT,
    url: LOCAL_BOOK_URL,
    name: 'Kontakte',
    accountLabel: LOCAL_CONTACTS_LABEL,
    source: 'local'
  };
  function add(contact, uid) {
    if (state.contacts.length >= MAX_CONTACTS) throw fail('Das Adressbuch auf diesem Gerät ist voll.', 'contact_limit');
    const entry = { url: `${LOCAL_BOOK_URL}${randomUUID()}`, uid, etag: etag(), data: buildVCard(contact, uid) };
    state.contacts.push(entry);
    return entry;
  }

  return {
    addressBook: () => ({ ...book }),
    contacts() {
      const out = [];
      for (const entry of state.contacts) {
        const parsed = parseVCard(entry.data);
        if (parsed)
          out.push({
            ...parsed,
            uid: parsed.uid || entry.uid,
            url: entry.url,
            etag: entry.etag,
            accountId: LOCAL_CONTACTS_ACCOUNT,
            addressBookUrl: LOCAL_BOOK_URL
          });
      }
      return { contacts: out, addressBooks: [{ ...book }], errors: [] };
    },
    /** `contact` must already be validated (validateContact). */
    async save({ url = null, etag: givenEtag = null, uid = null, contact }) {
      let entry;
      if (url) {
        entry = entryOf(url);
        if (givenEtag && givenEtag !== entry.etag)
          throw fail('Der Kontakt wurde zwischenzeitlich geändert. Bitte neu laden.', 'contact_conflict', 409);
        Object.assign(entry, { data: buildVCard(contact, entry.uid), etag: etag() });
      } else entry = add(contact, uid || randomUUID());
      await persist();
      return { ok: true, url: entry.url };
    },
    async delete(url, givenEtag = null) {
      const entry = state.contacts.find(c => c.url === url);
      if (!entry) return { ok: true };
      if (givenEtag && givenEtag !== entry.etag)
        throw fail('Der Kontakt wurde zwischenzeitlich geändert. Bitte neu laden.', 'contact_conflict', 409);
      state.contacts = state.contacts.filter(c => c !== entry);
      await persist();
      return { ok: true };
    },
    /** Adds several validated contacts with one write. */
    async importMany(contacts) {
      if (state.contacts.length + contacts.length > MAX_CONTACTS)
        throw fail('Das Adressbuch auf diesem Gerät ist voll.', 'contact_limit');
      for (const contact of contacts) add(contact, randomUUID());
      await persist();
      return { imported: contacts.length };
    },
    flush: () => writing
  };
}
