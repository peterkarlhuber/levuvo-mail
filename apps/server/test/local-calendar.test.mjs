import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

test('Local calendar: available immediately without an account, stored encrypted, series and reminders', async t => {
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
  assert.doesNotMatch(raw, /Fokuszeit/, 'content is encrypted');
  assert.match(raw, /"v":1/);

  const week = cal.events(Date.parse('2026-11-16T00:00:00Z'), Date.parse('2026-11-23T00:00:00Z')).events;
  assert.equal(week.length, 2, 'Monday and Wednesday');
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

test('Local calendar: a missing or wrong keychain key never wipes the encrypted file', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'lv-local-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'calendar-local.json');
  const keys = vault();
  const cal = await createLocalCalendar({ filename: file, vault: keys });
  const [personal] = cal.listCalendars().calendars;
  const { uid, ics } = createEventIcs(
    validateEventInput({
      summary: 'Keep me',
      allDay: false,
      tzid: 'UTC',
      start: '2026-11-16T09:00',
      end: '2026-11-16T10:00'
    })
  );
  await cal.createCalendarObject(personal.url, uid, ics);
  await cal.flush();
  const before = readFileSync(file, 'utf8');

  // Keychain reset: no key at all.
  const emptyVault = vault();
  await assert.rejects(createLocalCalendar({ filename: file, vault: emptyVault }), { code: 'local_locked' });
  assert.equal(emptyVault.get(LOCAL_ACCOUNT, 'calendar-key'), '', 'no new key is generated for existing data');
  // A different key: decryption fails.
  const otherVault = vault();
  otherVault.set(LOCAL_ACCOUNT, 'calendar-key', '11'.repeat(32));
  await assert.rejects(createLocalCalendar({ filename: file, vault: otherVault }), { code: 'local_locked' });
  assert.equal(readFileSync(file, 'utf8'), before, 'file unchanged');

  // With the original key everything is back.
  const again = await createLocalCalendar({ filename: file, vault: keys });
  assert.equal(again.events(Date.parse('2026-11-16T00:00:00Z'), Date.parse('2026-11-17T00:00:00Z')).events.length, 1);
});

test('Local calendar: a corrupt plain file is kept as a backup instead of being overwritten', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'lv-local-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'calendar-local.json');
  writeFileSync(file, '{"calendars": [broken');
  const cal = await createLocalCalendar({ filename: file, vault: null });
  assert.equal(cal.listCalendars().calendars.length, 1);
  const backups = readdirSync(dir).filter(n => n.startsWith('calendar-local.json.corrupt-'));
  assert.equal(backups.length, 1);
  assert.equal(readFileSync(join(dir, backups[0]), 'utf8'), '{"calendars": [broken');
});
