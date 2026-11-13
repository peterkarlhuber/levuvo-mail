import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanBeforeUid, mailConfig, folderName, cleanLimit, toMessageInfo } from '../src/config.mjs';

test('Account without credentials counts as not configured', () => {
  const c = mailConfig({});
  assert.equal(c.configured, false);
  assert.equal(c.host, 'mail.your-server.de');
  assert.equal(c.port, 993);
});

test('Configuration with a mailbox is enabled', () => {
  assert.equal(mailConfig({ IMAP_USER: ' test@example.com ', IMAP_PASSWORD: 'secret' }).configured, true);
});

test('Limit is clamped to 1 to 100, default 40', () => {
  assert.equal(cleanLimit(999), 100);
  assert.equal(cleanLimit(-1), 1);
  assert.equal(cleanLimit('hallo'), 40);
});

test('Page cursor accepts only positive UIDs', () => {
  assert.equal(cleanBeforeUid(undefined), null);
  assert.equal(cleanBeforeUid('36'), 36);
  assert.throws(() => cleanBeforeUid('0'), /Seitenzeiger/);
  assert.throws(() => cleanBeforeUid('1;DELETE'), /Seitenzeiger/);
  assert.throws(() => cleanBeforeUid('99999999999'), /Seitenzeiger/);
});

test('Message headers reveal no further message data', () => {
  const result = toMessageInfo({
    uid: 12,
    seq: 3,
    envelope: { subject: 'Hallo', from: [{ name: 'Ada', address: 'ada@example.com' }] },
    flags: new Set(),
    source: Buffer.from('Privat')
  });
  assert.equal(result.subject, 'Hallo');
  assert.equal(result.unread, true);
  assert.equal('source' in result, false);
});

test('IMAP Systemordner deutsch benannt', () => {
  assert.equal(folderName({ path: 'INBOX' }), 'Posteingang');
  assert.equal(folderName({ path: 'Sent', specialUse: '\\Sent' }), 'Gesendet');
});
