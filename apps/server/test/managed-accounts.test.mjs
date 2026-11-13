import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAccountManager, normalizeAccount, settingsPath } from '../src/managed-accounts.mjs';

const env = {
  IMAP_USER: 'peter@levuvo.at',
  IMAP_PASSWORD: 'legacy-secret',
  SMTP_HOST: 'mail.your-server.de',
  SMTP_USER: 'peter@levuvo.at',
  SMTP_PASSWORD: 'legacy-secret',
  ENABLE_SEND: 'false',
  MAIL_PRIMARY_LABEL: 'Peter',
  MAIL_ACCOUNT_2_USER: 'office@levuvo.at',
  MAIL_ACCOUNT_2_PASSWORD: 'office-secret',
  MAIL_ACCOUNT_2_LABEL: 'Office'
};
const extra = {
  label: 'Support',
  user: 'support@levuvo.at',
  password: 'new-secret',
  imapHost: 'mail.your-server.de',
  smtpHost: 'mail.your-server.de',
  sentFolder: 'INBOX.Sent',
  draftsFolder: 'INBOX.Drafts',
  smtpPort: 587,
  imapPort: 993
};
function makeVault() {
  const secrets = new Map();
  return {
    available: true,
    secrets,
    set(id, kind, value) {
      secrets.set(`${id}:${kind}`, value);
    },
    get(id, kind) {
      return secrets.get(`${id}:${kind}`) || '';
    },
    delete(id, kind) {
      secrets.delete(`${id}:${kind}`);
    }
  };
}
async function setup(override = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'levuvo-accounts-test-'));
  const filename = path.join(dir, 'private', 'accounts.json');
  const vault = makeVault();
  const manager = await createAccountManager({ env: { ...env, ...override }, filename, vault });
  return { manager, filename, vault };
}

test('New UI accounts store only metadata, never IMAP or SMTP passwords in the JSON', async () => {
  const { manager, filename, vault } = await setup();
  const item = await manager.create(extra);
  assert.match(item.id, /^managed-[a-f0-9]{12}$/);
  assert.equal(vault.get(item.id, 'imap'), 'new-secret');
  assert.equal(vault.get(item.id, 'smtp'), 'new-secret');
  assert.equal(manager.all().find(a => a.id === item.id).imap.user, 'support@levuvo.at');
  const stored = await readFile(filename, 'utf8');
  assert.doesNotMatch(stored, /new-secret|legacy-secret|office-secret|"password"\s*:/i);
  assert.equal(manager.listManagement().find(a => a.id === item.id).password, undefined);
  assert.equal(manager.all().length, 3);
});

test('Import of an existing .env account is backward compatible and also works without .env passwords', async () => {
  const { manager, filename, vault } = await setup();
  const adopted = await manager.adopt('account2');
  assert.equal(adopted.id, 'account2');
  assert.equal(manager.all().filter(a => a.id === 'account2').length, 1);
  assert.equal(manager.all().find(a => a.id === 'account2').imap.password, 'office-secret');
  const newManager = await createAccountManager({
    filename,
    vault,
    env: {
      IMAP_USER: '',
      IMAP_PASSWORD: '',
      MAIL_ACCOUNT_2_USER: '',
      MAIL_ACCOUNT_2_PASSWORD: '',
      ENABLE_SEND: 'false'
    }
  });
  assert.equal(newManager.all().find(a => a.id === 'account2').imap.user, 'office@levuvo.at');
  assert.equal(newManager.all().find(a => a.id === 'account2').imap.password, 'office-secret');
});

test('Primary mailbox can be continued via the keychain even if .env is empty', async () => {
  const { manager, filename, vault } = await setup();
  await manager.adopt('primary');
  const after = await createAccountManager({ filename, vault, env: {} });
  assert.equal(after.all().find(a => a.id === 'primary').imap.user, 'peter@levuvo.at');
  assert.equal(after.all().find(a => a.id === 'primary').smtp.password, 'legacy-secret');
});

test('New accounts are isolated from legacy accounts; duplicates and more than five accounts are blocked', async () => {
  const { manager } = await setup();
  await assert.rejects(() => manager.create({ ...extra, user: 'peter@levuvo.at' }), /bereits/);
  await manager.create(extra);
  await assert.rejects(() => manager.create(extra), /bereits/);
  await manager.create({ ...extra, user: 'a@levuvo.at' });
  await manager.create({ ...extra, user: 'b@levuvo.at' });
  await assert.rejects(() => manager.create({ ...extra, user: 'c@levuvo.at' }), /fünf/);
});

test('Update without password does not replace the secret; removing does not touch the remote mailbox', async () => {
  const { manager, vault } = await setup();
  const account = await manager.create(extra);
  await manager.update(account.id, { label: 'Support NEU', signature: 'Danke', password: '', smtpPassword: '' });
  assert.equal(vault.get(account.id, 'imap'), 'new-secret');
  assert.equal(manager.all().find(a => a.id === account.id).label, 'Support NEU');
  assert.deepEqual(await manager.remove(account.id), { removed: true, cleanupFailed: false });
  assert.equal(vault.get(account.id, 'imap'), '');
  assert.equal(manager.all().length, 2);
});

test('Without an OS keychain there is no plain-text fallback', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'levuvo-no-vault-'));
  const manager = await createAccountManager({
    env,
    filename: path.join(dir, 'accounts.json'),
    vault: { available: false }
  });
  await assert.rejects(() => manager.create(extra), /nicht verfügbar/);
  await assert.rejects(() => manager.adopt('primary'), /nicht verfügbar/);
});

test('Shared IMAP/SMTP password is updated in sync', async () => {
  const { manager, vault } = await setup();
  const a = await manager.create(extra);
  await manager.update(a.id, { password: 'rotated', smtpPassword: '' });
  assert.equal(vault.get(a.id, 'imap'), 'rotated');
  assert.equal(vault.get(a.id, 'smtp'), 'rotated');
});

test('Inputs prevent wrong ports, header line breaks and invalid mailbox addresses', () => {
  assert.throws(() => normalizeAccount({ ...extra, imapPort: 143 }), /Port/);
  assert.throws(() => normalizeAccount({ ...extra, user: 'bad address' }), /E-Mail/);
  assert.throws(() => normalizeAccount({ ...extra, imapHost: 'bad\rhost' }), /Textwert/);
  assert.throws(() => normalizeAccount({ ...extra, sentFolder: 'INBOX\nSent' }), /Textwert|Ordnerpfad/);
});

test('Password update is atomic with the metadata file; an error rolls back changed secrets', async () => {
  const { manager, vault } = await setup();
  const account = await manager.create(extra);
  // Force an invalid location for persistence by renaming not possible with manager; instead
  // simulate a credential vault write failure before persist.
  const old = vault.get(account.id, 'imap');
  const write = vault.set.bind(vault);
  vault.set = (id, kind, value) => {
    if (kind === 'smtp' && value === 'break') throw Error('vault unavailable');
    return write(id, kind, value);
  };
  await assert.rejects(() => manager.update(account.id, { password: 'new-pass', smtpPassword: 'break' }));
  assert.equal(vault.get(account.id, 'imap'), old);
  assert.equal(manager.all().find(a => a.id === account.id).label, 'Support');
});

test('Storage path uses the OS user profile and not a ZIP project file', () => {
  assert.match(
    settingsPath({}, '/Users/test', 'darwin').replaceAll('\\', '/'),
    /Library\/Application Support\/Levuvo Mail\/accounts.json$/
  );
  assert.match(settingsPath({ APPDATA: 'C:\\Users\\test\\AppData\\Roaming' }, 'ignored', 'win32'), /Levuvo Mail/);
});
