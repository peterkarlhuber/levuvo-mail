import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskStore } from '../src/tasks.mjs';
import { createTaskSync } from '../src/task-sync.mjs';
import { createOAuthManager, PROVIDERS } from '../src/oauth.mjs';
import { createGoogleTasks, createGraphTasks, graphTaskOut, zonedToUtc } from '../src/task-sync-cloud.mjs';

const ENDPOINTS = { graph: 'https://graph.test/v1.0', googleTasks: 'https://tasks.test/tasks/v1' };
const ACCOUNTS = [
  { id: 'ms-1', label: 'Firma', provider: 'microsoft' },
  { id: 'g-1', label: 'Privat', provider: 'google' }
];

const res = (status, body = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

/** Fake Microsoft Graph To Do: two lists, tasks with paging. */
function fakeGraph() {
  const tasks = new Map(); // id → task
  const calls = [];
  let n = 0;
  const state = { consent: true };
  const put = t => {
    const task = {
      '@odata.etag': `W/"${++n}"`,
      lastModifiedDateTime: '2026-11-01T08:00:00Z',
      status: 'notStarted',
      importance: 'normal',
      ...t
    };
    tasks.set(task.id, task);
    return task;
  };
  async function fetchImpl(url, init = {}) {
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, body, auth: init.headers?.Authorization });
    if (!state.consent) return res(403, { error: { code: 'Forbidden' } });
    const base = `${ENDPOINTS.graph}/me/todo/lists`;
    if (url === base)
      return res(200, {
        value: [
          { id: 'L1', displayName: 'Aufgaben', wellknownListName: 'defaultList' },
          { id: 'L2', displayName: 'Einkauf' }
        ]
      });
    if (url === `${base}/L1/tasks?$top=100`) {
      const all = [...tasks.values()];
      return res(200, {
        value: all.slice(0, 2),
        ...(all.length > 2 ? { '@odata.nextLink': `${base}/L1/tasks?$skip=2` } : {})
      });
    }
    if (url === `${base}/L1/tasks?$skip=2`) return res(200, { value: [...tasks.values()].slice(2) });
    if (url === `${base}/L1/tasks` && method === 'POST') return res(201, put({ id: `new${n + 1}`, ...body }));
    const m = /\/L1\/tasks\/([^/?]+)$/.exec(url);
    if (m && method === 'PATCH') {
      const t = tasks.get(decodeURIComponent(m[1]));
      if (!t) return res(404);
      return res(200, put({ ...t, ...body, lastModifiedDateTime: '2026-11-18T10:00:00Z' }));
    }
    if (m && method === 'DELETE') return tasks.delete(decodeURIComponent(m[1])) ? res(204) : res(404);
    return res(404);
  }
  return { fetchImpl, calls, tasks, put, state };
}

/** Fake Google Tasks API with page tokens. */
function fakeGoogle() {
  const tasks = new Map();
  const calls = [];
  let n = 0;
  const put = t => {
    const task = {
      kind: 'tasks#task',
      etag: `"g${++n}"`,
      updated: '2026-11-01T08:00:00.000Z',
      status: 'needsAction',
      ...t
    };
    tasks.set(task.id, task);
    return task;
  };
  async function fetchImpl(url, init = {}) {
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, body });
    const u = new URL(url);
    if (u.pathname === '/tasks/v1/users/@me/lists') return res(200, { items: [{ id: 'GL', title: 'Meine Aufgaben' }] });
    if (u.pathname === '/tasks/v1/lists/GL/tasks' && method === 'GET') {
      assert.equal(u.searchParams.get('showCompleted'), 'true');
      const all = [...tasks.values()];
      if (!u.searchParams.get('pageToken'))
        return res(200, { items: all.slice(0, 1), ...(all.length > 1 ? { nextPageToken: 'p2' } : {}) });
      return res(200, { items: all.slice(1) });
    }
    if (u.pathname === '/tasks/v1/lists/GL/tasks' && method === 'POST')
      return res(200, put({ id: `g-new${n + 1}`, ...body }));
    const m = /\/lists\/GL\/tasks\/([^/]+)$/.exec(u.pathname);
    if (m && method === 'PATCH') {
      const t = tasks.get(m[1]);
      return t ? res(200, put({ ...t, ...body, updated: '2026-11-18T10:00:00.000Z' })) : res(404);
    }
    if (m && method === 'DELETE') return tasks.delete(m[1]) ? res(204) : res(404);
    return res(404);
  }
  return { fetchImpl, calls, tasks, put };
}

function setup(adapters) {
  let value = {};
  const file = { get: () => value, save: async v => (value = v) };
  const time = { at: Date.parse('2026-11-18T10:00:00Z') };
  const now = () => new Date(time.at);
  const store = createTaskStore(file, { now });
  const sync = createTaskSync({ file, adapters, now, timeZone: 'Europe/Vienna' });
  return { file, store, sync, tick: ms => (time.at += ms) };
}
const token = async a => `token-${a.id}`;

test('Graph: zoned reminder times and the body only carries changed fields', () => {
  assert.equal(zonedToUtc('2026-12-01T09:00:00.0000000', 'Europe/Berlin'), '2026-12-01T08:00:00.000Z');
  assert.equal(zonedToUtc('2026-07-01T09:00:00', 'Europe/Berlin'), '2026-07-01T07:00:00.000Z');
  assert.equal(zonedToUtc('2026-12-01T09:00:00.0000000', 'UTC'), '2026-12-01T09:00:00.000Z');
  assert.equal(zonedToUtc('2026-12-01T09:00:00', 'W. Europe Standard Time'), '2026-12-01T09:00:00.000Z');
  assert.deepEqual(graphTaskOut({ title: 'x' }), { title: 'x' });
  // A new due date moves the repetition along.
  assert.deepEqual(
    graphTaskOut({ due: '2026-12-03' }, { due: '2026-12-03', repeat: { freq: 'WEEKLY', interval: 1 } }),
    {
      dueDateTime: { dateTime: '2026-12-03T00:00:00.0000000', timeZone: 'UTC' },
      recurrence: {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['thursday'] },
        range: { type: 'noEnd', startDate: '2026-12-03' }
      }
    }
  );
  assert.deepEqual(graphTaskOut({ remindAt: null, priority: 'medium', done: true }), {
    isReminderOn: false,
    reminderDateTime: null,
    importance: 'normal',
    status: 'completed'
  });
});

test('Microsoft To Do sync: lists, paging, import, create, merge, done and deletions', async () => {
  const g = fakeGraph();
  const graph = createGraphTasks({ accounts: () => ACCOUNTS, token, fetchImpl: g.fetchImpl, endpoints: ENDPOINTS });
  const s = setup({ microsoft: graph });
  const { lists, errors } = await s.sync.sources(ACCOUNTS);
  assert.deepEqual(errors, []);
  assert.deepEqual(
    lists.map(l => [l.provider, l.listId, l.name]),
    [
      ['microsoft', 'L1', 'Aufgaben'],
      ['microsoft', 'L2', 'Einkauf']
    ]
  );
  g.put({
    id: 'a',
    title: 'Angebot schicken',
    body: { content: '<p>an Huber</p>', contentType: 'html' },
    importance: 'high',
    dueDateTime: { dateTime: '2026-11-20T00:00:00.0000000', timeZone: 'UTC' },
    isReminderOn: true,
    reminderDateTime: { dateTime: '2026-11-20T09:00:00.0000000', timeZone: 'Europe/Berlin' }
  });
  g.put({
    id: 'b',
    title: 'Wöchentlich',
    dueDateTime: { dateTime: '2026-11-18T00:00:00.0000000', timeZone: 'UTC' },
    recurrence: {
      pattern: { type: 'weekly', interval: 1, daysOfWeek: ['wednesday'] },
      range: { type: 'noEnd', startDate: '2026-11-18' }
    }
  });
  g.put({ id: 'c', title: 'Erledigt', status: 'completed' });
  const link = await s.sync.link({ provider: 'microsoft', accountId: 'ms-1', listId: 'L1', name: 'Aufgaben' });
  const r = (await s.sync.run(link.id))[link.id];
  assert.equal(r.created, 3, 'all pages are read');
  const by = title => s.store.list().find(t => t.title === title);
  assert.deepEqual(
    {
      notes: by('Angebot schicken').notes,
      due: by('Angebot schicken').due,
      remindAt: by('Angebot schicken').remindAt,
      priority: by('Angebot schicken').priority
    },
    { notes: 'an Huber', due: '2026-11-20', remindAt: '2026-11-20T08:00:00.000Z', priority: 'high' }
  );
  assert.deepEqual(by('Wöchentlich').repeat, { freq: 'WEEKLY', interval: 1 });
  assert.equal(by('Erledigt').done, true);
  assert.ok(g.calls.every(c => c.auth === 'Bearer token-ms-1'));

  // Local: a task with time and "medium" priority; Graph stores the day and "normal".
  s.tick(60_000);
  const mine = await s.store.save({
    title: 'Mit Uhrzeit',
    due: '2026-11-21T14:00:00.000Z',
    priority: 'medium',
    list: link.id,
    mail: { accountId: 'ms-1', folder: 'INBOX', uid: 3, subject: 'Geheim', from: 'x' }
  });
  await s.sync.run(link.id);
  const post = g.calls.find(c => c.method === 'POST');
  assert.equal(post.body.title, 'Mit Uhrzeit');
  assert.deepEqual(post.body.dueDateTime, { dateTime: '2026-11-21T00:00:00.0000000', timeZone: 'UTC' });
  assert.equal(post.body.importance, 'normal');
  assert.doesNotMatch(JSON.stringify(post.body), /Geheim|INBOX/);
  const kept = s.store.get(mine.id);
  assert.equal(kept.due, '2026-11-21T14:00:00.000Z', 'the time stays on this device');
  assert.equal(kept.priority, 'medium');
  const patches = g.calls.filter(c => c.method === 'PATCH').length;
  await s.sync.run(link.id);
  assert.equal(g.calls.filter(c => c.method === 'PATCH').length, patches, 'no endless updates');

  // Finished here (repeating): the same To Do task gets the next date, it is not completed there.
  await s.store.setDone(by('Wöchentlich').id, true);
  await s.sync.run(link.id);
  const b = g.tasks.get('b');
  assert.equal(b.status, 'notStarted');
  assert.equal(b.dueDateTime.dateTime, '2026-11-25T00:00:00.0000000');
  assert.deepEqual(b.recurrence.pattern.daysOfWeek, ['wednesday']);

  // Finished in To Do: To Do makes the next task itself, so here it is just done.
  g.put({ ...g.tasks.get('b'), status: 'completed', lastModifiedDateTime: '2026-11-18T12:00:00Z' });
  g.put({
    id: 'b2',
    title: 'Wöchentlich',
    dueDateTime: { dateTime: '2026-12-02T00:00:00.0000000', timeZone: 'UTC' },
    recurrence: b.recurrence
  });
  await s.sync.run(link.id);
  const weekly = s.store.list().filter(t => t.title === 'Wöchentlich');
  // The occurrence finished here earlier, the one finished in To Do, and To Do's next one.
  assert.deepEqual(weekly.map(t => [t.done, t.due]).sort(), [
    [false, '2026-12-02'],
    [true, '2026-11-18'],
    [true, '2026-11-25']
  ]);

  // Deleted here → deleted in To Do.
  await s.store.remove(by('Erledigt').id);
  await s.sync.run(link.id);
  assert.equal(g.tasks.has('c'), false);
});

test('Microsoft To Do: missing consent is reported with the account, foreign next links are refused', async () => {
  const g = fakeGraph();
  g.state.consent = false;
  const graph = createGraphTasks({ accounts: () => ACCOUNTS, token, fetchImpl: g.fetchImpl, endpoints: ENDPOINTS });
  const s = setup({ microsoft: graph });
  const { errors } = await s.sync.sources(ACCOUNTS.filter(a => a.provider === 'microsoft'));
  assert.deepEqual(
    errors.map(e => [e.code, e.accountId, e.provider]),
    [['tasks_consent_required', 'ms-1', 'microsoft']]
  );
  const link = await s.sync.link({ provider: 'microsoft', accountId: 'ms-1', listId: 'L1', name: 'Aufgaben' });
  const r = await s.sync.run(link.id);
  assert.equal(r[link.id].code, 'tasks_consent_required');
  assert.equal(s.sync.links()[0].lastErrorCode, 'tasks_consent_required');

  // A token error from the sign-in service is mapped the same way.
  const denied = createGraphTasks({
    accounts: () => ACCOUNTS,
    token: async () => {
      throw Object.assign(new Error('x'), { code: 'cloud_consent_required' });
    },
    fetchImpl: g.fetchImpl,
    endpoints: ENDPOINTS
  });
  await assert.rejects(denied.lists({ id: 'ms-1' }), e => e.code === 'tasks_consent_required');

  const evil = createGraphTasks({
    accounts: () => ACCOUNTS,
    token,
    endpoints: ENDPOINTS,
    fetchImpl: async url => {
      if (url.includes('evil')) throw new Error('must not be called');
      return res(200, { value: [{ id: 'x', title: 'a' }], '@odata.nextLink': 'https://evil.test/steal' });
    }
  });
  await assert.rejects(evil.pull({ accountId: 'ms-1', listId: 'L1' }), e => e.code === 'task_sync_foreign_url');
});

test('Google Tasks sync: paging, day-only due dates, reminder and repetition stay local', async () => {
  const gg = fakeGoogle();
  const google = createGoogleTasks({ accounts: () => ACCOUNTS, token, fetchImpl: gg.fetchImpl, endpoints: ENDPOINTS });
  const s = setup({ google });
  const { lists } = await s.sync.sources(ACCOUNTS.filter(a => a.provider === 'google'));
  assert.deepEqual(
    lists.map(l => [l.listId, l.name]),
    [['GL', 'Meine Aufgaben']]
  );
  gg.put({ id: 't1', title: 'Paket abholen', notes: 'Post', due: '2026-11-19T00:00:00.000Z' });
  gg.put({ id: 't2', title: 'Fertig', status: 'completed', completed: '2026-11-10T10:00:00.000Z' });
  gg.put({ id: 't3', title: 'Gelöscht', deleted: true });
  const link = await s.sync.link({ provider: 'google', accountId: 'g-1', listId: 'GL', name: 'Meine Aufgaben' });
  await s.sync.run(link.id);
  assert.deepEqual(
    s.store
      .list()
      .map(t => [t.title, t.due, t.done])
      .sort(),
    [
      ['Fertig', null, true],
      ['Paket abholen', '2026-11-19', false]
    ]
  );
  const task = s.store.list().find(t => t.title === 'Paket abholen');
  s.tick(60_000);
  await s.store.save({
    ...task,
    remindAt: '2026-11-19T07:00:00.000Z',
    priority: 'high',
    repeat: { freq: 'MONTHLY', interval: 1 },
    notes: 'Post, Ausweis mitnehmen'
  });
  await s.sync.run(link.id);
  const patch = gg.calls.find(c => c.method === 'PATCH');
  assert.deepEqual(patch.body, { notes: 'Post, Ausweis mitnehmen' }, 'only what Google can store is sent');
  // A later change in Google does not drop the local reminder or repetition.
  gg.put({ ...gg.tasks.get('t1'), title: 'Paket abholen (Filiale)', updated: '2026-11-18T11:00:00.000Z' });
  await s.sync.run(link.id);
  const after = s.store.get(task.id);
  assert.equal(after.title, 'Paket abholen (Filiale)');
  assert.equal(after.remindAt, '2026-11-19T07:00:00.000Z');
  assert.deepEqual(after.repeat, { freq: 'MONTHLY', interval: 1 });
  assert.equal(after.priority, 'high');

  // Done here: a repeating task moves on here, Google gets the next day.
  await s.store.setDone(task.id, true);
  await s.sync.run(link.id);
  assert.equal(gg.tasks.get('t1').due, '2026-12-19T00:00:00.000Z');
  assert.equal(gg.tasks.get('t1').status, 'needsAction');
  // Undone in Google.
  gg.put({ ...gg.tasks.get('t2'), status: 'needsAction', completed: null, updated: '2026-11-18T12:00:00.000Z' });
  await s.sync.run(link.id);
  assert.equal(s.store.list().find(t => t.title === 'Fertig').done, false);
});

test('OAuth: the Microsoft To Do token is asked for separately and cached apart', async () => {
  assert.ok(PROVIDERS.microsoft.scopes.includes('https://graph.microsoft.com/Tasks.ReadWrite'));
  assert.ok(PROVIDERS.google.scopes.includes('https://www.googleapis.com/auth/tasks'));
  assert.doesNotMatch(PROVIDERS.microsoft.cloudScope, /Tasks/, 'calendar consent of older accounts stays valid');
  const requests = [];
  const oauth = createOAuthManager({
    config: { microsoft: { clientId: 'c' }, google: { clientId: 'g' } },
    fetchImpl: async (_url, init) => {
      const scope = new URLSearchParams(init.body).get('scope');
      requests.push(scope);
      return res(200, { access_token: `at:${scope}`, expires_in: 3600 });
    }
  });
  const tasksToken = await oauth.accessToken('ms-1', 'microsoft', 'rt', null, { resource: 'tasks' });
  const cloudToken = await oauth.accessToken('ms-1', 'microsoft', 'rt', null, { resource: 'cloud' });
  assert.match(tasksToken, /Tasks\.ReadWrite/);
  assert.doesNotMatch(cloudToken, /Tasks/);
  await oauth.accessToken('ms-1', 'microsoft', 'rt', null, { resource: 'tasks' });
  assert.equal(requests.length, 2, 'cached per resource');
  oauth.forget('ms-1');
  await oauth.accessToken('ms-1', 'microsoft', 'rt', null, { resource: 'tasks' });
  assert.equal(requests.length, 3);
});
