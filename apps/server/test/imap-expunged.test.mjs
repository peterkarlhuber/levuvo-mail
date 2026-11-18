// Regression tests for the empty "(no subject)" inbox row that could not be deleted.
// When another connection deletes or moves a message (the app's own action connection, a
// second computer, a phone) and this connection has not received the EXPUNGE yet, Dovecot
// still answers a FETCH for it, with a stand-in: RFC822.SIZE 0, INTERNALDATE 1970-01-01,
// an all-NIL ENVELOPE and an empty body. Reproduced against Dovecot 2.3.21.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ImapFlow } from 'imapflow';
import { defaultMessages, startFakeImapServer } from './helpers/fake-imap-server.mjs';
import { completeFetchResults, listMessages, monitorInbox } from '../src/mailbox.mjs';
import { fetchUidOne, hasRequestedFields, isExpungedPlaceholder } from '../src/imap-fetch.mjs';
import { loadParsedMessage } from '../src/message-service.mjs';

const TEST_TIMEOUT = 10_000;

/** Message 14 (the newest) was just deleted on another connection. */
function messagesWithExpunged(uid = 14) {
  return defaultMessages().map(m => (m.uid === uid ? { ...m, expunged: true } : m));
}

async function withClient(messages, run) {
  const server = await startFakeImapServer({ messages });
  const client = new ImapFlow({
    host: '127.0.0.1',
    port: server.port,
    secure: false,
    auth: { user: 'user', pass: 'secret' },
    logger: false,
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 5000
  });
  client.on('error', () => {});
  try {
    await client.connect();
    return await run(client);
  } finally {
    try {
      await client.logout();
    } catch {
      client.close();
    }
    await server.close();
  }
}

test('isExpungedPlaceholder recognises the Dovecot stand-in, not real messages', () => {
  const epoch = new Date(0);
  assert.equal(isExpungedPlaceholder({ uid: 6, size: 0, internalDate: epoch, envelope: {} }), true);
  assert.equal(isExpungedPlaceholder({ uid: 6, internalDate: epoch, envelope: {} }), true);
  assert.equal(isExpungedPlaceholder({ uid: 6, size: 0 }), true);
  assert.equal(isExpungedPlaceholder({ uid: 6, source: Buffer.alloc(0) }), true);
  // A real message without any header has an empty envelope, but a real date and size.
  assert.equal(
    isExpungedPlaceholder({ uid: 7, size: 23, internalDate: new Date('2026-11-18T19:33:18Z'), envelope: {} }),
    false
  );
  assert.equal(
    isExpungedPlaceholder({ uid: 8, size: 60, internalDate: new Date(), envelope: { subject: 'x' } }),
    false
  );
  assert.equal(isExpungedPlaceholder({ uid: 9, flags: new Set(['\\Seen']) }), false);
  assert.equal(isExpungedPlaceholder(null), false);
});

test('completeFetchResults and hasRequestedFields drop the stand-in', () => {
  const real = { uid: 13, size: 60, internalDate: new Date(), envelope: { subject: 'S' } };
  const gone = { uid: 14, size: 0, internalDate: new Date(0), envelope: {} };
  assert.deepEqual(
    completeFetchResults([real, gone]).map(m => m.uid),
    [13]
  );
  assert.equal(hasRequestedFields(gone, { envelope: true, size: true }), false);
  assert.equal(hasRequestedFields(real, { envelope: true, size: true }), true);
});

test('fake server answers like Dovecot for an expunged message', { timeout: TEST_TIMEOUT }, async () => {
  await withClient(messagesWithExpunged(), async client => {
    await client.mailboxOpen('INBOX', { readOnly: true });
    const raw = [];
    for await (const m of client.fetch('1:*', { uid: true, envelope: true, internalDate: true, size: true }))
      raw.push(m);
    const stand = raw.find(m => m.uid === 14);
    assert.ok(stand, 'imapflow returns an entry for the expunged message');
    assert.equal(stand.size, 0);
    assert.equal(stand.internalDate.getTime(), 0);
    assert.deepEqual(stand.envelope, {});
  });
});

test('monitorInbox does not list a message expunged on another connection', { timeout: TEST_TIMEOUT }, async () => {
  await withClient(messagesWithExpunged(), async client => {
    const state = await monitorInbox(client, {});
    assert.deepEqual(
      state.messages.map(m => m.uid),
      [13, 12, 11, 10]
    );
    for (const m of state.messages) {
      assert.equal(m.subject, `Subject ${m.uid}`);
      assert.notEqual(m.fromName, 'Unbekannt');
    }
  });
});

test('listMessages does not list a message expunged on another connection', { timeout: TEST_TIMEOUT }, async () => {
  await withClient(messagesWithExpunged(12), async client => {
    const page = await listMessages(client, 'INBOX', { limit: 50 });
    assert.deepEqual(
      page.messages.map(m => m.uid),
      [14, 13, 11, 10]
    );
    const older = await listMessages(client, 'INBOX', { limit: 5, beforeUid: 14 });
    assert.deepEqual(
      older.messages.map(m => m.uid),
      [13, 11, 10]
    );
  });
});

test('opening a message expunged on another connection reports it as gone', { timeout: TEST_TIMEOUT }, async () => {
  await withClient(messagesWithExpunged(), async client => {
    assert.equal(await loadParsedMessage(client, 'INBOX', 14), null);
    const lock = await client.getMailboxLock('INBOX', { readOnly: true });
    try {
      assert.equal(await fetchUidOne(client, 14, { source: true, envelope: true }), null);
      const ok = await fetchUidOne(client, 13, { source: true, envelope: true });
      assert.equal(ok?.envelope?.subject, 'Subject 13');
    } finally {
      lock.release();
    }
  });
});
