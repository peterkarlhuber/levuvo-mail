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

test('SMTP-Standard ist verschlüsselte Hetzner-Verbindung auf 587 und Versand bleibt aus', () => {
  const c = smtpConfig({ IMAP_USER: 'info@levuvo.com', IMAP_PASSWORD: 'secret' });
  assert.equal(c.host, 'mail.your-server.de');
  assert.equal(c.port, 587);
  assert.equal(c.configured, true);
  assert.equal(c.enabled, false);
});

test('Aktivierung benötigt explizit ENABLE_SEND=true', () => {
  assert.equal(smtpConfig({ IMAP_USER: 'info@levuvo.com', IMAP_PASSWORD: 'x', ENABLE_SEND: 'TRUE' }).enabled, false);
  assert.equal(smtpConfig({ IMAP_USER: 'info@levuvo.com', IMAP_PASSWORD: 'x', ENABLE_SEND: 'true' }).enabled, true);
  assert.equal(
    publicSendStatus(smtpConfig({ ENABLE_SEND: 'true' }), { configured: false, user: '' }).sendEnabled,
    false
  );
});

test('E-Mail-Validierung blockiert Injektion und ungültige Adressen', () => {
  assert.equal(isEmail('kunde@example.org'), true);
  for (const bad of ['a@example.org\r\nBcc:evil@example.org', 'hello', 'a@localhost', 'a@@example.org'])
    assert.equal(isEmail(bad), false);
});

test('Nachricht benötigt ausdrückliche Versandfreigabe', () => {
  assert.throws(() => validateSendPayload({ ...basic, confirm: 'NO' }), /bestätigt/);
  assert.throws(() => validateSendPayload({ ...basic, confirm: undefined }), /bestätigt/);
});

test('Gültige Nachricht erhält sichere Felder und Puffern für Attachments', () => {
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

test('Bcc, CC und An müssen Arrays aus reinen Adressen sein', () => {
  assert.throws(() => validateSendPayload({ ...basic, cc: 'hacker@example.org' }), /CC/);
  assert.throws(() => validateSendPayload({ ...basic, to: [] }), /Empfänger/);
  assert.throws(() => validateSendPayload({ ...basic, bcc: ['a@example.org\r\nX-Injection: yes'] }), /BCC/);
});

test('Grenzen für Nachrichtentext und Betreff', () => {
  assert.throws(() => validateSendPayload({ ...basic, subject: 'a\r\nBcc: x' }), /Betreff/);
  assert.throws(() => validateSendPayload({ ...basic, text: ' '.repeat(5) }), /Nachrichtentext/);
  assert.throws(() => validateSendPayload({ ...basic, text: 'x'.repeat(100001) }), /Nachrichtentext/);
});

test('Unzulässiges Base64 und große Anhänge werden blockiert', () => {
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

test('Antwortreferenz darf keine neuen Header injizieren', () => {
  assert.equal(validateSendPayload({ ...basic, inReplyTo: '<id@example.org>' }).inReplyTo, '<id@example.org>');
  assert.throws(
    () => validateSendPayload({ ...basic, inReplyTo: '<id@example.org>\r\nBcc: a@example.org' }),
    /Antwortreferenz/
  );
});

test('Sent-Ordner wird per Special-Use oder bekannten Namen gefunden', () => {
  assert.equal(findSentFolder([{ path: 'INBOX' }, { path: 'INBOX.Sent', specialUse: '\\Sent' }]).path, 'INBOX.Sent');
  assert.equal(findSentFolder([{ path: 'Gesendet' }]).path, 'Gesendet');
  assert.equal(findSentFolder([{ path: 'INBOX' }]), null);
});

test('Expliziter SENT_FOLDER wird nicht still auf anderen Ordner umgebogen', () => {
  const folders = [{ path: 'Sent', specialUse: '\\Sent' }, { path: 'Gesendet' }];
  assert.equal(findSentFolder(folders, 'Gesendet')?.path, 'Gesendet');
  assert.equal(findSentFolder(folders, 'INBOX.Sent'), null);
  assert.equal(findSentFolder([{ path: 'Sent Messages', name: 'Sent Messages' }])?.path, 'Sent Messages');
});
