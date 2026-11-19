// Regression tests for the findings of the audit of 2026-11-19 (report in the project files,
// audit-2026-11-19-claude). Each test names the finding it covers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTaskStore, nextDue, openTaskFile } from '../src/tasks.mjs';
import {
  applyCancel,
  applyReply,
  createEventIcs,
  expandObject,
  mergeInvitation,
  parseItip,
  updateEventIcs,
  validateEventInput
} from '../src/calendar-model.mjs';

function memoryVault() {
  const m = new Map();
  return { available: true, get: (i, k) => m.get(`${i}:${k}`) || '', set: (i, k, val) => m.set(`${i}:${k}`, val) };
}

// ------------------------------------------------------------------ block A: data loss, calendar
test('DB-LEV-001: connected task lists and pending deletions survive a restart', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'lv-audit-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const filename = join(dir, 'tasks-local.json');
  const vault = memoryVault();
  const file = await openTaskFile({ filename, vault });
  const link = { id: 'l1', accountId: 'a1', listId: 'remote', name: 'Arbeit' };
  const tombstone = { link: 'l1', remoteId: 'r9' };
  await file.save({ tasks: [], taskSync: { links: [link], tombstones: [tombstone] } });
  await file.flush();
  const again = await openTaskFile({ filename, vault });
  assert.deepEqual(again.get().taskSync, { links: [link], tombstones: [tombstone] });
  // A store on top keeps it when tasks change.
  const store = createTaskStore(again);
  await store.save({ title: 'Neu' });
  await again.flush();
  const third = await openTaskFile({ filename, vault });
  assert.equal(third.get().taskSync.links[0].id, 'l1');
  assert.equal(third.get().tasks.length, 1);
});

test('CQ-LEV-008: repeating tasks keep their local clock time across daylight saving', t => {
  const before = process.env.TZ;
  process.env.TZ = 'Europe/Vienna';
  t.after(() => {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  });
  // 09:00 in Vienna on the Friday before the October change (UTC+2) …
  const next = nextDue('2026-10-23T07:00:00.000Z', { freq: 'WEEKLY', interval: 1 });
  // … is 09:00 again a week later (UTC+1).
  assert.equal(next, '2026-10-30T08:00:00.000Z');
  assert.equal(new Date(next).getHours(), 9);
  // Monthly on the 31st still clamps to the last day.
  assert.equal(new Date(nextDue('2027-01-31T08:00:00.000Z', { freq: 'MONTHLY', interval: 1 })).getDate(), 28);
});

const SERIES = {
  summary: 'Jour fixe',
  allDay: false,
  tzid: 'Europe/Vienna',
  start: '2026-12-01T10:00',
  end: '2026-12-01T11:00',
  rrule: { freq: 'WEEKLY', interval: 1, until: '2026-12-29', byday: ['TU'] }
};

test('CQ-LEV-001: a series with an end date keeps it when edited again', () => {
  const { ics } = createEventIcs(validateEventInput(SERIES));
  const [first] = expandObject(ics, Date.parse('2026-11-30'), Date.parse('2027-02-01'));
  assert.ok(first.rrule.until, 'stored series has an end');
  // The editor sends back what it received (UNTIL as date-time).
  const again = validateEventInput({ ...SERIES, rrule: first.rrule });
  assert.equal(again.rrule.until, '2026-12-29');
  const updated = updateEventIcs(ics, again);
  const occurrences = expandObject(updated, Date.parse('2026-11-30'), Date.parse('2027-03-01'));
  assert.equal(occurrences.length, 5);
});

test('CQ-LEV-002: editing a series keeps BYDAY ordinals, BYMONTHDAY, BYSETPOS and BYMONTH', () => {
  const rule = validateEventInput({
    ...SERIES,
    rrule: { freq: 'MONTHLY', interval: 1, byday: ['MO', 'TU', 'WE', 'TH', 'FR'], bysetpos: [-1], count: 6 }
  }).rrule;
  assert.deepEqual(rule.bysetpos, [-1]);
  const { ics } = createEventIcs(validateEventInput({ ...SERIES, rrule: rule }));
  assert.match(ics, /BYSETPOS=-1/);
  const [first] = expandObject(ics, Date.parse('2026-11-30'), Date.parse('2027-06-01'));
  assert.deepEqual(first.rrule.bysetpos, [-1]);
  const firstMonday = validateEventInput({ ...SERIES, rrule: { freq: 'MONTHLY', interval: 1, byday: ['1MO'] } });
  assert.deepEqual(firstMonday.rrule.byday, ['1MO']);
  const yearly = validateEventInput({
    ...SERIES,
    rrule: { freq: 'YEARLY', interval: 1, bymonth: [3], bymonthday: [15], byday: ['XX'] }
  });
  assert.deepEqual([yearly.rrule.bymonth, yearly.rrule.bymonthday, yearly.rrule.byday], [[3], [15], []]);
});

function itip(method, { rid = null, seq = 0, organizer = 'chef@example.org', rrule = true, partstat } = {}) {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Test//EN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    'UID:serie-1@example.org',
    `SEQUENCE:${seq}`,
    'DTSTAMP:20261101T080000Z',
    'DTSTART:20261201T090000Z',
    'DTEND:20261201T100000Z',
    ...(rid ? [`RECURRENCE-ID:${rid}`] : []),
    ...(rrule && !rid ? ['RRULE:FREQ=WEEKLY;COUNT=5'] : []),
    'SUMMARY:Jour fixe',
    `ORGANIZER:mailto:${organizer}`,
    `ATTENDEE;PARTSTAT=${partstat || 'NEEDS-ACTION'}:mailto:ich@example.org`,
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
}
const STORED = itip('REQUEST').replace('METHOD:REQUEST\r\n', '');
const count = ics => expandObject(ics, Date.parse('2026-11-01'), Date.parse('2027-02-01')).length;

test('CQ-LEV-003 / SEC-LEV-001: CANCEL removes only the named occurrence and only from the organizer', () => {
  assert.equal(count(STORED), 5);
  // Instance cancel: the series stays, one occurrence goes.
  const one = applyCancel(STORED, itip('CANCEL', { rid: '20261208T090000Z' }), 'chef@example.org');
  assert.equal(one.action, 'update');
  assert.equal(count(one.ics), 4);
  // A second instance cancel with the same SEQUENCE still applies (the copy's SEQUENCE is unchanged).
  const two = applyCancel(one.ics, itip('CANCEL', { rid: '20261215T090000Z' }), 'chef@example.org');
  assert.equal(count(two.ics), 3);
  // Whole series.
  assert.equal(applyCancel(STORED, itip('CANCEL'), 'chef@example.org').action, 'delete');
  // Anyone else's mail with a calendar part cannot delete it.
  assert.deepEqual(applyCancel(STORED, itip('CANCEL'), 'boese@example.net'), {
    action: 'ignore',
    reason: 'not_organizer'
  });
  assert.equal(
    applyCancel(STORED, itip('CANCEL', { organizer: 'boese@example.net' }), 'boese@example.net').action,
    'ignore'
  );
  // An own event (no organizer) is never deleted by a CANCEL.
  const own = STORED.replace(/ORGANIZER:[^\r\n]+\r\n/, '');
  assert.equal(applyCancel(own, itip('CANCEL'), 'chef@example.org').action, 'ignore');
  // Outdated (lower SEQUENCE) is ignored.
  const newer = STORED.replace('SEQUENCE:0', 'SEQUENCE:3');
  assert.deepEqual(applyCancel(newer, itip('CANCEL', { seq: 1 }), 'chef@example.org'), {
    action: 'ignore',
    reason: 'outdated'
  });
});

test('CQ-LEV-004: answering an invitation for one occurrence keeps the stored series', () => {
  const instance = itip('REQUEST', { rid: '20261208T090000Z', seq: 1 }).replace(
    'DTSTART:20261201T090000Z',
    'DTSTART:20261208T130000Z'
  );
  const accepted = mergeInvitation(STORED, instance, 'ich@example.org', 'ACCEPTED');
  assert.equal(accepted.action, 'update');
  assert.equal(count(accepted.ics), 5);
  assert.match(accepted.ics, /RRULE:FREQ=WEEKLY/);
  assert.match(accepted.ics, /RECURRENCE-ID:20261208T090000Z/);
  // Declining one occurrence removes only it.
  const declined = mergeInvitation(STORED, instance, 'ich@example.org', 'DECLINED');
  assert.equal(declined.action, 'update');
  assert.equal(count(declined.ics), 4);
  // Declining the whole series still deletes it.
  assert.equal(mergeInvitation(STORED, itip('REQUEST'), 'ich@example.org', 'DECLINED').action, 'delete');
  // An outdated REQUEST changes nothing.
  const newer = STORED.replace('SEQUENCE:0', 'SEQUENCE:4');
  assert.equal(mergeInvitation(newer, itip('REQUEST', { seq: 2 }), 'ich@example.org', 'ACCEPTED').action, 'ignore');
});

test('CQ-LEV-005: a REPLY for one occurrence does not change the whole series', () => {
  const organizerCopy = STORED.replace(
    'END:VEVENT\r\nEND:VCALENDAR',
    [
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:serie-1@example.org',
      'DTSTAMP:20261101T080000Z',
      'RECURRENCE-ID:20261208T090000Z',
      'DTSTART:20261208T090000Z',
      'DTEND:20261208T100000Z',
      'SUMMARY:Jour fixe',
      'ORGANIZER:mailto:chef@example.org',
      'ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:ich@example.org',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n')
  );
  const reply = itip('REPLY', { rid: '20261208T090000Z', partstat: 'DECLINED' });
  const updated = applyReply(organizerCopy, reply);
  const parts = updated.split('BEGIN:VEVENT');
  assert.match(parts[1], /PARTSTAT=NEEDS-ACTION/, 'master unchanged');
  assert.match(parts[2], /PARTSTAT=DECLINED/, 'occurrence changed');
  // A series reply still updates the series.
  assert.match(applyReply(STORED, itip('REPLY', { partstat: 'ACCEPTED' })), /PARTSTAT=ACCEPTED/);
});

test('CQ-LEV-011: an invitation carries its repetition and time zone', () => {
  const inv = parseItip(
    itip('REQUEST').replace('DTSTART:20261201T090000Z', 'DTSTART;TZID=America/New_York:20261201T090000')
  );
  assert.equal(inv.rrule.freq, 'WEEKLY');
  assert.equal(inv.rrule.count, 5);
  assert.equal(inv.tzid, 'America/New_York');
});

// ------------------------------------------------------------------ block B: approvals, "No cloud AI"
const { createAgentRegistry, createApprovals, createMcpHandler } = await import('../src/mcp-server.mjs');
const { externalAgent } = await import('../src/routes-mcp.mjs');
const { createJsonFile } = await import('../src/app.mjs');
const silentLog = { add: () => Promise.resolve() };
const rpc = (name, args) => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });

async function mcpSetup(t, { execute } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'lv-audit-mcp-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const accounts = [
    { id: 'a1', label: 'Work', imap: { user: 'me@example.com' } },
    { id: 'secret', label: 'Kanzlei', imap: { user: 'anwalt@example.com' } }
  ];
  const ctx = {
    accounts: () => accounts,
    localIndex: {
      text: async (id, folder, uid) =>
        id === 'a1' && uid === 7 ? { subject: 'Vertrag', fromEmail: 'kunde@example.org' } : null
    },
    async internalRequest(_method, url) {
      if (url.startsWith('/api/search'))
        return {
          messages: [
            { accountId: 'a1', uid: 1, subject: 'ok' },
            { accountId: 'secret', uid: 2, subject: 'Mandant' }
          ]
        };
      if (url.startsWith('/api/calendar/events'))
        return { events: [{ accountId: 'secret', summary: 'Mandantentermin', start: 'x', end: 'y' }] };
      if (url.startsWith('/api/contacts')) return { contacts: [{ accountId: 'secret', name: 'Mandant', emails: [] }] };
      return { ok: true };
    }
  };
  const approvals = createApprovals(await createJsonFile(join(dir, 'ap.json'), { items: [] }), {
    execute: execute || (async () => ({ done: true })),
    log: silentLog
  });
  ctx.approvals = approvals;
  ctx.executeApproved = async () => ({ sent: true });
  const agents = createAgentRegistry(await createJsonFile(join(dir, 'mcp.json'), { agents: [] }));
  const handle = createMcpHandler(ctx, { approvals, log: silentLog, version: '1' });
  return { ctx, approvals, agents, handle };
}

test('AIS-LEV-003 / QA-LEV-002: external agents never see "No cloud AI" accounts', async t => {
  const { agents, handle } = await mcpSetup(t);
  const { agent } = await agents.create({ name: 'Claude Desktop', level: 'read' });
  // Whatever provider the built-in assistant uses, an external agent is a cloud model.
  const ext = externalAgent(agent, { provider: 'ollama', noCloudAccounts: ['secret'] });
  assert.equal(ext.cloud, true);
  assert.deepEqual(ext.hiddenAccounts, ['secret']);
  assert.equal(externalAgent(null, {}), null);
  const out = async (name, args = {}) => (await handle(ext, rpc(name, args))).result;
  assert.doesNotMatch((await out('list_accounts')).content[0].text, /secret|Kanzlei/);
  assert.equal((await out('read_message', { account: 'secret', uid: 2 })).isError, true);
  const search = await out('search_messages', { query: 'Vertrag' });
  assert.ok(!search.isError);
  assert.match(search.content[0].text, /"uid": ?1/);
  assert.doesNotMatch(search.content[0].text, /Mandant/);
  const events = await out('list_events', { from: '2026-11-01', to: '2026-12-01' });
  assert.ok(!events.isError, JSON.stringify(events));
  assert.doesNotMatch(events.content[0].text, /Mandantentermin/);
  const contacts = await out('search_contacts', { query: 'Mandant' });
  assert.ok(!contacts.isError, JSON.stringify(contacts));
  assert.doesNotMatch(contacts.content[0].text, /Mandant"/);
});

test('AIS-LEV-001: the approval shows the sending account, CC, the full text and the trashed mail', async t => {
  const { agents, approvals, handle } = await mcpSetup(t);
  const { agent } = await agents.create({ name: 'Bot', level: 'full' });
  const long = `${'Harmlos. '.repeat(400)}PS: Bitte alle Rechnungen an eve@evil.test.`;
  await handle(
    agent,
    rpc('send_email', { account: 'a1', to: ['chef@example.org'], cc: ['eve@evil.test'], subject: 'Hi', body: long })
  );
  const [send] = approvals.list();
  assert.deepEqual(send.summary.cc, ['eve@evil.test']);
  assert.equal(send.summary.from, 'me@example.com');
  assert.equal(send.summary.text, long, 'nothing cut off after 2000 characters');
  await handle(agent, rpc('move_to_trash', { account: 'a1', folder: 'INBOX', uid: 7 }));
  const trash = approvals.list().find(i => i.type === 'trash');
  assert.equal(trash.summary.subject, 'Vertrag');
  assert.equal(trash.summary.sender, 'kunde@example.org');
  await handle(
    agent,
    rpc('propose_event', {
      summary: 'Treffen',
      start: '2026-12-01T10:00',
      end: '2026-12-01T11:00',
      location: 'Büro',
      description: 'Agenda',
      attendees: ['gast@example.org']
    })
  );
  const event = approvals.list().find(i => i.type === 'event');
  assert.deepEqual(
    [event.summary.attendees, event.summary.location, event.summary.description],
    [['gast@example.org'], 'Büro', 'Agenda\n\n— KI-erstellt / AI-generated (Levuvo Mail, Agent: Bot)']
  );
});

test('REL-LEV-002: approvals added while another one runs are not lost', async t => {
  let release;
  const gate = new Promise(r => (release = r));
  const { agents, approvals, handle } = await mcpSetup(t, { execute: () => gate.then(() => ({ ok: true })) });
  const { agent } = await agents.create({ name: 'Bot', level: 'full' });
  await handle(agent, rpc('move_to_trash', { account: 'a1', folder: 'INBOX', uid: 7 }));
  const [first] = approvals.list();
  const deciding = approvals.decide(first.id, true);
  await new Promise(r => setTimeout(r, 10));
  await handle(agent, rpc('move_to_trash', { account: 'a1', folder: 'INBOX', uid: 8 }));
  release();
  await deciding;
  assert.equal(approvals.list().length, 1, 'the approval added meanwhile is still open');
  assert.equal(approvals.get(first.id).status, 'approved');
});

test('AIS-LEV-009: open approvals of a removed agent cannot be approved any more', async t => {
  const { agents, approvals, handle } = await mcpSetup(t);
  const { agent } = await agents.create({ name: 'Bot', level: 'full' });
  await handle(agent, rpc('move_to_trash', { account: 'a1', folder: 'INBOX', uid: 7 }));
  const [item] = approvals.list();
  await approvals.withdraw(agent.id);
  assert.equal(approvals.list().length, 0);
  await assert.rejects(approvals.decide(item.id, true), /nicht gefunden|erledigt/);
});

// ------------------------------------------------------------------ block C: send later
const { sendDue, RETRY_DELAY_MS } = await import('../src/scheduled.mjs');

function scheduledClient(sources) {
  const flags = new Map(Object.keys(sources).map(uid => [Number(uid), new Set(['\\Draft', '$LevuvoScheduled'])]));
  return {
    flags,
    capabilities: new Set(['MOVE']),
    list: async () => [
      { path: 'INBOX', delimiter: '.', flags: new Set() },
      { path: 'INBOX.Drafts', specialUse: '\\Drafts', flags: new Set() },
      { path: 'INBOX.Trash', specialUse: '\\Trash', flags: new Set() }
    ],
    mailboxCreate: async path => ({ path, created: true }),
    mailboxDelete: async path => ({ path }),
    getMailboxLock: async () => ({ release() {} }),
    search: async () => Object.keys(sources).map(Number),
    async *fetch(uids, query) {
      if (query.source) {
        const uid = Number(uids);
        yield { uid, flags: flags.get(uid), source: sources[uid] };
        return;
      }
      for (const uid of Array.isArray(uids) ? uids : String(uids).split(',').map(Number))
        yield {
          uid,
          envelope: { subject: `S${uid}`, to: [{ address: 'x@y.at' }] },
          flags: flags.get(uid),
          headers: Buffer.from(
            sources[uid]
              .toString()
              .split('\r\n')
              .find(l => l.startsWith('X-Levuvo'))
          )
        };
    },
    messageFlagsAdd: async (uid, f) => (f.forEach(x => flags.get(Number(uid)).add(x)), true),
    messageFlagsRemove: async (uid, f) => (f.forEach(x => flags.get(Number(uid)).delete(x)), true),
    messageMove: async () => true
  };
}
const scheduledSource = (to = 'To: x@y.at\r\n') =>
  Buffer.from(
    `Date: Wed, 01 Jan 2020 08:00:00 +0000\r\nFrom: a@b.at\r\n${to}X-Levuvo-Send-At: 2026-11-19T09:59:00Z\r\nSubject: S\r\n\r\nHallo\r\n`
  );

test('CQ-LEV-007: a scheduled message goes out with the time of sending in its Date header', async () => {
  const client = scheduledClient({ 5: scheduledSource() });
  const submitted = [];
  const now = Date.parse('2026-11-19T10:00:00Z');
  await sendDue(client, { now, submit: async (_r, raw) => submitted.push(raw.toString()), saveSent: async () => {} });
  assert.equal(submitted.length, 1);
  const dates = submitted[0].match(/^Date: .*$/gim);
  assert.deepEqual(dates, ['Date: Thu, 19 Nov 2026 10:00:00 +0000']);
});

test('REL-LEV-006 / CQ-LEV-009: failures before SMTP contact are retried, not left "unconfirmed"', async () => {
  const client = scheduledClient({ 5: scheduledSource() });
  const now = Date.parse('2026-11-19T10:00:00Z');
  const token = Object.assign(new Error('token expired'), { beforeSmtp: true });
  const result = await sendDue(client, {
    now,
    submit: async () => {
      throw token;
    },
    saveSent: async () => {}
  });
  assert.deepEqual(result.results, [{ uid: 5, sent: false, retry: true }]);
  assert.ok(!client.flags.get(5).has('$LevuvoSending'), 'claim released');
  // REL-LEV-015: the next run follows the retry delay, not the 10-minute fallback.
  assert.equal(result.next, new Date(now + RETRY_DELAY_MS).toISOString());

  // A message without recipients (or unreadable) is "failed", never "unconfirmed".
  const empty = scheduledClient({ 6: scheduledSource('') });
  const out = await sendDue(empty, { now, submit: async () => assert.fail('must not send'), saveSent: async () => {} });
  assert.deepEqual(out.results, [{ uid: 6, sent: false }]);
  assert.ok(empty.flags.get(6).has('$LevuvoFailed'));
  assert.ok(!empty.flags.get(6).has('$LevuvoSending'));
});

test(
  'REL-LEV-003: a late exit of the old sidecar process does not cancel requests of the new one',
  { timeout: 10_000 },
  async () => {
    const { spawn: nodeSpawn } = await import('node:child_process');
    const { fileURLToPath } = await import('node:url');
    const { createSidecar } = await import('../src/ai-sidecar.mjs');
    const { NODE_BIN } = await import('./fixtures/node-bin.mjs');
    const fake = fileURLToPath(new URL('./fixtures/fake-sidecar.mjs', import.meta.url));
    let started = 0;
    const spawn = (...args) => {
      const proc = nodeSpawn(...args);
      if (started++ === 0) {
        // The first process's exit reaches the sidecar's own handler late (slow shutdown).
        const on = proc.on.bind(proc);
        let first = true;
        proc.on = (event, fn) => {
          if (event !== 'exit' || !first) return on(event, fn);
          first = false;
          return on(event, (...a) => setTimeout(() => fn(...a), 200));
        };
      }
      return proc;
    };
    const sidecar = createSidecar({
      spawn,
      resolve: () => ({ command: NODE_BIN, args: [fake], cwd: process.cwd(), pythonPath: '' }),
      timeoutMs: 3000
    });
    await sidecar.call('status');
    await sidecar.stop();
    const out = await sidecar.call('delay', { ms: 400 });
    assert.equal(out.method, 'delay');
    await sidecar.stop();
  }
);

test('DB-LEV-004: a restore removes search index files and index key of accounts it does not have', async t => {
  const { dropOrphanIndexes } = await import('../src/backup.mjs');
  const { mkdirSync, writeFileSync, existsSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'lv-audit-restore-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'index'));
  for (const f of ['gone.lvdb', 'gone.lvdb-wal', 'gone.lvx', 'kept.lvdb']) writeFileSync(join(dir, 'index', f), 'x');
  const deleted = [];
  const vault = { available: true, delete: (id, kind) => deleted.push(`${id}:${kind}`) };
  await dropOrphanIndexes(dir, vault, [{ id: 'gone' }, { id: 'kept' }], [{ id: 'kept' }]);
  assert.ok(!existsSync(join(dir, 'index', 'gone.lvdb')));
  assert.ok(!existsSync(join(dir, 'index', 'gone.lvdb-wal')));
  assert.ok(!existsSync(join(dir, 'index', 'gone.lvx')));
  assert.ok(existsSync(join(dir, 'index', 'kept.lvdb')));
  assert.deepEqual(deleted, ['gone:index-key']);
});

test('REL-LEV-008: pending space mails stay in the outbox while they are being sent', async t => {
  const { openSpaceStore } = await import('../src/spaces/store.mjs');
  const { createSpaceService } = await import('../src/spaces/service.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'lv-audit-spaces-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = await openSpaceStore({ dir, vault: memoryVault() });
  const seen = [];
  let failNext = true;
  const service = createSpaceService({
    store,
    transport: {
      async send() {
        // What another save would write right now: the item must still be there.
        seen.push(store.all()[0].outbox.length);
        if (failNext) {
          failNext = false;
          throw new Error('offline');
        }
      }
    },
    accounts: () => [{ id: 'acc', address: 'anna@example.org', name: 'Anna', addresses: ['anna@example.org'] }]
  });
  const space = await service.create({ name: 'Projekt', accountId: 'acc' });
  await service.invite(space.id, { email: 'ben@example.org', role: 'editor' });
  await service.flush();
  assert.ok(seen.length >= 1 && seen.every(n => n >= 1), `outbox during sending: ${seen}`);
  assert.equal(store.all()[0].outbox.length, 1, 'failed mail kept for a retry');
  store.all()[0].outbox[0].nextAt = 0;
  await service.flush();
  assert.equal(store.all()[0].outbox.length, 0, 'sent mail leaves the outbox');
});

test('DB-LEV-008: follow-ups and screening lists are encrypted on disk and still part of a backup', async t => {
  const { createSealedJsonFile } = await import('../src/sealed-json.mjs');
  const { BACKUP_FILES, collectBackupContent } = await import('../src/backup.mjs');
  const { readFileSync, writeFileSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'lv-audit-sealed-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const keys = new Map();
  const vault = {
    available: true,
    get: (i, k) => keys.get(`${i}:${k}`) || '',
    set: (i, k, v) => keys.set(`${i}:${k}`, v),
    delete: (i, k) => keys.delete(`${i}:${k}`)
  };
  assert.equal(BACKUP_FILES['followups.json'].encrypted, 'followups-key');
  assert.equal(BACKUP_FILES['screening.json'].encrypted, 'screening-key');
  // An older plain file is encrypted at the first start.
  const filename = join(dir, 'followups.json');
  writeFileSync(filename, JSON.stringify({ snoozed: [], followups: [{ subject: 'Angebot Müller' }] }));
  const file = await createSealedJsonFile(
    filename,
    { snoozed: [], followups: [] },
    { vault, keyName: 'followups-key' }
  );
  assert.equal(file.get().followups[0].subject, 'Angebot Müller');
  assert.doesNotMatch(readFileSync(filename, 'utf8'), /Müller/);
  const content = await collectBackupContent({ dir, vault });
  assert.match(content.files['followups.json'], /Angebot Müller/);
});

test('REL-LEV-005: the IMAP connection is kept alive while a slow SMTP submission runs', async () => {
  const client = scheduledClient({ 5: scheduledSource() });
  let noops = 0;
  client.noop = async () => void noops++;
  const result = await sendDue(client, {
    now: Date.parse('2026-11-19T10:00:00Z'),
    keepAliveMs: 5,
    submit: () => new Promise(r => setTimeout(r, 40)),
    saveSent: async () => {}
  });
  assert.equal(result.results[0].sent, true);
  assert.ok(noops >= 3, `NOOPs during SMTP: ${noops}`);
  const after = noops;
  await new Promise(r => setTimeout(r, 30));
  assert.equal(noops, after, 'keep-alive stops after sending');
});
