import test from 'node:test';
import assert from 'node:assert/strict';
import { attachmentQuery, attachmentsFromStructure, listAttachments } from '../src/attachment-overview.mjs';

const text = { part: '1', type: 'text/plain', encoding: '7bit', size: 120 };
const html = { part: '2', type: 'text/html', encoding: 'quoted-printable', size: 400 };
const pdf = (name, part = '2') => ({
  part,
  type: 'application/pdf',
  encoding: 'base64',
  size: 4000,
  disposition: 'attachment',
  dispositionParameters: { filename: name }
});
const logo = { part: '2.2', type: 'image/png', encoding: 'base64', size: 800, id: '<logo@x>', disposition: 'inline' };

test('attachmentsFromStructure lists files, not body parts or inline logos', () => {
  const structure = {
    type: 'multipart/mixed',
    childNodes: [
      { type: 'multipart/related', childNodes: [html, logo] },
      pdf('Rechnung 2026-11.pdf', '2'),
      // Named part without disposition (old mailers) counts as a file.
      { part: '3', type: 'application/zip', encoding: 'base64', size: 400, parameters: { name: 'fotos.zip' } },
      { part: '4', type: 'application/pgp-signature', size: 300, disposition: 'attachment' }
    ]
  };
  assert.deepEqual(attachmentsFromStructure(structure), [
    { filename: 'Rechnung 2026-11.pdf', mimeType: 'application/pdf', size: 3000 },
    { filename: 'fotos.zip', mimeType: 'application/zip', size: 300 }
  ]);
  assert.deepEqual(attachmentsFromStructure(text), []);
  assert.deepEqual(attachmentsFromStructure(null), []);
});

test('attachmentQuery validates contact and position', () => {
  assert.deepEqual(attachmentQuery({ contact: ' Anna@Example.TEST ', q: ' pdf ', beforeUid: '40' }), {
    contact: 'anna@example.test',
    q: 'pdf',
    beforeUid: 40
  });
  assert.deepEqual(attachmentQuery({}), { contact: null, q: '', beforeUid: null });
  assert.throws(() => attachmentQuery({ contact: 'no address' }), /E-Mail-Adresse/);
  assert.throws(() => attachmentQuery({ beforeUid: '0' }), /Position/);
  assert.throws(() => attachmentQuery({ beforeUid: '1:*' }), /Position/);
});

function fakeClient(messages) {
  const calls = { search: [], fetch: [], released: 0, readOnly: null };
  return {
    calls,
    async getMailboxLock(_folder, options) {
      calls.readOnly = options?.readOnly;
      return { release: () => calls.released++ };
    },
    async search(criteria) {
      calls.search.push(criteria);
      const email = criteria.or?.[0]?.from;
      return messages.filter(m => !email || m.from === email || m.to === email).map(m => m.uid);
    },
    async *fetch(range) {
      calls.fetch.push(range);
      const wanted = new Set(range.split(',').map(Number));
      for (const m of messages) {
        if (!wanted.has(m.uid)) continue;
        yield {
          uid: m.uid,
          internalDate: new Date(Date.UTC(2026, 10, m.uid)),
          envelope: { subject: m.subject, from: [{ name: m.name, address: m.from }] },
          bodyStructure: m.structure
        };
      }
      // An unsolicited flag update without envelope must not end up in the overview.
      yield { uid: 999, flags: new Set(['\\Seen']) };
    }
  };
}

const MAILBOX = [
  {
    uid: 1,
    from: 'anna@example.test',
    name: 'Anna',
    subject: 'Vertrag',
    structure: { childNodes: [text, pdf('Vertrag.pdf')] }
  },
  { uid: 2, from: 'news@shop.test', name: 'Shop', subject: 'Angebote', structure: html },
  {
    uid: 3,
    from: 'bob@example.test',
    to: 'anna@example.test',
    name: 'Bob',
    subject: 'Fotos',
    structure: { childNodes: [text, pdf('Plan.pdf')] }
  },
  {
    uid: 4,
    from: 'anna@example.test',
    name: 'Anna',
    subject: 'Rechnung',
    structure: { childNodes: [text, pdf('Rechnung.pdf')] }
  }
];

test('listAttachments: newest first, read-only, only messages with files', async () => {
  const client = fakeClient(MAILBOX);
  const page = await listAttachments(client, 'INBOX');
  assert.equal(client.calls.readOnly, true);
  assert.equal(client.calls.released, 1);
  assert.deepEqual(
    page.items.map(i => [i.uid, i.filename, i.fromEmail]),
    [
      [4, 'Rechnung.pdf', 'anna@example.test'],
      [3, 'Plan.pdf', 'bob@example.test'],
      [1, 'Vertrag.pdf', 'anna@example.test']
    ]
  );
  assert.equal(page.hasMore, false);
  assert.equal(page.items[0].folder, 'INBOX');
  assert.equal(page.items[0].date, '2026-11-04T00:00:00.000Z');
});

test('listAttachments: contact filter, text filter and paging', async () => {
  const client = fakeClient(MAILBOX);
  const anna = await listAttachments(client, 'INBOX', { contact: 'anna@example.test' });
  assert.deepEqual(client.calls.search[0], {
    or: [{ from: 'anna@example.test' }, { to: 'anna@example.test' }, { cc: 'anna@example.test' }]
  });
  assert.deepEqual(
    anna.items.map(i => i.uid),
    [4, 3, 1]
  );
  const invoices = await listAttachments(fakeClient(MAILBOX), 'INBOX', { q: 'rechnung' });
  assert.deepEqual(
    invoices.items.map(i => i.filename),
    ['Rechnung.pdf']
  );
  const first = await listAttachments(fakeClient(MAILBOX), 'INBOX', { scan: 2 });
  assert.deepEqual(
    first.items.map(i => i.uid),
    [4, 3]
  );
  assert.equal(first.hasMore, true);
  assert.equal(first.nextBeforeUid, 3);
  const second = await listAttachments(fakeClient(MAILBOX), 'INBOX', { scan: 2, beforeUid: first.nextBeforeUid });
  assert.deepEqual(
    second.items.map(i => i.uid),
    [1]
  );
  assert.equal(second.hasMore, false);
});
