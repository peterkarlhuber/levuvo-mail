import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCommitmentStore, ownText, scanCommitments, KEEP_MS } from '../src/commitments.mjs';
import { createMailServer } from '../src/app.mjs';

function memoryFile(initial = {}) {
  let value = initial;
  return {
    get: () => value,
    save: async next => {
      value = structuredClone(next);
    }
  };
}

const NOW = Date.parse('2026-11-19T20:00:00Z');
const ago = h => new Date(NOW - h * 3600_000).toISOString();

function fakeAi(settings, answer) {
  const calls = [];
  return {
    calls,
    get: () => ({ enabled: true, provider: 'ollama', features: { commitments: true }, ...settings }),
    run: async (kind, input, opts) => {
      calls.push({ kind, input, opts });
      return typeof answer === 'function' ? answer(input) : answer;
    },
    log: { add: async () => {} }
  };
}

const sent = [
  { uid: 11, date: ago(2), subject: 'Angebot', to: [{ address: 'anna@example.com' }], messageId: '<s11@x>' },
  { uid: 10, date: ago(24 * 5), subject: 'Alt', to: [{ address: 'old@example.com' }] }
];
const inbox = [
  {
    uid: 21,
    date: ago(1),
    subject: 'Rückmeldung',
    fromName: 'Bernd',
    fromEmail: 'bernd@example.com',
    messageId: '<i21@x>'
  },
  { uid: 22, date: ago(1), subject: 'Newsletter', fromEmail: 'news@shop.example', bundle: 'newsletter' }
];

function deps(ai, store) {
  return {
    ai,
    store,
    accounts: [{ id: 'a1', sentFolder: 'Gesendet' }],
    ownAddresses: ['peter@example.org'],
    listFolder: async (_id, folder) => ({ messages: folder === 'Gesendet' ? sent : inbox }),
    readText: async (_id, folder, uid) => ({
      text:
        folder === 'Gesendet'
          ? `Hallo Anna,\nich schicke dir das Angebot bis Freitag.\n\nAm 18.11.2026 schrieb Anna <anna@example.com>:\n> Ich verspreche dir alles`
          : `Ich melde mich nächste Woche bei dir. (${uid})`
    })
  };
}

test('commitments: own text drops quoted history', () => {
  assert.equal(
    ownText('Hallo\nich schicke es dir.\n\nAm 18.11. schrieb Anna <a@b.c>:\n> alt'),
    'Hallo\nich schicke es dir.'
  );
  assert.equal(ownText('Neu\nOn Mon, 17 Nov 2026 Anna wrote:\n> old'), 'Neu');
  assert.equal(ownText('Neu\n> zitiert'), 'Neu');
  assert.equal(ownText('A\n-----Ursprüngliche Nachricht-----\nB'), 'A');
});

test('commitments: opt-in, local only, each mail once, direction follows the folder', async () => {
  const store = createCommitmentStore(memoryFile(), { now: () => NOW });
  const off = fakeAi({ features: {} }, { items: [] });
  assert.deepEqual(await scanCommitments(deps(off, store), { now: NOW }), { ran: false, reason: 'off' });
  const cloud = fakeAi({ provider: 'anthropic' }, { items: [] });
  assert.deepEqual(await scanCommitments(deps(cloud, store), { now: NOW }), { ran: false, reason: 'cloud' });
  assert.equal(off.calls.length + cloud.calls.length, 0);

  const ai = fakeAi({}, input => ({
    items: input.messages.flatMap(m =>
      m.subject === 'Angebot'
        ? [
            { id: m.id, direction: 'mine', what: 'Angebot an Anna schicken', due: '2026-11-21', quote: 'bis Freitag' },
            // A sent mail never holds someone else's promise: dropped.
            { id: m.id, direction: 'theirs', what: 'Falsch' }
          ]
        : [{ id: m.id, direction: 'theirs', what: 'Bernd meldet sich', due: '' }]
    )
  }));
  const r = await scanCommitments(deps(ai, store), { now: NOW });
  assert.deepEqual(r, { ran: true, scanned: 2, found: 2 });
  assert.equal(ai.calls.length, 1);
  const { input, opts } = ai.calls[0];
  assert.equal(opts.source, 'commitments');
  assert.equal(opts.accountId, 'a1');
  assert.deepEqual(
    input.messages.map(m => m.subject),
    ['Angebot', 'Rückmeldung'],
    'old sent mail and newsletters are not read'
  );
  assert.ok(!input.messages[0].text.includes('verspreche'), 'quoted part is not sent to the model');

  const items = store.open();
  const mine = items.find(i => i.direction === 'mine');
  const theirs = items.find(i => i.direction === 'theirs');
  assert.equal(mine.who, 'anna@example.com');
  assert.equal(mine.due, '2026-11-21');
  assert.equal(theirs.who, 'bernd@example.com');
  assert.equal(theirs.due, null);

  // Second run: nothing new to read.
  const again = await scanCommitments(deps(ai, store), { now: NOW + 60_000 });
  assert.deepEqual(again, { ran: true, scanned: 0, found: 0 });
  assert.equal(ai.calls.length, 1);
});

test('commitments: an AI error leaves the mails unscanned for the next run', async () => {
  const store = createCommitmentStore(memoryFile(), { now: () => NOW });
  const ai = fakeAi({}, () => {
    throw Object.assign(new Error('down'), { kind: 'unreachable' });
  });
  await assert.rejects(scanCommitments(deps(ai, store), { now: NOW }));
  assert.equal(store.get().scanned.length, 0);
});

test('commitments: store keeps 60 days, forgets an account', async () => {
  let now = NOW;
  const store = createCommitmentStore(memoryFile(), { now: () => now });
  await store.addScan([['a1', 'INBOX', 1]], [{ accountId: 'a1', uid: 1, what: 'X', direction: 'theirs' }]);
  await store.addScan([['a2', 'INBOX', 1]], [{ accountId: 'a2', uid: 1, what: 'Y', direction: 'theirs' }]);
  assert.equal(store.open().length, 2);
  await store.forgetAccount('a2');
  assert.deepEqual(
    store.open().map(i => i.what),
    ['X']
  );
  assert.equal(store.isScanned('a2', 'INBOX', 1), false);
  now += KEEP_MS + 1000;
  await store.remember({ lang: 'en', timeZone: 'Europe/Vienna' });
  assert.equal(store.open().length, 0);
  assert.equal(store.get().lang, 'en');
});

// ------------------------------------------------------------------ routes
const SECRET = 'c'.repeat(64);
const PORT = 4782;
const HOST = `127.0.0.1:${PORT}`;
const GET = { host: HOST, cookie: `levuvo_desktop_session=${SECRET}` };
const POST = { ...GET, origin: `http://${HOST}`, 'content-type': 'application/json', 'x-levuvo-action': 'ai-v1' };

function vault() {
  const m = new Map();
  return {
    available: true,
    get: (i, k) => m.get(`${i}:${k}`) || '',
    set: (i, k, v) => m.set(`${i}:${k}`, v),
    delete: (i, k) => m.delete(`${i}:${k}`)
  };
}

test('commitment routes: accept makes a task or a reminder, dismiss hides it', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'lv-commit-'));
  const s = await createMailServer({
    desktop: true,
    sessionSecret: SECRET,
    env: {},
    vault: vault(),
    accountsFile: join(dir, 'accounts.json'),
    staticRoot: join(dir, 'dist'),
    watch: false
  });
  s.setPortForTesting(PORT);
  t.after(async () => {
    await s.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const store = s.ctx.commitments;
  await store.addScan(
    [],
    [
      {
        accountId: 'a1',
        folder: 'Sent',
        uid: 5,
        messageId: '<m5@x>',
        subject: 'Angebot',
        direction: 'mine',
        what: 'Angebot an Anna schicken',
        who: 'anna@example.com',
        due: '2026-11-21',
        quote: 'Ich schicke dir das Angebot bis Freitag.'
      },
      {
        accountId: 'a1',
        folder: 'INBOX',
        uid: 6,
        messageId: '<m6@x>',
        subject: 'Rückmeldung',
        direction: 'theirs',
        what: 'Bernd meldet sich',
        who: 'bernd@example.com',
        due: null,
        quote: ''
      },
      { accountId: 'a1', folder: 'INBOX', uid: 7, subject: 'Egal', direction: 'theirs', what: 'Unwichtig', who: '' }
    ]
  );
  const list = async () =>
    (await s.api.inject({ method: 'GET', url: '/api/commitments?lang=de', headers: GET })).json();
  const before = await list();
  assert.equal(before.items.length, 3);
  assert.equal(before.enabled, false);
  const [mine, theirs, other] = ['mine', 'theirs', 'other'].map((d, i) =>
    d === 'other' ? before.items.find(x => x.uid === 7) : before.items.find(x => x.direction === d && x.uid === 5 + i)
  );

  const noAction = await s.api.inject({
    method: 'POST',
    url: '/api/commitments/accept',
    headers: { ...POST, 'x-levuvo-action': 'mail-v1' },
    payload: { id: mine.id }
  });
  assert.equal(noAction.statusCode, 403);

  const a = await s.api.inject({
    method: 'POST',
    url: '/api/commitments/accept',
    headers: POST,
    payload: { id: mine.id }
  });
  assert.equal(a.statusCode, 200, a.body);
  assert.equal(a.json().created.type, 'task');
  const [task] = s.ctx.tasks.list({ view: 'all' });
  assert.equal(task.title, 'Angebot an Anna schicken');
  assert.equal(task.due, '2026-11-21');
  assert.equal(task.source, 'ai');
  assert.equal(task.mail.uid, 5);

  const past = await s.api.inject({
    method: 'POST',
    url: '/api/commitments/accept',
    headers: POST,
    payload: { id: theirs.id, remindAt: '2020-01-01T08:00:00Z' }
  });
  assert.equal(past.statusCode, 400);
  const remindAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
  const b = await s.api.inject({
    method: 'POST',
    url: '/api/commitments/accept',
    headers: POST,
    payload: { id: theirs.id, remindAt }
  });
  assert.equal(b.statusCode, 200, b.body);
  assert.equal(b.json().created.type, 'followup');
  const [f] = s.ctx.followups.followups('a1');
  assert.equal(f.messageId, '<m6@x>');
  assert.equal(f.kind, 'promise');
  assert.deepEqual(f.to, ['bernd@example.com']);

  const d = await s.api.inject({
    method: 'POST',
    url: '/api/commitments/dismiss',
    headers: POST,
    payload: { id: other.id }
  });
  assert.equal(d.statusCode, 200);
  assert.equal((await list()).items.length, 0);
  const twice = await s.api.inject({
    method: 'POST',
    url: '/api/commitments/accept',
    headers: POST,
    payload: { id: mine.id }
  });
  assert.equal(twice.statusCode, 404);

  const scan = await s.api.inject({ method: 'POST', url: '/api/commitments/scan', headers: POST, payload: {} });
  assert.equal(scan.statusCode, 409);
});
