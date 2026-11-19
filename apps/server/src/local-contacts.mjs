// Contacts "on this device": an address book that works without any CardDAV or cloud account.
// Contacts are kept as vCards (same model as CardDAV, so import/export and moving to a connected
// address book later behave identically), encrypted with AES-256-GCM. The key lives in the OS
// keychain; without it the address book is unavailable instead of silently unencrypted.
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { atomicWrite, createWriteQueue, keychainKey, seal, unseal } from './local-store.mjs';
import { buildVCard, parseVCard } from './vcard.mjs';

export const LOCAL_CONTACTS_ACCOUNT = 'local';
export const LOCAL_BOOK_URL = 'local-contacts:';
export const LOCAL_CONTACTS_LABEL = 'Auf diesem Gerät';
const KEY_NAME = 'contacts-key';
const MAX_CONTACTS = 20_000;
const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });

export const isLocalContact = url => String(url || '').startsWith(LOCAL_BOOK_URL);

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
  // A new key only while no address book file exists: a fresh key for an existing file would
  // make it unreadable and the next save would overwrite every contact.
  const key = keychainKey(vault, KEY_NAME, { create: !exists, account: LOCAL_CONTACTS_ACCOUNT });
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
      text = unseal(key, raw);
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

  const writes = createWriteQueue();
  function persist() {
    const snapshot = seal(key, JSON.stringify(state));
    return writes.push(() => atomicWrite(filename, snapshot));
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
    flush: () => writes.flush()
  };
}
