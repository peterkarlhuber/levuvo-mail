import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCloudService,
  toGraphRecurrence,
  fromGraphRecurrence,
  toRruleLine,
  fromRruleLines,
  shiftModel
} from '../src/cloud.mjs';
import { createOAuthManager, PROVIDERS } from '../src/oauth.mjs';

const E = {
  graph: 'https://graph.test/v1.0',
  googleCalendar: 'https://gcal.test/v3',
  googlePeople: 'https://people.test/v1'
};

/** Minimal fake of Graph + Google: routes by method and path, records requests. */
function fakeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const key = `${init.method || 'GET'} ${u.origin}${u.pathname}`;
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ key, url: u, body, headers: init.headers });
    const handler = routes[key];
    if (!handler) return new Response(JSON.stringify({ error: 'nf' }), { status: 404 });
    const [status, data] = await handler({ url: u, body, headers: init.headers });
    return status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(data), { status });
  };
  return { fetchImpl, calls };
}
const prefsFile = () => {
  let v = { hidden: [], colors: {} };
  return { get: () => v, save: async n => (v = n) };
};
const ms = {
  id: 'm1',
  label: 'Arbeit',
  auth: 'oauth2',
  imap: { oauth: 'microsoft', user: 'me@firma.test', configured: true }
};
const gg = {
  id: 'g1',
  label: 'Privat',
  auth: 'oauth2',
  imap: { oauth: 'google', user: 'me@gmail.test', configured: true }
};
const pw = { id: 'p1', label: 'IMAP', auth: 'password', imap: { user: 'x@y.test' } };

test('Cloud: recurrences are translated between Graph, RRULE and Levuvo', () => {
  const weekly = { freq: 'WEEKLY', interval: 2, count: 5, until: null, byday: ['MO', 'WE'] };
  const g = toGraphRecurrence(weekly, '2026-11-16');
  assert.deepEqual(g.pattern.daysOfWeek, ['monday', 'wednesday']);
  assert.equal(g.range.numberOfOccurrences, 5);
  assert.deepEqual(fromGraphRecurrence(g), weekly);
  const monthly = toGraphRecurrence(
    { freq: 'MONTHLY', interval: 1, count: null, until: '2027-06-30', byday: [] },
    '2026-11-13'
  );
  assert.equal(monthly.pattern.dayOfMonth, 13);
  assert.equal(monthly.range.endDate, '2027-06-30');
  // Weekly without days: weekday of the start (2026-11-13 is a Friday).
  assert.deepEqual(toGraphRecurrence({ freq: 'WEEKLY', interval: 1, byday: [] }, '2026-11-13').pattern.daysOfWeek, [
    'friday'
  ]);
  const line = toRruleLine({ freq: 'DAILY', interval: 3, count: null, until: '2026-12-24', byday: [] });
  assert.equal(line, 'RRULE:FREQ=DAILY;INTERVAL=3;UNTIL=20261224T235959Z');
  assert.deepEqual(fromRruleLines(['EXDATE:20261201', line]), {
    freq: 'DAILY',
    interval: 3,
    count: null,
    until: '2026-12-24',
    byday: []
  });
  assert.equal(toGraphRecurrence(null), null);
});

test('Cloud: series is shifted by the shift applied to one occurrence', () => {
  const m = { allDay: false, tzid: 'Europe/Vienna', start: '2026-11-20T10:30', end: '2026-11-20T11:30' };
  // Occurrence originally 20.11. 10:00 Vienna (09:00Z), series starts 06.11. 10:00 Vienna.
  const shifted = shiftModel(m, '2026-11-06T09:00:00.000Z', '2026-11-20T09:00:00.000Z');
  assert.equal(shifted.start, '2026-11-06T10:30');
  assert.equal(shifted.end, '2026-11-06T11:30');
  const day = shiftModel({ allDay: true, start: '2026-11-21', end: '2026-11-22' }, '2026-11-06', '2026-11-20');
  assert.deepEqual([day.start, day.end], ['2026-11-07', '2026-11-08']);
});

test('Cloud: Microsoft 365 – calendars, events, saving, answering invitations, contacts', async () => {
  const created = [];
  const { fetchImpl, calls } = fakeFetch({
    [`GET ${E.graph}/me/calendars`]: () => [
      200,
      { value: [{ id: 'CAL1', name: 'Kalender', hexColor: '#123456', canEdit: true, isDefaultCalendar: true }] }
    ],
    [`GET ${E.graph}/me/calendars/CAL1/calendarView`]: () => [
      200,
      {
        value: [
          {
            id: 'EV1',
            iCalUId: 'uid-1',
            subject: 'Planung',
            body: { contentType: 'html', content: '<p>Agenda&nbsp;<b>1</b></p>' },
            start: { dateTime: '2026-11-16T08:00:00.0000000' },
            end: { dateTime: '2026-11-16T09:00:00.0000000' },
            originalStartTimeZone: 'Europe/Vienna',
            location: { displayName: 'Raum 2' },
            organizer: { emailAddress: { address: 'Chef@Firma.test', name: 'Chef' } },
            attendees: [
              { emailAddress: { address: 'me@firma.test', name: 'Ich' }, status: { response: 'tentativelyAccepted' } }
            ],
            isReminderOn: true,
            reminderMinutesBeforeStart: 15,
            type: 'occurrence',
            seriesMasterId: 'SER1',
            originalStart: '2026-11-16T08:00:00Z'
          },
          {
            id: 'EV2',
            subject: 'Urlaub',
            isAllDay: true,
            start: { dateTime: '2026-11-20T00:00:00.0000000' },
            end: { dateTime: '2026-11-22T00:00:00.0000000' },
            type: 'singleInstance'
          }
        ]
      }
    ],
    [`GET ${E.graph}/me/events/SER1`]: () => [
      200,
      {
        start: { dateTime: '2026-11-02T08:00:00.0000000' },
        recurrence: toGraphRecurrence({ freq: 'WEEKLY', interval: 1, byday: ['MO'] }, '2026-11-02')
      }
    ],
    [`POST ${E.graph}/me/calendars/CAL1/events`]: ({ body }) => (
      created.push(body),
      [201, { id: 'NEW', iCalUId: 'uid-new' }]
    ),
    [`PATCH ${E.graph}/me/events/SER1`]: ({ body }) => (created.push({ series: body }), [200, {}]),
    [`DELETE ${E.graph}/me/events/EV2`]: () => [204],
    [`GET ${E.graph}/me/events`]: ({ url }) => [
      200,
      { value: url.searchParams.get('$filter').includes('uid-1') ? [{ id: 'EV1' }] : [] }
    ],
    [`POST ${E.graph}/me/events/EV1/tentativelyAccept`]: ({ body }) => (created.push({ answer: body }), [202, {}]),
    [`GET ${E.graph}/me/contacts`]: () => [
      200,
      {
        value: [
          {
            id: 'C1',
            displayName: 'Anna Berg',
            givenName: 'Anna',
            surname: 'Berg',
            emailAddresses: [{ address: 'anna@x.test' }],
            mobilePhone: '+43 1',
            companyName: 'X'
          }
        ]
      }
    ],
    [`POST ${E.graph}/me/contacts`]: ({ body }) => (created.push({ contact: body }), [201, { id: 'C2' }])
  });
  const tokens = [];
  const cloud = createCloudService({
    accounts: () => [ms, pw],
    prefs: prefsFile(),
    fetchImpl,
    endpoints: E,
    token: async a => (tokens.push(a.id), 'graph-token')
  });
  assert.deepEqual(cloud.accounts(), [{ id: 'm1', label: 'Arbeit', provider: 'microsoft' }]);
  const { calendars } = await cloud.listCalendars();
  assert.equal(calendars.length, 1);
  assert.equal(calendars[0].url, 'cloud:CAL1');
  assert.equal(calendars[0].color, '#123456');
  assert.equal(calendars[0].accountId, 'm1');

  const { events, errors } = await cloud.events(Date.parse('2026-11-10'), Date.parse('2026-11-30'));
  assert.deepEqual(errors, []);
  const [planung, urlaub] = events;
  assert.equal(planung.start, '2026-11-16T08:00:00.000Z');
  assert.equal(planung.description, 'Agenda 1');
  assert.equal(planung.organizer.email, 'chef@firma.test');
  assert.equal(planung.attendees[0].partstat, 'TENTATIVE');
  assert.deepEqual(planung.alarms, [15]);
  assert.equal(planung.seriesId, 'cloud:SER1');
  assert.equal(planung.recurrenceId, '2026-11-16T08:00:00.000Z');
  assert.equal(planung.rrule.freq, 'WEEKLY');
  assert.equal(planung.tzid, 'Europe/Vienna');
  assert.deepEqual([urlaub.allDay, urlaub.start, urlaub.end], [true, '2026-11-20', '2026-11-22']);
  assert.equal(calls.find(c => c.key.endsWith('calendarView')).headers.Prefer, 'outlook.timezone="UTC"');
  assert.equal(calls[0].headers.Authorization, 'Bearer graph-token');

  const model = {
    summary: 'Neu',
    allDay: false,
    tzid: 'Europe/Vienna',
    start: '2026-11-18T14:00',
    end: '2026-11-18T15:00',
    location: '',
    description: 'x',
    rrule: null,
    attendees: [{ email: 'gast@x.test', name: '', partstat: 'NEEDS-ACTION' }],
    alarms: [10]
  };
  const r = await cloud.saveEvent({ accountId: 'm1', calendarUrl: 'cloud:CAL1', model, notify: true });
  assert.equal(r.uid, 'uid-new');
  assert.equal(created[0].start.dateTime, '2026-11-18T14:00:00');
  assert.equal(created[0].start.timeZone, 'Europe/Vienna');
  assert.equal(created[0].reminderMinutesBeforeStart, 10);
  assert.equal(created[0].attendees[0].emailAddress.address, 'gast@x.test');

  // Edit the whole series from the 16.11. occurrence: moved by +1 h on the series start.
  await cloud.saveEvent({
    accountId: 'm1',
    calendarUrl: 'cloud:CAL1',
    url: 'cloud:EV1',
    seriesId: 'cloud:SER1',
    occurrenceStart: '2026-11-16T08:00:00.000Z',
    scope: 'all',
    model: {
      ...model,
      start: '2026-11-16T10:00',
      end: '2026-11-16T11:00',
      rrule: { freq: 'WEEKLY', interval: 1, count: null, until: null, byday: ['MO'] }
    }
  });
  assert.equal(created[1].series.start.dateTime, '2026-11-02T10:00:00');
  assert.equal(created[1].series.recurrence.pattern.type, 'weekly');

  await cloud.deleteEvent({ accountId: 'm1', calendarUrl: 'cloud:CAL1', url: 'cloud:EV2' });
  assert.deepEqual(
    await cloud.respond({ accountId: 'm1', calendarUrl: 'cloud:CAL1', uid: 'uid-1', partstat: 'TENTATIVE' }),
    { found: true }
  );
  assert.deepEqual(created[2].answer, { sendResponse: true });
  assert.deepEqual(
    await cloud.respond({ accountId: 'm1', calendarUrl: 'cloud:CAL1', uid: 'other', partstat: 'ACCEPTED' }),
    { found: false }
  );

  const { contacts, addressBooks } = await cloud.contacts();
  assert.equal(contacts[0].name, 'Anna Berg');
  assert.equal(contacts[0].url, 'cloud:C1');
  assert.deepEqual(contacts[0].phones, [{ value: '+43 1', type: 'cell' }]);
  assert.equal(addressBooks[0].url, 'cloud:contacts');
  await cloud.saveContact({
    accountId: 'm1',
    contact: {
      name: 'Bob Kern',
      firstName: 'Bob',
      lastName: 'Kern',
      emails: [{ value: 'bob@x.test', type: 'work' }],
      phones: [{ value: '1', type: 'work' }],
      organization: '',
      title: '',
      address: '',
      birthday: '1990-02-03',
      note: ''
    }
  });
  assert.equal(created[3].contact.surname, 'Kern');
  assert.deepEqual(created[3].contact.businessPhones, ['1']);
  assert.equal(created[3].contact.birthday, '1990-02-03T00:00:00Z');

  // Hidden calendars are skipped, colors kept per account.
  await cloud.setCalendarPrefs('m1', 'cloud:CAL1', { hidden: true, color: '#ff0000' });
  assert.equal((await cloud.listCalendars()).calendars[0].color, '#ff0000');
  assert.deepEqual((await cloud.events(Date.parse('2026-11-10'), Date.parse('2026-11-30'))).events, []);
  assert.ok(tokens.every(id => id === 'm1'));
});

test('Cloud: Google – events, invitations with sendUpdates, reply, contacts via People API', async () => {
  const sent = [];
  const { fetchImpl } = fakeFetch({
    [`GET ${E.googleCalendar}/users/me/calendarList`]: () => [
      200,
      {
        items: [
          { id: 'me@gmail.test', summary: 'Ich', backgroundColor: '#0b8043', accessRole: 'owner', primary: true },
          { id: 'feiertage', summary: 'Feiertage', accessRole: 'reader' }
        ]
      }
    ],
    [`GET ${E.googleCalendar}/calendars/me%40gmail.test/events`]: ({ url }) =>
      url.searchParams.get('iCalUID')
        ? [200, { items: [{ id: 'GE1' }] }]
        : [
            200,
            {
              items: [
                {
                  id: 'GE1',
                  iCalUID: 'g-uid',
                  summary: 'Sport',
                  start: { dateTime: '2026-11-17T18:00:00+01:00', timeZone: 'Europe/Vienna' },
                  end: { dateTime: '2026-11-17T19:00:00+01:00' },
                  reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] },
                  recurringEventId: 'GSER',
                  originalStartTime: { dateTime: '2026-11-17T18:00:00+01:00' },
                  attendees: [
                    { email: 'Me@gmail.test', self: true, responseStatus: 'needsAction' },
                    { email: 'b@x.test', responseStatus: 'accepted' }
                  ]
                },
                { id: 'GX', status: 'cancelled', start: { date: '2026-11-18' }, end: { date: '2026-11-19' } }
              ]
            }
          ],
    [`GET ${E.googleCalendar}/calendars/feiertage/events`]: () => [
      200,
      { items: [{ id: 'H', summary: 'Feiertag', start: { date: '2026-12-08' }, end: { date: '2026-12-09' } }] }
    ],
    [`GET ${E.googleCalendar}/calendars/me%40gmail.test/events/GSER`]: () => [
      200,
      { recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=TU'] }
    ],
    [`GET ${E.googleCalendar}/calendars/me%40gmail.test/events/GE1`]: () => [
      200,
      {
        attendees: [
          { email: 'me@gmail.test', self: true, responseStatus: 'needsAction' },
          { email: 'b@x.test', responseStatus: 'accepted' }
        ]
      }
    ],
    [`PATCH ${E.googleCalendar}/calendars/me%40gmail.test/events/GE1`]: ({ url, body }) => (
      sent.push({ patch: body, updates: url.searchParams.get('sendUpdates') }),
      [200, {}]
    ),
    [`POST ${E.googleCalendar}/calendars/me%40gmail.test/events`]: ({ url, body }) => (
      sent.push({ insert: body, updates: url.searchParams.get('sendUpdates') }),
      [200, { id: 'N', iCalUID: 'n-uid' }]
    ),
    [`GET ${E.googlePeople}/people/me/connections`]: () => [
      200,
      {
        connections: [
          {
            resourceName: 'people/c1',
            etag: 'e1',
            names: [{ displayName: 'Cara Lind', givenName: 'Cara', familyName: 'Lind' }],
            emailAddresses: [{ value: 'cara@x.test', type: 'home' }],
            birthdays: [{ date: { year: 1985, month: 4, day: 9 } }]
          }
        ]
      }
    ],
    [`PATCH ${E.googlePeople}/people/c1:updateContact`]: ({ body, url }) => (
      sent.push({ person: body, fields: url.searchParams.get('updatePersonFields') }),
      [200, {}]
    ),
    [`DELETE ${E.googlePeople}/people/c1:deleteContact`]: () => [200, {}]
  });
  const cloud = createCloudService({
    accounts: () => [gg],
    prefs: prefsFile(),
    fetchImpl,
    endpoints: E,
    token: async () => 'g-token'
  });
  const { calendars } = await cloud.listCalendars();
  assert.deepEqual(
    calendars.map(c => [c.name, c.readOnly]),
    [
      ['Ich', false],
      ['Feiertage', true]
    ]
  );
  const { events } = await cloud.events(Date.parse('2026-11-10'), Date.parse('2026-12-31'));
  assert.deepEqual(
    events.map(e => e.summary),
    ['Sport', 'Feiertag']
  );
  const sport = events[0];
  assert.equal(sport.start, '2026-11-17T17:00:00.000Z');
  assert.deepEqual(sport.alarms, [30]);
  assert.equal(sport.rrule.byday[0], 'TU');
  assert.equal(sport.attendees[0].email, 'me@gmail.test');
  assert.equal(sport.attendees[0].partstat, 'NEEDS-ACTION');
  assert.equal(sport.seriesId, 'cloud:GSER');

  await cloud.saveEvent({
    accountId: 'g1',
    calendarUrl: 'cloud:me@gmail.test',
    notify: false,
    model: {
      summary: 'Ganztägig',
      allDay: true,
      tzid: null,
      start: '2026-11-25',
      end: '2026-11-26',
      location: '',
      description: '',
      rrule: { freq: 'YEARLY', interval: 1, count: null, until: null, byday: [] },
      attendees: [],
      alarms: []
    }
  });
  assert.equal(sent[0].updates, 'none');
  assert.deepEqual(sent[0].insert.start, { date: '2026-11-25' });
  assert.deepEqual(sent[0].insert.recurrence, ['RRULE:FREQ=YEARLY']);

  assert.deepEqual(
    await cloud.respond({
      accountId: 'g1',
      calendarUrl: 'cloud:me@gmail.test',
      uid: 'g-uid',
      partstat: 'ACCEPTED',
      me: 'me@gmail.test'
    }),
    { found: true }
  );
  assert.equal(sent[1].updates, 'all');
  assert.equal(sent[1].patch.attendees[0].responseStatus, 'accepted');
  assert.equal(sent[1].patch.attendees[1].responseStatus, 'accepted');

  const { contacts } = await cloud.contacts();
  assert.equal(contacts[0].birthday, '1985-04-09');
  assert.equal(contacts[0].emails[0].type, 'home');
  await cloud.saveContact({
    accountId: 'g1',
    url: contacts[0].url,
    etag: 'e1',
    contact: { ...contacts[0], note: 'VIP' }
  });
  assert.equal(sent[2].person.etag, 'e1');
  assert.equal(sent[2].person.biographies[0].value, 'VIP');
  assert.match(sent[2].fields, /biographies/);
  await cloud.deleteContact({ accountId: 'g1', url: 'cloud:people/c1' });
});

test('Cloud: missing consent and errors are reported clearly without blocking other accounts', async () => {
  const { fetchImpl } = fakeFetch({
    [`GET ${E.graph}/me/calendars`]: () => [403, { error: { code: 'Forbidden' } }],
    [`GET ${E.googleCalendar}/users/me/calendarList`]: () => [200, { items: [] }]
  });
  const cloud = createCloudService({
    accounts: () => [ms, gg],
    prefs: prefsFile(),
    fetchImpl,
    endpoints: E,
    token: async () => 't'
  });
  const { calendars, errors } = await cloud.listCalendars();
  assert.deepEqual(calendars, []);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'cloud_consent_required');
  assert.equal(errors[0].accountId, 'm1');
  await assert.rejects(cloud.saveEvent({ accountId: 'zz', calendarUrl: 'cloud:x', model: {} }), /Konto nicht gefunden/);
  const offline = createCloudService({
    accounts: () => [gg],
    prefs: prefsFile(),
    fetchImpl: async () => {
      throw new Error('ECONNRESET');
    },
    endpoints: E,
    token: async () => 't'
  });
  assert.equal((await offline.listCalendars()).errors[0].code, 'cloud_unreachable');
});

test('OAuth: Microsoft fetches mail and calendar tokens separately, re-sign-in for an existing account', async () => {
  const requests = [];
  const fetchImpl = async (_url, init) => {
    const p = Object.fromEntries(new URLSearchParams(String(init.body)));
    requests.push(p);
    if (p.scope?.includes('Calendars') && p.refresh_token === 'old')
      return new Response(JSON.stringify({ error: 'invalid_scope' }), { status: 400 });
    return new Response(JSON.stringify({ access_token: `at-${requests.length}`, expires_in: 3600 }), { status: 200 });
  };
  const oauth = createOAuthManager({
    config: { microsoft: { clientId: 'cid' }, google: { clientId: 'gid' } },
    fetchImpl
  });
  const mail = await oauth.accessToken('m1', 'microsoft', 'rt', null);
  const cal = await oauth.accessToken('m1', 'microsoft', 'rt', null, { resource: 'cloud' });
  assert.notEqual(mail, cal);
  assert.match(requests[0].scope, /IMAP\.AccessAsUser/);
  assert.match(requests[1].scope, /Calendars\.ReadWrite/);
  assert.equal(await oauth.accessToken('m1', 'microsoft', 'rt', null, { resource: 'cloud' }), cal);
  await assert.rejects(
    oauth.accessToken('m2', 'microsoft', 'old', null, { resource: 'cloud' }),
    err => err.code === 'cloud_consent_required'
  );
  // Google: one token for all scopes.
  await oauth.accessToken('g1', 'google', 'grt', null, { resource: 'cloud' });
  assert.equal(requests.at(-1).scope, undefined);
  assert.ok(new Set(PROVIDERS.google.scopes).has('https://www.googleapis.com/auth/calendar'));
  const { authUrl, state } = oauth.start('microsoft', 'http://127.0.0.1:1/oauth/callback', 'm1');
  assert.match(new URL(authUrl).searchParams.get('scope'), /Contacts\.ReadWrite/);
  assert.equal(oauth.status(state).status, 'pending');
});
