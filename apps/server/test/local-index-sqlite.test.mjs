// Encrypted SQLite index: migration from the old file, key and identity handling, word/substring
// search and the vector store for the AI assistant.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createLocalIndex, encrypt, entryKey } from '../src/local-index.mjs';
import { syntheticMailbox } from './helpers/synthetic-mailbox.mjs';

const INBOX = [{ path: 'INBOX', flags: new Set() }];

function mailbox(messages, uidValidity = 7) {
  return {
    mailbox: { exists: messages.length, uidValidity, uidNext: (messages.at(-1)?.uid || 0) + 1 },
    getMailboxLock: async () => ({ release() {} }),
    search: async () => messages.map(m => m.uid),
    async *fetch(uids, query) {
      if (!Array.isArray(uids)) return;
      for (const uid of uids) {
        const m = messages.find(x => x.uid === uid);
        if (!m) continue;
        if (query.bodyParts) yield { uid, bodyParts: new Map([['1', Buffer.from(m.text || '')]]) };
        else
          yield {
            uid,
            envelope: { subject: m.subject, from: [{ name: m.from || 'A', address: 'a@example.invalid' }], to: [] },
            internalDate: new Date(m.date || '2026-11-01'),
            flags: new Set(),
            bodyStructure: { type: 'text/plain' }
          };
      }
    }
  };
}

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'lv-sql-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('An index file from before 2.3 is migrated once and then deleted', async t => {
  const dir = tempDir(t);
  const key = randomBytes(32);
  const legacy = {
    version: 1,
    identity: 'box-A',
    folders: {
      INBOX: {
        uidValidity: '7',
        items: {
          3: {
            d: '2026-10-01T00:00:00.000Z',
            f: 'Anna',
            fe: 'a@x',
            fn: 'Anna',
            t: '',
            s: 'Steuerberater',
            a: false,
            r: true,
            x: 'Unterlagen bitte',
            u: 5
          }
        }
      }
    },
    updatedAt: '2026-10-02T00:00:00.000Z'
  };
  writeFileSync(join(dir, 'acc.lvx'), encrypt(key, legacy));
  const index = createLocalIndex({ dir, getKey: async () => key, getIdentity: () => 'box-A' });
  const hits = await index.search(['acc'], 'steuerberater');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].uid, 3);
  assert.equal(hits[0].unread, true);
  assert.ok(!existsSync(join(dir, 'acc.lvx')), 'old file removed after the migration');
  const keys = [];
  for await (const e of index.entries('acc')) keys.push(e.key);
  assert.deepEqual(keys, [entryKey('INBOX', '7', 3)]);
});

test('An old file of another mailbox is not migrated', async t => {
  const dir = tempDir(t);
  const key = randomBytes(32);
  writeFileSync(
    join(dir, 'acc.lvx'),
    encrypt(key, {
      version: 1,
      identity: 'box-A',
      folders: { INBOX: { uidValidity: '7', items: { 1: { s: 'Gehalt', x: '' } } } }
    })
  );
  const index = createLocalIndex({ dir, getKey: async () => key, getIdentity: () => 'box-B' });
  assert.deepEqual(await index.search(['acc'], 'gehalt'), []);
  assert.ok(!existsSync(join(dir, 'acc.lvx')));
});

test('A wrong key starts an empty index instead of failing; no plain text on disk', async t => {
  const dir = tempDir(t);
  const key = randomBytes(32);
  const index = createLocalIndex({ dir, getKey: async () => key });
  await index.sync(mailbox([{ uid: 1, subject: 'Vertraulich Kündigung', text: 'Geheimer Inhalt' }]), 'acc', INBOX);
  index.close();
  for (const f of readdirSync(dir)) {
    const bytes = readFileSync(join(dir, f));
    for (const word of ['Vertraulich', 'vertraulich', 'Geheimer', 'geheimer', 'SQLite format 3'])
      assert.ok(!bytes.includes(Buffer.from(word)), `${word} in ${f}`);
  }
  const other = createLocalIndex({ dir, getKey: async () => randomBytes(32) });
  assert.equal((await other.status('acc')).messages, 0);
  assert.deepEqual(await other.search(['acc'], 'vertraulich'), []);
});

test('Search: word beginnings anywhere, substrings in subject and sender, umlauts and ß', async t => {
  const dir = tempDir(t);
  const index = createLocalIndex({ dir, getKey: async () => Buffer.alloc(32, 9) });
  await index.sync(
    mailbox([
      { uid: 1, subject: 'Stromrechnung Oktober', text: 'Bitte überweisen', date: '2026-10-01' },
      { uid: 2, subject: 'Hallo', from: 'Jörg Weiß', text: 'Die Rechnungsnummer steht unten', date: '2026-10-02' },
      { uid: 3, subject: 'Termin', text: 'Treffen in der Straße', date: '2026-10-03' }
    ]),
    'acc',
    INBOX
  );
  const uids = async q => (await index.search(['acc'], q)).map(h => h.uid);
  assert.deepEqual(await uids('rechnung'), [2, 1], 'prefix in text, substring in subject');
  assert.deepEqual(await uids('UBERWEISEN'), [1]);
  assert.deepEqual(await uids('weiss'), [2]);
  assert.deepEqual(await uids('strasse'), [3]);
  assert.deepEqual(await uids('termin treffen'), [3]);
  assert.deepEqual(await uids('termin rechnung'), []);
  assert.deepEqual(await uids('"x" OR *'), [], 'FTS syntax in the query is treated as text');
  assert.equal((await index.searchPage(['acc'], 'rechnung', { folder: 'Other' })).total, 0);
});

test('Vectors: stored per model, nearest first, removed with their message', async t => {
  const dir = tempDir(t);
  const index = createLocalIndex({ dir, getKey: async () => Buffer.alloc(32, 4) });
  const client = syntheticMailbox(30, { textChars: 40 });
  await index.sync(client, 'acc', INBOX);
  const entries = [];
  for await (const e of index.entries('acc')) entries.push(e);
  const basis = n => Float32Array.from({ length: 32 }, (_, i) => (i === n ? 1 : 0.01 * i));
  const put = await index.putVectors(
    'acc',
    'qwen3-embedding:0.6b',
    entries
      .map((e, n) => ({ key: e.key, vector: basis(n) }))
      .concat([{ key: 'INBOX\u00004242\u0000999', vector: basis(1) }])
  );
  assert.deepEqual(put, { stored: 30, skipped: 1 }, 'unknown key skipped');
  assert.equal(
    (await index.putVectors('acc', 'qwen3-embedding:0.6b', [{ key: entries[0].key, vector: [1, 2] }])).skipped,
    1
  );
  await assert.rejects(index.putVectors('acc', 'bad model name!', []), /Modellname/);
  const hits = await index.searchVectors('acc', 'qwen3-embedding:0.6b', basis(3), { limit: 4 });
  assert.equal(hits.length, 4);
  assert.ok(
    hits.every((h, i) => i === 0 || h.score <= hits[i - 1].score),
    'sorted by score'
  );
  assert.equal(hits[0].key, entries[3].key);
  assert.ok(hits[0].score > 0.98 && hits[0].score <= 1.01);
  assert.deepEqual(await index.searchVectors('acc', 'other-model', basis(3)), []);
  // The message of the best hit disappears from the server: its vector goes with it.
  client.expunge(entries[3].uid);
  await index.sync(client, 'acc', INBOX);
  const after = await index.searchVectors('acc', 'qwen3-embedding:0.6b', basis(3), { limit: 30 });
  assert.equal(after.length, 29);
  assert.ok(!after.some(h => h.key === entries[3].key));
  assert.equal((await index.status('acc')).vectors, 29);
  assert.deepEqual(await index.dropVectors('acc', 'qwen3-embedding:0.6b'), { removed: 29 });
  assert.deepEqual(await index.searchVectors('acc', 'qwen3-embedding:0.6b', basis(3)), []);
});

test('Vectors are gone after the index is cleared or the mailbox changes', async t => {
  const dir = tempDir(t);
  let identity = 'box-A';
  const index = createLocalIndex({ dir, getKey: async () => Buffer.alloc(32, 5), getIdentity: () => identity });
  await index.sync(mailbox([{ uid: 1, subject: 'Hallo' }]), 'acc', INBOX);
  const [entry] = await Array.fromAsync(index.entries('acc'));
  await index.putVectors('acc', 'bge-m3', [{ key: entry.key, vector: [1, 0, 0] }]);
  const { generation } = await index.status('acc');
  identity = 'box-B';
  index.unload('acc');
  assert.notEqual((await index.status('acc')).generation, generation);
  assert.deepEqual(await index.searchVectors('acc', 'bge-m3', [1, 0, 0]), []);
});
