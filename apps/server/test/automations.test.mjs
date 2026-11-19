import test from 'node:test';
import assert from 'node:assert/strict';
import { fillTitle, matches, plan, taskFor, validateRule } from '../src/automations.mjs';
import { createAutomations } from '../src/routes-automations.mjs';

const invoice = {
  uid: 7,
  messageId: '<r7@muster.at>',
  fromName: 'Muster GmbH',
  fromEmail: 'rechnung@muster.at',
  to: ['me@x.at'],
  subject: 'Rechnung 2026-117',
  preview: 'Im Anhang finden Sie die Rechnung',
  hasAttachments: true
};

test('Automations: validation never allows deleting, forwarding or sending', () => {
  assert.throws(() => validateRule({ name: '' }), /Namen/);
  assert.throws(() => validateRule({ name: 'x', conditions: [], actions: [{ type: 'flag' }] }), /Bedingung/);
  assert.throws(
    () =>
      validateRule({
        name: 'x',
        conditions: [{ field: 'from', op: 'contains', value: 'a' }],
        actions: [{ type: 'trash' }]
      }),
    /Löschen/
  );
  assert.throws(
    () =>
      validateRule({
        name: 'x',
        conditions: [{ field: 'from', op: 'contains', value: 'a' }],
        actions: [{ type: 'forward' }]
      }),
    /Senden/
  );
  assert.throws(
    () =>
      validateRule({
        name: 'x',
        conditions: [{ field: 'from', op: 'contains', value: ' ' }],
        actions: [{ type: 'flag' }]
      }),
    /Wert/
  );
  assert.throws(
    () =>
      validateRule(
        {
          name: 'x',
          accountId: 'a',
          conditions: [{ field: 'from', op: 'contains', value: 'a' }],
          actions: [{ type: 'move', folder: 'Nope' }]
        },
        { folderExists: () => false }
      ),
    /Nope/
  );
  const r = validateRule({
    name: 'Rechnungen',
    conditions: [
      { field: 'from', op: 'ends_with', value: '@muster.at' },
      { field: 'attachment', op: 'whatever' }
    ],
    actions: [{ type: 'move', folder: 'Rechnungen' }, { type: 'task', dueDays: 14 }, { type: 'markRead' }]
  });
  assert.deepEqual(r.conditions[1], { field: 'attachment', op: 'yes', value: '' });
  assert.deepEqual(
    r.actions.map(a => a.type),
    ['task', 'markRead', 'move'],
    'move always runs last'
  );
  assert.equal(r.actions[0].title, '{subject}');
  assert.equal(r.enabled, false, 'a new rule is off until switched on');
});

test('Automations: matching, order and stop', () => {
  const rule = validateRule({
    name: 'R',
    enabled: true,
    conditions: [
      { field: 'from', op: 'ends_with', value: '@MUSTER.at' },
      { field: 'subject', op: 'contains', value: 'rechnung' },
      { field: 'attachment', op: 'yes' }
    ],
    actions: [{ type: 'flag' }]
  });
  assert.equal(matches(rule, invoice), true);
  assert.equal(matches(rule, { ...invoice, hasAttachments: false }), false);
  assert.equal(matches({ ...rule, match: 'any' }, { ...invoice, fromEmail: 'x@y.at', fromName: '' }), true);
  assert.equal(
    matches({ ...rule, conditions: [{ field: 'from', op: 'is', value: 'rechnung@muster.at' }] }, invoice),
    true
  );
  assert.equal(
    matches({ ...rule, conditions: [{ field: 'text', op: 'not_contains', value: 'anhang' }] }, invoice),
    false
  );
  const other = { ...rule, id: 'b', name: 'B' };
  assert.equal(plan([rule, other], invoice).length, 1, 'stop after the first match');
  assert.equal(plan([{ ...rule, stop: false }, other], invoice).length, 2);
  assert.equal(plan([{ ...rule, enabled: false }], invoice).length, 0);
  assert.equal(plan([{ ...rule, accountId: 'b' }], invoice, { accountId: 'a' }).length, 0);
});

test('Automations: task title and due date', () => {
  assert.equal(fillTitle('Zahlen: {subject} ({from})', invoice), 'Zahlen: Rechnung 2026-117 (Muster GmbH)');
  assert.equal(fillTitle('', invoice), 'Rechnung 2026-117');
  const t = taskFor({ type: 'task', title: '{subject}', dueDays: 14 }, invoice, {
    accountId: 'a',
    now: new Date('2026-11-19T23:30:00Z'),
    timeZone: 'Europe/Vienna'
  });
  assert.equal(t.due, '2026-12-04');
  assert.deepEqual(t.mail, {
    accountId: 'a',
    folder: 'INBOX',
    uid: 7,
    messageId: '<r7@muster.at>',
    subject: 'Rechnung 2026-117',
    from: 'Muster GmbH'
  });
});

function setup() {
  let v = {};
  const file = { get: () => v, save: async n => void (v = n) };
  const calls = [];
  const tasks = [];
  const service = createAutomations({
    file,
    api: {
      folders: async () => ({ folders: [{ path: 'INBOX' }, { path: 'Rechnungen' }] }),
      messages: async () => ({
        messages: [invoice, { ...invoice, uid: 6, fromEmail: 'news@shop.at', fromName: 'Shop', subject: 'Angebote' }]
      }),
      messageAction: async (account, uid, body) => {
        if (body.destination === 'Kaputt') throw Object.assign(new Error('Ordner fehlt'), { statusCode: 404 });
        calls.push({ account, uid, ...body });
      }
    },
    tasks: { available: true, save: async t => tasks.push(t) },
    now: () => new Date('2026-11-19T10:00:00Z')
  });
  return { service, calls, tasks, file: () => v };
}
const rule = {
  name: 'Rechnungen von Muster',
  accountId: 'acc',
  conditions: [{ field: 'from', op: 'ends_with', value: '@muster.at' }],
  actions: [
    { type: 'move', folder: 'Rechnungen' },
    { type: 'task', title: 'Bezahlen: {subject}', dueDays: 7 }
  ]
};

test('Automations service: dry run changes nothing and shows what would happen', async () => {
  const { service, calls, tasks } = setup();
  await assert.rejects(service.saveRule({ ...rule, accountId: '' }), /Konto/);
  const r = await service.dryRun({ rule });
  assert.equal(r.checked, 2);
  assert.equal(r.total, 1);
  assert.equal(r.matches[0].subject, 'Rechnung 2026-117');
  assert.equal(r.matches[0].task, 'Bezahlen: Rechnung 2026-117');
  assert.deepEqual(calls, []);
  assert.deepEqual(tasks, []);
});

test('Automations service: runs only on mail that arrives after it was switched on', async () => {
  const { service, calls, tasks, file } = setup();
  const saved = await service.saveRule({ ...rule, enabled: true });
  assert.ok(saved.enabledAt);
  // First snapshot only remembers where the inbox stands.
  assert.deepEqual(await service.onSnapshot('acc', { uidValidity: '1', highestUid: 7, messages: [invoice] }), []);
  assert.deepEqual(calls, []);
  const next = { ...invoice, uid: 8, subject: 'Rechnung 2026-118' };
  const spam = { ...invoice, uid: 9, fromEmail: 'x@spam.at', subject: 'Rechnung?' };
  const log = await service.onSnapshot('acc', { uidValidity: '1', highestUid: 9, messages: [spam, next, invoice] });
  assert.equal(log.length, 1);
  assert.deepEqual(log[0].done, ['task', 'move']);
  assert.deepEqual(calls, [
    { account: 'acc', uid: 8, folder: 'INBOX', action: 'move', destination: 'Rechnungen', notToTrash: true }
  ]);
  assert.equal(tasks[0].title, 'Bezahlen: Rechnung 2026-118');
  assert.equal(tasks[0].due, '2026-11-26');
  // The same snapshot again does nothing.
  assert.deepEqual(await service.onSnapshot('acc', { uidValidity: '1', highestUid: 9, messages: [spam, next] }), []);
  // A new UIDVALIDITY (mailbox rebuilt) never replays old mail.
  assert.deepEqual(
    await service.onSnapshot('acc', { uidValidity: '2', highestUid: 3, messages: [{ ...next, uid: 3 }] }),
    []
  );
  assert.equal(service.list().log[0].rule, 'Rechnungen von Muster');
  assert.equal(file().log[0].subject, 'Rechnung 2026-118');
  assert.equal(JSON.stringify(file()).includes('Im Anhang'), false, 'no message text is stored');
});

test('Automations service: a failing action is logged, other rules still run; switching off stops it', async () => {
  const { service, calls } = setup();
  const r = await service.saveRule({
    ...rule,
    enabled: true,
    actions: [{ type: 'flag' }, { type: 'move', folder: 'Rechnungen' }]
  });
  await service.onSnapshot('acc', { uidValidity: '1', highestUid: 1, messages: [] });
  // The folder was deleted on the server meanwhile.
  const s = service.list().rules[0];
  s.actions[1].folder = 'Kaputt';
  const log = await service.onSnapshot('acc', { uidValidity: '1', highestUid: 2, messages: [{ ...invoice, uid: 2 }] });
  assert.equal(log[0].ok, false);
  assert.match(log[0].error, /Ordner fehlt/);
  assert.equal(calls[0].action, 'flag');
  await service.setEnabled(r.id, false);
  assert.deepEqual(
    await service.onSnapshot('acc', { uidValidity: '1', highestUid: 3, messages: [{ ...invoice, uid: 3 }] }),
    []
  );
  await service.remove(r.id);
  assert.deepEqual(service.list().rules, []);
});
