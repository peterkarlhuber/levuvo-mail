import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_MESSAGE_BYTES } from '../src/message-utils.mjs';

let service;
try {
  service = await import('../src/message-service.mjs');
} catch (err) {
  if (err.code !== 'ERR_MODULE_NOT_FOUND') throw err;
}

function fakeImap(raw, size = raw.length) {
  const calls = [];
  const client = {
    calls,
    async getMailboxLock(folder, options) {
      calls.push({ method: 'lock', folder, options });
      return {
        release() {
          calls.push({ method: 'release' });
        }
      };
    },
    async *fetch(uid, query, options) {
      calls.push({ method: 'fetch', uid, query, options });
      // An unsolicited flag update for another message arrives first.
      yield { seq: 3, uid: 999, flags: new Set(['\\Seen']) };
      yield query.size ? { uid: Number(uid), size, flags: new Set() } : { uid: Number(uid), source: Buffer.from(raw) };
    }
  };
  return client;
}

test(
  'Parse an RFC 822 message including attachment via UID, read-only',
  { skip: !service && 'postal-mime must be installed (npm install)' },
  async () => {
    const raw = Buffer.from(
      'From: Anna <anna@example.com>\r\nTo: info@example.com\r\nSubject: Hallo\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="b"\r\n\r\n--b\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nNachrichteninhalt\r\n--b\r\nContent-Type: text/plain; name="test.txt"\r\nContent-Disposition: attachment; filename="test.txt"\r\nContent-Transfer-Encoding: base64\r\n\r\nSGFsbG8=\r\n--b--\r\n'
    );
    const client = fakeImap(raw);
    const loaded = await service.loadParsedMessage(client, 'INBOX', 150);
    assert.equal(loaded.detail.subject, 'Hallo');
    assert.match(loaded.detail.text, /Nachrichteninhalt/);
    assert.equal(loaded.detail.attachments[0].filename, 'test.txt');
    assert.equal(loaded.detail.attachments[0].size, 5);
    assert.equal(client.calls[0].options.readOnly, true);
    assert.ok(client.calls.filter(c => c.method === 'fetch').every(c => c.uid === '150' && c.options.uid === true));
    assert.equal(client.calls.at(-1).method, 'release');
  }
);

test(
  'Messages that are too large are rejected before download',
  { skip: !service && 'postal-mime must be installed (npm install)' },
  async () => {
    const client = fakeImap(Buffer.from('Subject: Test\r\n\r\nHi'), MAX_MESSAGE_BYTES + 1);
    await assert.rejects(service.loadParsedMessage(client, 'INBOX', 1), { statusCode: 413 });
    assert.equal(client.calls.filter(c => c.method === 'fetch').length, 1);
    assert.equal(client.calls.at(-1).method, 'release');
  }
);
