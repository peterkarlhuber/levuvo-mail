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
