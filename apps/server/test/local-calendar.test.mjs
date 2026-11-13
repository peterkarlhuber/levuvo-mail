import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalCalendar, LOCAL_ACCOUNT } from '../src/local-calendar.mjs';
import {
  createEventIcs,
  updateEventIcs,
  excludeOccurrence,
  dueAlarms,
  validateEventInput
} from '../src/calendar-model.mjs';

const vault = () => {
  const m = new Map();
  return {
    available: true,
    get: (i, k) => m.get(`${i}:${k}`) || '',
    set: (i, k, v) => m.set(`${i}:${k}`, v),
    delete: () => {}
  };
};

test('Lokaler Kalender: ohne Konto sofort da, verschlüsselt gespeichert, Serien und Erinnerungen', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'lv-local-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'calendar-local.json');
  const keys = vault();
  const cal = await createLocalCalendar({ filename: file, vault: keys });
  const [personal] = cal.listCalendars().calendars;
  assert.equal(personal.accountId, LOCAL_ACCOUNT);
  assert.equal(personal.name, 'Persönlich');
  assert.equal(personal.readOnly, false);

  const model = validateEventInput({
    summary: 'Fokuszeit',
    allDay: false,
    tzid: 'Europe/Vienna',
    start: '2026-11-16T09:00',
    end: '2026-11-16T11:00',
    rrule: { freq: 'WEEKLY', interval: 1, byday: ['MO', 'WE'] },
    alarms: [10]
  });
  const { uid, ics } = createEventIcs(model);
  const { url } = await cal.createCalendarObject(personal.url, uid, ics);
  await cal.flush();
  const raw = readFileSync(file, 'utf8');
  assert.doesNotMatch(raw, /Fokuszeit/, 'Inhalt ist verschlüsselt');
  assert.match(raw, /"v":1/);

  const week = cal.events(Date.parse('2026-11-16T00:00:00Z'), Date.parse('2026-11-23T00:00:00Z')).events;
  assert.equal(week.length, 2, 'Montag und Mittwoch');
  assert.equal(week[0].start, '2026-11-16T08:00:00.000Z');
  assert.equal(week[0].url, url);
  assert.equal(dueAlarms(week, Date.parse('2026-11-16T07:45:00Z'), Date.parse('2026-11-16T07:55:00Z')).length, 1);

  // Edit one occurrence, then delete another one.
  const current = cal.object(url);
  const moved = updateEventIcs(
    current.data,
    { ...model, start: '2026-11-18T13:00', end: '2026-11-18T14:00', rrule: null },
    {
      scope: 'this',
      recurrenceId: week[1].recurrenceId
    }
  );
  await cal.updateCalendarObject(url, current.etag, moved);
  await assert.rejects(cal.updateCalendarObject(url, current.etag, moved), { code: 'event_conflict' });
  const after = cal.events(Date.parse('2026-11-16T00:00:00Z'), Date.parse('2026-11-23T00:00:00Z')).events;
  assert.equal(after[1].start, '2026-11-18T12:00:00.000Z');
  const latest = cal.object(url);
  await cal.updateCalendarObject(url, latest.etag, excludeOccurrence(latest.data, after[0].recurrenceId));
  assert.equal(cal.events(Date.parse('2026-11-16T00:00:00Z'), Date.parse('2026-11-23T00:00:00Z')).events.length, 1);

  // Reopen: same key from the keychain, data intact; without key it stays locked.
  await cal.flush();
  const again = await createLocalCalendar({ filename: file, vault: keys });
  assert.equal(again.findAllByUid(uid).length, 1);
  await assert.rejects(createLocalCalendar({ filename: file, vault: null }), { code: 'local_locked' });

  // Export and import (.ics) into a second local calendar.
  const exported = again.exportIcs(personal.url);
  assert.match(exported, /BEGIN:VCALENDAR[\s\S]*SUMMARY:Fokuszeit[\s\S]*END:VCALENDAR/);
  const second = await again.createCalendar('Blocker');
  assert.deepEqual(await again.importIcs(second.url, exported), { imported: 1, skipped: 0 });
  assert.deepEqual(await again.importIcs(second.url, exported), { imported: 0, skipped: 1 });
  await assert.rejects(again.importIcs(second.url, 'kein Kalender'), { code: 'ics_invalid' });
  await again.setCalendarPrefs(second.url, { hidden: true, color: '#123456' });
  assert.equal(again.events(Date.parse('2026-11-16T00:00:00Z'), Date.parse('2026-11-23T00:00:00Z')).events.length, 1);
  await again.deleteCalendar(second.url);
  await assert.rejects(again.deleteCalendar(personal.url), { code: 'calendar_last' });
  await again.deleteCalendarObject(url, null);
  assert.deepEqual(again.findAllByUid(uid), []);
});
