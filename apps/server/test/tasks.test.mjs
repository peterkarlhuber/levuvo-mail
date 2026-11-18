import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createTaskStore,
  filterTasks,
  lockedTaskStore,
  nextDue,
  openTaskFile,
  sortTasks,
  validateTask
} from '../src/tasks.mjs';

function memoryStore(now) {
  let v = {};
  const file = {
    get: () => v,
    save: async n => {
      v = n;
    }
  };
  return createTaskStore(file, { now });
}
function memoryVault() {
  const m = new Map();
  return { available: true, get: (i, k) => m.get(`${i}:${k}`) || '', set: (i, k, val) => m.set(`${i}:${k}`, val) };
}

test('Tasks: validation of title, due, reminder, priority, repetition and mail link', () => {
  assert.throws(() => validateTask({ title: '  ' }), /Titel/);
  assert.throws(() => validateTask({ title: 'x', due: '2026-02-30' }), /Fälligkeit/);
  assert.throws(() => validateTask({ title: 'x', due: 'morgen' }), /Fälligkeit/);
  assert.throws(() => validateTask({ title: 'x', remindAt: 'bald' }), /Erinnerung/);
  assert.throws(() => validateTask({ title: 'x', priority: 'urgent' }), /Priorität/);
  assert.throws(() => validateTask({ title: 'x', repeat: { freq: 'HOURLY' }, due: '2026-12-01' }), /Wiederholung/);
  assert.throws(() => validateTask({ title: 'x', repeat: { freq: 'MONTHLY' } }), /Fälligkeitsdatum/);
  assert.throws(() => validateTask({ title: 'x', mail: { accountId: 'a', folder: 'INBOX', uid: 0 } }), /Verweis/);
  assert.throws(() => validateTask({ title: 'x'.repeat(301) }), /Titel/);
  const v = validateTask({
    title: ' Rechnung zahlen ',
    due: '2026-12-01T09:00:00+01:00',
    remindAt: '2026-12-01T07:30:00Z',
    priority: 'high',
    repeat: { freq: 'MONTHLY', interval: 0 },
    mail: { accountId: 'a', folder: 'INBOX', uid: 42, subject: 'Rechnung', from: 'Firma' }
  });
  assert.equal(v.title, 'Rechnung zahlen');
  assert.equal(v.due, '2026-12-01T08:00:00.000Z');
  assert.equal(v.remindAt, '2026-12-01T07:30:00.000Z');
  assert.deepEqual(v.repeat, { freq: 'MONTHLY', interval: 1 });
  assert.equal(v.source, 'mail');
  assert.equal(validateTask({ title: 'x' }).priority, 'none');
  assert.equal(validateTask({ title: 'x', source: 'ai' }).source, 'ai');
  assert.equal(validateTask({ title: 'x', due: '' }).due, null);
});

test('Tasks: create, edit keeps mail link and origin, done and undone, delete, forget account', async () => {
  let clock = Date.parse('2026-11-18T10:00:00Z');
  const store = memoryStore(() => new Date(clock));
  const mail = { accountId: 'acc1', folder: 'INBOX', uid: 7, messageId: '<m@x>', subject: 'Angebot', from: 'Anna' };
  const a = await store.save({ title: 'Angebot prüfen', due: '2026-11-20', mail });
  assert.equal(a.source, 'mail');
  clock += 1000;
  const edited = await store.save({ id: a.id, title: 'Angebot prüfen und antworten', due: '2026-11-21', source: 'ai' });
  assert.equal(edited.id, a.id);
  assert.equal(edited.mail.messageId, '<m@x>');
  assert.equal(edited.source, 'mail');
  assert.equal(edited.createdAt, a.createdAt);
  const { task: done, finished } = await store.setDone(a.id, true);
  assert.equal(finished, null);
  assert.equal(done.doneAt, '2026-11-18T10:00:01.000Z');
  assert.equal((await store.setDone(a.id, false)).task.doneAt, null);
  await assert.rejects(store.setDone('nope', true), /nicht mehr/);
  await store.forgetAccount('acc1');
  assert.equal(store.get(a.id).mail, null);
  await store.remove(a.id);
  assert.deepEqual(store.list(), []);
});

test('Tasks: reminders ring once, again after the time changes', async () => {
  let clock = Date.parse('2026-11-18T10:00:00Z');
  const store = memoryStore(() => new Date(clock));
  const t = await store.save({ title: 'Anrufen', remindAt: '2026-11-18T10:30:00Z' });
  assert.deepEqual(store.dueReminders(), []);
  clock = Date.parse('2026-11-18T10:31:00Z');
  assert.deepEqual(
    store.dueReminders().map(x => x.id),
    [t.id]
  );
  await store.markReminded([t.id]);
  assert.deepEqual(store.dueReminders(), []);
  await store.save({ ...store.get(t.id), title: 'Anrufen!' });
  assert.deepEqual(store.dueReminders(), [], 'unchanged reminder stays announced');
  await store.save({ ...store.get(t.id), remindAt: '2026-11-18T10:31:00Z' });
  assert.equal(store.dueReminders().length, 1);
  await store.setDone(t.id, true);
  assert.deepEqual(store.dueReminders(), []);
});

test('Tasks: repeating task moves on and keeps a done copy', async () => {
  const store = memoryStore(() => new Date('2026-11-18T10:00:00Z'));
  const t = await store.save({
    title: 'Miete',
    due: '2026-01-31',
    remindAt: '2026-01-31T08:00:00.000Z',
    repeat: { freq: 'MONTHLY', interval: 1 }
  });
  const { task, finished } = await store.setDone(t.id, true);
  assert.equal(task.id, t.id);
  assert.equal(task.done, false);
  assert.equal(task.due, '2026-02-28');
  assert.equal(task.remindAt, '2026-02-28T08:00:00.000Z');
  assert.equal(finished.done, true);
  assert.equal(finished.repeat, null);
  assert.equal(finished.due, '2026-01-31');
  assert.equal(store.list({ view: 'done' }).length, 1);
  assert.equal(store.list({ view: 'open' }).length, 1);
});

test('Tasks: next due dates', () => {
  assert.equal(nextDue('2026-11-18', { freq: 'DAILY', interval: 2 }), '2026-11-20');
  assert.equal(nextDue('2026-11-18', { freq: 'WEEKLY', interval: 1 }), '2026-11-25');
  assert.equal(nextDue('2026-12-31', { freq: 'MONTHLY', interval: 2 }), '2027-02-28');
  assert.equal(nextDue('2028-02-29', { freq: 'YEARLY', interval: 1 }), '2029-02-28');
  assert.equal(nextDue('2026-11-18T08:00:00.000Z', { freq: 'WEEKLY', interval: 1 }), '2026-11-25T08:00:00.000Z');
  assert.equal(nextDue(null, { freq: 'DAILY', interval: 1 }), null);
});

test('Tasks: views today, upcoming, overdue, open and done in the user zone', () => {
  const now = new Date('2026-11-18T22:30:00Z'); // 23:30 in Vienna, Wednesday
  const t = (id, extra) => ({ id, done: false, priority: 'none', createdAt: id, ...extra });
  const list = [
    t('yesterday', { due: '2026-11-17' }),
    t('today', { due: '2026-11-18' }),
    t('today-late', { due: '2026-11-18T22:45:00.000Z' }), // 23:45 Vienna
    t('earlier', { due: '2026-11-18T20:00:00.000Z' }),
    t('tomorrow', { due: '2026-11-18T23:30:00.000Z' }), // 00:30 Thursday in Vienna
    t('next-week', { due: '2026-11-25' }),
    t('later', { due: '2026-12-25' }),
    t('undated', { due: null }),
    t('done', { due: '2026-11-17', done: true, doneAt: '2026-11-17T10:00:00Z' })
  ];
  const ids = view => filterTasks(list, view, { now, timeZone: 'Europe/Vienna' }).map(x => x.id);
  assert.deepEqual(ids('today'), ['yesterday', 'today', 'earlier', 'today-late']);
  assert.deepEqual(ids('overdue'), ['yesterday', 'earlier']);
  assert.deepEqual(ids('upcoming'), ['tomorrow', 'next-week']);
  assert.deepEqual(ids('done'), ['done']);
  assert.equal(ids('open').length, 8);
  assert.equal(ids('all').length, 9);
});

test('Tasks: same due date sorts by priority; done ones last', () => {
  const list = sortTasks([
    { id: 'low', done: false, due: '2026-11-19', priority: 'low', createdAt: '1' },
    { id: 'high', done: false, due: '2026-11-19', priority: 'high', createdAt: '2' },
    { id: 'undated', done: false, due: null, priority: 'high', createdAt: '3' },
    { id: 'done', done: true, doneAt: '2026-11-10T00:00:00Z' }
  ]);
  assert.deepEqual(
    list.map(t => t.id),
    ['high', 'low', 'undated', 'done']
  );
});

test('Tasks file: encrypted on disk, fails closed without the key', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'lv-tasks-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const filename = join(dir, 'tasks-local.json');
  const vault = memoryVault();
  const file = await openTaskFile({ filename, vault });
  const store = createTaskStore(file);
  await store.save({ title: 'Geheime Aufgabe', notes: 'Notiz' });
  await file.flush();
  const raw = readFileSync(filename, 'utf8');
  assert.doesNotMatch(raw, /Geheime|Notiz/);
  const again = createTaskStore(await openTaskFile({ filename, vault }));
  assert.equal(again.list()[0].title, 'Geheime Aufgabe');
  await assert.rejects(openTaskFile({ filename, vault: memoryVault() }), e => e.code === 'task_locked');
  await assert.rejects(openTaskFile({ filename, vault: { available: false } }), e => e.statusCode === 423);
  writeFileSync(filename, 'kaputt');
  await assert.rejects(openTaskFile({ filename, vault }), e => e.code === 'task_locked');
  const locked = lockedTaskStore(Object.assign(new Error('gesperrt'), { code: 'task_locked' }));
  assert.throws(() => locked.list(), /gesperrt/);
  await assert.rejects(locked.save({ title: 'x' }), /gesperrt/);
  assert.deepEqual(locked.dueReminders(), []);
});
