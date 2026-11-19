import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKUP_FILES, NOT_BACKED_UP } from '../src/backup.mjs';
import { LEVUVO_DIRS, applyPendingWipe, levuvoEntries, stageWipe, WIPE_MARKER } from '../src/data-rights.mjs';
import { createMailServer } from '../src/app.mjs';
import { noticeFiles } from '../src/routes-data-rights.mjs';

const vault = () => {
  const m = new Map();
  return {
    available: true,
    map: m,
    get: (i, k) => m.get(`${i}:${k}`) || '',
    set: (i, k, v) => m.set(`${i}:${k}`, v),
    delete: (i, k) => m.delete(`${i}:${k}`),
    list: () =>
      [...m.keys()].map(key => ({ id: key.slice(0, key.indexOf(':')), kind: key.slice(key.indexOf(':') + 1) }))
  };
};
const tmp = t => {
  const dir = mkdtempSync(join(tmpdir(), 'lv-rights-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const write = (dir, name, value) =>
  writeFileSync(join(dir, name), typeof value === 'string' ? value : JSON.stringify(value));

test('only Levuvo files are selected, never Chromium storage in the same folder', () => {
  const names = [
    { name: 'accounts.json', dir: false },
    { name: 'tasks-local.json', dir: false },
    { name: 'tasks-local.json.tmp-123', dir: false },
    { name: 'primary.lvdb', dir: false },
    { name: 'spaces', dir: true },
    { name: 'ollama', dir: true },
    { name: 'index', dir: true },
    { name: 'Local Storage', dir: true },
    { name: 'Cache', dir: true },
    { name: 'Preferences', dir: false },
    { name: 'notes.txt', dir: false }
  ];
  assert.deepEqual(
    levuvoEntries(names).map(e => e.name),
    ['accounts.json', 'tasks-local.json', 'tasks-local.json.tmp-123', 'primary.lvdb', 'spaces', 'ollama', 'index']
  );
});

test('every data file the backup knows is also removed by "delete all"', () => {
  const names = [...Object.keys(BACKUP_FILES), ...Object.keys(NOT_BACKED_UP).filter(n => !n.startsWith('*'))].map(
    n => ({ name: n.replace(/\/$/, ''), dir: n.endsWith('/') })
  );
  assert.equal(levuvoEntries(names).length, names.length);
  for (const d of ['spaces/', 'index/', 'before-restore/', 'restore-pending/', 'ollama/'])
    assert.ok(LEVUVO_DIRS.includes(d));
});

test('a staged wipe removes Levuvo files and keychain entries at the next start, and keeps other files', async t => {
  const dir = tmp(t);
  const keys = vault();
  keys.set('primary', 'password', 'secret');
  keys.set('local', 'tasks-key', 'a'.repeat(64));
  keys.set('crypto', 'pgp:ABCDEF0123456789', 'private');
  write(dir, 'accounts.json', { version: 1, accounts: [] });
  write(dir, 'ai-log.jsonl', '{"a":1}\n');
  mkdirSync(join(dir, 'spaces', 'blobs'), { recursive: true });
  write(join(dir, 'spaces'), 'index.lvs', 'x');
  mkdirSync(join(dir, 'Local Storage'));
  write(join(dir, 'Local Storage'), 'leveldb', 'chromium');

  assert.equal(await applyPendingWipe({ dir, vault: keys }), null, 'nothing staged, nothing removed');
  assert.ok(existsSync(join(dir, 'accounts.json')));

  await stageWipe(dir);
  const result = await applyPendingWipe({ dir, accountsPath: join(dir, 'accounts.json'), vault: keys });
  assert.equal(result.secrets, 3);
  assert.equal(result.secretsComplete, true);
  assert.equal(keys.map.size, 0);
  assert.deepEqual(readdirSync(dir), ['Local Storage']);
  assert.ok(!existsSync(join(dir, WIPE_MARKER)));
});

test('without a keychain listing the wipe reports that entries may remain', async t => {
  const dir = tmp(t);
  const keys = vault();
  delete keys.list;
  await stageWipe(dir);
  const result = await applyPendingWipe({ dir, vault: keys });
  assert.equal(result.secretsComplete, false);
});

test('routes: export without secrets, delete all with confirmation and restart, blocked writes, legal info', async t => {
  const dir = tmp(t);
  const keys = vault();
  const SECRET = 'f'.repeat(64);
  const HOST = '127.0.0.1:4791';
  const GET = { host: HOST, cookie: `levuvo_desktop_session=${SECRET}` };
  const POST = {
    ...GET,
    origin: `http://${HOST}`,
    'content-type': 'application/json',
    'x-levuvo-action': 'privacy-v1'
  };
  write(dir, 'accounts.json', { version: 1, accounts: [] });
  write(dir, 'templates.json', { templates: [{ id: 't1', name: 'Danke', body: 'Vielen Dank!' }] });
  write(dir, 'ai-log.jsonl', '{"at":"2026-11-19","fn":"summary"}\n');
  write(dir, 'crypto.json', { pgp: { own: [{ fingerprint: 'ABCDEF0123456789' }] } });
  keys.set('crypto', 'pgp:ABCDEF0123456789', 'PRIVATE KEY');
  let restartOptions = null;
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
    onRestartRequested: options => {
      restartOptions = options;
      restarted();
    }
  });
  s.setPortForTesting(4791);
  t.after(() => s.close());

  const exported = await s.api.inject({ method: 'GET', url: '/api/privacy/export', headers: GET });
  assert.equal(exported.statusCode, 200, exported.body);
  assert.match(exported.headers['content-disposition'], /levuvo-mail-data-\d{4}-\d{2}-\d{2}\.json/);
  const data = exported.json();
  assert.equal(data.format, 'levuvo-data-export');
  assert.equal(data.files['templates.json'].templates[0].body, 'Vielen Dank!');
  assert.deepEqual(data.files['ai-log.jsonl'], [{ at: '2026-11-19', fn: 'summary' }]);
  assert.ok(!exported.body.includes('PRIVATE KEY'), 'private keys are never exported');

  const legal = await s.api.inject({ method: 'GET', url: '/api/runtime/legal', headers: GET });
  assert.equal(legal.statusCode, 200);
  assert.match(legal.json().supportUntil, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(legal.json().notices.some(n => n.id === 'app'));
  const notices = await s.api.inject({ method: 'GET', url: '/api/runtime/legal/app', headers: GET });
  assert.match(notices.body, /Third-party software notices/);
  assert.equal((await s.api.inject({ method: 'GET', url: '/api/runtime/legal/x', headers: GET })).statusCode, 404);

  const noConfirm = await s.api.inject({ method: 'POST', url: '/api/privacy/delete-all', headers: POST, payload: {} });
  assert.equal(noConfirm.statusCode, 400);
  const wrongAction = await s.api.inject({
    method: 'POST',
    url: '/api/privacy/delete-all',
    headers: { ...POST, 'x-levuvo-action': 'mail-v1' },
    payload: { confirm: 'delete-all' }
  });
  assert.equal(wrongAction.statusCode, 403);
  const staged = await s.api.inject({
    method: 'POST',
    url: '/api/privacy/delete-all',
    headers: POST,
    payload: { confirm: 'delete-all' }
  });
  assert.equal(staged.statusCode, 200);
  assert.deepEqual(staged.json(), { pending: true, restarting: true });
  // The restart timer is unref'd in the server; keep the test process alive until it fires.
  const keepAlive = setTimeout(() => {}, 5000);
  await restartRequested;
  clearTimeout(keepAlive);
  assert.deepEqual(restartOptions, { clearBrowserData: true });

  const blocked = await s.api.inject({
    method: 'POST',
    url: '/api/app-settings',
    headers: { ...POST, 'x-levuvo-action': 'mail-v1' },
    payload: { crashReports: true }
  });
  assert.equal(blocked.statusCode, 409);

  const cancelled = await s.api.inject({
    method: 'POST',
    url: '/api/privacy/delete-all/cancel',
    headers: POST,
    payload: {}
  });
  assert.deepEqual(cancelled.json(), { pending: false });
  assert.ok(!existsSync(join(dir, WIPE_MARKER)));
  const settings = await s.api.inject({
    method: 'POST',
    url: '/api/app-settings',
    headers: { ...POST, 'x-levuvo-action': 'mail-v1' },
    payload: { autoUpdates: false }
  });
  assert.equal(settings.json().autoUpdates, false);
  assert.equal(JSON.parse(readFileSync(join(dir, 'app-settings.json'), 'utf8')).autoUpdates, false);
});

test('notice files include the AI runtime and Ollama in packaged builds', () => {
  assert.deepEqual(
    noticeFiles('/res').map(n => n.id),
    ['app', 'ai', 'ollama']
  );
  assert.deepEqual(
    noticeFiles('').map(n => n.id),
    ['app']
  );
});
