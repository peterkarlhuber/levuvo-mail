import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validFolder,
  validUid,
  validAttachmentIndex,
  cleanFilename,
  downloadHeaders,
  publicMessage,
  attachmentBytes,
  MAX_MESSAGE_BYTES
} from '../src/message-utils.mjs';

test('Nur gültige Ordnernamen zulassen', () => {
  assert.equal(validFolder('INBOX/Entwürfe'), true);
  for (const invalid of ['', 'x\0y', 'x\ny', 'x\ry', 'a'.repeat(256), 17]) assert.equal(validFolder(invalid), false);
});

test('UID korrekt im 32-Bit-Bereich validieren', () => {
  for (const value of ['1', '4294967295', '120']) assert.equal(validUid(value), true);
  for (const value of ['0', '-1', '2.4', '01', '1:*', '99999999999', 'a', 5]) assert.equal(validUid(value), false);
});

test('Anhangindex wird begrenzt und Pfade bereinigt', () => {
  assert.equal(validAttachmentIndex('0'), true);
  assert.equal(validAttachmentIndex('1001'), false);
  assert.equal(validAttachmentIndex('-1'), false);
  assert.equal(cleanFilename('../private\\x\r\n.pdf', 0).includes('/'), false);
  assert.equal(cleanFilename('\\r', 1).includes('\\'), false);
});

test('Downloadheaders enthalten keine Header-Injektion und erzwingen Download', () => {
  const headers = downloadHeaders(cleanFilename('angebot\r\nX-Bad: 1.pdf', 0));
  assert.match(headers['Content-Disposition'], /^attachment;/);
  assert.equal(headers['Content-Type'], 'application/octet-stream');
  assert.equal(headers['Content-Disposition'].includes('\r'), false);
  assert.equal(headers['Content-Disposition'].includes('\n'), false);
});

test('E-Mail-Antwort verrät keine Rohdaten oder Anhangbytes', () => {
  const parsed = {
    from: { name: 'Anna', address: 'anna@example.com' },
    to: [{ name: 'Team', address: 'team@example.com' }],
    text: 'Hallo',
    html: '<p>Hallo</p>',
    subject: 'Betreff',
    attachments: [{ filename: 'report.pdf', mimeType: 'application/pdf', content: Uint8Array.of(1, 2, 3) }]
  };
  const result = publicMessage(parsed, 51, 'INBOX');
  assert.equal(result.from[0].email, 'anna@example.com');
  assert.equal(result.attachments[0].size, 3);
  assert.equal('content' in result.attachments[0], false);
  assert.equal(JSON.stringify(result).includes('Uint8Array'), false);
  assert.equal(result.readOnly, true);
});

test('Anhangbytes werden verlustfrei übernommen', () => {
  assert.deepEqual(attachmentBytes({ content: Uint8Array.of(7, 8, 9) }), Buffer.from([7, 8, 9]));
  assert.ok(MAX_MESSAGE_BYTES >= 1024 * 1024);
});
