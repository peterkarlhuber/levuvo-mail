import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyPendingRestore,
  cancelRestore,
  collectBackupContent,
  decryptBackup,
  encryptBackup,
  pendingRestore,
  readBackupHeader,
  stageRestore
} from '../src/backup.mjs';
import { createLocalCalendar } from '../src/local-calendar.mjs';
import { createLocalContacts } from '../src/local-contacts.mjs';
import { createMailServer } from '../src/app.mjs';
import { validateContact } from '../src/vcard.mjs';
import { createEventIcs, validateEventInput } from '../src/calendar-model.mjs';

const FAST = { N: 2 ** 14, r: 8, p: 1 };
const PASSWORD = 'korrekt Pferd Batterie';

const vault = () => {
  const m = new Map();
  return {
    available: true,
    map: m,
    get: (i, k) => m.get(`${i}:${k}`) || '',
    set: (i, k, v) => m.set(`${i}:${k}`, v),
    delete: (i, k) => m.delete(`${i}:${k}`)
  };
};
const tmp = t => {
  const dir = mkdtempSync(join(tmpdir(), 'lv-backup-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const account = (id, user, host = 'mail.example.org') => ({
  id,
  label: user,
  user,
  smtpUser: user,
  imapHost: host,
  imapPort: 993,
  smtpHost: host,
  smtpPort: 587,
  auth: 'password'
});
const write = (dir, name, value) =>
  writeFileSync(join(dir, name), typeof value === 'string' ? value : JSON.stringify(value));

/** A device with data in every store. */
async function device(t) {
  const dir = tmp(t);
  const keys = vault();
  write(dir, 'accounts.json', { version: 1, accounts: [account('primary', 'anna@example.org')] });
  write(dir, 'app-settings.json', { crashReports: false, localIndex: true });
  write(dir, 'templates.json', { templates: [{ id: 't1', name: 'Danke', body: 'Vielen Dank!' }] });
  write(dir, 'followups.json', { snoozed: [{ id: 's1' }], followups: [{ id: 'f1' }, { id: 'f2' }] });
  write(dir, 'instance.json', { id: 'a'.repeat(32) });
  write(dir, 'crypto.json', { pgp: { own: [{ fingerprint: 'ABCDEF0123456789' }], public: [] } });
  write(dir, 'ai.json', { enabled: true, provider: 'ollama' });
  write(dir, 'ai-log.jsonl', '{"type":"settings"}\n{"type":"summary"}\n');
  keys.set('crypto', 'pgp:ABCDEF0123456789', 'armored-test-key-material');
  keys.set('primary', 'imap', 'imap-secret-password');
  keys.set('ai', 'key-openai', 'sk-secret');
  const calendar = await createLocalCalendar({ filename: join(dir, 'calendar-local.json'), vault: keys });
  const [cal] = calendar.listCalendars().calendars;
  const { uid, ics } = createEventIcs(
    validateEventInput({
      summary: 'Zahnarzt',
      allDay: false,
      tzid: 'Europe/Vienna',
      start: '2026-12-01T09:00',
      end: '2026-12-01T10:00'
    })
  );
  await calendar.createCalendarObject(cal.url, uid, ics);
  await calendar.flush();
  const contacts = await createLocalContacts({ filename: join(dir, 'contacts-local.json'), vault: keys });
  await contacts.save({ contact: validateContact({ firstName: 'Berta', emails: [{ value: 'berta@example.org' }] }) });
  await contacts.flush();
  return { dir, keys };
}

test('Backup: round trip to a new computer with other keychain keys', async t => {
  const source = await device(t);
  const content = await collectBackupContent({ dir: source.dir, vault: source.keys });
  assert.equal(content.files['instance.json'], undefined, 'installation ID stays on the device');
  const file = await encryptBackup({ ...content, uiPrefs: { theme: 'dark' } }, PASSWORD, { app: '9.9.9', kdf: FAST });

  // Nothing readable in the file, and no account or AI secret inside the encrypted content.
  assert.doesNotMatch(file, /Zahnarzt|Berta|anna@example|Vielen Dank|armored-test-key-material/);
  const plainContent = JSON.stringify(content);
  assert.doesNotMatch(plainContent, /imap-secret-password|sk-secret/);
  assert.equal(readBackupHeader(file).app, '9.9.9');

  const backup = await decryptBackup(file, PASSWORD);
  assert.deepEqual(backup.uiPrefs, { theme: 'dark' });
  assert.equal(backup.summary.accounts, 1);
  assert.equal(backup.summary.contacts, 1);
  assert.equal(backup.summary.events, 1);
  assert.equal(backup.summary.templates, 1);
  assert.equal(backup.summary.followups, 2);
  assert.equal(backup.summary.ownKeys, 1);
  assert.equal(backup.summary.assistant, true);

  const target = { dir: tmp(t), keys: vault() };
  await stageRestore({ dir: target.dir, vault: target.keys, backup });
  assert.ok(await pendingRestore(target.dir));
  assert.equal(existsSync(join(target.dir, 'templates.json')), false, 'nothing applied before the restart');
  // Staged calendar and contacts are already encrypted with the new device's keys.
  assert.doesNotMatch(readFileSync(join(target.dir, 'restore-pending', 'contacts-local.json'), 'utf8'), /Berta/);
  // Private keys wait under a staging name until the restart (audit 2.3.0, H-06).
  assert.equal(target.keys.get('crypto', 'pgp:ABCDEF0123456789'), '');

  const applied = await applyPendingRestore({ dir: target.dir, vault: target.keys });
  assert.ok(applied);
  assert.equal(target.keys.get('crypto', 'pgp:ABCDEF0123456789'), 'armored-test-key-material');
  assert.equal(target.keys.get('local', 'restore-pending-crypto-pgp:ABCDEF0123456789'), '');
  assert.equal(await pendingRestore(target.dir), null);
  const calendar = await createLocalCalendar({ filename: join(target.dir, 'calendar-local.json'), vault: target.keys });
  const events = calendar.events(Date.parse('2026-11-30T00:00:00Z'), Date.parse('2026-12-02T00:00:00Z')).events;
  assert.equal(events.length, 1);
  assert.ok(JSON.stringify(events).includes('Zahnarzt'));
  const contacts = await createLocalContacts({ filename: join(target.dir, 'contacts-local.json'), vault: target.keys });
  assert.equal(contacts.contacts().contacts[0].name, 'Berta');
  assert.equal(JSON.parse(readFileSync(join(target.dir, 'templates.json'), 'utf8')).templates[0].name, 'Danke');
  assert.equal(readFileSync(join(target.dir, 'ai-log.jsonl'), 'utf8'), '{"type":"settings"}\n{"type":"summary"}\n');
  assert.equal(target.keys.get('primary', 'imap'), '', 'passwords are entered again after a move');
});

test('Backup: wrong password, tampering and weak or crafted parameters are rejected', async t => {
  const source = await device(t);
  const content = await collectBackupContent({ dir: source.dir, vault: source.keys });
  await assert.rejects(encryptBackup(content, 'kurz', { kdf: FAST }), e => e.code === 'backup_password_short');
  const file = await encryptBackup(content, PASSWORD, { kdf: FAST });
  await assert.rejects(decryptBackup(file, 'ein anderes Passwort'), e => e.code === 'backup_password_wrong');

  const doc = JSON.parse(file);
  const tampered = JSON.stringify({ ...doc, createdAt: '2020-01-01T00:00:00.000Z' });
  await assert.rejects(decryptBackup(tampered, PASSWORD), e => e.code === 'backup_password_wrong');
  const expensive = JSON.stringify({ ...doc, kdf: { ...doc.kdf, N: 2 ** 24 } });
  await assert.rejects(decryptBackup(expensive, PASSWORD), e => e.code === 'backup_invalid');
  assert.throws(
    () => readBackupHeader('{"format":"other"}'),
    e => e.code === 'backup_invalid'
  );
  assert.throws(
    () => readBackupHeader(JSON.stringify({ ...doc, version: 2 })),
    e => e.code === 'backup_version'
  );
});

test('Backup: a locked calendar stops the backup instead of leaving it out', async t => {
  const source = await device(t);
  source.keys.delete('local', 'calendar-key');
  await assert.rejects(collectBackupContent({ dir: source.dir, vault: source.keys }), e => e.code === 'backup_locked');
});

test('Restore: current data is kept aside, and passwords of a replaced mailbox are dropped', async t => {
  const source = await device(t);
  const backup = await decryptBackup(
    await encryptBackup(await collectBackupContent({ dir: source.dir, vault: source.keys }), PASSWORD, { kdf: FAST }),
    PASSWORD
  );
  const dir = tmp(t);
  const keys = vault();
  // This device: `primary` is another mailbox, `account2` the same mailbox as in no backup.
  write(dir, 'accounts.json', {
    version: 1,
    accounts: [account('primary', 'other@example.net', 'imap.example.net'), account('account2', 'x@example.org')]
  });
  write(dir, 'cloud.json', { hidden: ['x'], colors: {} });
  write(dir, 'instance.json', { id: 'b'.repeat(32) });
  keys.set('primary', 'imap', 'password-of-other-mailbox');
  keys.set('account2', 'imap', 'password-x');
  await stageRestore({ dir, vault: keys, backup });
  await applyPendingRestore({ dir, vault: keys });

  assert.equal(keys.get('primary', 'imap'), '', 'never sent to the restored mailbox');
  assert.equal(keys.get('account2', 'imap'), '', 'account no longer exists');
  assert.equal(existsSync(join(dir, 'cloud.json')), false, 'backup without the file replaces it as well');
  assert.equal(JSON.parse(readFileSync(join(dir, 'instance.json'), 'utf8')).id, 'b'.repeat(32));
  const [copy] = readdirSync(join(dir, 'before-restore'));
  assert.ok(existsSync(join(dir, 'before-restore', copy, 'cloud.json')));
  assert.match(readFileSync(join(dir, 'before-restore', copy, 'accounts.json'), 'utf8'), /other@example\.net/);

  // Same mailbox under the same ID keeps its password (restore on the same computer).
  const again = tmp(t);
  const sameKeys = vault();
  write(again, 'accounts.json', { version: 1, accounts: [account('primary', 'anna@example.org')] });
  sameKeys.set('primary', 'imap', 'anna-password');
  await stageRestore({ dir: again, vault: sameKeys, backup });
  await applyPendingRestore({ dir: again, vault: sameKeys });
  assert.equal(sameKeys.get('primary', 'imap'), 'anna-password');
});

test('Restore routes: backup, staged restore freezes changes until the restart', async t => {
  const dir = tmp(t);
  const keys = vault();
  const SECRET = 'e'.repeat(64);
  const HOST = '127.0.0.1:4790';
  const GET = { host: HOST, cookie: `levuvo_desktop_session=${SECRET}` };
  const POST = { ...GET, origin: `http://${HOST}`, 'content-type': 'application/json', 'x-levuvo-action': 'backup-v1' };
  let restarts = 0;
  // Waits for the restart event itself instead of a fixed time (QA-LEV-011: slow CI timers).
  let restarted;
  const restartRequested = new Promise(resolve => (restarted = resolve));
  const s = await createMailServer({
    desktop: true,
    sessionSecret: SECRET,
    vault: keys,
    dataDir: dir,
    accountsFile: join(dir, 'accounts.json'),
    watch: false,
    background: false,
    onRestartRequested: () => {
      restarts++;
      restarted();
    }
  });
  s.setPortForTesting(4790);
  t.after(() => s.close());

  const weak = await s.api.inject({
    method: 'POST',
    url: '/api/backup/create',
    headers: POST,
    payload: { password: 'x' }
  });
  assert.equal(weak.statusCode, 400);
  const created = await s.api.inject({
    method: 'POST',
    url: '/api/backup/create',
    headers: POST,
    payload: { password: PASSWORD, uiPrefs: { theme: 'light' } }
  });
  assert.equal(created.statusCode, 200);
  assert.match(created.headers['content-disposition'], /levuvo-backup-\d{4}-\d{2}-\d{2}\.levuvo/);
  const file = created.body;

  const wrongAction = await s.api.inject({
    method: 'POST',
    url: '/api/backup/restore',
    headers: { ...POST, 'x-levuvo-action': 'mail-v1' },
    payload: { file, password: PASSWORD }
  });
  assert.equal(wrongAction.statusCode, 403);
  const restored = await s.api.inject({
    method: 'POST',
    url: '/api/backup/restore',
    headers: POST,
    payload: { file, password: PASSWORD }
  });
  assert.equal(restored.statusCode, 200, restored.body);
  assert.deepEqual(restored.json().uiPrefs, { theme: 'light' });

  const blocked = await s.api.inject({
    method: 'POST',
    url: '/api/app-settings',
    headers: { ...POST, 'x-levuvo-action': 'mail-v1' },
    payload: { crashReports: true }
  });
  assert.equal(blocked.statusCode, 409);
  assert.equal(blocked.json().code, 'backup_restart_pending');
  const status = (await s.api.inject({ method: 'GET', url: '/api/backup/status', headers: GET })).json();
  assert.ok(status.pending);
  assert.equal(status.canRestart, true);

  const cancelled = await s.api.inject({ method: 'POST', url: '/api/backup/cancel', headers: POST, payload: {} });
  assert.equal(cancelled.statusCode, 200);
  const free = await s.api.inject({
    method: 'POST',
    url: '/api/app-settings',
    headers: { ...POST, 'x-levuvo-action': 'mail-v1' },
    payload: { crashReports: false }
  });
  assert.notEqual(free.statusCode, 409);

  await s.api.inject({
    method: 'POST',
    url: '/api/backup/restore',
    headers: POST,
    payload: { file, password: PASSWORD }
  });
  const restart = await s.api.inject({ method: 'POST', url: '/api/backup/restart', headers: POST, payload: {} });
  assert.equal(restart.statusCode, 200);
  // The server's restart timer is unref'd; a ref'd one keeps the test process alive meanwhile.
  const alive = setInterval(() => {}, 1000);
  await restartRequested;
  clearInterval(alive);
  assert.equal(restarts, 1);
});

test('Backup routes are rate-limited', async t => {
  const dir = tmp(t);
  const SECRET = 'e'.repeat(64);
  const HOST = '127.0.0.1:4791';
  const POST = {
    host: HOST,
    cookie: `levuvo_desktop_session=${SECRET}`,
    origin: `http://${HOST}`,
    'content-type': 'application/json',
    'x-levuvo-action': 'backup-v1'
  };
  const s = await createMailServer({
    desktop: true,
    sessionSecret: SECRET,
    vault: vault(),
    dataDir: dir,
    accountsFile: join(dir, 'accounts.json'),
    watch: false,
    background: false
  });
  s.setPortForTesting(4791);
  t.after(() => s.close());
  const codes = [];
  for (let i = 0; i < 11; i++)
    codes.push(
      await s.api.inject({ method: 'POST', url: '/api/backup/create', headers: POST, payload: { password: 'x' } })
    );
  assert.deepEqual(
    codes.slice(0, 10).map(r => r.statusCode),
    Array(10).fill(400)
  );
  assert.equal(codes[10].statusCode, 429);
  assert.equal(codes[10].json().error, 'Zu viele Versuche. Bitte eine Minute warten.');
});

test('Backup: shared spaces travel as encrypted files together with both keychain entries', async t => {
  const source = await device(t);
  const space = 'a'.repeat(32);
  mkdirSync(join(source.dir, 'spaces', 'blobs'), { recursive: true });
  write(join(source.dir, 'spaces'), `${space}.lvs`, '{"v":1,"iv":"x","tag":"y","data":"sealed-space"}');
  write(join(source.dir, 'spaces'), 'index.lvs', '{"v":1,"data":"sealed-index"}');
  writeFileSync(join(source.dir, 'spaces', 'blobs', `${'b'.repeat(16)}.0`), Buffer.from([0, 1, 2, 255]));
  write(join(source.dir, 'spaces'), 'stray.txt', 'not part of the store');

  // Without the keys the spaces could never be opened again: no backup instead of a broken one.
  await assert.rejects(collectBackupContent({ dir: source.dir, vault: source.keys }), e => e.code === 'backup_locked');
  source.keys.set('local', 'spaces-key', 'c'.repeat(64));
  source.keys.set('local', 'spaces-identity', '{"identity":"source"}');

  const backup = await decryptBackup(
    await encryptBackup(await collectBackupContent({ dir: source.dir, vault: source.keys }), PASSWORD, { kdf: FAST }),
    PASSWORD
  );
  assert.equal(backup.summary.spaces, 1);
  assert.deepEqual(Object.keys(backup.spaces).sort(), [`${space}.lvs`, `blobs/${'b'.repeat(16)}.0`, 'index.lvs']);

  // The new device already has its own spaces and keys.
  const dir = tmp(t);
  const keys = vault();
  mkdirSync(join(dir, 'spaces'), { recursive: true });
  write(join(dir, 'spaces'), `${'d'.repeat(32)}.lvs`, 'old device space');
  keys.set('local', 'spaces-key', 'e'.repeat(64));
  keys.set('local', 'spaces-identity', '{"identity":"target"}');

  await stageRestore({ dir, vault: keys, backup });
  assert.equal(keys.get('local', 'spaces-key'), 'e'.repeat(64), 'unchanged until the restart');
  await cancelRestore(dir, keys);
  assert.equal(keys.get('local', 'restore-pending-spaces-key'), '');
  assert.ok(existsSync(join(dir, 'spaces', `${'d'.repeat(32)}.lvs`)));

  await stageRestore({ dir, vault: keys, backup });
  await applyPendingRestore({ dir, vault: keys });
  assert.equal(keys.get('local', 'spaces-key'), 'c'.repeat(64));
  assert.equal(keys.get('local', 'spaces-identity'), '{"identity":"source"}');
  assert.equal(keys.get('local', 'spaces-key-before-restore'), 'e'.repeat(64));
  assert.equal(keys.get('local', 'restore-pending-spaces-identity'), '');
  assert.deepEqual(readdirSync(join(dir, 'spaces')).sort(), [`${space}.lvs`, 'blobs', 'index.lvs']);
  assert.deepEqual([...readFileSync(join(dir, 'spaces', 'blobs', `${'b'.repeat(16)}.0`))], [0, 1, 2, 255]);
  const [copy] = readdirSync(join(dir, 'before-restore'));
  assert.ok(existsSync(join(dir, 'before-restore', copy, 'spaces', `${'d'.repeat(32)}.lvs`)));

  // A crafted path inside a backup is refused, never written.
  const crafted = await encryptBackup(
    { files: {}, secrets: {}, spaces: { '../evil.lvs': 'AA==' }, localSecrets: {} },
    PASSWORD,
    { kdf: FAST }
  );
  await assert.rejects(decryptBackup(crafted, PASSWORD), e => e.code === 'backup_invalid');
});

test('DB-LEV-005: backups from a newer app or with a newer store format are refused before restoring', async () => {
  const { newerApp } = await import('../src/backup.mjs');
  assert.equal(newerApp('2.4.0', '2.3.0'), true);
  assert.equal(newerApp('2.3.0', '2.3.0'), false);
  assert.equal(newerApp('2.2.9', '2.3.0'), false);
  assert.equal(newerApp('10.0.0', '9.9.9'), true);
  const accounts = JSON.stringify({ version: 1, accounts: [] });
  const newer = await encryptBackup({ files: { 'accounts.json': accounts } }, PASSWORD, { app: '2.4.0', kdf: FAST });
  await assert.rejects(decryptBackup(newer, PASSWORD, { ownApp: '2.3.0' }), e => e.code === 'backup_version');
  assert.ok(await decryptBackup(newer, PASSWORD, { ownApp: '2.4.0' }));
  const format2 = await encryptBackup(
    { files: { 'accounts.json': JSON.stringify({ version: 2, accounts: [] }) } },
    PASSWORD,
    { app: '2.3.0', kdf: FAST }
  );
  await assert.rejects(decryptBackup(format2, PASSWORD, { ownApp: '2.3.0' }), e => e.code === 'backup_version');
  const broken = await encryptBackup({ files: { 'dav.json': JSON.stringify({ accounts: 'x' }) } }, PASSWORD, {
    app: '2.3.0',
    kdf: FAST
  });
  await assert.rejects(decryptBackup(broken, PASSWORD, { ownApp: '2.3.0' }), e => e.code === 'backup_invalid');
});
