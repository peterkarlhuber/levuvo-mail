import test from 'node:test';
import assert from 'node:assert/strict';
import {
  busyFromEvents,
  findSlots,
  fitsLink,
  linkRequest,
  offersMail,
  parseSubjectToken,
  proposalMail,
  subjectTag,
  validateLink,
  validateSearch,
  votesFromText,
  wallClock
} from '../src/scheduling.mjs';
import { createScheduling } from '../src/routes-scheduling.mjs';
import { isAutoSubmitted } from '../src/message-utils.mjs';

const TZ = 'Europe/Vienna';
// Monday 23 Nov 2026, 00:00 in Vienna (UTC+1).
const MON = Date.parse('2026-11-22T23:00:00Z');
const H = 3600_000;

test('Scheduling: tokens in subjects and votes in replies', () => {
  const token = 'abcdefghijklmnopqrstuvwx';
  assert.deepEqual(parseSubjectToken(`Re: Planung ${subjectTag(token, { slot: 2 })}`), { token, slot: 2, at: null });
  assert.deepEqual(parseSubjectToken(`AW: x ${subjectTag(token)}`), { token, slot: null, at: null });
  const at = '2026-11-24T08:00:00.000Z';
  assert.equal(subjectTag(token, { at }), `[LV-${token} @20261124T0800Z]`);
  assert.deepEqual(parseSubjectToken(`Re: ${subjectTag(token, { at })}`), { token, slot: null, at });
  assert.equal(parseSubjectToken('[LV-short #1]'), null);
  assert.equal(parseSubjectToken('Hallo'), null);
  assert.deepEqual(
    votesFromText('Passen 1 und 3, 9 nicht\n\nAm 23.11.2026 schrieb Anna:\n> 2. Dienstag 10:00', 4),
    [1, 3]
  );
  assert.deepEqual(votesFromText('Nur 2.\n> 1. Montag', 3), [2]);
  assert.deepEqual(votesFromText('am 2.12. um 1:30', 3), []);
  assert.deepEqual(votesFromText('2', 3), [2]);
  assert.deepEqual(votesFromText('um 10:30 geht es', 3), []);
});

test('Scheduling: search validation and busy times', () => {
  assert.throws(() => validateSearch({ from: 'x', to: 'y' }), /Zeitraum/);
  assert.throws(() => validateSearch({ from: '2026-01-01', to: '2026-04-01' }), /62 Tage/);
  assert.throws(() => validateSearch({ from: '2026-11-23', to: '2026-11-24', dayStart: 9, dayEnd: 9 }), /Arbeitszeit/);
  assert.throws(() => validateSearch({ from: '2026-11-23', to: '2026-11-24', participants: ['nope'] }), /E-Mail/);
  const s = validateSearch({
    from: new Date(MON).toISOString(),
    to: new Date(MON + 5 * 24 * H).toISOString(),
    participants: [{ email: 'Anna@Example.com' }, 'anna@example.com'],
    now: MON - 10 * 24 * H,
    timeZone: 'Nowhere/City'
  });
  assert.equal(s.participants.length, 1);
  assert.equal(s.timeZone, TZ);
  const busy = busyFromEvents(
    [
      { start: '2026-11-23T08:00:00Z', end: '2026-11-23T09:00:00Z' },
      { start: '2026-11-23T08:30:00Z', end: '2026-11-23T10:00:00Z' },
      { start: '2026-11-23T12:00:00Z', end: '2026-11-23T13:00:00Z', status: 'CANCELLED' },
      {
        start: '2026-11-23T14:00:00Z',
        end: '2026-11-23T15:00:00Z',
        attendees: [{ email: 'me@x.at', partstat: 'DECLINED' }]
      },
      { start: '2026-11-24', end: '2026-11-25', allDay: true }
    ],
    { ownAddresses: ['me@x.at'] }
  );
  assert.deepEqual(busy, [[Date.parse('2026-11-23T08:00:00Z'), Date.parse('2026-11-23T10:00:00Z')]]);
  const withAllDay = busyFromEvents([{ start: '2026-11-24', end: '2026-11-25', allDay: true }], {
    allDayBusy: true,
    timeZone: TZ
  });
  assert.deepEqual(withAllDay, [[Date.parse('2026-11-23T23:00:00Z'), Date.parse('2026-11-24T23:00:00Z')]]);
});

test('Scheduling: common slots respect working hours, weekdays and everyone’s calendar', () => {
  const search = validateSearch({
    from: new Date(MON).toISOString(),
    to: new Date(MON + 2 * 24 * H).toISOString(),
    minutes: 60,
    dayStart: 9,
    dayEnd: 12,
    timeZone: TZ,
    now: MON - H
  });
  const people = {
    me: { busy: [[MON + 9 * H, MON + 10 * H]] }, // Monday 9–10 Vienna
    'anna@x.at': { busy: [[MON + 10 * H, MON + 11 * H]] },
    'bert@x.at': { unknown: true }
  };
  const slots = findSlots(people, search);
  assert.equal(slots[0].start, new Date(MON + 11 * H).toISOString()); // Monday 11–12
  assert.ok(slots[0].all);
  assert.deepEqual(slots[0].unknown, ['bert@x.at']);
  // Tuesday 9–10, 10–11, 11–12: non-overlapping.
  assert.deepEqual(
    slots.slice(1, 4).map(s => s.start),
    [9, 10, 11].map(h => new Date(MON + 24 * H + h * H).toISOString())
  );
  // Weekend excluded by default.
  const sat = validateSearch({
    from: new Date(MON + 5 * 24 * H).toISOString(),
    to: new Date(MON + 7 * 24 * H).toISOString(),
    now: 0
  });
  assert.deepEqual(findSlots({ me: { busy: [] } }, sat), []);
  // Nobody fully free: the partial ones with most people come first.
  const full = { me: { busy: [[MON, MON + 3 * 24 * H]] }, 'a@x.at': { busy: [] }, 'b@x.at': { busy: [] } };
  const partial = findSlots(full, search);
  assert.ok(partial.length > 0);
  assert.equal(partial[0].all, false);
  assert.deepEqual(partial[0].busy, ['me']);
  assert.equal(wallClock(new Date(MON + 9.5 * H).toISOString(), TZ), '2026-11-23T09:30');
});

test('Scheduling: proposal mail has a mailto link per slot and never leaks other addresses', () => {
  const token = 'abcdefghijklmnopqrstuvwx';
  const slots = [
    { start: '2026-11-23T08:00:00.000Z', end: '2026-11-23T08:30:00.000Z' },
    { start: '2026-11-24T09:00:00.000Z', end: '2026-11-24T09:30:00.000Z' }
  ];
  const poll = proposalMail({
    kind: 'poll',
    token,
    title: 'Planung <Q1>',
    slots,
    replyTo: 'me@x.at',
    organizer: 'Peter',
    lang: 'de',
    timeZone: TZ,
    minutes: 30
  });
  assert.match(poll.subject, /^Terminabstimmung: Planung <Q1> \[LV-/);
  assert.match(poll.html, /Planung &lt;Q1&gt;/);
  assert.equal((poll.html.match(/href="mailto:me@x.at\?subject=/g) || []).length, 3);
  assert.ok(poll.html.includes(encodeURIComponent(subjectTag(token, { slot: 2 }))));
  assert.ok(poll.html.includes(encodeURIComponent(subjectTag(token, { slot: 0 }))));
  assert.match(poll.text, /Montag, 23\. November, 09:00–09:30/);
  const offer = proposalMail({
    kind: 'offer',
    token,
    title: 'Call',
    slots,
    replyTo: 'me@x.at',
    organizer: 'P',
    lang: 'en',
    timeZone: TZ,
    minutes: 30
  });
  assert.match(offer.subject, /^Suggested times: Call/);
  assert.match(offer.html, /Book this time/);
  assert.doesNotMatch(offer.html, /None of these/);
});

test('Scheduling: booking link rules', () => {
  assert.throws(() => validateLink({ title: '' }), /Titel/);
  const link = validateLink({
    title: 'Erstgespräch',
    minutes: 30,
    dayStart: 9,
    dayEnd: 12,
    daysAhead: 7,
    noticeHours: 24,
    timeZone: TZ
  });
  const now = MON - 2 * 24 * H; // Saturday before
  assert.equal(fitsLink(link, new Date(MON + 9 * H).toISOString(), now), true);
  assert.equal(fitsLink(link, new Date(MON + 9 * H + 5 * 60_000).toISOString(), now), false, 'off the grid');
  assert.equal(fitsLink(link, new Date(MON + 8 * H).toISOString(), now), false, 'before hours');
  assert.equal(fitsLink(link, new Date(MON + 11.75 * H).toISOString(), now), false, 'ends after hours');
  assert.equal(fitsLink(link, new Date(MON + 9 * H).toISOString(), MON + 8 * H), false, 'too short notice');
  assert.equal(fitsLink(link, new Date(MON + 5 * 24 * H + 9 * H).toISOString(), now), false, 'Saturday');
  const req = linkRequest({ token: 'abcdefghijklmnopqrstuvwx', link, address: 'me@x.at' });
  assert.match(req.url, /^mailto:me@x.at\?subject=Terminanfrage/);
  const none = offersMail({ token: 'abcdefghijklmnopqrstuvwx', link, slots: [], replyTo: 'me@x.at', lang: 'de' });
  assert.match(none.html, /keine Zeit frei/);
  assert.match(none.html, /automatisch/);
});

test('Scheduling: automatic mails (RFC 3834) are recognised', () => {
  const h = obj => new Map(Object.entries(obj));
  assert.equal(isAutoSubmitted(h({ 'auto-submitted': 'auto-replied' })), true);
  assert.equal(isAutoSubmitted(h({ 'auto-submitted': 'no' })), false);
  assert.equal(isAutoSubmitted(h({ precedence: 'bulk' })), true);
  assert.equal(isAutoSubmitted(h({ 'list-id': { value: 'x' } })), true);
  assert.equal(isAutoSubmitted(h({})), false);
  assert.equal(isAutoSubmitted(undefined), false);
});

// ---------------------------------------------------------------- service
function memoryFile(initial = {}) {
  let v = initial;
  return {
    get: () => v,
    save: async n => {
      v = n;
    }
  };
}
function setup({ events = [], freeBusy = null, clock = MON - 24 * H, messages = {} } = {}) {
  const sent = [];
  const saved = [];
  const api = {
    events: async () => ({ events }),
    calendars: async () => ({ calendars: [{ accountId: 'local', url: 'local:cal', readOnly: false, hidden: false }] }),
    send: async (account, m) => sent.push({ account, ...m }),
    saveEvent: async p => {
      saved.push(p);
      events.push({
        start: new Date(Date.parse(`${p.event.start}:00+01:00`)).toISOString(),
        end: new Date(Date.parse(`${p.event.end}:00+01:00`)).toISOString()
      });
      return { ok: true, uid: `uid-${saved.length}` };
    },
    message: async (_a, _f, uid) =>
      messages[uid] || { text: '', automatic: false, from: [{ name: 'X', email: 'x@y.at' }] }
  };
  const now = { t: clock };
  const service = createScheduling({
    file: memoryFile(),
    api,
    freeBusy,
    identity: id => (id === 'acc' ? { address: 'me@x.at', name: 'Peter' } : null),
    ownAddresses: () => ['me@x.at'],
    now: () => now.t
  });
  return { service, sent, saved, now, events };
}
const slotsAt = (...hours) =>
  hours.map(h => ({
    start: new Date(MON + h * H).toISOString(),
    end: new Date(MON + h * H + 30 * 60_000).toISOString()
  }));
const tokenOf = mail => /\[LV-([A-Za-z0-9_-]{24})\]/.exec(mail.subject)[1];

test('Scheduling service: availability merges own calendars, free/busy and unknown people', async () => {
  const { service } = setup({
    events: [
      { start: new Date(MON + 9 * H).toISOString(), end: new Date(MON + 10 * H).toISOString(), calendarUrl: 'mine' }
    ],
    freeBusy: async emails => ({
      people: { 'anna@x.at': { source: 'microsoft', busy: [[MON + 10 * H, MON + 11 * H]] } },
      errors: [],
      asked: emails
    })
  });
  const r = await service.availability({
    from: new Date(MON).toISOString(),
    to: new Date(MON + 24 * H).toISOString(),
    minutes: 60,
    dayStart: 9,
    dayEnd: 12,
    timeZone: TZ,
    participants: ['anna@x.at', 'bert@x.at', 'me@x.at']
  });
  assert.deepEqual(
    r.people.map(p => [p.email, p.source]),
    [
      ['me', 'own'],
      ['anna@x.at', 'microsoft'],
      ['bert@x.at', 'unknown']
    ]
  );
  assert.equal(r.slots[0].start, new Date(MON + 11 * H).toISOString());
  assert.deepEqual(r.slots[0].unknown, ['bert@x.at']);
});

test('Scheduling service: poll by mail, votes from replies, booking invites everyone', async () => {
  const { service, sent, saved } = setup();
  await assert.rejects(service.createPoll({ title: 'x' }), /ausdrücklich/);
  await assert.rejects(
    service.createPoll({ confirm: 'SEND', accountId: 'acc', title: 'x', participants: ['me@x.at'], slots: slotsAt(9) }),
    /andere Person/
  );
  const poll = await service.createPoll({
    confirm: 'SEND',
    accountId: 'acc',
    title: 'Planung',
    minutes: 30,
    participants: [{ email: 'anna@x.at', name: 'Anna' }, 'bert@x.at'],
    slots: slotsAt(9, 10, 11),
    timeZone: TZ
  });
  assert.equal(sent.length, 2);
  assert.deepEqual(
    sent.map(m => m.to),
    [['anna@x.at'], ['bert@x.at']]
  );
  assert.equal(sent[0].confirm, 'SEND');
  assert.equal(poll.token, undefined, 'the token is not shown in the API');
  const token = tokenOf(sent[0]);
  const reply = (uid, from, subject) => ({ uid, messageId: `<m${uid}@x>`, fromEmail: from, subject });
  await service.onMessages('acc', [reply(1, 'anna@x.at', `Re: Planung ${subjectTag(token, { slot: 2 })}`)]);
  await service.onMessages('acc', [reply(2, 'anna@x.at', `Re: Planung ${subjectTag(token, { slot: 3 })}`)]);
  await service.onMessages('acc', [reply(2, 'anna@x.at', `Re: Planung ${subjectTag(token, { slot: 1 })}`)]); // same mail again
  await service.onMessages('acc', [reply(3, 'eve@evil.at', `Re: Planung ${subjectTag(token, { slot: 1 })}`)]);
  await service.onMessages('acc', [reply(4, 'bert@x.at', `Re: Planung ${subjectTag(token, { slot: 0 })}`)]);
  let p = service.list().polls[0];
  assert.deepEqual(p.votes['anna@x.at'].slots, [2, 3]);
  assert.equal(p.votes['eve@evil.at'], undefined);
  assert.deepEqual(p.none, ['bert@x.at']);
  assert.deepEqual(
    p.counts.map(c => c.length),
    [0, 1, 1]
  );
  p = await service.book({ id: poll.id, slot: 2 });
  assert.equal(p.status, 'booked');
  assert.deepEqual(
    saved[0].event.attendees.map(a => a.email),
    ['anna@x.at', 'bert@x.at']
  );
  assert.equal(saved[0].event.start, '2026-11-23T10:00');
  assert.equal(saved[0].notify, true);
  await assert.rejects(service.book({ id: poll.id, slot: 1 }), /schon/);
});

test('Scheduling service: an offer books the first pick and answers a late one', async () => {
  const { service, sent, saved } = setup();
  await service.createPoll({
    confirm: 'SEND',
    kind: 'offer',
    accountId: 'acc',
    title: 'Erstgespräch',
    participants: ['kunde@firma.at', 'kollegin@firma.at'],
    slots: slotsAt(9, 14),
    timeZone: TZ
  });
  const token = tokenOf(sent[0]);
  await service.onMessages('acc', [
    { uid: 5, fromEmail: 'kunde@firma.at', subject: `Re: ${subjectTag(token, { slot: 2 })}` }
  ]);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].event.start, '2026-11-23T14:00');
  assert.equal(service.list().polls[0].booked.by, 'kunde@firma.at');
  await service.onMessages('acc', [
    { uid: 6, fromEmail: 'kollegin@firma.at', subject: `Re: ${subjectTag(token, { slot: 1 })}` }
  ]);
  assert.equal(saved.length, 1, 'no second booking');
  assert.match(sent.at(-1).subject, /vergeben/);
});

test('Scheduling service: booking link answers with free times, books a free one, refuses a busy one', async () => {
  const { service, sent, saved, now } = setup({
    events: [{ start: new Date(MON + 9 * H).toISOString(), end: new Date(MON + 10 * H).toISOString() }]
  });
  now.t = MON - 2 * 24 * H;
  const link = await service.saveLink({
    accountId: 'acc',
    title: 'Erstgespräch',
    minutes: 30,
    dayStart: 9,
    dayEnd: 11,
    daysAhead: 7,
    noticeHours: 0,
    timeZone: TZ
  });
  assert.match(link.request.url, /^mailto:me@x.at/);
  const token = /\[LV-([A-Za-z0-9_-]{24})\]/.exec(link.request.subject)[1];
  await service.onMessages('acc', [
    { uid: 10, fromEmail: 'kunde@firma.at', subject: `Terminanfrage ${subjectTag(token)}` }
  ]);
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /^Freie Zeiten: Erstgespräch/);
  assert.ok(
    !sent[0].html.includes(encodeURIComponent(subjectTag(token, { at: new Date(MON + 9 * H).toISOString() }))),
    'busy time not offered'
  );
  // Picks a busy time: answered with other times, nothing booked.
  await service.onMessages('acc', [
    {
      uid: 11,
      fromEmail: 'kunde@firma.at',
      subject: `Re: ${subjectTag(token, { at: new Date(MON + 9.5 * H).toISOString() })}`
    }
  ]);
  assert.equal(saved.length, 0);
  assert.match(sent.at(-1).subject, /vergeben/);
  // Picks a free time: booked with an invitation.
  await service.onMessages('acc', [
    {
      uid: 12,
      fromEmail: 'kunde@firma.at',
      subject: `Re: ${subjectTag(token, { at: new Date(MON + 10 * H).toISOString() })}`
    }
  ]);
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].event.attendees, [{ email: 'kunde@firma.at', name: 'X' }]);
  assert.equal(service.list().links[0].bookings, 1);
});

test('Scheduling service: never answers automatic mail, own mail or beyond the daily limit', async () => {
  const { service, sent } = setup({ messages: { 20: { automatic: true } } });
  const link = await service.saveLink({ accountId: 'acc', title: 'Call', timeZone: TZ });
  const token = /\[LV-([A-Za-z0-9_-]{24})\]/.exec(link.request.subject)[1];
  await service.onMessages('acc', [{ uid: 20, fromEmail: 'ooo@firma.at', subject: `Abwesend: ${subjectTag(token)}` }]);
  await service.onMessages('acc', [{ uid: 21, fromEmail: 'me@x.at', subject: subjectTag(token) }]);
  assert.equal(sent.length, 0);
  for (let i = 0; i < 8; i++)
    await service.onMessages('acc', [{ uid: 30 + i, fromEmail: 'spam@firma.at', subject: subjectTag(token) }]);
  assert.equal(sent.length, 5, 'at most 5 answers per sender and day');
  await service.saveLink({ id: link.id, enabled: false });
  await service.onMessages('acc', [{ uid: 50, fromEmail: 'neu@firma.at', subject: subjectTag(token) }]);
  assert.equal(sent.length, 5, 'a switched-off link does not answer');
});
