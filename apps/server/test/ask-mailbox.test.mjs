import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuse, questionTerms, readSources, retrieve, verifiedQuote } from '../src/ask-mailbox.mjs';
import { askSources, mapLimit } from '../src/routes-ai.mjs';
import { attachmentText, attachmentTexts, textKind } from '../src/attachment-text.mjs';

/** A one-page PDF with the given text (valid xref offsets). */
export function tinyPdf(text) {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  const stream = `BT /F1 12 Tf 20 100 Td (${text}) Tj ET`;
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

test('question terms keep names and numbers, drop question words', () => {
  assert.deepEqual(questionTerms('Was hat Müller zum Angebot gesagt?'), ['Angebot', 'Müller']);
  assert.deepEqual(questionTerms('When is invoice RE-2026-114 due?'), ['RE-2026-114', 'invoice', 'due']);
  assert.deepEqual(questionTerms('was ist?'), []);
});

test('fusion ranks a mail found by meaning and words above single hits', () => {
  const a = { accountId: 'x', folder: 'INBOX', uid: 1 };
  const b = { accountId: 'x', folder: 'INBOX', uid: 2 };
  const c = { accountId: 'x', folder: 'INBOX', uid: 3 };
  const out = fuse([{ hits: [b, a] }, { hits: [a, c] }], 10);
  assert.equal(out[0].uid, 1);
  assert.equal(out.length, 3);
});

test('retrieve finds a name by words when vectors miss it or are not built', async () => {
  const mail = { accountId: 'acc', folder: 'INBOX', uid: 7, subject: 'Angebot Fenster', fromName: 'Hans Müller' };
  const localIndex = {
    async search(ids, q) {
      assert.deepEqual(ids, ['acc']);
      return /müller/i.test(q) ? [{ ...mail, hasAttachments: true }] : [];
    },
    async text() {
      return {
        subject: mail.subject,
        fromName: mail.fromName,
        fromEmail: 'h@m.at',
        date: '2026-11-02',
        text: 'Preis folgt'
      };
    }
  };
  const semantic = { search: async () => Promise.reject(new Error('no model')) };
  const hits = await retrieve({ semantic, localIndex, ids: ['acc'], question: 'Was sagt Müller?' });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].text, 'Preis folgt');
  assert.equal(await retrieve({ semantic, localIndex, ids: [], question: 'x' }).then(h => h.length), 0);
  // A follow-up widens the word search with the earlier question.
  const follow = await retrieve({ semantic, localIndex, ids: ['acc'], question: 'Und der Preis?', context: 'Müller' });
  assert.equal(follow.length, 1);
});

test('readSources reads the best hits in full and keeps index text on failure', async () => {
  const hits = [
    { accountId: 'a', folder: 'INBOX', uid: 1, text: 'kurz' },
    { accountId: 'a', folder: 'INBOX', uid: 2, text: 'index', hasAttachments: false }
  ];
  const out = await readSources(hits, {
    mapLimit,
    full: 5,
    load: async h => (h.uid === 1 ? { text: 'voller Text', to: 'me' } : Promise.reject(new Error('offline'))),
    attachments: async () => [{ filename: 'a.pdf', text: 'Summe 100' }]
  });
  assert.equal(out[0].text, 'voller Text');
  assert.equal(out[0].attachments[0].filename, 'a.pdf');
  assert.equal(out[1].text, 'index');
  assert.deepEqual(out[1].attachments, []);
});

test('only literal quotes are shown, and only for sources the model got', () => {
  const src = {
    text: 'Hallo,\nder Preis beträgt 12.400 € netto.',
    attachments: [{ filename: 'a.pdf', text: 'Lieferung KW 3' }]
  };
  assert.ok(verifiedQuote('der Preis beträgt 12.400 €', src));
  assert.equal(verifiedQuote('der Preis beträgt 99 €', src), '');
  assert.equal(verifiedQuote('kurz', src), '');
  const map = [{ accountId: 'a', folder: 'INBOX', uid: 1, subject: 'S', ...src }];
  const out = askSources({ sources: ['s1', 's1', 's4'], quotes: [{ id: 's1', quote: 'Lieferung  KW 3' }] }, map);
  assert.equal(out.length, 1);
  assert.equal(out[0].attachment, 'a.pdf');
  assert.equal(out[0].text, undefined, 'mail text never goes back to the UI');
});

test('attachment text: text, HTML and PDF are read, other files and oversize are not', async () => {
  assert.equal(textKind({ mimeType: 'application/pdf' }), 'pdf');
  assert.equal(textKind({ mimeType: 'application/octet-stream', filename: 'x.csv' }), 'text');
  assert.equal(textKind({ mimeType: 'image/png', filename: 'x.png' }), null);
  assert.equal(
    await attachmentText({ mimeType: 'text/plain' }, Buffer.from('Zeile 1\r\n\r\n\r\n\r\nZeile 2')),
    'Zeile 1\n\nZeile 2'
  );
  assert.equal(
    await attachmentText({ mimeType: 'text/html' }, Buffer.from('<style>x{}</style><p>Hallo &amp; tschüss</p>')),
    'Hallo & tschüss'
  );
  assert.match(
    await attachmentText({ mimeType: 'application/pdf' }, tinyPdf('Rechnung 4711 Gesamt 99 EUR')),
    /Rechnung 4711 Gesamt 99 EUR/
  );
  assert.equal(await attachmentText({ mimeType: 'application/pdf' }, Buffer.from('%PDF-1.4 broken')), '');
  const limits = { files: 4, bytes: 10, pages: 1, chars: 100, totalChars: 100, timeoutMs: 1000 };
  assert.equal(await attachmentText({ mimeType: 'text/plain' }, Buffer.from('more than ten bytes'), limits), '');
  const files = await attachmentTexts(
    {
      attachments: [
        { filename: 'p.png', mimeType: 'image/png' },
        { filename: 'n.txt', mimeType: 'text/plain' }
      ]
    },
    { attachments: [{ content: new Uint8Array([1]) }, { content: new TextEncoder().encode('Notiz') }] }
  );
  assert.deepEqual(
    files.map(f => [f.index, f.text]),
    [[1, 'Notiz']]
  );
});
