import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createLocalIndex as openIndex, encrypt, decrypt, normalize } from '../src/local-index.mjs';

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

function mailbox(messages) {
  return {
    mailbox: { exists: messages.length, uidValidity: 7 },
    getMailboxLock: async () => ({ release() {} }),
    search: async () => messages.map(m => m.uid),
    async *fetch(uids, query) {
      for (const uid of uids) {
        const m = messages.find(x => x.uid === uid);
        if (!m) continue;
        if (query.bodyParts) yield { uid, bodyParts: new Map([['1', Buffer.from(m.text)]]) };
        else
          yield {
            uid,
            envelope: { subject: m.subject, from: [{ name: m.from, address: `${m.from.toLowerCase()}@x.at` }], to: [] },
            internalDate: new Date(m.date),
            flags: new Set(),
            bodyStructure: { type: 'text/plain' }
          };
      }
    }
  };
}

test('Index is encrypted, matches without umlauts/case, removes deleted messages', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lv-index-'));
  try {
    const key = randomBytes(32);
    const index = createLocalIndex({ dir, getKey: async () => key });
    const msgs = [
      { uid: 1, subject: 'Angebot für Müller', from: 'Anna', text: 'Die Preise für Olivenöl', date: '2026-10-01' },
      { uid: 2, subject: 'Rechnung', from: 'Max', text: 'Zahlbar bis Freitag', date: '2026-10-02' }
    ];
    await index.sync(mailbox(msgs), 'acc', [
      { path: 'INBOX', flags: new Set() },
      { path: 'INBOX.Trash', specialUse: '\\Trash', flags: new Set() }
    ]);
    const files = readdirSync(dir).filter(f => f.includes('.lvdb'));
    assert.ok(files.length >= 1);
    for (const f of files) {
      const bytes = readFileSync(join(dir, f));
      for (const word of ['Olivenöl', 'olivenol', 'Rechnung', 'rechnung', 'SQLite format'])
        assert.ok(!bytes.includes(Buffer.from(word)), `"${word}" not in plain text in ${f}`);
    }
    assert.deepEqual(
      (await index.search(['acc'], 'MULLER olivenol')).map(h => h.uid),
      [1]
    );
    assert.deepEqual(
      (await index.search(['acc'], 'rechnung')).map(h => h.uid),
      [2]
    );
    const reopened = createLocalIndex({ dir, getKey: async () => key });
    assert.equal((await reopened.status('acc')).messages, 2);
    await reopened.sync(mailbox(msgs.slice(0, 1)), 'acc', [{ path: 'INBOX', flags: new Set() }]);
    assert.deepEqual(await reopened.search(['acc'], 'rechnung'), []);
    // As after a restart with a lost key: nothing else holds the file open (Windows locks it).
    for (const open of opened.splice(0)) open.close();
    const wrongKey = createLocalIndex({ dir, getKey: async () => randomBytes(32) });
    assert.equal((await wrongKey.status('acc')).messages, 0, 'wrong key → empty index');
    assert.equal((await createLocalIndex({ dir, getKey: async () => null }).status('acc')).enabled, false);
  } finally {
    cleanup(dir);
  }
});

test('Encryption detects tampering; normalization', () => {
  const key = randomBytes(32);
  const blob = encrypt(key, { a: 1 });
  assert.deepEqual(decrypt(key, blob), { a: 1 });
  blob[blob.length - 1] ^= 1;
  assert.throws(() => decrypt(key, blob));
  assert.equal(normalize('Größe Ärger'), 'grosse arger');
});

test('An unchanged sync writes nothing to the database', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lv-index-'));
  try {
    const key = randomBytes(32);
    const index = createLocalIndex({ dir, getKey: async () => key });
    const msgs = [{ uid: 1, subject: 'Hallo', from: 'Anna', text: 'Text', date: '2026-10-01' }];
    const folders = [{ path: 'INBOX', flags: new Set() }];
    await index.sync(mailbox(msgs), 'acc', folders);
    const snapshot = () =>
      readdirSync(dir)
        .filter(f => f.includes('.lvdb'))
        .sort()
        .map(f => {
          const s = statSync(join(dir, f));
          return `${f}:${s.size}:${s.mtimeMs}`;
        })
        .join('|');
    const first = snapshot();
    await index.sync(mailbox(msgs), 'acc', folders);
    assert.equal(snapshot(), first, 'unchanged index is not written');
    await index.sync(
      mailbox([...msgs, { uid: 2, subject: 'Neu', from: 'Max', text: 'x', date: '2026-10-02' }]),
      'acc',
      folders
    );
    assert.notEqual(snapshot(), first, 'a new message is saved');
    assert.equal((await index.search(['acc'], 'neu')).length, 1);
  } finally {
    cleanup(dir);
  }
});

function flagMailbox(messages, { condstore = false } = {}) {
  const state = { modseq: 10n, fetches: [] };
  const client = {
    enabled: new Set(condstore ? ['CONDSTORE'] : []),
    get mailbox() {
      return {
        exists: messages.length,
        uidValidity: 7,
        ...(condstore ? { highestModseq: state.modseq } : {})
      };
    },
    getMailboxLock: async () => ({ release() {} }),
    search: async () => messages.map(m => m.uid),
    async *fetch(range, query, options = {}) {
      state.fetches.push({ range, changedSince: options.changedSince });
      const list =
        range === '1:*'
          ? messages.filter(m => !options.changedSince || m.modseq > options.changedSince)
          : messages.filter(m => range.includes(m.uid));
      for (const m of list) {
        if (query.bodyParts) yield { uid: m.uid, bodyParts: new Map([['1', Buffer.from(m.text)]]) };
        else
          yield {
            uid: m.uid,
            envelope: { subject: m.subject, from: [{ name: 'A', address: 'a@x.at' }], to: [] },
            internalDate: new Date('2026-11-18T10:00:00Z'),
            flags: new Set(m.flags),
            bodyStructure: { type: 'text/plain' }
          };
      }
    }
  };
  return { client, state };
}

test('Index: read/unread changes from other devices reach the offline search (AUD-007)', async t => {
  for (const condstore of [false, true]) {
    const dir = mkdtempSync(join(tmpdir(), 'lv-idx-'));
    t.after(() => cleanup(dir));
    const key = randomBytes(32);
    const index = createLocalIndex({ dir, getKey: async () => key });
    const messages = [{ uid: 1, subject: 'Rechnung Oktober', text: 'x', flags: [], modseq: 5n }];
    const { client, state } = flagMailbox(messages, { condstore });
    await index.sync(client, 'acc', [{ path: 'INBOX', flags: new Set() }]);
    assert.equal((await index.search(['acc'], 'rechnung'))[0].unread, true);
    // Read on the phone: same UID, new flags.
    messages[0].flags = ['\\Seen'];
    messages[0].modseq = 11n;
    state.modseq = 11n;
    await index.sync(client, 'acc', [{ path: 'INBOX', flags: new Set() }]);
    assert.equal((await index.search(['acc'], 'rechnung'))[0].unread, false, `condstore=${condstore}`);
    if (condstore) assert.equal(state.fetches.at(-1).changedSince, 10n, 'only changes since the last run');
    // Survives a restart (the change was saved).
    const again = createLocalIndex({ dir, getKey: async () => key });
    assert.equal((await again.search(['acc'], 'rechnung'))[0].unread, false);
  }
});

test('Index: data of a previous mailbox never shows up after the account changes (AUD-003)', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'lv-idx-'));
  t.after(() => cleanup(dir));
  const key = randomBytes(32);
  let identity = 'mailbox-A';
  const index = createLocalIndex({ dir, getKey: async () => key, getIdentity: () => identity });
  // Mailbox A and mailbox B use the same folder, UIDVALIDITY and UID.
  const a = flagMailbox([{ uid: 1, subject: 'Vertraulich Gehalt', text: 'a', flags: [] }]);
  await index.sync(a.client, 'acc', [{ path: 'INBOX', flags: new Set() }]);
  assert.equal((await index.search(['acc'], 'gehalt')).length, 1);
  // Same account ID, now pointing to another login.
  identity = 'mailbox-B';
  index.unload('acc');
  assert.equal((await index.search(['acc'], 'gehalt')).length, 0, 'old index is not used');
  const b = flagMailbox([{ uid: 1, subject: 'Newsletter', text: 'b', flags: [] }]);
  await index.sync(b.client, 'acc', [{ path: 'INBOX', flags: new Set() }]);
  assert.equal((await index.search(['acc'], 'gehalt')).length, 0);
  assert.equal((await index.search(['acc'], 'newsletter')).length, 1);
  // Also after a restart: the file now belongs to mailbox B.
  const restarted = createLocalIndex({ dir, getKey: async () => key, getIdentity: () => 'mailbox-B' });
  assert.equal((await restarted.search(['acc'], 'gehalt')).length, 0);
  assert.equal((await restarted.search(['acc'], 'newsletter')).length, 1);
});
