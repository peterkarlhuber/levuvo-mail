import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMailServer, withoutLegacyEnv } from '../src/app.mjs';

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
    rmSync(dir, { recursive: true, force: true });
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
