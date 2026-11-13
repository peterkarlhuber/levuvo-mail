// Unsolicited FETCH responses (flag updates the server pushes while our own FETCH runs)
// must never be mistaken for the requested message.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchUidOne, hasRequestedFields, isRequestedFetchResult, uidSet } from '../src/imap-fetch.mjs';
import { attachPreviews, createPreviewCache } from '../src/previews.mjs';
import { loadThread } from '../src/thread.mjs';
import { performMessageAction } from '../src/mail-actions.mjs';
import { snoozeMessages } from '../src/followups.mjs';
import { collectContacts } from '../src/contacts.mjs';
import { listScheduled } from '../src/scheduled.mjs';

const seenUpdate = (uid, seq = 7) => ({ seq, ...(uid ? { uid } : {}), flags: new Set(['\\Seen']) });
const lock = async () => ({ release() {} });

function fakeClient(answer, extra = {}) {
  const calls = [];
  return {
    calls,
    getMailboxLock: lock,
    async *fetch(range, query, options) {
      calls.push({ range, query, options });
      yield* answer(range, query);
    },
    ...extra
  };
}

test('fetchUidOne skips an unsolicited flags-only entry for another UID', async () => {
  const client = fakeClient(function* () {
    yield seenUpdate(41);
    yield { seq: 8, uid: 42, source: Buffer.from('Subject: right\r\n\r\nx') };
  });
  const msg = await fetchUidOne(client, '42', { source: true });
  assert.equal(msg.uid, 42);
  assert.match(msg.source.toString(), /right/);
  assert.deepEqual(client.calls[0], { range: '42', query: { source: true, uid: true }, options: { uid: true } });
});

test('fetchUidOne skips a flags-only entry for the same UID and entries without UID', async () => {
  const client = fakeClient(function* () {
    yield seenUpdate(null);
    yield seenUpdate(42);
    yield { uid: 42, size: 120, flags: new Set() };
    yield seenUpdate(42);
  });
  const msg = await fetchUidOne(client, 42, { size: true, flags: true });
  assert.equal(msg.size, 120);
  assert.equal(msg.flags.size, 0);
});

test('fetchUidOne merges partial entries for the same UID', async () => {
  const client = fakeClient(function* () {
    yield { uid: 42, flags: new Set(['\\Draft']) };
    yield { uid: 42, size: 90 };
  });
  const msg = await fetchUidOne(client, 42, { size: true, flags: true });
  assert.equal(msg.size, 90);
  assert.ok(msg.flags.has('\\Draft'));
});

test('fetchUidOne returns null when only unsolicited entries arrive', async () => {
  const client = fakeClient(function* () {
    yield seenUpdate(42);
    yield seenUpdate(43);
  });
  assert.equal(await fetchUidOne(client, 42, { source: true }), null);
  assert.equal(await fetchUidOne(client, 42, { envelope: true }), null);
  assert.equal(await fetchUidOne(client, 'abc', { source: true }), null);
});

test('hasRequestedFields checks every requested field', () => {
  assert.equal(hasRequestedFields({ size: 0 }, { size: true }), true);
  assert.equal(hasRequestedFields({ size: '1' }, { size: true }), false);
  assert.equal(hasRequestedFields({ flags: [] }, { flags: true }), false);
  assert.equal(hasRequestedFields({ bodyParts: new Map([['1', Buffer.alloc(0)]]) }, { bodyParts: ['1'] }), true);
  assert.equal(hasRequestedFields({ bodyParts: new Map() }, { bodyParts: [{ key: 'TEXT' }] }), false);
  assert.equal(isRequestedFetchResult({ uid: 5, envelope: {} }, { envelope: true }, uidSet('5,6')), true);
  assert.equal(isRequestedFetchResult({ uid: 9, envelope: {} }, { envelope: true }, uidSet([5, 6])), false);
  assert.equal(isRequestedFetchResult({ envelope: {} }, { envelope: true }), false);
});

test('Previews: an unsolicited FETCH for the same UID is not cached as an empty preview', async () => {
  const client = fakeClient(function* (uids, query) {
    yield seenUpdate(1);
    yield seenUpdate(2);
    yield { uid: 2, bodyParts: new Map([[query.bodyParts[0].key, Buffer.from('Hello two')]]) };
  });
  const cache = createPreviewCache(10);
  const items = [
    { uid: 1, bodyStructure: { type: 'text/plain' } },
    { uid: 2, bodyStructure: { type: 'text/plain' } }
  ];
  await attachPreviews(client, items, { cache, keyPrefix: 'k' });
  assert.equal(items[0].preview, '');
  assert.equal(items[1].preview, 'Hello two');
  assert.equal(cache.get('k:1'), undefined, 'missing preview is retried next time');
  assert.equal(cache.get('k:2'), 'Hello two');
});

test('Thread seed ignores an unsolicited flags entry that arrives first', async () => {
  const client = fakeClient(
    function* (range, query) {
      if (query.headers) {
        yield seenUpdate(10);
        yield {
          uid: 10,
          envelope: { messageId: '<seed@x>', subject: 'Seed' },
          headers: Buffer.from('Message-ID: <seed@x>\r\n\r\n')
        };
        return;
      }
      for (const uid of String(range).split(',').map(Number)) {
        yield seenUpdate(uid);
        yield {
          uid,
          envelope: { messageId: `<m${uid}@x>`, subject: `S${uid}`, from: [{ address: 'a@x.at' }] },
          flags: new Set(),
          internalDate: new Date('2026-01-01T00:00:00Z'),
          bodyStructure: { type: 'text/plain', part: '1' }
        };
      }
    },
    {
      list: async () => [{ path: 'INBOX', flags: new Set() }],
      search: async () => [10, 11]
    }
  );
  const thread = await loadThread(client, 'INBOX', 10);
  assert.deepEqual(thread.messages.map(m => m.uid).sort(), [10, 11]);
});

test('Message actions count only requested UIDs, once each', async () => {
  const flagged = [];
  const client = fakeClient(
    function* () {
      yield { seq: 1, flags: new Set() };
      yield seenUpdate(99);
      yield { uid: 5 };
      yield seenUpdate(5);
    },
    {
      mailbox: { readOnly: false },
      list: async () => [{ path: 'INBOX', flags: new Set() }],
      messageFlagsAdd: async set => {
        flagged.push(set);
        return true;
      }
    }
  );
  const result = await performMessageAction(client, { folder: 'INBOX', uids: ['5', '6'], action: 'markRead' });
  assert.deepEqual(flagged, ['5']);
  assert.equal(result.count, 1);
});

test('Snooze ignores unsolicited entries without an envelope or for other UIDs', async () => {
  const moved = [];
  const client = fakeClient(
    function* () {
      yield seenUpdate(5);
      yield { uid: 99, envelope: { subject: 'foreign' } };
      yield { uid: 5, envelope: { messageId: '<m5@x>', subject: 'Offer', from: [{ address: 'c@x.at' }] } };
    },
    {
      capabilities: new Set(['MOVE']),
      list: async () => [
        { path: 'INBOX', flags: new Set(), delimiter: '.' },
        { path: 'INBOX.Zurückgestellt', flags: new Set(), delimiter: '.' }
      ],
      mailboxCreate: async () => ({}),
      messageMove: async set => {
        moved.push(set);
        return { uidMap: new Map([[5, 905]]), uidValidity: 1n };
      }
    }
  );
  const result = await snoozeMessages(client, { folder: 'INBOX', uids: ['5'] });
  assert.deepEqual(moved, ['5']);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].subject, 'Offer');
});

test('Contacts ignore unsolicited entries without an envelope', async () => {
  const client = fakeClient(
    function* () {
      yield seenUpdate(null);
      yield { seq: 1, envelope: { from: [{ address: 'anna@x.at', name: 'Anna' }] } };
    },
    { list: async () => [], mailbox: { exists: 1 } }
  );
  const contacts = await collectContacts(client, { ownAddress: 'me@x.at' });
  assert.deepEqual(
    contacts.map(c => c.email),
    ['anna@x.at']
  );
});

test('Scheduled list ignores unsolicited entries', async () => {
  const client = fakeClient(
    function* () {
      yield seenUpdate(5);
      yield { uid: 99, envelope: {}, flags: new Set(), headers: Buffer.from('X-Levuvo-Send-At: 2099-01-01T00:00:00Z') };
      yield {
        uid: 5,
        envelope: { subject: 'Later', to: [{ address: 'x@y.at' }] },
        flags: new Set(),
        headers: Buffer.from('X-Levuvo-Send-At: 2099-01-01T00:00:00Z')
      };
    },
    {
      list: async () => [{ path: 'Drafts', specialUse: '\\Drafts', flags: new Set() }],
      search: async () => [5]
    }
  );
  const { items } = await listScheduled(client);
  assert.deepEqual(
    items.map(i => [i.uid, i.subject]),
    [[5, 'Later']]
  );
});
