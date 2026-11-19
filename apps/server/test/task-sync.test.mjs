import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskStore } from '../src/tasks.mjs';
import { applyFields, cleanRemote, createTaskSync, mergeFields, project } from '../src/task-sync.mjs';
import { allowedUrl, createCaldavTasks, createTodoIcs, parseTodo, updateTodoIcs } from '../src/task-sync-caldav.mjs';

import { BASE, LIST, fakeCaldav } from './helpers/fake-caldav.mjs';

function davAccounts() {
  const account = { id: 'dav-1', label: 'Nextcloud', serverUrl: `${BASE}/dav/`, username: 'peter' };
  return { get: id => (id === account.id ? account : null), password: () => 'geheim', list: () => [account] };
}

function setup({ clock = Date.parse('2026-11-18T10:00:00Z') } = {}) {
  let value = {};
  const file = {
    get: () => value,
    save: async v => {
      value = v;
    }
  };
  const time = { at: clock };
  const now = () => new Date(time.at);
  const store = createTaskStore(file, { now });
  const server = fakeCaldav();
  const caldav = createCaldavTasks({ store: davAccounts(), fetchImpl: server.fetchImpl, now });
  const sync = createTaskSync({ file, adapters: { caldav }, now, timeZone: 'Europe/Vienna' });
  const link = () =>
    sync.link({ provider: 'caldav', accountId: 'dav-1', accountLabel: 'Nextcloud', listId: LIST, name: 'Aufgaben' });
  return { file, store, server, caldav, sync, link, time, tick: ms => (time.at += ms) };
}

const ICS = ({ uid, summary, extra = '' }) =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Other//EN',
    'BEGIN:VTODO',
    `UID:${uid}`,
    'DTSTAMP:20261101T080000Z',
    'LAST-MODIFIED:20261101T080000Z',
    `SUMMARY:${summary}`,
    extra,
    'END:VTODO',
    'END:VCALENDAR',
    ''
  ]
    .filter(Boolean)
    .join('\r\n');

// ------------------------------------------------------------------ pure parts
test('Task sync: three-way merge per field, conflicts go to the newer side', () => {
  const base = { title: 'A', notes: '', done: false };
  assert.deepEqual(
    mergeFields(base, { title: 'B', notes: '', done: false }, { title: 'A', notes: 'n', done: false }, true),
    {
      merged: { title: 'B', notes: 'n', done: false },
      conflicts: []
    }
  );
  const both = mergeFields(
    base,
    { title: 'Hier', notes: '', done: false },
    { title: 'Dort', notes: '', done: true },
    false
  );
  assert.deepEqual(both.merged, { title: 'Dort', notes: '', done: true });
  assert.deepEqual(both.conflicts, ['title']);
  // Same change on both sides is no conflict.
  assert.deepEqual(
    mergeFields(base, { title: 'X', notes: '', done: false }, { title: 'X', notes: '', done: false }, true).conflicts,
    []
  );
});

test('Task sync: projection keeps what a provider cannot store', () => {
  const caps = { fields: ['title', 'due', 'priority'], dueTime: false, priority: p => (p === 'medium' ? 'none' : p) };
  const task = {
    title: 'T',
    due: '2026-11-20T23:30:00.000Z',
    priority: 'medium',
    remindAt: '2026-11-20T08:00:00.000Z'
  };
  // 23:30 UTC is already the 21st in Vienna.
  assert.deepEqual(project(task, caps, 'Europe/Vienna'), { title: 'T', due: '2026-11-21', priority: 'none' });
  // Same day and "normal" priority from the server: the time and "medium" stay.
  const next = applyFields(task, { title: 'T', due: '2026-11-21', priority: 'none' }, caps, 'Europe/Vienna');
  assert.equal(next.due, task.due);
  assert.equal(next.priority, 'medium');
  assert.equal(next.remindAt, task.remindAt);
  assert.equal(applyFields(task, { due: '2026-11-25' }, caps, 'Europe/Vienna').due, '2026-11-25');
  const clean = cleanRemote(
    { title: ' \0 ', due: 'gestern', priority: 'urgent', repeat: { freq: 'HOURLY' } },
    { fields: ['title', 'due', 'priority', 'repeat'] }
  );
  assert.deepEqual(clean, { title: 'Ohne Titel', due: null, priority: 'none', repeat: null });
});

test('CalDAV VTODO: parse and write title, due, reminder, priority, repetition, done', () => {
  const parsed = parseTodo(
    ICS({
      uid: 'u1',
      summary: 'Steuer',
      extra: [
        'DESCRIPTION:Belege sammeln',
        'DUE;TZID=Europe/Vienna:20261201T090000',
        'PRIORITY:2',
        'RRULE:FREQ=MONTHLY;INTERVAL=3',
        'CATEGORIES:Büro',
        'X-OTHER-APP:bleibt',
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'TRIGGER;RELATED=END:-PT30M',
        'END:VALARM'
      ].join('\r\n')
    })
  );
  assert.deepEqual(parsed.fields, {
    title: 'Steuer',
    notes: 'Belege sammeln',
    due: '2026-12-01T08:00:00.000Z',
    remindAt: '2026-12-01T07:30:00.000Z',
    priority: 'high',
    repeat: { freq: 'MONTHLY', interval: 3 },
    done: false
  });
  // A rule that the task list cannot show (BYDAY) is not taken over as a simple repetition.
  assert.equal(
    parseTodo(ICS({ uid: 'u2', summary: 'x', extra: 'DUE;VALUE=DATE:20261201\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,TH' }))
      .fields.repeat,
    null
  );

  const now = new Date('2026-11-18T10:00:00Z');
  const ics = ICS({
    uid: 'u1',
    summary: 'Steuer',
    extra: 'CATEGORIES:Büro\r\nX-OTHER-APP:bleibt\r\nDTSTART:20261201T080000Z\r\nDUE:20261201T090000Z'
  });
  const updated = updateTodoIcs(
    ics,
    { title: 'Steuer 2026', done: true, due: '2026-11-30', remindAt: '2026-11-29T08:00:00.000Z' },
    { now }
  );
  assert.match(updated, /SUMMARY:Steuer 2026/);
  assert.match(updated, /CATEGORIES:Büro/);
  assert.match(updated, /X-OTHER-APP:bleibt/);
  assert.match(updated, /STATUS:COMPLETED/);
  assert.match(updated, /DUE;VALUE=DATE:20261130/);
  // DTSTART follows the type of DUE and is not after it.
  assert.match(updated, /DTSTART;VALUE=DATE:20261130/);
  assert.match(updated, /TRIGGER;VALUE=DATE-TIME:20261129T080000Z/);
  assert.match(updated, /SEQUENCE:1/);
  const back = parseTodo(updated).fields;
  assert.equal(back.done, true);
  assert.equal(back.due, '2026-11-30');

  const made = createTodoIcs(
    {
      title: 'Neu',
      notes: '',
      due: '2026-12-01',
      priority: 'low',
      repeat: { freq: 'WEEKLY', interval: 2 },
      done: false,
      remindAt: null
    },
    { uid: 'n1', now }
  );
  assert.match(made, /RRULE:FREQ=WEEKLY;INTERVAL=2/);
  assert.match(made, /DTSTART;VALUE=DATE:20261201/);
  assert.match(made, /PRIORITY:9/);
  assert.match(made, /STATUS:NEEDS-ACTION/);
});

test('CalDAV: credentials only go to the account’s own domain over https', () => {
  assert.equal(allowedUrl(`${BASE}/x`, `${BASE}/dav/`), true);
  assert.equal(allowedUrl('https://p57-caldav.icloud.com/1/', 'https://caldav.icloud.com/'), true);
  assert.equal(allowedUrl('https://evil.example.org/', `${BASE}/dav/`), false);
  assert.equal(allowedUrl('http://other.example.test/', `${BASE}/dav/`), false);
  assert.equal(allowedUrl('https://user:pw@dav.example.test/', `${BASE}/dav/`), false);
});

// ------------------------------------------------------------------ against the fake server
test('CalDAV sync: lists, import, create, merge and keep unknown properties', async () => {
  const s = setup();
  const lists = await s.caldav.lists({ id: 'dav-1' });
  assert.deepEqual(lists, [{ id: LIST, name: 'Aufgaben & To-dos' }]);
  assert.ok(
    s.server.calls.every(c => !c.url.startsWith('https://evil.')),
    'no request to a foreign host'
  );

  const remoteUrl = s.server.put(
    'r1',
    ICS({ uid: 'r1', summary: 'Vom Handy', extra: 'DUE;VALUE=DATE:20261120\r\nX-OTHER-APP:bleibt' })
  );
  const local = await s.store.save({
    title: 'Rechnung zahlen',
    due: '2026-11-21',
    mail: { accountId: 'a1', folder: 'INBOX', uid: 7, subject: 'Rechnung Nr. 4711', from: 'Firma' }
  });
  const link = await s.link();
  // A local task joins the list when it is moved there.
  await s.store.save({ ...local, list: link.id });
  const r1 = (await s.sync.run(link.id))[link.id];
  assert.equal(r1.created, 1);
  assert.equal(r1.pushed, 1);
  const tasks = s.store.list();
  assert.deepEqual(tasks.map(t => t.title).sort(), ['Rechnung zahlen', 'Vom Handy']);
  assert.ok(tasks.every(t => t.sync?.link === link.id && t.sync.remoteId));
  const created = [...s.server.objects.values()].find(o => o.data.includes('Rechnung zahlen'));
  // The mail link stays on this device.
  assert.doesNotMatch(created.data, /4711|Firma|INBOX/);

  // Edited on both sides, in different fields.
  s.tick(60_000);
  const handy = tasks.find(t => t.title === 'Vom Handy');
  await s.store.save({ ...handy, title: 'Vom Handy (hier geändert)' });
  s.server.edit(remoteUrl, d =>
    d.replace('DUE;VALUE=DATE:20261120', 'DUE;VALUE=DATE:20261124\r\nDESCRIPTION:dort ergänzt')
  );
  const r2 = (await s.sync.run())[link.id];
  assert.deepEqual(r2.conflicts, []);
  const merged = s.store.get(handy.id);
  assert.equal(merged.title, 'Vom Handy (hier geändert)');
  assert.equal(merged.due, '2026-11-24');
  assert.equal(merged.notes, 'dort ergänzt');
  const data = s.server.objects.get(remoteUrl).data;
  assert.match(data, /SUMMARY:Vom Handy \(hier geändert\)/);
  assert.match(data, /X-OTHER-APP:bleibt/);
  // Nothing changed: a further sync sends nothing.
  const puts = s.server.calls.filter(c => c.method === 'PUT').length;
  await s.sync.run();
  assert.equal(s.server.calls.filter(c => c.method === 'PUT').length, puts);
  assert.equal(s.sync.links()[0].lastError, null);
});

test('CalDAV sync: same field on both sides, the newer change wins and is reported', async () => {
  const s = setup();
  const url = s.server.put('c1', ICS({ uid: 'c1', summary: 'Alt' }));
  const link = await s.link();
  await s.sync.run();
  const task = s.store.list()[0];
  s.tick(60_000);
  await s.store.save({ ...task, title: 'Hier' });
  // The server copy is changed later (LAST-MODIFIED after the local edit).
  s.server.edit(url, d =>
    d.replace('SUMMARY:Alt', 'SUMMARY:Dort').replace('LAST-MODIFIED:20261101T080000Z', 'LAST-MODIFIED:20261118T110000Z')
  );
  const r = (await s.sync.run())[link.id];
  assert.equal(r.conflicts.length, 1);
  assert.deepEqual(r.conflicts[0].fields, ['title']);
  assert.equal(s.store.get(task.id).title, 'Dort');
});

test('CalDAV sync: a repeating task finished elsewhere moves on here', async () => {
  const s = setup();
  const url = s.server.put(
    'rep',
    ICS({
      uid: 'rep',
      summary: 'Pflanzen gießen',
      extra: 'DTSTART;VALUE=DATE:20261118\r\nDUE;VALUE=DATE:20261118\r\nRRULE:FREQ=WEEKLY'
    })
  );
  const link = await s.link();
  await s.sync.run();
  s.server.edit(url, d =>
    d
      .replace('SUMMARY:Pflanzen gießen', 'SUMMARY:Pflanzen gießen\r\nSTATUS:COMPLETED\r\nCOMPLETED:20261118T120000Z')
      .replace('LAST-MODIFIED:20261101T080000Z', 'LAST-MODIFIED:20261118T120000Z')
  );
  s.tick(3 * 3600_000);
  await s.sync.run(link.id);
  const all = s.store.list();
  const open = all.find(t => !t.done);
  const finished = all.find(t => t.done);
  assert.equal(open.due, '2026-11-25');
  assert.deepEqual(open.repeat, { freq: 'WEEKLY', interval: 1 });
  assert.equal(finished.sync, null, 'the finished occurrence stays on this device');
  const data = s.server.objects.get(url).data;
  assert.match(data, /DUE;VALUE=DATE:20261125/);
  assert.match(data, /STATUS:NEEDS-ACTION/);
  assert.match(data, /RRULE:FREQ=WEEKLY/);

  // Finished here: the same server task gets the next date, it is not marked done there.
  await s.store.setDone(open.id, true);
  await s.sync.run(link.id);
  const after = s.server.objects.get(url).data;
  assert.match(after, /DUE;VALUE=DATE:20261202/);
  assert.match(after, /STATUS:NEEDS-ACTION/);
  assert.equal(s.server.objects.size, 1);
});

test('CalDAV sync: deletions both ways without losing changed tasks', async () => {
  const s = setup();
  const keep = s.server.put('k', ICS({ uid: 'k', summary: 'Bleibt' }));
  const gone = s.server.put('g', ICS({ uid: 'g', summary: 'Hier gelöscht' }));
  const back = s.server.put('b', ICS({ uid: 'b', summary: 'Dort geändert' }));
  const link = await s.link();
  await s.sync.run();
  const byTitle = title => s.store.list().find(t => t.title === title);

  // Deleted here → deleted there.
  await s.store.remove(byTitle('Hier gelöscht').id);
  // Deleted here, but changed there meanwhile → comes back.
  await s.store.remove(byTitle('Dort geändert').id);
  s.server.edit(back, d => d.replace('SUMMARY:Dort geändert', 'SUMMARY:Dort geändert (neu)'));
  await s.sync.run(link.id);
  assert.equal(s.server.objects.has(gone), false);
  assert.ok(byTitle('Dort geändert (neu)'));
  assert.deepEqual(s.file.get().taskSync.tombstones, []);

  // Deleted there, unchanged here → deleted here; deleted there but changed here → sent again.
  const kept = byTitle('Bleibt');
  const other = byTitle('Dort geändert (neu)');
  s.tick(60_000);
  await s.store.save({ ...kept, notes: 'wichtig' });
  s.server.objects.delete(keep);
  s.server.objects.delete(other.sync.remoteId);
  await s.sync.run(link.id);
  assert.equal(s.store.get(other.id), null);
  assert.equal(s.store.get(kept.id).notes, 'wichtig');
  assert.ok(
    [...s.server.objects.values()].some(o => /SUMMARY:Bleibt/.test(o.data) && /DESCRIPTION:wichtig/.test(o.data))
  );
});

test('CalDAV sync: an empty answer for a full list deletes nothing', async () => {
  const s = setup();
  for (let i = 0; i < 12; i++) s.server.put(`t${i}`, ICS({ uid: `t${i}`, summary: `Aufgabe ${i}` }));
  const link = await s.link();
  await s.sync.run();
  assert.equal(s.store.list().length, 12);
  s.server.state.emptyReport = true;
  await s.sync.run(link.id);
  assert.equal(s.store.list().length, 12);
  assert.equal(s.sync.links()[0].lastErrorCode, 'task_sync_empty');
});

test('CalDAV sync: a precondition failure is retried, foreign entries and server errors are kept out', async () => {
  const s = setup();
  s.server.state.evilHref = true;
  s.server.put('p', ICS({ uid: 'p', summary: 'P' }));
  const link = await s.link();
  await s.sync.run();
  assert.deepEqual(
    s.store.list().map(t => t.title),
    ['P'],
    'entries on a foreign host are skipped'
  );
  const task = s.store.list()[0];
  s.tick(60_000);
  await s.store.save({ ...task, title: 'P2' });
  s.server.state.preconditionOnce = true;
  await s.sync.run(link.id);
  assert.doesNotMatch([...s.server.objects.values()][0].data, /SUMMARY:P2/);
  await s.sync.run(link.id);
  assert.match([...s.server.objects.values()][0].data, /SUMMARY:P2/);

  // A server error leaves the task for the next sync and is reported on the list.
  await s.store.save({ title: 'Neu', list: link.id });
  s.server.state.failPut = 1;
  await s.sync.run(link.id);
  assert.equal(s.sync.links()[0].lastErrorCode, 'task_sync_partial');
  assert.equal(s.store.list().find(t => t.title === 'Neu').sync.remoteId, null);
  await s.sync.run(link.id);
  assert.ok(s.store.list().find(t => t.title === 'Neu').sync.remoteId);
  assert.equal(s.sync.links()[0].lastError, null);
});

test('CalDAV sync: an edit made during a sync is kept and sent next time', async () => {
  const s = setup();
  const url = s.server.put('e', ICS({ uid: 'e', summary: 'Vorher' }));
  const link = await s.link();
  await s.sync.run();
  const task = s.store.list()[0];
  s.server.edit(url, d => d.replace('SUMMARY:Vorher', 'SUMMARY:Vorher\r\nDESCRIPTION:dort'));
  s.server.state.onReport = async () => {
    s.server.state.onReport = null;
    s.tick(1000);
    await s.store.save({ ...s.store.get(task.id), title: 'Während des Abgleichs' });
  };
  await s.sync.run(link.id);
  assert.equal(s.store.get(task.id).title, 'Während des Abgleichs');
  await s.sync.run(link.id);
  const t = s.store.get(task.id);
  assert.equal(t.title, 'Während des Abgleichs');
  assert.equal(t.notes, 'dort');
  assert.match(s.server.objects.get(url).data, /SUMMARY:Während des Abgleichs/);
});

test('Task sync: moving lists, unlinking keeps tasks, wrong password is reported on the list', async () => {
  const s = setup();
  s.server.put('m', ICS({ uid: 'm', summary: 'Verschieben' }));
  const link = await s.link();
  await s.sync.run();
  const task = s.store.list()[0];
  // Back to this device: the server copy is deleted, the task stays.
  await s.store.save({ ...task, list: null });
  await s.sync.run(link.id);
  assert.equal(s.server.objects.size, 0);
  assert.equal(s.store.get(task.id).sync, null);
  await assert.rejects(s.store.save({ ...task, list: 'tl-unknown' }), /nicht mehr verbunden/);

  await s.store.save({ title: 'Bleibt lokal', list: link.id });
  await s.sync.run(link.id);
  await s.sync.unlink(link.id);
  assert.deepEqual(s.sync.links(), []);
  assert.ok(s.store.list().every(t => t.sync === null));
  assert.equal(s.server.objects.size, 1, 'unlinking deletes nothing on the server');

  // Wrong credentials: the error is kept on the list, run() does not throw.
  const bad = createCaldavTasks({
    store: { ...davAccounts(), password: () => 'falsch' },
    fetchImpl: s.server.fetchImpl
  });
  const sync = createTaskSync({ file: s.file, adapters: { caldav: bad } });
  const l2 = await sync.link({ provider: 'caldav', accountId: 'dav-1', listId: LIST, name: 'x' });
  const r = await sync.run(l2.id);
  assert.equal(r[l2.id].code, 'dav_auth_failed');
  assert.equal(sync.links()[0].lastErrorCode, 'dav_auth_failed');
});

test('REL-LEV-010: a create whose answer was lost does not make a duplicate on the server', async () => {
  const s = setup();
  let loseAnswer = true;
  const flaky = {
    ...s.caldav,
    caps: s.caldav.caps,
    create: async (...args) => {
      const made = await s.caldav.create(...args);
      if (loseAnswer) throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
      return made;
    }
  };
  const sync = createTaskSync({
    file: s.file,
    adapters: { caldav: flaky },
    now: () => new Date(s.time.at),
    timeZone: 'Europe/Vienna'
  });
  const link = await sync.link({
    provider: 'caldav',
    accountId: 'dav-1',
    accountLabel: 'Nextcloud',
    listId: LIST,
    name: 'Aufgaben'
  });
  const task = await s.store.save({ title: 'Angebot schicken', due: '2026-11-21' });
  await s.store.save({ ...task, list: link.id });
  await sync.run(link.id);
  assert.equal(s.server.objects.size, 1, 'the server has the task');
  assert.equal(s.store.get(task.id).sync.remoteId, null, 'but this device did not learn about it');
  loseAnswer = false;
  await sync.run(link.id);
  assert.equal(s.server.objects.size, 1, 'no second copy');
  assert.ok(s.store.get(task.id).sync.remoteId);
  assert.equal(s.store.list().length, 1, 'no copy imported back either');
});
