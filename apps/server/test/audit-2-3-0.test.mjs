// Regression tests for the external audits of 2.3.0 (19 Nov 2026). Each test names the finding.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  mkdirSync,
  utimesSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJsonFile } from '../src/app.mjs';
import { createAiService, createAiLog, DEFAULT_AI_SETTINGS } from '../src/ai-service.mjs';
import { registerAiRoutes } from '../src/routes-ai.mjs';
import { createApprovals } from '../src/mcp-server.mjs';
import { createSealedJsonFile } from '../src/sealed-json.mjs';
import { isTrashTarget, performMessageAction, validateActionInput } from '../src/mail-actions.mjs';
import { createGraphTasks, createGoogleTasks } from '../src/task-sync-cloud.mjs';
import { createTaskSync } from '../src/task-sync.mjs';
import { createCaldavTasks, createTodoIcs } from '../src/task-sync-caldav.mjs';
import { BASE, LIST, fakeCaldav } from './helpers/fake-caldav.mjs';
import { createMailStore } from './helpers/fake-mailstore.mjs';
import { createMailTransport, parseSyncMail, MAX_SYNC_MAIL_BYTES } from '../src/spaces/mail-transport.mjs';
import { cancelRestore, pruneSafetyCopies, stageRestore, applyPendingRestore } from '../src/backup.mjs';
import { sendDue, TAKEOVER_GRACE_MS } from '../src/scheduled.mjs';

const tmp = t => {
  const dir = mkdtempSync(join(tmpdir(), 'lv-audit23-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
function vault() {
  const m = new Map();
  return {
    available: true,
    map: m,
    get: (i, k) => m.get(`${i}:${k}`) || '',
    set: (i, k, v) => m.set(`${i}:${k}`, v),
    delete: (i, k) => m.delete(`${i}:${k}`)
  };
}
const tick = () => new Promise(r => setImmediate(r));

// ------------------------------------------------------------------ AI
async function cloudAi(t, { sidecar } = {}) {
  const dir = tmp(t);
  const calls = [];
  const sc = sidecar || {
    running: true,
    async call(method, params) {
      calls.push({ method, params });
      return method === 'task' ? { answer: 'ok', found: true, sources: ['s1'] } : { ok: true };
    },
    async stop() {},
    diagnostics: () => ({})
  };
  const ai = createAiService({
    settingsFile: await createJsonFile(join(dir, 'ai.json'), DEFAULT_AI_SETTINGS),
    vault: vault(),
    sidecar: sc,
    log: createAiLog(join(dir, 'log.jsonl'))
  });
  await ai.save({
    enabled: true,
    provider: 'anthropic',
    apiKey: 'sk-ant-test-123',
    consent: { provider: 'anthropic', granted: true },
    noCloudAccounts: ['secret']
  });
  return { ai, calls, dir };
}

test('H-01/AI-01: a question across all accounts never sends text of a "No cloud AI" account', async t => {
  const { ai, calls } = await cloudAi(t);
  const searched = [];
  const handlers = {};
  const ctx = {
    api: {
      get: (p, ...rest) => (handlers[`GET ${p}`] = rest.at(-1)),
      post: (p, ...rest) => (handlers[`POST ${p}`] = rest.at(-1))
    },
    ai,
    requireAction: () => true,
    accounts: () => [{ id: 'open' }, { id: 'secret' }],
    ownAddresses: () => [],
    aiForgetHooks: [],
    semantic: {
      async search(ids) {
        searched.push(ids);
        return ids.map(id => ({ accountId: id, folder: 'INBOX', uid: 1, subject: `S ${id}`, text: `TEXT-${id}` }));
      },
      sync: async () => null,
      forget: async () => {}
    }
  };
  registerAiRoutes(ctx);
  const reply = { code: () => reply, send: x => x };
  const out = await handlers['POST /api/ai/run']({ body: { kind: 'ask', input: { question: 'Was gilt?' } } }, reply);
  assert.deepEqual(searched, [['open']], 'blocked account is not even searched');
  const task = calls.find(c => c.method === 'task');
  assert.ok(task);
  assert.doesNotMatch(JSON.stringify(task.params), /TEXT-secret/);
  assert.equal(out.result.sources[0].accountId, 'open');
  // A client cannot smuggle in its own source list.
  calls.length = 0;
  const smuggled = await handlers['POST /api/ai/run'](
    {
      body: {
        kind: 'ask',
        input: { question: 'x', sources: [{ accountId: 'secret', folder: 'INBOX', uid: 1, text: 'TEXT-secret' }] },
        sourceMap: [{ accountId: 'secret', folder: 'INBOX', uid: 1 }]
      }
    },
    reply
  );
  assert.deepEqual(
    smuggled.result.sources.map(s => s.accountId),
    ['open'],
    'only sources the server found itself are returned'
  );
  assert.doesNotMatch(JSON.stringify(calls.find(c => c.method === 'task')?.params), /TEXT-secret|"secret"/);
  // Content of a blocked account in the input is refused right before the model call.
  await assert.rejects(ai.run('ask', {}, { sources: ['open', 'secret'] }), err => err.kind === 'cloud_blocked');
  // Functions on loaded mails need the account they come from.
  const noAccount = await handlers['POST /api/ai/run']({ body: { kind: 'digest', refs: [{ uid: 1 }] } }, reply);
  assert.equal(noAccount.code, 'ai_invalid');
});

test('AI-02: a failed provider switch stops tasks instead of running on the old provider', async t => {
  let failConfigure = false;
  const calls = [];
  const sidecar = {
    running: true,
    async call(method, params) {
      calls.push({ method, params });
      if (method === 'configure' && failConfigure) throw Object.assign(new Error('x'), { kind: 'unreachable' });
      return { ok: true };
    },
    async stop() {},
    diagnostics: () => ({})
  };
  const { ai } = await cloudAi(t, { sidecar });
  await ai.run('digest', {}, { accountId: 'open' });
  failConfigure = true;
  await ai.save({ provider: 'ollama', model: 'llama3.2' }); // configure fails, error swallowed here
  const before = calls.filter(c => c.method === 'task').length;
  await assert.rejects(ai.run('digest', {}, { accountId: 'open' }), err => err.kind === 'not_configured');
  assert.equal(calls.filter(c => c.method === 'task').length, before, 'no task on an unconfirmed provider');
  failConfigure = false;
  await ai.run('digest', {}, { accountId: 'open' });
  assert.equal(calls.filter(c => c.method === 'configure').at(-1).params.provider, 'ollama');
});

test('PRIV-02: old AI log lines are removed at the start, also without new activity', async t => {
  const dir = tmp(t);
  const file = join(dir, 'log.jsonl');
  const old = new Date(Date.now() - 40 * 86400_000).toISOString();
  writeFileSync(
    file,
    `${JSON.stringify({ at: old, type: 'task' })}\n${JSON.stringify({ at: new Date().toISOString(), type: 'x' })}\n`
  );
  const log = createAiLog(file);
  await log.sweep();
  const lines = readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  assert.doesNotMatch(lines[0], new RegExp(old));
});

// ------------------------------------------------------------------ MCP
test('MCP-01: two decisions on the same approval run the action once', async t => {
  const dir = tmp(t);
  const file = await createJsonFile(join(dir, 'a.json'), { items: [] });
  let runs = 0;
  const approvals = createApprovals(file, {
    execute: async () => {
      runs++;
      await tick();
      return { ok: true };
    },
    log: { add: () => {} }
  });
  const item = await approvals.add({
    agent: { id: 'a', name: 'A' },
    type: 'send',
    payload: { text: 'Hallo' },
    summary: { to: ['x@y'], subject: 'S', text: 'Hallo Welt' }
  });
  const results = await Promise.allSettled(Array.from({ length: 20 }, () => approvals.decide(item.id, true)));
  assert.equal(runs, 1);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const decided = approvals.get(item.id);
  assert.equal(decided.status, 'approved');
  assert.equal(decided.payload, null);
  assert.equal(decided.summary.text, undefined, 'M-01: mail text is dropped once decided');
  assert.equal(decided.summary.subject, 'S');
});

test('M-01: approvals are encrypted on disk; without a keychain they stay in memory', async t => {
  const dir = tmp(t);
  const name = join(dir, 'mcp-approvals.json');
  writeFileSync(name, JSON.stringify({ items: [{ id: 'old', payload: { text: 'KLARTEXT' } }] }));
  const keys = vault();
  const file = await createSealedJsonFile(name, { items: [] }, { vault: keys, keyName: 'mcp-approvals-key' });
  assert.equal(file.get().items[0].id, 'old', 'plain file of an older version is read');
  assert.doesNotMatch(readFileSync(name, 'utf8'), /KLARTEXT/, 'and encrypted at once');
  await file.save({ items: [{ id: 'n', payload: { text: 'GEHEIM' } }] });
  assert.doesNotMatch(readFileSync(name, 'utf8'), /GEHEIM/);
  const again = await createSealedJsonFile(name, { items: [] }, { vault: keys, keyName: 'mcp-approvals-key' });
  assert.equal(again.get().items[0].payload.text, 'GEHEIM');
  const locked = await createSealedJsonFile(name, { items: [] }, { vault: { available: false }, keyName: 'k' });
  assert.equal(existsSync(name), false, 'no keychain: nothing on disk');
  await locked.save({ items: [{ id: 'm', payload: { text: 'NUR-RAM' } }] });
  assert.equal(existsSync(name), false);
  assert.equal(locked.get().items[0].id, 'm');
});

// ------------------------------------------------------------------ mail actions
test('H-05: an agent move never reaches the trash, whatever the trash is called', async () => {
  const folders = [
    { path: 'INBOX', delimiter: '/' },
    { path: 'Bin', specialUse: '\\Trash', delimiter: '/' },
    { path: 'Bin/Old', delimiter: '/' },
    { path: 'Projects', delimiter: '/' }
  ];
  assert.equal(isTrashTarget(folders, folders[1]), true);
  assert.equal(isTrashTarget(folders, folders[2]), true, 'subfolder of the trash');
  assert.equal(isTrashTarget(folders, folders[3]), false);
  const calls = [];
  const client = {
    mailbox: { readOnly: false },
    capabilities: new Map([['MOVE', true]]),
    list: async () => folders,
    getMailboxLock: async () => ({ release() {} }),
    async *fetch(set) {
      for (const uid of String(set).split(',')) yield { uid: Number(uid) };
    },
    messageMove: async (uid, path) => calls.push(path) && { destination: path }
  };
  const input = validateActionInput('5', { folder: 'INBOX', action: 'move', destination: 'Bin', notToTrash: true });
  await assert.rejects(performMessageAction(client, input), { code: 'trash_needs_approval' });
  const sub = validateActionInput('5', { folder: 'INBOX', action: 'move', destination: 'Bin/Old', notToTrash: true });
  await assert.rejects(performMessageAction(client, sub), { code: 'trash_needs_approval' });
  assert.deepEqual(calls, []);
  await performMessageAction(
    client,
    validateActionInput('5', { folder: 'INBOX', action: 'move', destination: 'Projects', notToTrash: true })
  );
  // The user (no flag) may still move into the trash folder by hand.
  await performMessageAction(client, validateActionInput('5', { folder: 'INBOX', action: 'move', destination: 'Bin' }));
  assert.deepEqual(calls, ['Projects', 'Bin']);
});

// ------------------------------------------------------------------ tasks
const fakeFetch =
  handler =>
  async (url, init = {}) => {
    const r = await handler(String(url), init);
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status || 200 });
  };

test('H-02: a provider list longer than one pull is an error, never a deletion', async () => {
  const accounts = () => [
    { id: 'm', provider: 'microsoft' },
    { id: 'g', provider: 'google' }
  ];
  const endpoints = { graph: 'https://graph.test/v1.0', googleTasks: 'https://tasks.test/v1' };
  let page = 0;
  const graph = createGraphTasks({
    accounts,
    token: async () => 't',
    endpoints,
    fetchImpl: fakeFetch(async () => ({
      body: { value: [{ id: `x${page}`, title: 'T' }], '@odata.nextLink': `https://graph.test/v1.0/next?p=${++page}` }
    }))
  });
  await assert.rejects(graph.pull({ accountId: 'm', listId: 'l' }), { code: 'task_sync_incomplete' });
  const google = createGoogleTasks({
    accounts,
    token: async () => 't',
    endpoints,
    fetchImpl: fakeFetch(async () => ({
      body: { items: Array.from({ length: 100 }, (_, i) => ({ id: `g${page}-${i}` })), nextPageToken: `p${++page}` }
    }))
  });
  await assert.rejects(google.pull({ accountId: 'g', listId: 'l' }), { code: 'task_sync_incomplete' });
});

function taskFile(tasks) {
  let value = {
    tasks,
    taskSync: { links: [{ id: 'L', provider: 'caldav', accountId: 'a', listId: 'u' }], tombstones: [] }
  };
  return { get: () => value, save: async v => (value = v) };
}
const synced = (id, remoteId) => ({
  id,
  title: id,
  notes: '',
  due: null,
  remindAt: null,
  priority: 'none',
  repeat: null,
  done: false,
  updatedAt: '2026-11-01T00:00:00.000Z',
  sync: { link: 'L', remoteId, etag: 'e1', base: { title: id, notes: '', due: null, done: false } }
});

test('H-02: tasks the server lists but this device cannot read are kept, and a failed pull changes nothing', async () => {
  const file = taskFile([synced('a', 'r-a'), synced('b', 'r-b')]);
  let mode = 'unreadable';
  const adapter = {
    caps: { fields: ['title', 'notes', 'due', 'done'], dueTime: false },
    async pull() {
      if (mode === 'fail') throw Object.assign(new Error('zu groß'), { code: 'task_sync_incomplete' });
      return [
        { remoteId: 'r-a', etag: 'e1', fields: { title: 'a', notes: '', due: null, done: false } },
        { remoteId: 'r-b', etag: 'e2', unreadable: true }
      ];
    },
    create: async () => ({ remoteId: 'new' }),
    update: async (_link, item) => {
      updates.push(item.remoteId);
      return {};
    },
    remove: async () => true
  };
  const updates = [];
  const sync = createTaskSync({ file, adapters: { caldav: adapter } });
  await sync.run('L');
  assert.deepEqual(
    file.get().tasks.map(x => x.id),
    ['a', 'b']
  );
  assert.equal(file.get().tasks[1].title, 'b', 'unreadable on the server: unchanged here');
  assert.deepEqual(updates, [], 'and not overwritten there');
  mode = 'fail';
  await sync.run('L');
  assert.deepEqual(
    file.get().tasks.map(x => x.id),
    ['a', 'b']
  );
  assert.equal(file.get().taskSync.links[0].lastErrorCode, 'task_sync_incomplete');
});

test('H-02: CalDAV reports tasks it cannot read as present, not as deleted', async () => {
  const server = fakeCaldav();
  server.objects.set(`${LIST}good.ics`, { data: createTodoIcs({ title: 'Gut' }, { uid: 'good' }), etag: '"1"' });
  server.objects.set(`${LIST}odd.ics`, { data: 'BEGIN:VCALENDAR\r\nkaputt', etag: '"2"' });
  const account = { id: 'dav-1', serverUrl: `${BASE}/dav/`, username: 'peter' };
  const caldav = createCaldavTasks({
    store: { get: id => (id === account.id ? account : null), password: () => 'geheim', list: () => [account] },
    fetchImpl: server.fetchImpl
  });
  const items = await caldav.pull({ accountId: 'dav-1', listId: LIST });
  assert.deepEqual(items.map(i => [i.remoteId.endsWith('odd.ics'), Boolean(i.unreadable)]).sort(), [
    [false, false],
    [true, true]
  ]);
});

test('H-04: Microsoft To Do and Google Tasks send If-Match; a 412 is a conflict, not an overwrite', async () => {
  const seen = [];
  const endpoints = { graph: 'https://graph.test/v1.0', googleTasks: 'https://tasks.test/v1' };
  const fetchImpl = fakeFetch(async (url, init) => {
    seen.push({ method: init.method, ifMatch: init.headers?.['If-Match'] });
    return init.headers?.['If-Match'] === 'W/"old"' ? { status: 412, body: {} } : { body: { id: 'x', etag: 'n' } };
  });
  const accounts = () => [
    { id: 'm', provider: 'microsoft' },
    { id: 'g', provider: 'google' }
  ];
  const graph = createGraphTasks({ accounts, token: async () => 't', endpoints, fetchImpl });
  const google = createGoogleTasks({ accounts, token: async () => 't', endpoints, fetchImpl });
  await graph.update({ accountId: 'm', listId: 'l' }, { remoteId: 'x', etag: 'W/"1"' }, { title: 'T' }, { title: 'T' });
  await google.update({ accountId: 'g', listId: 'l' }, { remoteId: 'x', etag: '"2"' }, { title: 'T' });
  await graph.remove({ accountId: 'm', listId: 'l' }, 'x', 'W/"3"');
  await google.remove({ accountId: 'g', listId: 'l' }, 'x', '"4"');
  assert.deepEqual(
    seen.map(s => s.ifMatch),
    ['W/"1"', '"2"', 'W/"3"', '"4"']
  );
  await assert.rejects(
    graph.update({ accountId: 'm', listId: 'l' }, { remoteId: 'x', etag: 'W/"old"' }, { title: 'T' }, { title: 'T' }),
    { code: 'task_sync_conflict' }
  );
});

// ------------------------------------------------------------------ spaces
test('H-03: a backlog in the hidden folder is never skipped when new sync mails arrive', async () => {
  const mail = createMailStore({ folders: ['INBOX', 'Junk', 'INBOX/Levuvo Spaces'] });
  const store = {
    value: {},
    index: () => store.value,
    saveIndex: async v => (store.value = v || store.value),
    updateIndex: async fn => (store.value = fn(store.value))
  };
  const ctx = { accounts: () => [{ id: 'a' }], withImap: async fn => fn(mail.client()) };
  const transport = createMailTransport(ctx, store);
  const sync = (n, to = 'INBOX') =>
    mail.add(
      to,
      [
        'From: b@x.example',
        'To: a@x.example',
        'X-Levuvo-Space: v1; sync',
        'Subject: sync',
        'MIME-Version: 1.0',
        'Content-Type: multipart/mixed; boundary=B',
        '',
        '--B',
        'Content-Type: text/plain',
        '',
        'x',
        '--B',
        'Content-Type: application/vnd.levuvo.space+json; name=levuvo-space.json',
        'Content-Disposition: attachment; filename=levuvo-space.json',
        '',
        JSON.stringify({ n }),
        '--B--',
        ''
      ].join('\r\n')
    );
  // 250 mails another device already moved, plus new ones in the inbox.
  for (let i = 0; i < 250; i++) sync(i, 'INBOX/Levuvo Spaces');
  sync(1000);
  const handled = new Set();
  await transport.receive('a', async env => handled.add(env.n));
  await transport.receive('a', async env => handled.add(env.n));
  await transport.receive('a', async env => handled.add(env.n));
  for (let i = 0; i < 250; i++) assert.ok(handled.has(i), `mail ${i} handled`);
  assert.ok(handled.has(1000));
});

test('SPO-01: oversized sync mails are not parsed', async () => {
  assert.equal(await parseSyncMail(Buffer.alloc(MAX_SYNC_MAIL_BYTES + 1)), null);
});

// ------------------------------------------------------------------ backup
const backupWithKey = () => ({
  createdAt: '2026-11-19T00:00:00.000Z',
  files: { 'crypto.json': JSON.stringify({ pgp: { own: [{ fingerprint: 'ABCDEF0123456789' }] } }) },
  secrets: { 'pgp:ABCDEF0123456789': 'PRIVATE-KEY' },
  spaces: {},
  localSecrets: {}
});

test('H-06: restored private keys wait under a staging name; cancelling leaves the keychain as it was', async t => {
  const dir = tmp(t);
  const keys = vault();
  keys.set('crypto', 'pgp:ABCDEF0123456789', 'CURRENT');
  await stageRestore({ dir, vault: keys, backup: backupWithKey() });
  assert.equal(keys.get('crypto', 'pgp:ABCDEF0123456789'), 'CURRENT', 'nothing replaced before the restart');
  await cancelRestore(dir, keys);
  assert.equal(keys.get('crypto', 'pgp:ABCDEF0123456789'), 'CURRENT');
  assert.deepEqual(
    [...keys.map.keys()].filter(k => k.includes('restore-pending')),
    [],
    'no staged key left behind'
  );
  await stageRestore({ dir, vault: keys, backup: backupWithKey() });
  await applyPendingRestore({ dir, vault: keys });
  assert.equal(keys.get('crypto', 'pgp:ABCDEF0123456789'), 'PRIVATE-KEY');
});

test('M-06: safety copies of a restore are deleted after 30 days', async t => {
  const dir = tmp(t);
  const root = join(dir, 'before-restore');
  for (const name of ['2026-09-01', '2026-11-18']) mkdirSync(join(root, name), { recursive: true });
  const old = new Date(Date.now() - 40 * 86400_000);
  utimesSync(join(root, '2026-09-01'), old, old);
  await pruneSafetyCopies(dir);
  assert.deepEqual(readdirSync(root), ['2026-11-18']);
});

// ------------------------------------------------------------------ JSON files
test('ARC-01/02, M-07: settings files keep damaged content, never overwrite unreadable ones, write in order', async t => {
  const dir = tmp(t);
  const name = join(dir, 's.json');
  writeFileSync(name, '{"broken": ');
  const file = await createJsonFile(name, { a: 0 });
  assert.deepEqual(file.get(), { a: 0 });
  assert.ok(
    readdirSync(dir).some(f => f.startsWith('s.json.corrupt-')),
    'damaged file kept aside'
  );
  // Many overlapping saves: the last one is on disk.
  await Promise.all(Array.from({ length: 30 }, (_, i) => file.save({ a: i })));
  assert.equal(JSON.parse(readFileSync(name, 'utf8')).a, 29);
  // A file that cannot be read (here: a directory) is never replaced.
  const dirAsFile = join(dir, 'locked.json');
  mkdirSync(dirAsFile);
  const locked = await createJsonFile(dirAsFile, { b: 1 });
  await assert.rejects(locked.save({ b: 2 }), { code: 'store_unreadable' });
  // A failed write does not leave the unsaved value behind.
  const gone = await createJsonFile(join(dir, 'x', 'y.json'), { c: 1 });
  writeFileSync(join(dir, 'x'), 'not a folder');
  await assert.rejects(gone.save({ c: 2 }));
  assert.deepEqual(gone.get(), { c: 1 });
});

// ------------------------------------------------------------------ send later
test('DATA-03: two devices that are not the owner never both send (takeover lock)', async () => {
  const DUE = '2026-11-18T10:00:00.000Z';
  const NOW = Date.parse(DUE) + TAKEOVER_GRACE_MS + 1000;
  const source = [
    'From: me@example.test',
    'To: customer@example.test',
    'Subject: Offer',
    'Message-ID: <offer@example.test>',
    `X-Levuvo-Send-At: ${DUE}`,
    `X-Levuvo-Scheduler: ${'a'.repeat(32)}`,
    '',
    'Hello',
    ''
  ].join('\r\n');
  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  for (let round = 0; round < 40; round++) {
    const store = createMailStore();
    store.add('Drafts', source, ['\\Draft']);
    const submits = [];
    const jitter = async () => {
      for (let i = Math.floor(random() * 5); i > 0; i--) await tick();
    };
    const devices = ['b', 'c', 'd'].map(ch => {
      const id = ch.repeat(32);
      const client = store.client({ name: id, gate: jitter });
      const claims = new Map();
      return () =>
        sendDue(client, {
          now: NOW,
          instanceId: id,
          claims,
          pollMs: 1,
          submit: async () => submits.push(id),
          saveSent: async () => {}
        });
    });
    for (let i = 0; i < 4 && store.messages('Drafts').length; i++) await Promise.all(devices.map(run => run()));
    assert.equal(submits.length, 1, `round ${round}: exactly one submission`);
    const left = (await store.client().list()).filter(f => f.path.includes('Sendelock'));
    assert.equal(left.length, 0, 'lock folder removed');
  }
});

// ------------------------------------------------------------------ local index
test('DATA-01: a sync that fails while fetching never marks the folder complete', async t => {
  const { createLocalIndex } = await import('../src/local-index.mjs');
  const { syntheticMailbox } = await import('./helpers/synthetic-mailbox.mjs');
  // The database is closed before its folder is removed (Windows keeps open files locked).
  const dir = mkdtempSync(join(tmpdir(), 'lv-audit23-'));
  const index = createLocalIndex({ dir, getKey: async () => Buffer.alloc(32, 3) });
  t.after(() => {
    index.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const client = syntheticMailbox(300, { textChars: 50 });
  const folders = [{ path: 'INBOX', flags: new Set() }];
  const fetch = client.fetch.bind(client);
  client.fetch = (uids, query, options) => {
    if (query.envelope) throw Object.assign(new Error('connection lost'), { code: 'NoConnection' });
    return fetch(uids, query, options);
  };
  await index.sync(client, 'acc', folders).catch(() => null);
  client.fetch = fetch;
  const next = await index.sync(client, 'acc', folders);
  assert.notEqual(next.skipped, 1, 'the next run does not skip the folder');
  assert.equal(next.added, 300);
  assert.equal((await index.sync(client, 'acc', folders)).skipped, 1, 'complete only now');
});
