// Notes about a contact for the contact history ("mini CRM"). Kept on this device only, in
// contact-notes.json, encrypted with AES-256-GCM; the key `contact-notes-key` lives in the system
// keychain. Fail closed like the local address book: without the key the notes are unavailable,
// and an existing file is never overwritten with a new key.
// A note belongs to an email address (lower case), so it follows the person across address books
// and mail accounts, and also works for people who are not in any address book.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { atomicWrite, createWriteQueue, keychainKey, LOCAL_KEY_ACCOUNT, seal, unseal } from './local-store.mjs';

export const CONTACT_NOTES_KEY = 'contact-notes-key';
const MAX_TEXT = 5000;
const MAX_PER_CONTACT = 500;
const MAX_NOTES = 20_000;
const fail = (message, code = 'contact_note_invalid', statusCode = 400) =>
  Object.assign(new Error(message), { code, statusCode });

/** Normalized email address, or throws. */
export function contactAddress(value) {
  const email = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!email || email.length > 320 || !/^[^\s@<>"]+@[^\s@<>"]+$/.test(email))
    throw fail('Ungültige E-Mail-Adresse.', 'contact_address_invalid');
  return email;
}

function noteText(value) {
  if (typeof value !== 'string' || value.includes('\0')) throw fail('Ungültige Notiz.');
  const text = value.replace(/\r\n?/g, '\n').trim();
  if (!text) throw fail('Die Notiz ist leer.');
  if (text.length > MAX_TEXT) throw fail('Eine Notiz darf höchstens 5000 Zeichen haben.');
  return text;
}

/** Stand-in when the keychain is not available: every call reports the reason. */
export function lockedContactNotes(err) {
  const reason = () => {
    throw err;
  };
  return { available: false, list: reason, save: reason, remove: reason, forget: reason, exportAll: reason };
}

export async function createContactNotes({ filename, vault, now = () => new Date() }) {
  let raw = null;
  try {
    raw = await readFile(filename, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const exists = raw !== null && raw.trim() !== '';
  const key = keychainKey(vault, CONTACT_NOTES_KEY, { create: !exists, account: LOCAL_KEY_ACCOUNT });
  if (!key)
    throw fail(
      'Die Notizen zu Kontakten brauchen den Schlüsselbund des Systems. Er ist gerade nicht verfügbar.',
      'contact_notes_locked',
      423
    );
  let state = { notes: [] };
  if (exists) {
    try {
      const parsed = JSON.parse(unseal(key, raw));
      state = { notes: Array.isArray(parsed?.notes) ? parsed.notes : [] };
    } catch {
      throw fail(
        'Die Notizen zu Kontakten lassen sich mit dem Schlüssel aus dem Schlüsselbund nicht öffnen.',
        'contact_notes_locked',
        423
      );
    }
  }
  const writes = createWriteQueue();
  const persist = () => {
    const snapshot = seal(key, JSON.stringify(state));
    return writes.push(() => atomicWrite(filename, snapshot));
  };
  const newestFirst = (a, b) => b.createdAt.localeCompare(a.createdAt);

  return {
    available: true,
    /** Notes about one address, newest first. */
    list(email) {
      const address = contactAddress(email);
      return state.notes.filter(n => n.email === address).sort(newestFirst);
    },
    /** New note (no id) or changed text of an existing one. */
    async save({ id = null, email, text }) {
      const clean = noteText(text);
      const stamp = now().toISOString();
      let note;
      if (id) {
        note = state.notes.find(n => n.id === id);
        if (!note) throw fail('Die Notiz gibt es nicht mehr.', 'contact_note_missing', 404);
        note = { ...note, text: clean, updatedAt: stamp };
        state = { notes: state.notes.map(n => (n.id === id ? note : n)) };
      } else {
        const address = contactAddress(email);
        if (state.notes.length >= MAX_NOTES) throw fail('Es sind schon zu viele Notizen gespeichert.');
        if (state.notes.filter(n => n.email === address).length >= MAX_PER_CONTACT)
          throw fail('Höchstens 500 Notizen pro Kontakt.');
        note = { id: randomUUID(), email: address, text: clean, createdAt: stamp, updatedAt: stamp };
        state = { notes: [...state.notes, note] };
      }
      await persist();
      return note;
    },
    async remove(id) {
      if (!state.notes.some(n => n.id === id)) return;
      state = { notes: state.notes.filter(n => n.id !== id) };
      await persist();
    },
    /** Deletes every note about an address (right to erasure). Returns how many were deleted. */
    async forget(email) {
      const address = contactAddress(email);
      const before = state.notes.length;
      state = { notes: state.notes.filter(n => n.email !== address) };
      if (state.notes.length !== before) await persist();
      return before - state.notes.length;
    },
    /** All notes (data export). */
    exportAll: () => [...state.notes].sort((a, b) => a.email.localeCompare(b.email) || newestFirst(a, b)),
    flush: () => writes.flush()
  };
}
