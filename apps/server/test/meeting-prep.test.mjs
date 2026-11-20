import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMeetingPrep, peopleOf, topicWords } from '../src/meeting-prep.mjs';
import { upcomingMeetings } from '../src/routes-meeting-prep.mjs';

const EVENT = {
  uid: 'e1',
  summary: 'Jour fixe Website-Relaunch',
  start: '2026-11-20T09:00:00.000Z',
  end: '2026-11-20T10:00:00.000Z',
  organizer: { email: 'Peter@example.org', name: 'Peter' },
  attendees: [
    { email: 'lukas@hofer-it.at', name: '', partstat: 'ACCEPTED' },
    { email: 'peter@example.org', name: 'Peter', partstat: 'ACCEPTED' },
    { email: 'anna@example.com', name: 'Anna', partstat: 'NEEDS-ACTION' }
  ],
  attachments: [{ name: 'Agenda.pdf' }]
};

test('meeting prep: topic words skip filler words, people skip the user', () => {
  assert.deepEqual(topicWords('Jour fixe Website-Relaunch'), ['website-relaunch']);
  assert.deepEqual(topicWords('Weekly Sync 2026'), []);
  assert.deepEqual(
    peopleOf(EVENT, new Set(['peter@example.org'])).map(p => p.email),
    ['lukas@hofer-it.at', 'anna@example.com']
  );
});

test('meeting prep: attendees with contact cards, related mail, files, tasks and promises', async () => {
  const searches = [];
  const prep = await buildMeetingPrep({
    event: EVENT,
    ownAddresses: ['peter@example.org'],
    accountIds: ['a1'],
    contacts: async () => ({
      contacts: [
        {
          name: 'Lukas Hofer',
          organization: 'Hofer IT',
          title: 'CTO',
          emails: [{ value: 'Lukas@Hofer-IT.at' }],
          phones: [{ value: '+43 1 234' }]
        }
      ]
    }),
    search: async (ids, q, opts) => {
      searches.push([ids, q, opts.limit]);
      if (q === 'lukas@hofer-it.at')
        return [
          { accountId: 'a1', folder: 'INBOX', uid: 1, subject: 'Angebot', date: '2026-11-18', hasAttachments: true },
          { accountId: 'a1', folder: 'INBOX', uid: 2, subject: 'Zeitplan', date: '2026-11-19' }
        ];
      if (q === 'website-relaunch')
        return [{ accountId: 'a1', folder: 'INBOX', uid: 1, subject: 'Angebot', date: '2026-11-18' }];
      return [];
    },
    tasks: () => [
      { id: 't1', title: 'Angebot prüfen', mail: { from: 'lukas@hofer-it.at', subject: 'Angebot' } },
      { id: 't2', title: 'Website-Relaunch Texte', mail: null },
      { id: 't3', title: 'Steuer', mail: null }
    ],
    followups: () => [
      { id: 'f1', subject: 'Vertrag', to: ['anna@example.com'], state: 'waiting' },
      { id: 'f2', subject: 'Andere', to: ['x@y.z'], state: 'waiting' }
    ],
    commitments: () => [
      { id: 'c1', direction: 'theirs', what: 'Zugangsdaten', who: 'lukas@hofer-it.at' },
      { id: 'c2', direction: 'mine', what: 'Anderes', who: 'nobody@x.y' }
    ]
  });
  assert.deepEqual(
    prep.attendees.map(a => [a.email, a.name, a.contact?.organization || null, a.partstat]),
    [
      ['lukas@hofer-it.at', 'Lukas Hofer', 'Hofer IT', 'ACCEPTED'],
      ['anna@example.com', 'Anna', null, 'NEEDS-ACTION']
    ]
  );
  assert.deepEqual(
    prep.mails.map(m => m.uid),
    [2, 1],
    'newest first, no duplicates'
  );
  assert.deepEqual(
    searches.map(s => s[1]),
    ['lukas@hofer-it.at', 'anna@example.com', 'website-relaunch']
  );
  assert.deepEqual(
    prep.files.map(f => [f.source, f.name]),
    [
      ['event', 'Agenda.pdf'],
      ['mail', 'Angebot']
    ]
  );
  assert.deepEqual(
    prep.tasks.map(t => t.id),
    ['t1', 't2']
  );
  assert.deepEqual(
    prep.followups.map(f => f.id),
    ['f1']
  );
  assert.deepEqual(
    prep.promises.map(c => c.id),
    ['c1']
  );
  assert.deepEqual(prep.unavailable, []);
});

test('meeting prep: a failing source is reported, not fatal', async () => {
  const prep = await buildMeetingPrep({
    event: EVENT,
    ownAddresses: [],
    accountIds: [],
    contacts: async () => {
      throw new Error('carddav down');
    },
    search: async () => {
      throw new Error('index locked');
    }
  });
  assert.deepEqual(prep.unavailable.sort(), ['contacts', 'mail']);
  assert.equal(prep.attendees.length, 3);
});

test('meeting prep: upcoming meetings are timed events with other people, soon', () => {
  const now = Date.parse('2026-11-20T08:52:00Z');
  const own = new Set(['peter@example.org']);
  const base = { ...EVENT, allDay: false };
  const list = upcomingMeetings(
    [
      base,
      { ...base, uid: 'later', start: '2026-11-20T10:00:00.000Z' },
      { ...base, uid: 'alone', attendees: [], organizer: { email: 'peter@example.org' } },
      { ...base, uid: 'allday', allDay: true },
      { ...base, uid: 'cancelled', status: 'CANCELLED' }
    ],
    { now, minutes: 10, own }
  );
  assert.deepEqual(
    list.map(m => m.uid),
    ['e1']
  );
});
