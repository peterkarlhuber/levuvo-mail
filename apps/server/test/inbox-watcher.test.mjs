import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createWatcherPool, accountFingerprint } from '../src/inbox-watcher.mjs';

function fakeImap(state) {
  const client = new EventEmitter();
  client.mailbox = { exists: state.uids.length, uidValidity: 9, uidNext: state.uids.at(-1) + 1 };
  client.connect = async () => {
    state.connects++;
    if (state.failConnect) throw Object.assign(new Error('x'), { code: 'ECONNREFUSED' });
  };
  client.mailboxOpen = async (path, opts) => {
    state.opened.push([path, opts.readOnly]);
  };
  client.getMailboxLock = async () => ({ release() {} });
  client.fetch = async function* (range) {
    if (typeof range !== 'string') return;
    for (const uid of state.uids) yield { uid, envelope: { subject: `S${uid}` }, flags: new Set(), bodyStructure: {} };
  };
  client.search = async () => [];
  client.logout = async () => {
    client.emit('close');
  };
  client.close = () => client.emit('close');
  state.clients.push(client);
  return client;
}
const account = (id, password = 'p') => ({
  id,
  imap: { configured: true, host: 'h', port: 993, user: `${id}@x.at`, password }
});
const wait = ms => new Promise(r => setTimeout(r, ms));

test('Watcher keeps a read-only IDLE connection and refreshes on EXISTS', async () => {
  const state = { uids: [1, 2, 3], connects: 0, opened: [], clients: [] };
  const pool = createWatcherPool({ clientFactory: () => fakeImap(state) });
  pool.sync([account('a')]);
  await wait(30);
  assert.equal(state.connects, 1);
  assert.deepEqual(state.opened, [['INBOX', true]]);
  assert.equal(pool.snapshot('a').highestUid, 3);
  state.uids.push(4);
  state.clients[0].mailbox.exists = 4;
  state.clients[0].mailbox.uidNext = 5;
  state.clients[0].emit('exists', { count: 4 });
  await wait(600);
  assert.equal(pool.snapshot('a').highestUid, 4);
  assert.equal(pool.snapshot('a').source, 'idle');
  pool.stopAll();
});

test('Changed credentials create a new connection, removed accounts are stopped', async () => {
  const state = { uids: [1], connects: 0, opened: [], clients: [] };
  const pool = createWatcherPool({ clientFactory: () => fakeImap(state) });
  pool.sync([account('a'), account('b')]);
  await wait(30);
  assert.equal(pool.size, 2);
  pool.sync([account('a', 'neu')]);
  await wait(30);
  assert.equal(pool.size, 1);
  assert.equal(state.connects, 3);
  assert.notEqual(accountFingerprint(account('a')), accountFingerprint(account('a', 'neu')));
  pool.stopAll();
});

test('Without a connection there is no (stale) snapshot', async () => {
  const state = { uids: [1], connects: 0, opened: [], clients: [], failConnect: true };
  const pool = createWatcherPool({ clientFactory: () => fakeImap(state) });
  pool.sync([account('a')]);
  await wait(30);
  assert.equal(pool.snapshot('a'), null);
  assert.equal(pool.status('a').healthy, false);
  assert.match(pool.status('a').error, /nicht erreichbar/);
  pool.stopAll();
});

test('Snapshot time is the start of the IMAP read, not its end', async () => {
  const state = { uids: [1, 2], connects: 0, opened: [], clients: [] };
  let gate = null;
  const pool = createWatcherPool({
    clientFactory: () => {
      const client = fakeImap(state);
      const fetch = client.fetch;
      client.fetch = async function* (range) {
        if (gate) await gate.promise;
        yield* fetch(range);
      };
      return client;
    }
  });
  pool.sync([account('a')]);
  await wait(30);
  let open;
  gate = { promise: new Promise(r => (open = r)) };
  const before = Date.now();
  const done = pool.refresh('a');
  await wait(60);
  gate = null;
  open();
  await done;
  assert.ok(pool.snapshot('a').checkedAt <= before + 20, 'checkedAt must be the start time');
  pool.stopAll();
});

test('refresh() waits for a refresh that started after the call', async () => {
  const state = { uids: [1, 2], connects: 0, opened: [], clients: [] };
  let gate = null;
  let fetches = 0;
  const pool = createWatcherPool({
    clientFactory: () => {
      const client = fakeImap(state);
      const fetch = client.fetch;
      client.fetch = async function* (range) {
        if (typeof range === 'string') fetches++;
        if (gate) await gate.promise;
        yield* fetch(range);
      };
      return client;
    }
  });
  pool.sync([account('a')]);
  await wait(30);
  const initial = fetches;
  let open;
  gate = { promise: new Promise(r => (open = r)) };
  // A refresh is running (it read the mailbox before the change below) ...
  const first = pool.refresh('a');
  await wait(10);
  state.uids.push(3);
  // ... so a caller asking now must get a newer snapshot, not the running one.
  let secondDone = false;
  const second = pool.refresh('a').then(() => (secondDone = true));
  const third = pool.refresh('a');
  await wait(20);
  assert.equal(secondDone, false);
  gate = null;
  open();
  await Promise.all([first, second, third]);
  assert.equal(pool.snapshot('a').highestUid, 3);
  // The running refresh plus exactly one queued refresh for both waiting callers.
  assert.equal(fetches - initial, 2);
  pool.stopAll();
});
