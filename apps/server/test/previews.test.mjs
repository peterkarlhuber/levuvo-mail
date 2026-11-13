import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findPreviewPart,
  hasAttachments,
  decodePreview,
  attachPreviews,
  createPreviewCache
} from '../src/previews.mjs';

const alternative = {
  type: 'multipart/mixed',
  childNodes: [
    {
      part: '1',
      type: 'multipart/alternative',
      childNodes: [
        { part: '1.1', type: 'text/plain', encoding: 'quoted-printable', parameters: { charset: 'utf-8' } },
        { part: '1.2', type: 'text/html', encoding: 'quoted-printable', parameters: { charset: 'utf-8' } }
      ]
    },
    { part: '2', type: 'application/pdf', disposition: 'attachment' }
  ]
};

test('Vorschau nutzt Text vor HTML und nie Anhänge', () => {
  assert.deepEqual(findPreviewPart(alternative), {
    part: '1.1',
    type: 'text/plain',
    encoding: 'quoted-printable',
    charset: 'utf-8'
  });
  assert.equal(findPreviewPart({ type: 'text/plain' }).part, '1', 'Einteilige Nachricht → Teil 1');
  assert.equal(findPreviewPart({ type: 'image/png' }), null);
  assert.equal(findPreviewPart({ childNodes: [{ part: '1', type: 'text/plain', disposition: 'attachment' }] }), null);
});

test('Anhänge werden in der Struktur erkannt', () => {
  assert.equal(hasAttachments(alternative), true);
  assert.equal(hasAttachments({ type: 'text/plain' }), false);
});

test('Quoted-printable, Base64, abgeschnittene Bytes und HTML werden sauber dekodiert', () => {
  assert.equal(
    decodePreview(Buffer.from('Gr=C3=BC=C3=9Fe aus Wien=\r\n weiter =C3'), {
      type: 'text/plain',
      encoding: 'quoted-printable',
      charset: 'utf-8'
    }),
    'Grüße aus Wien weiter'
  );
  const b64 = Buffer.from('Hallo Welt – äöü').toString('base64');
  assert.equal(
    decodePreview(Buffer.from(b64.slice(0, 16)), { type: 'text/plain', encoding: 'base64', charset: 'utf-8' }),
    'Hallo Welt'
  );
  assert.equal(
    decodePreview(Buffer.from('<style>p{}</style><p>Hallo <b>Peter</b>,</p><p>A &amp; B</p>'), {
      type: 'text/html',
      encoding: '7bit',
      charset: 'utf-8'
    }),
    'Hallo Peter, A & B'
  );
  assert.equal(
    decodePreview(Buffer.from('Antwort\n> Zitat\n-- \nSignatur'), {
      type: 'text/plain',
      encoding: '7bit',
      charset: 'utf-8'
    }),
    'Antwort Signatur'
  );
  assert.equal(
    decodePreview(Buffer.from('caf\xe9', 'latin1'), { type: 'text/plain', encoding: '8bit', charset: 'iso-8859-1' }),
    'café'
  );
  assert.ok(
    decodePreview(Buffer.from('x'.repeat(1000)), { type: 'text/plain', encoding: '7bit', charset: 'utf-8' }).length <=
      180
  );
});

test('Vorschauen werden gruppiert abgerufen und gecacht', async () => {
  const calls = [];
  const client = {
    async *fetch(uids, query) {
      calls.push([uids, query.bodyParts[0]]);
      for (const uid of uids) yield { uid, bodyParts: new Map([[query.bodyParts[0].key, Buffer.from(`Text ${uid}`)]]) };
    }
  };
  const cache = createPreviewCache(10);
  const items = [
    { uid: 1, bodyStructure: { type: 'text/plain' } },
    { uid: 2, bodyStructure: { type: 'text/plain' } },
    { uid: 3, bodyStructure: alternative }
  ];
  await attachPreviews(client, items, { cache, keyPrefix: 'a:INBOX:7' });
  assert.deepEqual(
    items.map(i => i.preview),
    ['Text 1', 'Text 2', 'Text 3']
  );
  assert.equal(calls.length, 2, 'ein FETCH pro Teilnummer');
  assert.equal(calls[0][1].maxLength, 3072);
  const again = [{ uid: 1, bodyStructure: { type: 'text/plain' } }];
  await attachPreviews(client, again, { cache, keyPrefix: 'a:INBOX:7' });
  assert.equal(calls.length, 2, 'zweiter Aufruf kommt aus dem Cache');
});

test('Fehler beim Vorschauabruf lassen die Liste unbeschädigt', async () => {
  const client = {
    fetch() {
      return {
        [Symbol.asyncIterator]() {
          return { next: () => Promise.reject(new Error('boom')) };
        }
      };
    }
  };
  const items = [{ uid: 1, bodyStructure: { type: 'text/plain' } }];
  await attachPreviews(client, items, { cache: createPreviewCache(), keyPrefix: 'x' });
  assert.equal(items[0].preview, '');
});
