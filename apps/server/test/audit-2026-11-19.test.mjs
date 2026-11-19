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
