import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyMessage, headerMap } from '../src/bundles.mjs';
import { fetchInfos } from '../src/mailbox.mjs';

test('headerMap reads IMAP header blocks with folded lines', () => {
  const map = headerMap(
    Buffer.from('List-Unsubscribe: <https://x.test/u>,\r\n <mailto:u@x.test>\r\nPrecedence: bulk\r\n\r\n')
  );
  assert.equal(map['list-unsubscribe'], '<https://x.test/u>, <mailto:u@x.test>');
  assert.equal(map.precedence, 'bulk');
  assert.deepEqual(headerMap([{ key: 'List-Id', value: '<team.x.test>' }]), { 'list-id': '<team.x.test>' });
  assert.deepEqual(headerMap(null), {});
});

test('classifyMessage sorts newsletters, invoices and notifications', () => {
  const unsubscribe = 'List-Unsubscribe: <https://shop.test/u>\r\n';
  assert.equal(classifyMessage({ fromEmail: 'news@shop.test', headers: unsubscribe }), 'newsletter');
  assert.equal(classifyMessage({ fromEmail: 'hello@shop.test', headers: unsubscribe }), 'newsletter');
  assert.equal(classifyMessage({ fromEmail: 'x@shop.test', headers: 'Precedence: bulk\r\n' }), 'newsletter');
  assert.equal(classifyMessage({ fromEmail: 'billing@host.test', subject: 'Ihre Rechnung Nr. 4711' }), 'invoice');
  assert.equal(classifyMessage({ fromEmail: 'no-reply@shop.test', subject: 'Receipt for your order' }), 'invoice');
  assert.equal(
    classifyMessage({ fromEmail: 'a@b.test', subject: 'Unterlagen', attachmentNames: ['Rechnung_2026-11.pdf'] }),
    'invoice'
  );
  assert.equal(classifyMessage({ fromEmail: 'notifications@github.test', headers: unsubscribe }), 'notification');
  assert.equal(classifyMessage({ fromEmail: 'noreply@bank.test', subject: 'Neue Anmeldung' }), 'notification');
  assert.equal(
    classifyMessage({ fromEmail: 'calendar@x.test', headers: 'Auto-Submitted: auto-generated\r\n' }),
    'notification'
  );
  // Personal mail and discussion lists stay in the inbox.
  assert.equal(classifyMessage({ fromEmail: 'anna@example.test', subject: 'Treffen morgen?' }), null);
  assert.equal(classifyMessage({ fromEmail: 'anna@example.test', headers: 'List-Id: <team.example.test>\r\n' }), null);
  assert.equal(classifyMessage({ fromEmail: 'anna@example.test', headers: 'Auto-Submitted: no\r\n' }), null);
  assert.equal(classifyMessage(), null);
});

test('fetchInfos asks for the bundle headers and tags each message', async () => {
  let asked = null;
  const client = {
    async *fetch(range, query) {
      asked ??= query;
      if (!query.envelope) return;
      yield {
        uid: 5,
        envelope: { subject: 'Wochenangebote', from: [{ name: 'Shop', address: 'news@shop.test' }] },
        flags: new Set(['\\Seen']),
        internalDate: new Date('2026-11-18T10:00:00Z'),
        bodyStructure: { type: 'text/html', part: '1' },
        headers: Buffer.from('List-Unsubscribe: <https://shop.test/u>\r\n\r\n')
      };
      yield {
        uid: 6,
        envelope: { subject: 'Hallo', from: [{ name: 'Anna', address: 'anna@example.test' }] },
        flags: new Set(),
        internalDate: new Date('2026-11-18T11:00:00Z'),
        bodyStructure: { type: 'text/plain', part: '1' },
        headers: Buffer.from('\r\n')
      };
    },
    async download() {
      return { content: (async function* () {})() };
    }
  };
  const infos = await fetchInfos(client, [5, 6], { uidRange: true, previewCache: null, keyPrefix: 'k' });
  assert.ok(Array.isArray(asked.headers) && asked.headers.includes('list-unsubscribe'));
  assert.deepEqual(
    infos.map(i => [i.uid, i.bundle]),
    [
      [6, null],
      [5, 'newsletter']
    ]
  );
});
