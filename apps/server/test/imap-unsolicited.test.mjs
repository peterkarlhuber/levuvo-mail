// Regression tests: the real ImapFlow client against a scripted fake IMAP server that
// interleaves unsolicited untagged FETCH responses (flag updates) into FETCH answers,
// like Dovecot does. ImapFlow hands those entries to the command result; they used to
// show up as "phantom" empty inbox rows or as the wrong message in `fetchOne`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ImapFlow } from 'imapflow';
import { startFakeImapServer } from './helpers/fake-imap-server.mjs';
import { monitorInbox, listMessages } from '../src/mailbox.mjs';
import { loadParsedMessage } from '../src/message-service.mjs';
import { attachPreviews, createPreviewCache } from '../src/previews.mjs';

const TEST_TIMEOUT = 10_000;
const ALL_UIDS = [10, 11, 12, 13, 14];

/** Unsolicited lines: no UID, other message with UID + MODSEQ, and the requested message itself. */
function noisyFetch({ targets }) {
  const first = targets[0] || { seq: 1, uid: 10 };
  // UIDs 10..14 are sequence numbers 1..5.
  const otherUid = first.uid === 11 ? 12 : 11;
  const otherSeq = otherUid - 9;
  return {
    before: [
      '* 3 FETCH (FLAGS (\\Seen))',
      `* ${otherSeq} FETCH (UID ${otherUid} FLAGS (\\Seen) MODSEQ (77))`,
      `* ${first.seq} FETCH (UID ${first.uid} FLAGS (\\Seen \\Flagged))`
    ],
    between: ['* 1 FETCH (FLAGS (\\Seen \\Answered))', '* 5 FETCH (UID 14 FLAGS ())'],
    after: ['* 2 FETCH (FLAGS ())', `* ${first.seq} FETCH (UID ${first.uid} FLAGS (\\Seen))`]
  };
}

async function withClient(options, run) {
  const server = await startFakeImapServer(options);
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
    return await run(client, server);
  } finally {
    try {
      await client.logout();
    } catch {
      client.close();
    }
    await server.close();
  }
}

function assertCompleteList(messages) {
  assert.equal(messages.length, 5, 'exactly the five stored messages');
  const uids = messages.map(m => m.uid);
  assert.deepEqual(
    [...uids].sort((a, b) => a - b),
    ALL_UIDS,
    'no duplicates, no phantom entries'
  );
  for (const message of messages) {
    assert.equal(message.subject, `Subject ${message.uid}`);
    assert.equal(message.fromEmail, `sender${message.uid}@example.test`);
    assert.equal(message.fromName, `Sender ${message.uid}`);
    assert.equal(message.preview, `Body text of message ${message.uid}. Second line ${message.uid}.`);
  }
}

test(
  'fake server reproduces the problem: raw fetchOne returns an unsolicited entry',
  { timeout: TEST_TIMEOUT },
  async () => {
    await withClient({ onFetch: noisyFetch }, async client => {
      await client.mailboxOpen('INBOX', { readOnly: true });
      const first = await client.fetchOne('13', { uid: true, size: true }, { uid: true });
      assert.notEqual(first.uid, 13, 'imapflow fetchOne returns list[0], which is not message 13 here');
    });
  }
);

test('monitorInbox ignores unsolicited FETCH responses', { timeout: TEST_TIMEOUT }, async () => {
  await withClient({ onFetch: noisyFetch }, async client => {
    const state = await monitorInbox(client, {});
    assert.equal(state.total, 5);
    assert.equal(state.highestUid, 14);
    assert.equal(state.uidValidity, '1700000000');
    assertCompleteList(state.messages);
    assert.deepEqual(
      state.messages.map(m => m.uid),
      [14, 13, 12, 11, 10]
    );
  });
});

test('listMessages ignores unsolicited FETCH responses', { timeout: TEST_TIMEOUT }, async () => {
  await withClient({ onFetch: noisyFetch }, async client => {
    const page = await listMessages(client, 'INBOX', { limit: 50 });
    assert.equal(page.total, 5);
    assert.equal(page.hasMore, false);
    assertCompleteList(page.messages);
  });
});

test('listMessages UID paging ignores unsolicited FETCH responses', { timeout: TEST_TIMEOUT }, async () => {
  await withClient({ onFetch: noisyFetch }, async client => {
    const page = await listMessages(client, 'INBOX', { limit: 2, beforeUid: 13 });
    assert.deepEqual(
      page.messages.map(m => m.uid),
      [12, 11]
    );
    for (const message of page.messages) assert.equal(message.subject, `Subject ${message.uid}`);
  });
});

test(
  'loadParsedMessage returns message 13 even when other messages are reported first',
  { timeout: TEST_TIMEOUT },
  async () => {
    const plan = () => ({
      before: ['* 3 FETCH (FLAGS (\\Seen))', '* 2 FETCH (UID 11 FLAGS (\\Seen) MODSEQ (77))']
    });
    await withClient({ onFetch: plan }, async client => {
      const result = await loadParsedMessage(client, 'INBOX', 13);
      assert.ok(result, 'message 13 is found');
      assert.equal(result.parsed.subject, 'Subject 13');
      assert.equal(result.parsed.from?.address, 'sender13@example.test');
      assert.match(result.parsed.text, /Body text of message 13\./);
      assert.match(result.source.toString('utf8'), /Message-ID: <msg-13@example\.test>/);
      // Message 13 (sequence 4) is stored without \Seen.
      assert.equal(result.detail.unread, true);
    });
  }
);

test('loadParsedMessage ignores a flags-only update for the same UID', { timeout: TEST_TIMEOUT }, async () => {
  const plan = () => ({
    before: ['* 4 FETCH (UID 13 FLAGS (\\Seen \\Flagged))', '* 1 FETCH (UID 10 FLAGS ())'],
    after: ['* 4 FETCH (FLAGS (\\Seen))']
  });
  await withClient({ onFetch: plan }, async client => {
    const result = await loadParsedMessage(client, 'INBOX', 13);
    assert.ok(result, 'message 13 is found');
    assert.equal(result.parsed.subject, 'Subject 13');
    assert.match(result.parsed.text, /Body text of message 13\./);
  });
});

test(
  'attachPreviews uses the real text when a flags update for the same UID arrives first',
  { timeout: TEST_TIMEOUT },
  async () => {
    const plan = ({ targets }) => ({
      before: targets.map(t => `* ${t.seq} FETCH (UID ${t.uid} FLAGS (\\Seen))`),
      between: ['* 3 FETCH (FLAGS ())']
    });
    await withClient({ onFetch: plan }, async client => {
      const lock = await client.getMailboxLock('INBOX', { readOnly: true });
      try {
        const bodyStructure = { type: 'text/plain', encoding: '7bit', parameters: { charset: 'utf-8' } };
        const items = [12, 13].map(uid => ({ uid, bodyStructure }));
        const cache = createPreviewCache();
        await attachPreviews(client, items, { cache, keyPrefix: 'acc:INBOX:1700000000' });
        for (const item of items) {
          const expected = `Body text of message ${item.uid}. Second line ${item.uid}.`;
          assert.equal(item.preview, expected);
          assert.equal(cache.get(`acc:INBOX:1700000000:${item.uid}`), expected);
        }
      } finally {
        lock.release();
      }
    });
  }
);
