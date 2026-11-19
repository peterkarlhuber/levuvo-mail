// Spaces on the shared storage layer (ARC-LEV-003): one at-rest format with the other local files,
// a migration of the files written by versions up to 2.3, and fail-closed behaviour throughout.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { unseal } from '../src/local-store.mjs';
import { createIdentity, seal as e2eSeal } from '../src/spaces/crypto.mjs';
import { isLegacyBox, openSpaceStore } from '../src/spaces/store.mjs';

const vault = () => {
  const m = new Map();
  return { available: true, get: (i, k) => m.get(`${i}:${k}`) || '', set: (i, k, v) => m.set(`${i}:${k}`, v) };
};

const tempDir = t => {
  const dir = mkdtempSync(join(tmpdir(), 'lv-spaces-store-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

/** A spaces folder exactly as versions up to 2.3 wrote it (base64url envelope, bound to the name). */
function legacyFolder(dir, { spaces, index }) {
  const keys = vault();
  const hex = randomBytes(32).toString('hex');
  keys.set('local', 'spaces-key', hex);
  keys.set('local', 'spaces-identity', JSON.stringify(createIdentity()));
  const key = Buffer.from(hex, 'hex');
  const write = (file, value, aad) =>
    writeFileSync(join(dir, file), JSON.stringify({ v: 1, ...e2eSeal(key, JSON.stringify(value), aad) }));
  mkdirSync(dir, { recursive: true });
  for (const record of spaces) write(`${record.id}.lvs`, record, `space.${record.id}`);
  if (index) write('index.lvs', index, 'spaces.index');
  return { keys, key };
}

const boxOf = file => JSON.parse(readFileSync(file, 'utf8'));
const A = 'a'.repeat(32);
const B = 'b'.repeat(32);

test('Spaces store: files of versions up to 2.3 open and are rewritten in the shared format', async t => {
  const dir = tempDir(t);
  const spaceA = { id: A, name: 'Projekt', ops: [{ id: 1, t: 'note' }], outbox: [] };
  const spaceB = { id: B, name: 'Kunde', ops: [], outbox: [{ to: 'ben@example.org' }] };
  const index = { invitations: [{ space: B, from: 'anna@example.org' }], cursors: { acc: { INBOX: 42 } } };
  const { keys, key } = legacyFolder(dir, { spaces: [spaceA, spaceB], index });
  mkdirSync(join(dir, 'blobs'));
  writeFileSync(join(dir, 'blobs', `${'c'.repeat(32)}.0`), 'chunk-bytes');
  assert.ok(isLegacyBox(boxOf(join(dir, `${A}.lvs`))), 'fixture is in the old format');

  const store = await openSpaceStore({ dir, vault: keys });
  assert.deepEqual(store.get(A), spaceA);
  assert.deepEqual(store.get(B), spaceB);
  assert.deepEqual(store.index(), index);
  assert.equal(String(await store.getChunk('c'.repeat(32), 0)), 'chunk-bytes', 'chunks are left as they are');

  // Every file is now in the format of local-store.mjs, still bound to its own name.
  for (const [file, aad, value] of [
    [`${A}.lvs`, `space.${A}`, spaceA],
    [`${B}.lvs`, `space.${B}`, spaceB],
    ['index.lvs', 'spaces.index', index]
  ]) {
    const box = boxOf(join(dir, file));
    assert.equal(isLegacyBox(box), false, `${file} migrated`);
    assert.deepEqual(JSON.parse(unseal(key, box, aad)), value);
    assert.throws(() => unseal(key, box), 'not readable without its context');
  }
  assert.equal(keys.get('local', 'spaces-key'), key.toString('hex'), 'the key stays the same');

  // A second start reads the migrated files and changes nothing.
  const before = readFileSync(join(dir, `${A}.lvs`), 'utf8');
  const again = await openSpaceStore({ dir, vault: keys });
  assert.deepEqual(again.get(A), spaceA);
  assert.deepEqual(again.index(), index);
  assert.equal(readFileSync(join(dir, `${A}.lvs`), 'utf8'), before);
});

test('Spaces store: a folder with old and new files (migration cut off) opens completely', async t => {
  const dir = tempDir(t);
  const spaceA = { id: A, name: 'Neu', ops: [] };
  const spaceB = { id: B, name: 'Alt', ops: [] };
  const { keys } = legacyFolder(dir, { spaces: [spaceA, spaceB], index: { invitations: [], cursors: {} } });
  const legacyB = readFileSync(join(dir, `${B}.lvs`));
  await openSpaceStore({ dir, vault: keys });
  writeFileSync(join(dir, `${B}.lvs`), legacyB); // as if the start ended before B was rewritten
  const store = await openSpaceStore({ dir, vault: keys });
  assert.deepEqual(store.get(A), spaceA);
  assert.deepEqual(store.get(B), spaceB);
  assert.equal(isLegacyBox(boxOf(join(dir, `${B}.lvs`))), false);
});

test('Spaces store: old files with the wrong key stay locked and untouched', async t => {
  const dir = tempDir(t);
  legacyFolder(dir, { spaces: [{ id: A, name: 'Projekt' }] });
  const before = readFileSync(join(dir, `${A}.lvs`), 'utf8');
  const other = vault();
  other.set('local', 'spaces-key', randomBytes(32).toString('hex'));
  other.set('local', 'spaces-identity', JSON.stringify(createIdentity()));
  await assert.rejects(openSpaceStore({ dir, vault: other }), { code: 'spaces_locked' });
  assert.equal(readFileSync(join(dir, `${A}.lvs`), 'utf8'), before, 'no rewrite without a working key');

  const empty = vault();
  await assert.rejects(openSpaceStore({ dir, vault: empty }), { code: 'spaces_locked' });
  assert.equal(empty.get('local', 'spaces-key'), '', 'no new key for existing data');
  await assert.rejects(openSpaceStore({ dir, vault: { available: false } }), { code: 'spaces_locked' });
  assert.equal(readFileSync(join(dir, `${A}.lvs`), 'utf8'), before);
});

test('Spaces store: a space file copied over another one does not open', async t => {
  const dir = tempDir(t);
  const keys = vault();
  const store = await openSpaceStore({ dir, vault: keys });
  await store.save({ id: A, name: 'A' });
  await store.save({ id: B, name: 'B' });
  copyFileSync(join(dir, `${A}.lvs`), join(dir, `${B}.lvs`));
  await assert.rejects(openSpaceStore({ dir, vault: keys }), { code: 'spaces_locked' });
});

test('Spaces store: new files use the shared format and leftovers of cut-off writes are removed', async t => {
  const dir = tempDir(t);
  const keys = vault();
  const store = await openSpaceStore({ dir, vault: keys });
  await store.save({ id: A, name: 'A' });
  await store.saveIndex({ invitations: [], cursors: { x: 1 } });
  await store.putChunk('d'.repeat(32), 0, Buffer.from('x'));
  const key = Buffer.from(keys.get('local', 'spaces-key'), 'hex');
  assert.deepEqual(JSON.parse(unseal(key, readFileSync(join(dir, `${A}.lvs`), 'utf8'), `space.${A}`)), {
    id: A,
    name: 'A'
  });
  writeFileSync(join(dir, `${A}.lvs.0123456789ab.tmp`), 'half');
  writeFileSync(join(dir, 'blobs', `${'d'.repeat(32)}.0.01234567.tmp`), 'half');
  const again = await openSpaceStore({ dir, vault: keys });
  assert.deepEqual(again.get(A), { id: A, name: 'A' });
  assert.deepEqual(readdirSync(dir).sort(), [`${A}.lvs`, 'blobs', 'index.lvs'].sort());
  assert.deepEqual(readdirSync(join(dir, 'blobs')), [`${'d'.repeat(32)}.0`]);
});
