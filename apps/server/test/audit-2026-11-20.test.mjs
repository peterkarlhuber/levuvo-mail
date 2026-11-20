// Regression tests for the findings of the audit of 2026-11-20 (before the next release).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMailServer } from '../src/app.mjs';
import { createDiagnostics, errorKind } from '../src/diagnostics.mjs';
import { createFollowupStore, MAX_ENTRIES } from '../src/followups.mjs';
import { NO_SENT_COPY_FLAG, SENT_FLAG, listScheduled, scheduleState, sendDue } from '../src/scheduled.mjs';
import { createMailStore } from './helpers/fake-mailstore.mjs';

const DUE = '2026-11-18T10:00:00.000Z';
const NOW = Date.parse(DUE) + 1000;
const OWNER = 'a'.repeat(32);

function scheduledSource() {
  return [
    'From: me@example.test',
    'To: customer@example.test',
    'Subject: Offer',
    'Message-ID: <offer-1@example.test>',
    `X-Levuvo-Send-At: ${DUE}`,
    'X-Levuvo-Draft-ID: 11111111-2222-3333-4444-555555555555',
    `X-Levuvo-Scheduler: ${OWNER}`,
    '',
    'Hello',
    ''
  ].join('\r\n');
}

const run = (store, saveSent, submits = []) =>
  sendDue(store.client({ name: OWNER }), {
    now: NOW,
    instanceId: OWNER,
    pollMs: 1,
    submit: async (rcpt, raw) => submits.push(raw.toString()),
    saveSent
  });

test('F-FUN-002: a scheduled send whose Sent copy fails keeps the draft as the record', async () => {
  for (const saveSent of [
    async () => ({ saved: false, folder: null, reason: 'append_rejected' }),
    async () => {
      throw new Error('connection lost');
    }
  ]) {
    const store = createMailStore();
    store.add('Drafts', scheduledSource(), ['\\Draft', '$LevuvoScheduled']);
    const submits = [];
    const out = await run(store, saveSent, submits);
    assert.equal(submits.length, 1, 'the mail went out once');
    assert.equal(out.results[0].sent, true);
    assert.equal(out.results[0].savedToSent, false);
    assert.ok(out.results[0].sentCopyError);
    // Not moved to the trash: the draft is the only copy of what was sent.
    assert.equal(store.messages('Drafts').length, 1);
    assert.equal(store.messages('Trash').length, 0);
    const listed = await listScheduled(store.client({ name: 'reader' }));
    assert.equal(listed.items[0].state, 'sent_no_copy');
    // The next run neither sends it again nor throws the record away.
    const again = await run(store, async () => ({ saved: true }), submits);
    assert.equal(submits.length, 1);
    assert.equal(again.results.length, 0);
    assert.equal(store.messages('Drafts').length, 1);
  }
});

test('F-FUN-002: a stored Sent copy still cleans up the scheduled draft', async () => {
  const store = createMailStore();
  store.add('Drafts', scheduledSource(), ['\\Draft', '$LevuvoScheduled']);
  const out = await run(store, async () => ({ saved: true, folder: 'Sent', reason: null }));
  assert.equal(out.results[0].savedToSent, true);
  assert.equal(store.messages('Drafts').length, 0);
  assert.equal(scheduleState(new Set([SENT_FLAG])), 'sent');
  assert.equal(scheduleState(new Set([SENT_FLAG, NO_SENT_COPY_FLAG])), 'sent_no_copy');
});

function memoryFile(initial = {}) {
  let state = initial;
  return {
    get: () => state,
    save: async next => {
      state = next;
    }
  };
}

test('F-FUN-001: at the limit new snoozes are refused instead of dropping active ones', async () => {
  const snoozed = Array.from({ length: MAX_ENTRIES }, (_, i) => ({ id: `s${i}`, accountId: 'a', uid: i + 1 }));
  const store = createFollowupStore(memoryFile({ snoozed, followups: [] }));
  await assert.rejects(
    store.addSnoozed('a', 'INBOX', { folder: 'Snoozed', uidValidity: 1, items: [{ uid: 9999 }] }, DUE),
    { code: 'followups_limit', statusCode: 409 }
  );
  assert.equal(store.snoozed('a').length, MAX_ENTRIES);
  assert.equal(store.snoozed('a')[0].id, 's0', 'the oldest entry is still tracked');
  // Saving other changes never trims either.
  await store.updateSnoozed('s1', { until: DUE });
  assert.equal(store.snoozed('a').length, MAX_ENTRIES);
  const full = createFollowupStore(
    memoryFile({ snoozed: [], followups: Array.from({ length: MAX_ENTRIES }, (_, i) => ({ id: `f${i}` })) })
  );
  await assert.rejects(full.addFollowup({ accountId: 'a', messageId: '<x@y>' }), { code: 'followups_limit' });
});

test('F-FUN-005: diagnostics keep an anonymous error class, never the message', () => {
  const d = createDiagnostics({ version: 'test' });
  d.record('tasks', 'tasks_failed', Object.assign(new Error('/home/peter/secret path'), { code: 'ENOSPC' }));
  d.record('scheduled', 'check_failed', new TypeError('peter@example.org is not a function'));
  d.record('scheduled', 'check_failed');
  const recent = d.report().recent;
  assert.deepEqual(
    recent.map(e => e.kind ?? null),
    ['ENOSPC', 'TypeError', null]
  );
  assert.doesNotMatch(JSON.stringify(d.report()), /peter|secret/);
  assert.equal(errorKind({ code: 'with spaces', name: 'x y' }), 'Error');
});

const SECRET = 'e'.repeat(64);
const PORT = 4778;
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

function imapFactory() {
  return () => ({
    on() {},
    async connect() {},
    async logout() {},
    close() {},
    capabilities: new Set(['MOVE', 'UIDPLUS']),
    mailbox: { exists: 0, uidValidity: 5, uidNext: 1 },
    async list() {
      return [{ path: 'INBOX', flags: new Set(), status: { unseen: 0, messages: 0 } }];
    },
    async getMailboxLock() {
      return { release() {} };
    },
    async *fetch() {},
    async search() {
      return [];
    },
    async mailboxCreate() {
      return null;
    },
    async append() {
      return false;
    }
  });
}

async function server(t) {
  const dir = mkdtempSync(join(tmpdir(), 'lv-aud20-'));
  const s = await createMailServer({
    desktop: true,
    sessionSecret: SECRET,
    env: {},
    vault: vault(),
    accountsFile: join(dir, 'accounts.json'),
    staticRoot: join(dir, 'dist'),
    imapFactory: imapFactory(),
    smtpFactory: () => ({
      verify: async () => {},
      sendMail: async () => ({ accepted: ['anna@example.org'], rejected: [] }),
      close() {}
    }),
    watch: false
  });
  s.setPortForTesting(PORT);
  t.after(async () => {
    await s.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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
  return { s, id: r.json().account.id };
}

test('F-FUN-003: a follow-up that could not be stored is reported, not claimed', async t => {
  const { s, id } = await server(t);
  s.ctx.followups.addFollowup = async () => {
    throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
  };
  const r = await s.api.inject({
    method: 'POST',
    url: `/api/messages/send?account=${id}`,
    headers: { ...POST, 'x-levuvo-action': 'send-v1' },
    payload: {
      requestId: '11111111-1111-4111-8111-111111111111',
      confirm: 'SEND',
      to: ['anna@example.org'],
      cc: [],
      bcc: [],
      subject: 'Angebot',
      html: '<p>Hallo</p>',
      attachments: [],
      followUp: new Date(Date.now() + 3 * 86_400_000).toISOString()
    }
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().sent, true);
  assert.equal(r.json().followUp, false);
  assert.equal(r.json().followUpError, 'followup_not_saved');
  const events = s.ctx.diagnostics.report().recent;
  assert.ok(events.some(e => e.area === 'followups' && e.code === 'save_failed' && e.kind === 'ENOSPC'));
});

test('F-GOV-003: removing an account also removes its contacts’ writing-style profile', async t => {
  const { s, id } = await server(t);
  await s.ctx.styleFile.save({
    accounts: { [id]: { builtAt: DUE, mails: 3, contacts: { 'anna@example.org': { greeting: 'Hallo …,' } } } }
  });
  assert.ok(s.ctx.styles.get(id));
  const r = await s.api.inject({
    method: 'POST',
    url: '/api/accounts/remove',
    headers: { ...POST, 'x-levuvo-action': 'accounts-v1' },
    payload: { id, confirm: 'REMOVE_LOCAL_ACCOUNT' }
  });
  assert.equal(r.statusCode, 200, r.body);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(s.ctx.styles.get(id), null);
  assert.equal(s.ctx.styleFile.get().accounts[id], undefined);
});
