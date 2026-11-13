import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAccounts, publicAccounts, resolveAccount, accountScopedRequestKey } from '../src/accounts.mjs';

const env = {
  IMAP_USER: 'main@levuvo.at',
  IMAP_PASSWORD: 'primary-secret',
  SMTP_HOST: 'mail.your-server.de',
  ENABLE_SEND: 'false',
  MAIL_ACCOUNT_2_LABEL: 'Support',
  MAIL_ACCOUNT_2_USER: 'support@levuvo.at',
  MAIL_ACCOUNT_2_PASSWORD: 'secondary-secret',
  MAIL_ACCOUNT_2_SENT_FOLDER: 'INBOX.Sent',
  MAIL_ACCOUNT_3_USER: 'office@levuvo.at',
  MAIL_ACCOUNT_3_PASSWORD: 'third-secret'
};

test('Main account stays backward compatible', () => {
  const accounts = buildAccounts({ IMAP_USER: 'main@levuvo.at', IMAP_PASSWORD: 'p' });
  assert.equal(accounts.length, 1);
  assert.equal(resolveAccount(accounts, undefined).imap.user, 'main@levuvo.at');
});

test('Drei Konten bleiben strikt getrennt', () => {
  const accounts = buildAccounts(env);
  assert.equal(accounts.length, 3);
  assert.equal(resolveAccount(accounts, 'account2').imap.user, 'support@levuvo.at');
  assert.equal(resolveAccount(accounts, 'account2').imap.password, 'secondary-secret');
  assert.equal(resolveAccount(accounts, 'primary').imap.password, 'primary-secret');
  assert.equal(resolveAccount(accounts, 'account3').imap.password, 'third-secret');
  assert.equal(resolveAccount(accounts, 'account2').sentFolder, 'INBOX.Sent');
  assert.equal(resolveAccount(accounts, 'account2').smtp.user, 'support@levuvo.at');
});

test('Account list never reveals passwords', () => {
  const json = JSON.stringify(publicAccounts(buildAccounts(env)));
  assert.doesNotMatch(json, /secret|password|SMTP_HOST/i);
  assert.match(json, /support@levuvo.at/);
});

test('Unknown, manipulated or duplicate account IDs are rejected', () => {
  const accounts = buildAccounts(env);
  for (const id of ['', 'account6', '../primary', 'ACCOUNT2', ['primary', 'account2'], 2]) {
    assert.throws(() => resolveAccount(accounts, id));
  }
  assert.throws(() => resolveAccount(buildAccounts({}), 'account2'), /Unbekanntes Konto/);
});

test('Sending identity is separate for each account', () => {
  const accounts = buildAccounts(env);
  assert.notEqual(accountScopedRequestKey(accounts[0], 'test-id'), accountScopedRequestKey(accounts[1], 'test-id'));
});

test('Partially configured additional account is not silently accepted', () => {
  assert.throws(() => buildAccounts({ MAIL_ACCOUNT_2_USER: 'support@levuvo.at' }), /USER und PASSWORD/);
  assert.throws(() => buildAccounts({ MAIL_ACCOUNT_2_PASSWORD: 'hidden' }), /USER und PASSWORD/);
});

test('Doppelte Mailbox-Adresse verhindert mehrdeutige Konten', () => {
  assert.throws(() => buildAccounts({ ...env, MAIL_ACCOUNT_2_USER: 'MAIN@levuvo.at' }), /doppelt/);
});

test('SMTP and IMAP write permission stay off by default', () => {
  const accounts = buildAccounts(env);
  assert.equal(accounts[0].smtp.enabled, false);
  assert.equal(accounts[1].smtp.enabled, false);
});

test('Per-account signatures stay separate and contain real line breaks', () => {
  const acc = buildAccounts({
    IMAP_USER: 'peter@levuvo.at',
    IMAP_PASSWORD: 'secret',
    MAIL_PRIMARY_SIGNATURE: 'Grüße\\nPeter',
    MAIL_ACCOUNT_2_USER: 'office@levuvo.at',
    MAIL_ACCOUNT_2_PASSWORD: 'other',
    MAIL_ACCOUNT_2_SIGNATURE: 'Office\\nLevuvo'
  });
  assert.equal(acc[0].signature, 'Grüße\nPeter');
  assert.equal(acc[1].signature, 'Office\nLevuvo');
  assert.equal('signature' in publicAccounts(acc)[0], false);
});
