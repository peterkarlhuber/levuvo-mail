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
