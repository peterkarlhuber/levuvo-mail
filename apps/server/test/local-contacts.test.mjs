import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalContacts, LOCAL_BOOK_URL, LOCAL_CONTACTS_ACCOUNT } from '../src/local-contacts.mjs';
import { validateContact } from '../src/vcard.mjs';

const vault = () => {
  const m = new Map();
  return {
    available: true,
    get: (i, k) => m.get(`${i}:${k}`) || '',
    set: (i, k, v) => m.set(`${i}:${k}`, v),
    delete: (i, k) => m.delete(`${i}:${k}`)
  };
};
const tmp = t => {
  const dir = mkdtempSync(join(tmpdir(), 'lv-contacts-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'contacts-local.json');
};
const anna = validateContact({
  firstName: 'Anna',
  lastName: 'Berger',
  emails: [{ value: 'anna@example.org', type: 'work' }],
  phones: [{ value: '+43 1 234', type: 'cell' }],
  note: 'Zeile 1\nZeile 2'
});

test('Local contacts: create, edit and delete without any account, stored encrypted', async t => {
  const file = tmp(t);
  const keys = vault();
  const book = await createLocalContacts({ filename: file, vault: keys });
  const empty = book.contacts();
  assert.deepEqual(empty.contacts, []);
  assert.equal(empty.addressBooks.length, 1);
  assert.equal(empty.addressBooks[0].accountId, LOCAL_CONTACTS_ACCOUNT);
  assert.equal(empty.addressBooks[0].url, LOCAL_BOOK_URL);

  const { url } = await book.save({ contact: anna });
  await book.flush();
  const raw = readFileSync(file, 'utf8');
  assert.doesNotMatch(raw, /Anna|anna@example\.org/, 'content is encrypted');
  assert.match(raw, /"v":1/);

  const [saved] = book.contacts().contacts;
  assert.equal(saved.name, 'Anna Berger');
  assert.equal(saved.emails[0].value, 'anna@example.org');
  assert.equal(saved.note, 'Zeile 1\nZeile 2');
  assert.equal(saved.url, url);
  assert.equal(saved.addressBookUrl, LOCAL_BOOK_URL);

  // An outdated etag is rejected instead of overwriting a newer change.
  await assert.rejects(
    book.save({ url, etag: '"stale"', contact: { ...anna, title: 'CEO' } }),
    e => e.code === 'contact_conflict'
  );
  await book.save({ url, etag: saved.etag, contact: { ...anna, title: 'CEO' } });
  const edited = book.contacts().contacts[0];
  assert.equal(edited.title, 'CEO');
  assert.equal(edited.uid, saved.uid, 'UID stays the same when editing');

  // Reopened with the same key: everything is still there.
  await book.flush();
  const again = await createLocalContacts({ filename: file, vault: keys });
  assert.equal(again.contacts().contacts[0].title, 'CEO');

  await again.delete(url, edited.etag);
  await again.flush();
  const third = await createLocalContacts({ filename: file, vault: keys });
  assert.deepEqual(third.contacts().contacts, []);
});

test('Local contacts: import adds many cards with one write', async t => {
  const file = tmp(t);
  const book = await createLocalContacts({ filename: file, vault: vault() });
  const r = await book.importMany([anna, validateContact({ name: 'Bernd', emails: [{ value: 'b@example.org' }] })]);
  assert.equal(r.imported, 2);
  assert.deepEqual(
    book
      .contacts()
      .contacts.map(c => c.name)
      .sort(),
    ['Anna Berger', 'Bernd']
  );
});

test('Local contacts fail closed: no keychain, missing or wrong key never wipe the file', async t => {
  const file = tmp(t);
  await assert.rejects(createLocalContacts({ filename: file, vault: null }), e => e.code === 'local_locked');
  await assert.rejects(
    createLocalContacts({ filename: file, vault: { ...vault(), available: false } }),
    e => e.code === 'local_locked'
  );

  const keys = vault();
  const book = await createLocalContacts({ filename: file, vault: keys });
  await book.save({ contact: anna });
  await book.flush();
  const before = readFileSync(file, 'utf8');

  // Key gone from the keychain: no new key is generated for the existing file.
  const lost = vault();
  await assert.rejects(createLocalContacts({ filename: file, vault: lost }), e => e.code === 'local_locked');
  assert.equal(lost.get(LOCAL_CONTACTS_ACCOUNT, 'contacts-key'), '');
  // A different key cannot open it either.
  const other = vault();
  other.set(LOCAL_CONTACTS_ACCOUNT, 'contacts-key', 'ab'.repeat(32));
  await assert.rejects(createLocalContacts({ filename: file, vault: other }), e => e.code === 'local_locked');
  assert.equal(readFileSync(file, 'utf8'), before, 'file untouched');

  // A damaged file is not replaced by an empty address book.
  writeFileSync(file, 'not json');
  await assert.rejects(createLocalContacts({ filename: file, vault: keys }), e => e.code === 'local_locked');
  assert.equal(readFileSync(file, 'utf8'), 'not json');
});

test('vCard TYPE lists: INTERNET and PREF do not hide the kind of address', async () => {
  const { parseVCard, buildVCard } = await import('../src/vcard.mjs');
  const round = parseVCard(buildVCard(anna, 'u1'));
  assert.equal(round.emails[0].type, 'work');
  const parsed = parseVCard('BEGIN:VCARD\r\nVERSION:3.0\r\nFN:X\r\nEMAIL;TYPE=INTERNET:x@example.org\r\nEND:VCARD\r\n');
  assert.equal(parsed.emails[0].type, 'other');
});
