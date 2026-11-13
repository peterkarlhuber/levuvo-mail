import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listMessages,
  searchFolder,
  monitorInbox,
  validateSearchQuery,
  completeFetchResults
} from '../src/mailbox.mjs';

// Fake IMAP mailbox with UIDs 1..n; exposes the calls the code makes.
function fakeClient(n, { gaps = [] } = {}) {
  const uids = Array.from({ length: n }, (_, i) => i + 1).filter(u => !gaps.includes(u));
  const log = [];
  const envelope = uid => ({
    uid,
    seq: uids.indexOf(uid) + 1,
    envelope: { subject: `S${uid}`, from: [{ name: 'A', address: 'a@x.at' }], to: [] },
    flags: new Set(uid % 2 ? [] : ['\\Seen']),
    bodyStructure: { type: 'text/plain' }
  });
  return {
    log,
    mailbox: { exists: uids.length, uidValidity: 42n, uidNext: n + 1 },
    async getMailboxLock(path, opts) {
      log.push(['lock', path, opts?.readOnly]);
      return {
        release() {
          log.push(['release']);
        }
      };
    },
    async *fetch(range, query, opts) {
      if (query.bodyParts) {
        for (const uid of range) yield { uid, bodyParts: new Map([['1', Buffer.from(`P${uid}`)]]) };
        return;
      }
      let list;
      if (opts?.uid) list = range;
      else {
        const [a, b] = range.split(':').map(Number);
        list = uids.slice(a - 1, b);
      }
      log.push(['fetch', opts?.uid ? 'uid' : 'seq', list.length]);
      for (const uid of list) yield envelope(uid);
    },
    async search(query) {
      log.push(['search', query]);
      if (query.uid) {
        const [, max] = query.uid.split(':').map(Number);
        return uids.filter(u => u <= max);
      }
      if (query.seen === false) return uids.filter(u => u % 2);
      if (query.text) return uids.filter(u => u % 3 === 0);
      return uids;
    }
  };
}

test('First page returns the newest messages, locked read-only', async () => {
  const c = fakeClient(75);
  const page = await listMessages(c, 'INBOX', { limit: 40 });
  assert.equal(page.messages.length, 40);
  assert.equal(page.messages[0].uid, 75);
  assert.equal(page.messages.at(-1).uid, 36);
  assert.equal(page.hasMore, true);
  assert.equal(page.nextBeforeUid, 36);
  assert.equal(page.messages[0].preview, 'P75');
  assert.deepEqual(c.log[0], ['lock', 'INBOX', true]);
  assert.equal(c.log.at(-1)[0], 'release');
});

test('Following pages use UIDs and stay correct with gaps', async () => {
  const c = fakeClient(75, { gaps: [30, 31, 32] });
  const page = await listMessages(c, 'INBOX', { limit: 40, beforeUid: 36 });
  assert.equal(page.messages.length, 32);
  assert.equal(page.messages[0].uid, 35);
  assert.ok(!page.messages.some(m => [30, 31, 32].includes(m.uid)));
  assert.equal(page.hasMore, false);
  assert.equal(page.nextBeforeUid, null);
});

test('Empty folder and search with paging', async () => {
  assert.deepEqual((await listMessages(fakeClient(0), 'X', { limit: 10 })).messages, []);
  const result = await searchFolder(fakeClient(90), 'INBOX', 'Angebot', { limit: 10 });
  assert.equal(result.total, 30);
  assert.equal(result.messages.length, 10);
  assert.equal(result.messages[0].uid, 90);
  assert.equal(result.hasMore, true);
  const next = await searchFolder(fakeClient(90), 'INBOX', 'Angebot', { limit: 10, beforeUid: result.nextBeforeUid });
  assert.equal(next.messages[0].uid, 60);
});

test('Search terms are validated', () => {
  assert.equal(validateSearchQuery('  Rechnung '), 'Rechnung');
  assert.throws(() => validateSearchQuery('a'));
  assert.throws(() => validateSearchQuery('a\u0000b'));
  assert.throws(() => validateSearchQuery('x'.repeat(81)));
});

test('Inbox status contains UIDVALIDITY, highest UID and unread count', async () => {
  const state = await monitorInbox(fakeClient(50));
  assert.equal(state.uidValidity, '42');
  assert.equal(state.highestUid, 50);
  assert.equal(state.unseen, 25);
  assert.equal(state.messages.length, 40);
  const broken = fakeClient(3);
  broken.mailbox.uidValidity = null;
  await assert.rejects(monitorInbox(broken), /UIDVALIDITY/);
});

test('Unsolicited FETCH responses during a listing never become empty extra messages', async () => {
  const c = fakeClient(5);
  const original = c.fetch;
  c.fetch = async function* (range, query, opts) {
    for await (const message of original.call(this, range, query, opts)) {
      yield message;
      // The server pushes flag updates for new mail while our FETCH runs.
      if (message.uid === 3) {
        yield { seq: 6, flags: new Set(['\\Recent']) };
        yield { seq: 3, uid: 3, flags: new Set(['\\Seen']) };
      }
    }
  };
  const state = await monitorInbox(c);
  assert.deepEqual(
    state.messages.map(m => m.uid),
    [5, 4, 3, 2, 1]
  );
  assert.ok(state.messages.every(m => m.subject.startsWith('S')));
});

test('completeFetchResults keeps one complete entry per requested UID', () => {
  const env = { subject: 'x' };
  const kept = completeFetchResults(
    [{ uid: 7, envelope: env }, { uid: 7 }, { seq: 2 }, { uid: 0, envelope: env }, { uid: 9, envelope: env }],
    [7, 8]
  );
  assert.deepEqual(
    kept.map(m => m.uid),
    [7]
  );
});
