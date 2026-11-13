import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/calendar-model.mjs';
import { parseVCard, buildVCard, validateContact } from '../src/vcard.mjs';

const base = { summary: 'Jour fixe', start: '2026-10-19T09:00', end: '2026-10-19T10:00', tzid: 'Europe/Vienna' };

test('Weekly series stays at 9:00 Vienna time across the DST change', () => {
  const { ics } = C.createEventIcs(C.validateEventInput({ ...base, rrule: { freq: 'WEEKLY', interval: 1, count: 4 } }));
  assert.match(ics, /BEGIN:VTIMEZONE/);
  assert.match(ics, /DTSTART;TZID=Europe\/Vienna:20261019T090000/);
  const occ = C.expandObject(ics, '2026-10-01', '2026-12-01');
  assert.deepEqual(
    occ.map(o => o.start),
    ['2026-10-19T07:00:00.000Z', '2026-10-26T08:00:00.000Z', '2026-11-02T08:00:00.000Z', '2026-11-09T08:00:00.000Z']
  );
});

test('Change or delete a single occurrence of a series', () => {
  const { ics } = C.createEventIcs(C.validateEventInput({ ...base, rrule: { freq: 'WEEKLY', interval: 1, count: 4 } }));
  const occ = C.expandObject(ics, '2026-10-01', '2026-12-01');
  const moved = C.updateEventIcs(
    ics,
    C.validateEventInput({ ...base, summary: 'Verschoben', start: '2026-10-27T11:00', end: '2026-10-27T12:00' }),
    { scope: 'this', recurrenceId: occ[1].recurrenceId }
  );
  const removed = C.excludeOccurrence(moved, occ[2].recurrenceId);
  const after = C.expandObject(removed, '2026-10-01', '2026-12-01');
  assert.deepEqual(
    after.map(o => [o.start, o.summary]),
    [
      ['2026-10-19T07:00:00.000Z', 'Jour fixe'],
      ['2026-10-27T10:00:00.000Z', 'Verschoben'],
      ['2026-11-09T08:00:00.000Z', 'Jour fixe']
    ]
  );
  const series = C.updateEventIcs(
    removed,
    C.validateEventInput({ ...base, summary: 'Neu', rrule: { freq: 'WEEKLY', interval: 1, count: 4 } }),
    { scope: 'all' }
  );
  assert.match(series, /SEQUENCE:2/);
});

test('All-day, time range filter and reminders', () => {
  const allDay = C.createEventIcs(
    C.validateEventInput({ summary: 'Urlaub', allDay: true, start: '2026-12-24', end: '2026-12-27' })
  );
  assert.deepEqual(
    C.expandObject(allDay.ics, '2026-12-01', '2027-01-01').map(o => [o.start, o.end, o.allDay]),
    [['2026-12-24', '2026-12-27', true]]
  );
  assert.deepEqual(C.expandObject(allDay.ics, '2027-01-01', '2027-02-01'), []);
  const { ics } = C.createEventIcs(C.validateEventInput({ ...base, alarms: [15] }));
  const occ = C.expandObject(ics, '2026-10-01', '2026-11-01');
  const alarms = C.dueAlarms(occ, Date.parse('2026-10-19T06:40:00Z'), Date.parse('2026-10-19T06:50:00Z'));
  assert.equal(alarms.length, 1);
  assert.equal(alarms[0].at, Date.parse('2026-10-19T06:45:00Z'));
});

test('Inputs are validated', () => {
  assert.throws(() => C.validateEventInput({ ...base, summary: ' ' }), /Titel/);
  assert.throws(() => C.validateEventInput({ ...base, end: '2026-10-19T08:00' }), /Ende/);
  assert.throws(() => C.validateEventInput({ ...base, tzid: 'Mars/Olympus' }), /Zeitzone/);
  assert.throws(() => C.validateEventInput({ ...base, attendees: [{ email: 'kein-mail' }] }), /Teilnehmer/);
});

test('Invitation: REQUEST → REPLY → attendance status at the organizer', () => {
  const organizer = { email: 'peter@example.org', name: 'Peter' };
  const { ics } = C.createEventIcs(
    C.validateEventInput({ ...base, alarms: [10], attendees: [{ email: 'anna@example.org', name: 'Anna' }] }),
    { organizer }
  );
  assert.match(ics.replace(/\r\n /g, ''), /SCHEDULE-AGENT=CLIENT/);
  const request = C.buildOrganizerMessage(ics, 'REQUEST');
  assert.doesNotMatch(request, /VALARM|SCHEDULE-AGENT/);
  const inv = C.parseItip(request);
  assert.equal(inv.method, 'REQUEST');
  assert.equal(inv.organizer.email, 'peter@example.org');
  const stored = C.invitationToStoredIcs(request, 'anna@example.org', 'TENTATIVE');
  assert.doesNotMatch(stored, /METHOD:/);
  const reply = C.buildReply(request, { email: 'anna@example.org' }, 'ACCEPTED');
  assert.equal(C.parseItip(reply).method, 'REPLY');
  const updated = C.applyReply(ics, reply).replace(/\r\n /g, '');
  assert.match(updated, /PARTSTAT=ACCEPTED[^\r\n]*anna@example\.org/);
  assert.match(C.buildOrganizerMessage(ics, 'CANCEL'), /STATUS:CANCELLED/);
});

test('vCard: erstellen, Sonderzeichen, Faltung, Einlesen', () => {
  const contact = validateContact({
    firstName: 'Anna',
    lastName: 'Berger',
    emails: [{ value: 'anna@kunde.at', type: 'work' }],
    phones: [{ value: '+43 1 234 56', type: 'cell' }],
    organization: 'Kunde GmbH; Wien, Österreich',
    note: 'Zeile 1\nZeile 2 ' + 'x'.repeat(100)
  });
  const vcf = buildVCard(contact, 'uid-1');
  assert.ok(vcf.split('\r\n').every(line => Buffer.byteLength(line) <= 75));
  const back = parseVCard(vcf);
  assert.deepEqual(
    [back.name, back.emails[0].value, back.phones[0].value, back.organization],
    ['Anna Berger', 'anna@kunde.at', '+43 1 234 56', 'Kunde GmbH; Wien, Österreich']
  );
  assert.match(back.note, /^Zeile 1\nZeile 2 x+$/);
  assert.throws(() => validateContact({ emails: [{ value: 'falsch' }] }), /E-Mail/);
  assert.throws(() => validateContact({}), /Namen/);
});

test('Move whole series from a later occurrence: series keeps its start', () => {
  const rule = { freq: 'WEEKLY', interval: 1, count: 4 };
  const { ics } = C.createEventIcs(C.validateEventInput({ ...base, rrule: rule }));
  const occ = C.expandObject(ics, '2026-10-01', '2026-12-01');
  // Third occurrence (2 Nov, after the DST change) edited from 09:00 to 10:30, scope "all".
  const updated = C.updateEventIcs(
    ics,
    C.validateEventInput({ ...base, start: '2026-11-02T10:30', end: '2026-11-02T11:30', rrule: rule }),
    { scope: 'all', recurrenceId: occ[2].recurrenceId }
  );
  const after = C.expandObject(updated, '2026-10-01', '2026-12-01');
  assert.deepEqual(
    after.map(o => o.start),
    ['2026-10-19T08:30:00.000Z', '2026-10-26T09:30:00.000Z', '2026-11-02T09:30:00.000Z', '2026-11-09T09:30:00.000Z']
  );
});
