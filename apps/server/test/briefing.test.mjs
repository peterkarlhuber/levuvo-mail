import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildBriefing, waitsForReply, MAX_REPLIES } from '../src/briefing.mjs';
import { createMailServer } from '../src/app.mjs';

const NOW = Date.parse('2026-11-20T07:30:00Z');
const DAY = { from: '2026-11-19T23:00:00.000Z', to: '2026-11-20T23:00:00.000Z', now: NOW };
const hoursAgo = h => new Date(NOW - h * 3600_000).toISOString();

const mail = (uid, extra = {}) => ({
  uid,
  fromName: `Person ${uid}`,
  fromEmail: `p${uid}@example.org`,
  subject: `Frage ${uid}`,
  date: hoursAgo(uid),
  unread: true,
  answered: false,
  flagged: false,
  bundle: null,
  preview: 'Kannst du mir bis Freitag Bescheid geben?',
  ...extra
});

test('briefing: waiting mail is mail from people, recent, unanswered and not from yourself', () => {
  const own = new Set(['me@example.org']);
  const since = NOW - 3 * 86_400_000;
  assert.equal(waitsForReply(mail(1), { own, since }), true);
  assert.equal(waitsForReply(mail(1, { answered: true }), { own, since }), false);
  assert.equal(waitsForReply(mail(1, { bundle: 'newsletter' }), { own, since }), false);
  assert.equal(waitsForReply(mail(1, { fromEmail: 'no-reply@shop.example' }), { own, since }), false);
  assert.equal(waitsForReply(mail(1, { fromEmail: 'newsletter@shop.example' }), { own, since }), false);
  assert.equal(waitsForReply(mail(1, { fromEmail: 'ME@example.org' }), { own, since }), false);
  assert.equal(waitsForReply(mail(1, { date: hoursAgo(24 * 4) }), { own, since }), false);
  assert.equal(waitsForReply(mail(1, { date: null }), { own, since }), false);
});

test('briefing: collects events, tasks, due follow-ups, waiting mail and spaces news', async () => {
  const b = await buildBriefing(
    {
      accounts: [{ id: 'a1', label: 'Arbeit' }],
      ownAddresses: ['me@example.org'],
      listInbox: async () => ({
        messages: [
          mail(2),
          mail(1, { flagged: true }),
          mail(3, { answered: true }),
          ...Array.from({ length: 12 }, (_, i) => mail(10 + i))
        ]
      }),
      events: async (from, to) => {
        assert.equal(from, DAY.from);
        assert.equal(to, DAY.to);
        return {
          events: [
            {
              uid: 'e1',
              summary: 'Projekt-Jour-fixe',
              start: '2026-11-20T09:00:00Z',
              end: '2026-11-20T10:00:00Z',
              attendees: [{}, {}]
            },
            { uid: 'e2', summary: 'Abgesagt', status: 'CANCELLED', start: '2026-11-20T11:00:00Z' }
          ]
        };
      },
      tasks: view =>
        view === 'overdue'
          ? [{ id: 't1', title: 'Angebot schicken', due: '2026-11-18' }]
          : [
              { id: 't1', title: 'Angebot schicken', due: '2026-11-18' },
              { id: 't2', title: 'Rechnung prüfen', due: '2026-11-20' }
            ],
      followups: () => [
        { id: 'f1', accountId: 'a1', subject: 'Vertrag', to: ['kunde@example.org'], state: 'due', due: hoursAgo(2) },
        { id: 'f2', accountId: 'a1', subject: 'Später', to: [], state: 'waiting', due: '2026-12-01T08:00:00Z' }
      ],
      spaces: async () => ({
        spaces: [
          { id: 's1', name: 'Team', status: 'active', updatedAt: hoursAgo(3), openTasks: 2 },
          { id: 's2', name: 'Alt', status: 'active', updatedAt: hoursAgo(72) }
        ],
        invitations: [
          { id: 'i1', name: 'Neu', from: { name: 'Anna' }, expired: false },
          { id: 'i2', name: 'Abgelaufen', from: { name: 'Bob' }, expired: true }
        ]
      })
    },
    DAY
  );
  assert.deepEqual(
    b.events.map(e => e.summary),
    ['Projekt-Jour-fixe']
  );
  assert.equal(b.events[0].attendees, 2);
  assert.deepEqual(
    b.tasks.map(t => [t.id, t.overdue]),
    [
      ['t1', true],
      ['t2', false]
    ]
  );
  assert.deepEqual(
    b.followups.map(f => f.id),
    ['f1']
  );
  assert.equal(b.replies.length, MAX_REPLIES);
  assert.equal(b.replies[0].uid, 1, 'flagged first');
  assert.equal(b.replies[1].uid, 2, 'then newest');
  assert.ok(!b.replies.some(r => r.uid === 3), 'answered mail left out');
  assert.equal(b.moreReplies, 14 - MAX_REPLIES);
  assert.deepEqual(
    b.spaces.updated.map(s => s.name),
    ['Team']
  );
  assert.deepEqual(
    b.spaces.invitations.map(i => i.from),
    ['Anna']
  );
  assert.deepEqual(b.unavailable, []);
  assert.ok(!JSON.stringify(b).includes('"text"'), 'no full mail text');
});

test('briefing: a failing source empties its section and is reported, the rest still works', async () => {
  const b = await buildBriefing(
    {
      accounts: [{ id: 'a1' }, { id: 'a2' }],
      ownAddresses: [],
      listInbox: async id => {
        if (id === 'a1') throw new Error('imap down');
        return { messages: [mail(1)] };
      },
      events: async () => {
        throw new Error('calendar down');
      },
      tasks: () => {
        throw Object.assign(new Error('locked'), { statusCode: 423 });
      },
      followups: () => [],
      spaces: async () => {
        throw new Error('no spaces');
      }
    },
    DAY
  );
  assert.deepEqual(b.unavailable.sort(), ['calendar', 'mail:a1', 'spaces', 'tasks']);
  assert.equal(b.replies.length, 1);
  assert.equal(b.replies[0].accountId, 'a2');
});

// ------------------------------------------------------------------ routes
const SECRET = 'e'.repeat(64);
const PORT = 4781;
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

function fakeImapFactory() {
  return () => ({
    on() {},
    async connect() {},
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
          envelope: { subject: `Frage ${uid}`, from: [{ name: 'Clara', address: `clara${uid}@example.org` }] },
          internalDate: new Date(Date.now() - uid * 3600_000),
          flags: uid === 2 ? new Set(['\\Answered']) : new Set(),
          bodyStructure: {}
        };
    },
    async search() {
      return [1, 2];
    }
  });
}

async function server(t, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'lv-brief-'));
  const s = await createMailServer({
    desktop: true,
    sessionSecret: SECRET,
    env: {},
    vault: vault(),
    accountsFile: join(dir, 'accounts.json'),
    staticRoot: join(dir, 'dist'),
    imapFactory: fakeImapFactory(),
    smtpFactory: () => ({ verify: async () => {}, close() {} }),
    watch: false,
    ...extra
  });
  s.setPortForTesting(PORT);
  t.after(async () => {
    await s.close();
    rmSync(dir, { recursive: true, force: true });
  });
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
  return { s, accountId: r.json().account.id };
}

test('GET /api/briefing: overview of the day from local data, range is checked', async t => {
  const { s, accountId } = await server(t);
  const now = Date.now();
  const from = new Date(now - 3600_000).toISOString();
  const to = new Date(now + 20 * 3600_000).toISOString();
  const r = await s.api.inject({
    method: 'GET',
    url: `/api/briefing?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&tz=Europe%2FVienna`,
    headers: GET
  });
  assert.equal(r.statusCode, 200, r.body);
  const b = r.json();
  assert.deepEqual(
    b.replies.map(m => [m.accountId, m.uid]),
    [[accountId, 1]]
  );
  assert.ok(Array.isArray(b.events) && Array.isArray(b.tasks) && Array.isArray(b.followups));

  const bad = await s.api.inject({ method: 'GET', url: '/api/briefing?from=x&to=y', headers: GET });
  assert.equal(bad.statusCode, 400);
  const tooLong = await s.api.inject({
    method: 'GET',
    url: `/api/briefing?from=${encodeURIComponent(from)}&to=${encodeURIComponent(new Date(now + 5 * 86_400_000).toISOString())}`,
    headers: GET
  });
  assert.equal(tooLong.statusCode, 400);
});

test('POST /api/briefing/rank: needs the action header and enabled AI', async t => {
  const { s } = await server(t);
  const from = new Date(Date.now() - 3600_000).toISOString();
  const to = new Date(Date.now() + 3600_000).toISOString();
  const noAction = await s.api.inject({
    method: 'POST',
    url: '/api/briefing/rank',
    headers: POST,
    payload: { from, to }
  });
  assert.equal(noAction.statusCode, 403);
  const off = await s.api.inject({
    method: 'POST',
    url: '/api/briefing/rank',
    headers: { ...POST, 'x-levuvo-action': 'ai-v1' },
    payload: { from, to, auto: true }
  });
  assert.equal(off.statusCode, 409, off.body);
  assert.equal(off.json().code, 'ai_disabled');
});
