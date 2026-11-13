import test from 'node:test';
import assert from 'node:assert/strict';
import { findSentFolder, isEmail, publicSendStatus, smtpConfig, validateSendPayload } from '../src/send-utils.mjs';

const id = 'b3c2d1e0-33ee-44aa-99bb-ffffffffffff';
const basic = {
  requestId: id,
  confirm: 'SEND',
  to: ['kunde@example.org'],
  cc: [],
  bcc: [],
  subject: 'Hallo',
  text: 'Guten Tag',
  attachments: []
};

test('SMTP default is an encrypted Hetzner connection on 587 and sending stays off', () => {
  const c = smtpConfig({ IMAP_USER: 'info@levuvo.com', IMAP_PASSWORD: 'secret' });
  assert.equal(c.host, 'mail.your-server.de');
  assert.equal(c.port, 587);
  assert.equal(c.configured, true);
  assert.equal(c.enabled, false);
});

test('Enabling requires explicit ENABLE_SEND=true', () => {
  assert.equal(smtpConfig({ IMAP_USER: 'info@levuvo.com', IMAP_PASSWORD: 'x', ENABLE_SEND: 'TRUE' }).enabled, false);
  assert.equal(smtpConfig({ IMAP_USER: 'info@levuvo.com', IMAP_PASSWORD: 'x', ENABLE_SEND: 'true' }).enabled, true);
  assert.equal(
    publicSendStatus(smtpConfig({ ENABLE_SEND: 'true' }), { configured: false, user: '' }).sendEnabled,
    false
  );
});

test('Email validation blocks injection and invalid addresses', () => {
  assert.equal(isEmail('kunde@example.org'), true);
  for (const bad of ['a@example.org\r\nBcc:evil@example.org', 'hello', 'a@localhost', 'a@@example.org'])
    assert.equal(isEmail(bad), false);
});

test('Message requires explicit send confirmation', () => {
  assert.throws(() => validateSendPayload({ ...basic, confirm: 'NO' }), /bestätigt/);
  assert.throws(() => validateSendPayload({ ...basic, confirm: undefined }), /bestätigt/);
});

test('Valid message gets safe fields and buffers for attachments', () => {
  const parsed = validateSendPayload({
    ...basic,
    cc: ['team@example.org'],
    bcc: ['blind@example.org'],
    attachments: [{ name: '../demo.txt', contentBase64: Buffer.from('test').toString('base64') }]
  });
  assert.deepEqual(parsed.to, ['kunde@example.org']);
  assert.deepEqual(parsed.bcc, ['blind@example.org']);
  assert.equal(parsed.attachments[0].filename, '.._demo.txt');
  assert.deepEqual(parsed.attachments[0].content, Buffer.from('test'));
});

test('Bcc, CC and To must be arrays of plain addresses', () => {
  assert.throws(() => validateSendPayload({ ...basic, cc: 'hacker@example.org' }), /CC/);
  assert.throws(() => validateSendPayload({ ...basic, to: [] }), /Empfänger/);
  assert.throws(() => validateSendPayload({ ...basic, bcc: ['a@example.org\r\nX-Injection: yes'] }), /BCC/);
});

test('Limits for message body and subject', () => {
  assert.throws(() => validateSendPayload({ ...basic, subject: 'a\r\nBcc: x' }), /Betreff/);
  assert.throws(() => validateSendPayload({ ...basic, text: ' '.repeat(5) }), /Nachrichtentext/);
  assert.throws(() => validateSendPayload({ ...basic, text: 'x'.repeat(100001) }), /Nachrichtentext/);
});

test('Invalid Base64 and large attachments are blocked', () => {
  assert.throws(
    () => validateSendPayload({ ...basic, attachments: [{ name: 'evil', contentBase64: 'not-valid==!' }] }),
    /Anhang/
  );
  assert.throws(
    () =>
      validateSendPayload({
        ...basic,
        attachments: Array.from({ length: 9 }, (_, i) => ({ name: `test${i}`, contentBase64: '' }))
      }),
    /Maximal/
  );
  assert.throws(
    () =>
      validateSendPayload({
        ...basic,
        attachments: [{ name: 'too-big', contentBase64: Buffer.alloc(8 * 1024 * 1024 + 1).toString('base64') }]
      }),
    /groß/
  );
});

test('Reply reference must not inject new headers', () => {
  assert.equal(validateSendPayload({ ...basic, inReplyTo: '<id@example.org>' }).inReplyTo, '<id@example.org>');
  assert.throws(
    () => validateSendPayload({ ...basic, inReplyTo: '<id@example.org>\r\nBcc: a@example.org' }),
    /Antwortreferenz/
  );
});

test('Sent folder is found via special-use or known names', () => {
  assert.equal(findSentFolder([{ path: 'INBOX' }, { path: 'INBOX.Sent', specialUse: '\\Sent' }]).path, 'INBOX.Sent');
  assert.equal(findSentFolder([{ path: 'Gesendet' }]).path, 'Gesendet');
  assert.equal(findSentFolder([{ path: 'INBOX' }]), null);
});

test('Explicit SENT_FOLDER is not silently redirected to another folder', () => {
  const folders = [{ path: 'Sent', specialUse: '\\Sent' }, { path: 'Gesendet' }];
  assert.equal(findSentFolder(folders, 'Gesendet')?.path, 'Gesendet');
  assert.equal(findSentFolder(folders, 'INBOX.Sent'), null);
  assert.equal(findSentFolder([{ path: 'Sent Messages', name: 'Sent Messages' }])?.path, 'Sent Messages');
});
