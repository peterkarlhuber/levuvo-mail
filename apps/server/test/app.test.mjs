import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMailServer, withoutLegacyEnv } from '../src/app.mjs';
import { BASE, LIST, fakeCaldav } from './helpers/fake-caldav.mjs';

const SECRET = 'e'.repeat(64);
const PORT = 4777;
const HOST = `127.0.0.1:${PORT}`;
const GET = { host: HOST, cookie: `levuvo_desktop_session=${SECRET}` };
const POST = { ...GET, origin: `http://${HOST}`, 'content-type': 'application/json' };

function vault() {
  const m = new Map();
  return {
    available: true,
    get: (i, k) => m.get(`${i}:${k}`) || '',
    set: (i, k, v) => m.set(`${i}:${k}`, v),
    delete: (i, k) => m.delete(`${i}:${k}`)
  };
}

function fakeImapFactory(state) {
  return () => ({
    on() {},
    async connect() {
      if (state.offline) throw Object.assign(new Error('down'), { code: 'ECONNREFUSED' });
    },
    async logout() {},
    close() {},
    capabilities: new Set(['MOVE', 'UIDPLUS']),
    mailbox: { exists: 2, uidValidity: 5, uidNext: 3 },
    async list() {
      return [{ path: 'INBOX', flags: new Set(), status: { unseen: 1, messages: 2 } }];
    },
    async getMailboxLock() {
      return { release() {} };
    },
    async *fetch(range, query) {
      if (query.bodyParts) return;
      for (const uid of [1, 2])
        yield {
          uid,
          envelope: { subject: `S${uid}`, from: [{ address: 'x@y.at' }] },
          flags: new Set(),
          bodyStructure: {}
        };
    },
    async search() {
      return [2];
    }
  });
}

async function server(t, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'lv-app-'));
  const state = { offline: false };
  const s = await createMailServer({
    desktop: true,
    sessionSecret: SECRET,
    env: {},
    vault: vault(),
    accountsFile: join(dir, 'accounts.json'),
    staticRoot: join(dir, 'dist'),
    imapFactory: fakeImapFactory(state),
    smtpFactory: () => ({ verify: async () => {}, close() {} }),
    watch: false,
    ...extra
  });
  s.setPortForTesting(PORT);
  t.after(async () => {
    await s.close();
    // Windows may still hold a just-closed file handle for a moment (EBUSY): retry like rimraf does.
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  return { s, state, dir };
}
async function addAccount(s) {
  const r = await s.api.inject({
    method: 'POST',
    url: '/api/accounts/create',
    headers: { ...POST, 'x-levuvo-action': 'accounts-v1' },
    payload: {
      label: 'Test',
      user: 'peter@example.org',
      password: 'pw',
      imapHost: 'mail.example.org',
      smtpHost: 'mail.example.org'
    }
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json().account.id;
}

test('Desktop API requires session cookie, correct Host and Origin', async t => {
  const { s } = await server(t);
  assert.equal((await s.api.inject({ method: 'GET', url: '/api/accounts', headers: { host: HOST } })).statusCode, 401);
  assert.equal(
    (
      await s.api.inject({
        method: 'GET',
        url: '/api/accounts',
        headers: { ...GET, cookie: `levuvo_desktop_session=${'f'.repeat(64)}` }
      })
    ).statusCode,
    401
  );
  assert.equal(
    (await s.api.inject({ method: 'GET', url: '/api/accounts', headers: { ...GET, host: 'evil.example:4777' } }))
      .statusCode,
    403
  );
  assert.equal(
    (await s.api.inject({ method: 'GET', url: '/api/accounts', headers: { ...GET, origin: 'https://evil.example' } }))
      .statusCode,
    403
  );
  assert.equal(
    (
      await s.api.inject({
        method: 'POST',
        url: '/api/accounts/create',
        headers: { ...GET, 'content-type': 'application/json', 'x-levuvo-action': 'accounts-v1' },
        payload: {}
      })
    ).statusCode,
    403,
    'POST without Origin'
  );
  assert.equal((await s.api.inject({ method: 'GET', url: '/api/accounts', headers: GET })).statusCode, 200);
});

test('Schreibende Endpunkte verlangen ihren Aktions-Header', async t => {
  const { s } = await server(t);
  const id = await addAccount(s);
  for (const url of [
    `/api/messages/send?account=${id}`,
    `/api/messages/1/action?account=${id}`,
    `/api/drafts/save?account=${id}`,
    '/api/accounts/create'
  ]) {
    const r = await s.api.inject({ method: 'POST', url, headers: POST, payload: {} });
    assert.equal(r.statusCode, 403, url);
  }
});

test('App document is served with a Content-Security-Policy', async t => {
  const { s, dir } = await server(t);
  mkdirSync(join(dir, 'dist'));
  writeFileSync(join(dir, 'dist', 'index.html'), '<!doctype html><title>x</title>');
  const r = await s.api.inject({ method: 'GET', url: '/', headers: GET });
  assert.equal(r.statusCode, 200);
  assert.match(r.headers['content-security-policy'], /default-src 'none'; script-src 'self'/);
  assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'/);
  const missing = await s.api.inject({ method: 'GET', url: '/../../etc/passwd', headers: GET });
  assert.equal(missing.statusCode, 404);
});

test('Without server: the last loaded list is served as offline state', async t => {
  const { s, state } = await server(t);
  const id = await addAccount(s);
  const online = await s.api.inject({ method: 'GET', url: `/api/messages?account=${id}&folder=INBOX`, headers: GET });
  assert.equal(online.statusCode, 200);
  assert.equal(online.json().stale, undefined);
  state.offline = true;
  const offline = await s.api.inject({ method: 'GET', url: `/api/messages?account=${id}&folder=INBOX`, headers: GET });
  assert.equal(offline.statusCode, 200);
  assert.equal(offline.json().stale, true);
  assert.equal(offline.json().messages.length, 2);
  const neverLoaded = await s.api.inject({
    method: 'GET',
    url: `/api/messages?account=${id}&folder=Archiv`,
    headers: GET
  });
  assert.equal(neverLoaded.statusCode, 502);
});

test('Folders return unread counts; invalid page cursors are rejected', async t => {
  const { s } = await server(t);
  const id = await addAccount(s);
  const folders = await s.api.inject({ method: 'GET', url: `/api/folders?account=${id}`, headers: GET });
  assert.equal(folders.json().folders[0].unseen, 1);
  const bad = await s.api.inject({ method: 'GET', url: `/api/messages?account=${id}&beforeUid=abc`, headers: GET });
  assert.equal(bad.statusCode, 400);
});

test('Unified inbox marks the account of each message', async t => {
  const { s } = await server(t);
  const id = await addAccount(s);
  const r = await s.api.inject({ method: 'GET', url: '/api/unified', headers: GET });
  assert.equal(r.statusCode, 200);
  assert.ok(r.json().messages.every(m => m.accountId === id && m.accountLabel === 'Test'));
});

test('Desktop ignores credentials from environment variables', async t => {
  assert.deepEqual(
    withoutLegacyEnv({ IMAP_USER: 'a', SMTP_PASSWORD: 'b', MAIL_ACCOUNT_2_USER: 'c', ENABLE_SEND: 'x', PATH: '/bin' }),
    { PATH: '/bin' }
  );
  const { s } = await server(t, { env: { IMAP_USER: 'leak@example.org', IMAP_PASSWORD: 'secret' } });
  const r = await s.api.inject({ method: 'GET', url: '/api/accounts', headers: GET });
  assert.deepEqual(r.json().accounts, []);
});

test('Desktop mode does not start without a valid session key', async () => {
  await assert.rejects(
    createMailServer({ desktop: true, sessionSecret: 'kurz', vault: vault(), watch: false }),
    /Sitzungsschlüssel/
  );
});

test('Contacts can be created, edited and deleted on this device without any account', async t => {
  const { s } = await server(t);
  const list = async () => (await s.api.inject({ method: 'GET', url: '/api/contacts/list', headers: GET })).json();
  const post = (url, payload) =>
    s.api.inject({ method: 'POST', url, headers: { ...POST, 'x-levuvo-action': 'contacts-v1' }, payload });

  const empty = await list();
  assert.deepEqual(empty.contacts, []);
  assert.equal(empty.addressBooks.length, 1);
  const [book] = empty.addressBooks;
  assert.equal(book.source, 'local');

  const created = await post('/api/contacts/save', {
    accountId: book.accountId,
    addressBookUrl: book.url,
    contact: { firstName: 'Clara', lastName: 'Huber', emails: [{ value: 'clara@example.org', type: 'home' }] }
  });
  assert.equal(created.statusCode, 200, created.body);
  let [clara] = (await list()).contacts;
  assert.equal(clara.name, 'Clara Huber');

  const edited = await post('/api/contacts/save', {
    accountId: clara.accountId,
    addressBookUrl: clara.addressBookUrl,
    url: clara.url,
    etag: clara.etag,
    uid: clara.uid,
    contact: { ...clara, organization: 'Levuvo' }
  });
  assert.equal(edited.statusCode, 200, edited.body);
  [clara] = (await list()).contacts;
  assert.equal(clara.organization, 'Levuvo');

  const exported = await s.api.inject({ method: 'GET', url: '/api/contacts/export', headers: GET });
  assert.match(exported.body, /FN:Clara Huber/);

  const imported = await post('/api/contacts/import', {
    accountId: book.accountId,
    addressBookUrl: book.url,
    vcf: 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Dora\r\nEMAIL:dora@example.org\r\nEND:VCARD\r\nBEGIN:VCARD\r\nVERSION:3.0\r\nEND:VCARD\r\n'
  });
  assert.equal(imported.json().imported, 1, 'cards without a name are skipped');

  const removed = await post('/api/contacts/delete', { accountId: clara.accountId, url: clara.url, etag: clara.etag });
  assert.equal(removed.statusCode, 200, removed.body);
  assert.deepEqual(
    (await list()).contacts.map(c => c.name),
    ['Dora']
  );
});

test('Without a keychain the device address book reports why it is missing', async t => {
  const { s } = await server(t, { vault: { available: false, get: () => '', set() {}, delete() {} } });
  const r = (await s.api.inject({ method: 'GET', url: '/api/contacts/list', headers: GET })).json();
  assert.deepEqual(r.addressBooks, []);
  assert.ok(r.errors.some(e => /Schlüsselbund/.test(e.error)));
  const saved = await s.api.inject({
    method: 'POST',
    url: '/api/contacts/save',
    headers: { ...POST, 'x-levuvo-action': 'contacts-v1' },
    payload: { accountId: 'local', addressBookUrl: 'local-contacts:', contact: { name: 'X' } }
  });
  assert.equal(saved.statusCode, 423);
});

test('Changing the login of an account drops cached data of the previous mailbox (AUD-003)', async t => {
  const { s } = await server(t);
  const id = await addAccount(s);
  const { ctx } = s;
  ctx.detailCache.set(`${id}|INBOX|1`, { data: { subject: 'Alt' }, at: Date.now() });
  ctx.listCache.set(`${id}|INBOX|40|`, { data: [], at: Date.now() });
  ctx.previewCache.set(`${id}:INBOX:5:1`, 'Vorschau alt');
  await ctx.followups.addSnoozed(
    id,
    'INBOX',
    { folder: 'Z', uidValidity: '5', items: [{ uid: '1' }] },
    '2030-01-01T00:00:00.000Z'
  );
  // Only the label changes: same mailbox, nothing is dropped.
  const label = await s.api.inject({
    method: 'POST',
    url: '/api/accounts/update',
    headers: { ...POST, 'x-levuvo-action': 'accounts-v1' },
    payload: { id, label: 'Arbeit' }
  });
  assert.equal(label.statusCode, 200, label.body);
  assert.ok(ctx.detailCache.get(`${id}|INBOX|1`));
  // Another login for the same account ID: everything of the old mailbox goes.
  const other = await s.api.inject({
    method: 'POST',
    url: '/api/accounts/update',
    headers: { ...POST, 'x-levuvo-action': 'accounts-v1' },
    payload: { id, user: 'anna@example.org', password: 'pw2' }
  });
  assert.equal(other.statusCode, 200, other.body);
  assert.equal(ctx.detailCache.get(`${id}|INBOX|1`), undefined);
  assert.equal(ctx.listCache.get(`${id}|INBOX|40|`), undefined);
  assert.equal(ctx.previewCache.get(`${id}:INBOX:5:1`), undefined);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(ctx.followups.snoozed(id).length, 0);
});

test('Every installation has a stable instance ID for scheduled sending', async t => {
  const { s, dir } = await server(t);
  assert.match(s.ctx.instanceId, /^[a-f0-9]{32}$/);
  const again = await createMailServer({
    desktop: true,
    sessionSecret: SECRET,
    env: {},
    vault: vault(),
    accountsFile: join(dir, 'accounts.json'),
    staticRoot: join(dir, 'dist'),
    watch: false,
    background: false
  });
  t.after(() => again.close());
  assert.equal(again.ctx.instanceId, s.ctx.instanceId);
});

test('AI and MCP: settings off by default, internal agent reaches the API with the same checks', async t => {
  const { s } = await server(t);
  const settings = await s.api.inject({ method: 'GET', url: '/api/ai/settings', headers: GET });
  assert.equal(settings.statusCode, 200);
  assert.equal(settings.json().enabled, false);
  const run = await s.api.inject({
    method: 'POST',
    url: '/api/ai/run',
    headers: { ...POST, 'x-levuvo-action': 'ai-v1' },
    payload: { kind: 'digest', refs: [] }
  });
  assert.equal(run.statusCode, 409);
  assert.equal(run.json().code, 'ai_disabled');
  const noAction = await s.api.inject({
    method: 'POST',
    url: '/api/ai/settings',
    headers: POST,
    payload: { enabled: true }
  });
  assert.equal(noAction.statusCode, 403);
  const mcp = await s.api.inject({ method: 'GET', url: '/api/mcp', headers: GET });
  assert.equal(mcp.json().enabled, false);
  assert.equal(mcp.json().running, false);
  const apply = payload =>
    s.api.inject({ method: 'POST', url: '/api/ai/apply', headers: { ...POST, 'x-levuvo-action': 'ai-v1' }, payload });
  assert.equal((await apply({ type: 'shell', data: {} })).statusCode, 400);
  assert.equal((await apply({ type: 'event', data: { summary: 'x' } })).statusCode, 400);
  assert.equal((await apply({ type: 'task', data: { title: 'x' } })).statusCode, 200);
  const linked = await apply({
    type: 'task',
    data: { title: 'y' },
    mail: { accountId: 'nope', folder: 'INBOX', uid: 4 }
  });
  assert.equal(linked.statusCode, 200);
  const tasks = (await s.api.inject({ method: 'GET', url: '/api/tasks?view=all', headers: GET })).json();
  const y = (tasks.tasks || tasks).find(x => x.title === 'y');
  assert.equal(y.source, 'ai');
  assert.equal(y.mail, null, 'unknown account: no mail link');

  const skills = await s.api.inject({ method: 'GET', url: '/api/ai/skills', headers: GET });
  assert.ok(skills.json().skills.some(x => x.id === 'briefing' && x.level === 'read'));
  const aiPost = (url, payload) =>
    s.api.inject({ method: 'POST', url, headers: { ...POST, 'x-levuvo-action': 'ai-v1' }, payload });
  const saved = await aiPost('/api/ai/skills/save', {
    name: 'Rechnungen',
    instruction: 'Find invoices',
    level: 'full'
  });
  assert.equal(saved.json().skill.level, 'read');
  const delegated = await aiPost('/api/ai/agent', { instruction: 'Kläre mit Anna einen Termin' });
  assert.equal(delegated.statusCode, 409);
  assert.equal(delegated.json().code, 'ai_disabled');
  assert.equal((await aiPost('/api/ai/agent', { skill: 'schedule', params: {} })).statusCode, 400);

  const agent = await s.mcp.internalAgent({ level: 'read' });
  t.after(() => agent.release());
  const call = body =>
    fetch(agent.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${agent.token}` },
      body: JSON.stringify(body)
    }).then(r => r.json());
  const accounts = await call({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'list_accounts', arguments: {} }
  });
  assert.deepEqual(JSON.parse(accounts.result.content[0].text), []);
  const search = await call({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'search_messages', arguments: { query: 'rechnung' } }
  });
  assert.equal(search.result.isError, undefined, JSON.stringify(search));
  assert.match(search.result.content[0].text, /untrusted_data/);

  // A task from the reading pane keeps the link to its mail (known accounts only).
  await addAccount(s);
  const acc = (await s.api.inject({ method: 'GET', url: '/api/accounts', headers: GET })).json();
  const accId = (acc.accounts || acc)[0].id;
  await apply({ type: 'task', data: { title: 'z' }, mail: { accountId: accId, folder: 'INBOX', uid: 4 } });
  const all = (await s.api.inject({ method: 'GET', url: '/api/tasks?view=all', headers: GET })).json();
  const z = (all.tasks || all).find(x => x.title === 'z');
  assert.deepEqual([z.mail.accountId, z.mail.folder, z.mail.uid], [accId, 'INBOX', 4]);
});

test('Spaces API: create a space, add a task, upload and download a file', async t => {
  const { s } = await server(t);
  await addAccount(s);
  const accounts = (await s.api.inject({ method: 'GET', url: '/api/accounts', headers: GET })).json();
  const accountId = (accounts.accounts || accounts)[0].id;
  const H = { ...POST, 'x-levuvo-action': 'spaces-v1' };
  const empty = await s.api.inject({ method: 'GET', url: '/api/spaces', headers: GET });
  assert.equal(empty.statusCode, 200);
  assert.deepEqual(empty.json().spaces, []);
  const denied = await s.api.inject({
    method: 'POST',
    url: '/api/spaces/create',
    headers: POST,
    payload: { name: 'X' }
  });
  assert.equal(denied.statusCode, 403);
  const created = await s.api.inject({
    method: 'POST',
    url: '/api/spaces/create',
    headers: H,
    payload: { name: 'Umbau', accountId }
  });
  assert.equal(created.statusCode, 200, created.body);
  const id = created.json().id;
  const op = await s.api.inject({
    method: 'POST',
    url: `/api/spaces/${id}/op`,
    headers: H,
    payload: { type: 'task.upsert', data: { id: 'c'.repeat(32), title: 'Fliesen aussuchen' } }
  });
  assert.equal(op.statusCode, 200, op.body);
  const bad = await s.api.inject({
    method: 'POST',
    url: `/api/spaces/${id}/op`,
    headers: H,
    payload: { type: 'member.add', data: {} }
  });
  assert.equal(bad.statusCode, 400);
  const up = await s.api.inject({
    method: 'POST',
    url: `/api/spaces/${id}/files/upload?name=plan.txt&mime=text/plain`,
    headers: {
      ...GET,
      origin: `http://${HOST}`,
      'content-type': 'application/octet-stream',
      'x-levuvo-action': 'spaces-v1'
    },
    payload: Buffer.from('Grundriss')
  });
  assert.equal(up.statusCode, 200, up.body);
  const detail = (await s.api.inject({ method: 'GET', url: `/api/spaces/${id}`, headers: GET })).json();
  assert.equal(detail.tasks[0].title, 'Fliesen aussuchen');
  assert.equal(detail.files[0].name, 'plan.txt');
  const down = await s.api.inject({ method: 'GET', url: `/api/spaces/${id}/files/${up.json().id}`, headers: GET });
  assert.equal(down.body, 'Grundriss');
  assert.match(down.headers['content-disposition'], /attachment/);
  assert.equal(down.headers['content-type'], 'application/octet-stream');
});

test('Tasks API: save, list, done and delete without a mail account', async t => {
  const { s } = await server(t);
  const post = (url, payload, action = 'mail-v1') =>
    s.api.inject({ method: 'POST', url, headers: { ...POST, 'x-levuvo-action': action }, payload });
  assert.equal((await post('/api/tasks/save', { task: { title: 'x' } }, 'calendar-v1')).statusCode, 403);
  assert.equal((await post('/api/tasks/save', { task: { title: '' } })).statusCode, 400);
  const saved = (await post('/api/tasks/save', { task: { title: 'Rechnung zahlen', due: '2026-12-01' } })).json().task;
  assert.equal(saved.title, 'Rechnung zahlen');
  assert.equal((await post('/api/tasks/done', { id: saved.id, done: true })).json().task.done, true);
  const list = (await s.api.inject({ method: 'GET', url: '/api/tasks', headers: GET })).json().tasks;
  assert.deepEqual(
    list.map(x => [x.title, x.done]),
    [['Rechnung zahlen', true]]
  );
  assert.equal((await post('/api/tasks/delete', { id: saved.id })).statusCode, 200);
  assert.deepEqual((await s.api.inject({ method: 'GET', url: '/api/tasks', headers: GET })).json().tasks, []);
});

test('API-LEV-005: a local task failure is not reported as an IMAP failure', async t => {
  const { s, dir } = await server(t);
  const post = (url, payload) =>
    s.api.inject({ method: 'POST', url, headers: { ...POST, 'x-levuvo-action': 'mail-v1' }, payload });
  assert.equal((await post('/api/tasks/save', { task: { title: 'vorher' } })).statusCode, 200);
  // The task file can no longer be replaced: a directory with content sits where it belongs.
  const file = join(dir, 'tasks-local.json');
  rmSync(file, { force: true });
  mkdirSync(join(file, 'blocked'), { recursive: true });
  const r = await post('/api/tasks/save', { task: { title: 'nachher' } });
  assert.equal(r.statusCode, 500);
  assert.equal(r.json().code, 'task_failed');
  assert.doesNotMatch(JSON.stringify(r.json()), /imap/i);
});

test('Tasks API: connect a CalDAV list, sync, move a task, disconnect', async t => {
  const dav = fakeCaldav();
  const { s } = await server(t, { fetchImpl: dav.fetchImpl });
  const post = (url, payload) =>
    s.api.inject({ method: 'POST', url, headers: { ...POST, 'x-levuvo-action': 'mail-v1' }, payload });
  const get = async url => (await s.api.inject({ method: 'GET', url, headers: GET })).json();
  const account = await s.ctx.davStore.create(
    { label: 'Nextcloud', serverUrl: `${BASE}/dav/`, username: 'peter' },
    'geheim'
  );
  assert.deepEqual((await get('/api/tasks/sync')).links, []);
  const { lists } = await get('/api/tasks/sync/sources');
  assert.deepEqual(
    lists.map(l => [l.provider, l.listId, l.connected]),
    [['caldav', LIST, false]]
  );
  // Only lists the server offers can be connected.
  assert.equal(
    (
      await post('/api/tasks/sync/link', {
        provider: 'caldav',
        accountId: account.id,
        listId: 'https://evil.example.org/'
      })
    ).statusCode,
    404
  );
  const local = (await post('/api/tasks/save', { task: { title: 'Wird übernommen' } })).json().task;
  assert.equal(local.list, null);
  assert.equal('sync' in local, false, 'sync internals stay on the server');
  const linked = await post('/api/tasks/sync/link', {
    provider: 'caldav',
    accountId: account.id,
    listId: LIST,
    moveLocal: true
  });
  assert.equal(linked.statusCode, 200);
  const link = linked.json().link;
  assert.equal(link.name, 'Aufgaben & To-dos');
  assert.equal(linked.json().result.pushed, 1);
  assert.equal(dav.objects.size, 1);
  const tasks = (await get('/api/tasks')).tasks;
  assert.equal(tasks[0].list, link.id);
  // Back to this device.
  await post('/api/tasks/save', { task: { ...tasks[0], list: null } });
  await post('/api/tasks/sync/run', {});
  assert.equal(dav.objects.size, 0);
  // Removing the CalDAV account disconnects its lists, the tasks stay.
  await post('/api/tasks/save', { task: { title: 'Zweite', list: link.id } });
  await post('/api/tasks/sync/run', { id: link.id });
  assert.equal(dav.objects.size, 1);
  const removed = await s.api.inject({
    method: 'POST',
    url: '/api/dav/accounts/remove',
    headers: { ...POST, 'x-levuvo-action': 'accounts-v1' },
    payload: { id: account.id, confirm: 'REMOVE_DAV_ACCOUNT' }
  });
  assert.equal(removed.statusCode, 200);
  assert.deepEqual((await get('/api/tasks/sync')).links, []);
  assert.deepEqual((await get('/api/tasks')).tasks.map(x => [x.title, x.list]).sort(), [
    ['Wird übernommen', null],
    ['Zweite', null]
  ]);
});

test('REL-LEV-007: the background monitor never opens a login while the IDLE watcher is down', async t => {
  let logins = 0;
  const imap = fakeImapFactory({ offline: false });
  const { s } = await server(t, {
    watch: true,
    imapFactory: config => {
      logins++;
      return imap(config);
    },
    watcherFactory: () => ({
      on() {},
      once() {},
      async connect() {
        throw Object.assign(new Error('down'), { code: 'ECONNREFUSED' });
      },
      close() {}
    })
  });
  const id = await addAccount(s);
  const before = logins;
  const r = await s.api.inject({ method: 'GET', url: `/api/inbox/monitor?account=${id}&cachedOnly=1`, headers: GET });
  assert.equal(r.statusCode, 409);
  assert.equal(r.json().code, 'inbox_watcher_down');
  assert.equal(logins, before, 'no extra login');
  // The app itself (without cachedOnly) still reads the inbox live.
  const live = await s.api.inject({ method: 'GET', url: `/api/inbox/monitor?account=${id}`, headers: GET });
  assert.equal(live.statusCode, 200);
});

test('ARC-LEV-002: internal requests use their own secret, not a copied browser session', async t => {
  const { s } = await server(t);
  // The internal entry point works without cookie or origin …
  const accounts = await s.internalRequest('GET', '/api/accounts');
  assert.ok(Array.isArray(accounts.accounts));
  // … still enforces the action header on changes …
  await assert.rejects(
    s.internalRequest('POST', '/api/tasks/save', { task: { title: 'x' } }),
    e => e.statusCode === 403
  );
  assert.equal(
    (await s.internalRequest('POST', '/api/tasks/save', { task: { title: 'x' } }, 'mail-v1')).task.title,
    'x'
  );
  // … and a guessed internal header gets no access.
  for (const value of ['', 'x', 'a'.repeat(64)]) {
    const r = await s.api.inject({
      method: 'GET',
      url: '/api/accounts',
      headers: { host: '127.0.0.1', 'x-levuvo-internal': value }
    });
    assert.ok([401, 403].includes(r.statusCode), `status ${r.statusCode} for "${value}"`);
  }
});

test('Help: the manual and its screenshots need the session and are rate-limited routes', async t => {
  const { s } = await server(t);
  assert.equal((await s.api.inject({ method: 'GET', url: '/api/manual', headers: { host: HOST } })).statusCode, 401);
  const r = await s.api.inject({ method: 'GET', url: '/api/manual?lang=en', headers: GET });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().lang, 'en');
  assert.ok(r.json().chapters.length >= 8);
  assert.ok(r.headers['x-ratelimit-limit']);
  const img = await s.api.inject({ method: 'GET', url: '/api/manual/img/de/mail.png', headers: GET });
  assert.equal(img.statusCode, 200);
  assert.equal(img.headers['content-type'], 'image/png');
  assert.equal(
    (await s.api.inject({ method: 'GET', url: '/api/manual/img/de/..%2Faccounts.png', headers: GET })).statusCode,
    404
  );
  assert.equal(
    (await s.api.inject({ method: 'GET', url: '/api/manual/img/de/mail.png', headers: { host: HOST } })).statusCode,
    401
  );
});
