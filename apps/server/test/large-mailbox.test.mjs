// AUD-011: bounded work per page and per index run on 100k-message folders.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { listMessages, searchFolder, uidsBefore } from '../src/mailbox.mjs';
import { createLocalIndex as openIndex, entryKey } from '../src/local-index.mjs';
import { syntheticMailbox } from './helpers/synthetic-mailbox.mjs';

// Every index a test opens is closed before its directory is removed (Windows keeps open
// database files locked).
const opened = [];
const createLocalIndex = options => {
  const index = openIndex(options);
  opened.push(index);
  return index;
};
function cleanup(dir) {
  for (const index of opened.splice(0)) index.close();
  rmSync(dir, { recursive: true, force: true });
}

const PAGE = 40;

test('Older pages of a 100k folder never ask for every UID below the cursor', async () => {
  const client = syntheticMailbox(100_000, { textChars: 200 });
  const first = await listMessages(client, 'INBOX', { limit: PAGE });
  assert.equal(first.messages[0].uid, 100_000);
  const cursor = first.nextBeforeUid;
  // Page from the top, the middle and the very end of the folder.
  for (const start of [cursor, 50_000, 120]) {
    client.resetStats();
    const page = await listMessages(client, 'INBOX', { limit: PAGE, beforeUid: start });
    assert.equal(page.messages.length, Math.min(PAGE, start - 1));
    assert.equal(page.messages[0].uid, start - 1);
    assert.ok(client.stats.searchUids <= 4 * PAGE, `UIDs per page: ${client.stats.searchUids}`);
    assert.ok(client.stats.searches <= 2, `searches per page: ${client.stats.searches}`);
  }
  const last = await listMessages(client, 'INBOX', { limit: PAGE, beforeUid: 30 });
  assert.equal(last.messages.length, 29);
  assert.equal(last.hasMore, false);
  assert.equal(last.nextBeforeUid, null);
});

test('Windowing stays exact with sparse UIDs and finds the end of the folder', async () => {
  // Every second UID expunged, then a large hole.
  const client = syntheticMailbox(30_000, { gapEvery: 2 });
  for (let uid = 20_001; uid <= 50_000; uid++) client.expunge(uid);
  const below = 50_500;
  const { uids, more, rounds } = await uidsBefore(client, below, PAGE, client.mailbox);
  const expected = client.uids
    .filter(uid => uid < below)
    .slice(-PAGE)
    .reverse();
  assert.deepEqual(uids, expected);
  assert.equal(more, true);
  assert.ok(rounds <= 12, `rounds: ${rounds}`);
  const tail = await uidsBefore(client, 6, PAGE, client.mailbox);
  assert.deepEqual(tail.uids, [5, 3, 1]);
  assert.equal(tail.more, false);
  assert.deepEqual(await uidsBefore(client, 1, PAGE), { uids: [], more: false, rounds: 0, transferred: 0 });
});

test('IMAP search on later pages only covers UIDs below the cursor', async () => {
  const client = syntheticMailbox(5_000);
  const first = await searchFolder(client, 'INBOX', 'Rechnung', { limit: 10 });
  assert.equal(first.messages.length, 10);
  client.resetStats();
  const next = await searchFolder(client, 'INBOX', 'Rechnung', { limit: 10, beforeUid: first.nextBeforeUid });
  assert.ok(next.messages.every(m => m.uid < first.nextBeforeUid));
  assert.ok(client.stats.searchUids < first.total, 'the already shown part is not sent again');
});

test('Index: unchanged folders skip the full UID listing; changes are still picked up', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'lv-big-'));
  t.after(() => cleanup(dir));
  const key = randomBytes(32);
  const index = createLocalIndex({ dir, getKey: async () => key, maxPerAccount: 3_000 });
  const client = syntheticMailbox(2_000, { textChars: 300 });
  const folders = [{ path: 'INBOX', flags: new Set() }];
  const first = await index.sync(client, 'acc', folders, { budget: 5_000 });
  assert.equal(first.added, 2_000);
  client.resetStats();
  const idle = await index.sync(client, 'acc', folders);
  assert.equal(idle.skipped, 1);
  assert.equal(client.stats.searchUids, 0, 'no UID listing for an unchanged folder');
  client.expunge(1_000);
  const uid = client.append();
  const changed = await index.sync(client, 'acc', folders);
  assert.equal(changed.added, 1);
  assert.equal(changed.removed, 1);
  assert.equal((await index.search(['acc'], `${uid}`)).length, 1);
});

test('Index: a folder cut short by the budget keeps syncing although nothing changed', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'lv-big-'));
  t.after(() => cleanup(dir));
  const index = createLocalIndex({ dir, getKey: async () => Buffer.alloc(32, 1) });
  const client = syntheticMailbox(300, { textChars: 50 });
  const folders = [{ path: 'INBOX', flags: new Set() }];
  assert.equal((await index.sync(client, 'acc', folders, { budget: 200 })).added, 200);
  const rest = await index.sync(client, 'acc', folders, { budget: 200 });
  assert.equal(rest.added, 100);
  assert.equal((await index.sync(client, 'acc', folders)).skipped, 1);
});

test('Index search pages newest first with an exact total', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'lv-big-'));
  t.after(() => cleanup(dir));
  const index = createLocalIndex({ dir, getKey: async () => Buffer.alloc(32, 2) });
  const client = syntheticMailbox(1_600, { textChars: 0 }); // subjects only
  await index.sync(client, 'acc', [{ path: 'INBOX', flags: new Set() }], { budget: 5_000 });
  // Subjects cycle through 16 words: 100 messages say "Rechnung".
  const first = await index.searchPage(['acc'], 'rechnung', { limit: 40 });
  assert.equal(first.total, 100);
  assert.equal(first.messages.length, 40);
  assert.equal(first.nextCursor, '40');
  const dates = first.messages.map(m => m.date);
  assert.deepEqual(dates, [...dates].sort().reverse());
  const rest = await index.searchPage(['acc'], 'rechnung', { limit: 80, cursor: first.nextCursor });
  assert.equal(rest.messages.length, 60);
  assert.equal(rest.nextCursor, null);
  const seen = new Set([...first.messages, ...rest.messages].map(m => m.uid));
  assert.equal(seen.size, 100, 'no duplicates across pages');
  assert.equal((await index.searchPage(['acc'], 'rechnung', { limit: 10_000 })).messages.length, 100);
  assert.equal((await index.search(['acc'], 'rechnung', { limit: 5 })).length, 5, 'search() stays an array');
});

test('Index: entries() and removedKeys() report changes incrementally', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'lv-big-'));
  t.after(() => cleanup(dir));
  const key = Buffer.alloc(32, 3);
  const index = createLocalIndex({ dir, getKey: async () => key });
  const client = syntheticMailbox(50, { textChars: 80 });
  const folders = [{ path: 'INBOX', flags: new Set() }];
  const before = Date.now() - 1;
  assert.equal(await index.removedKeys('acc', before - 60_000), null, 'no history before the index existed');
  await index.sync(client, 'acc', folders);
  const all = [];
  for await (const e of index.entries('acc')) all.push(e);
  assert.equal(all.length, 50);
  assert.equal(all[0].key, entryKey('INBOX', '4242', all[0].uid));
  assert.ok(all.every(e => e.updatedAt >= before && typeof e.text === 'string'));
  const { generation } = await index.status('acc');
  const mark = Math.max(...all.map(e => e.updatedAt));
  await new Promise(resolve => setTimeout(resolve, 5));
  client.expunge(7);
  const added = client.append();
  await index.sync(client, 'acc', folders);
  const fresh = [];
  for await (const e of index.entries('acc', { since: mark })) fresh.push(e.uid);
  assert.deepEqual(fresh, [added]);
  assert.deepEqual(await index.removedKeys('acc', mark), [entryKey('INBOX', '4242', 7)]);
  // Survives a restart; the generation only changes when the index is rebuilt.
  const reopened = createLocalIndex({ dir, getKey: async () => key });
  assert.equal((await reopened.status('acc')).generation, generation);
  assert.deepEqual(await reopened.removedKeys('acc', mark), [entryKey('INBOX', '4242', 7)]);
  await reopened.clear('acc');
  assert.notEqual((await reopened.status('acc')).generation, generation);
});
