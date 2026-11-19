// Demo data for the manual screenshots, on top of test/a11y/fixtures.json. Fictional people and
// companies only. The clock is fixed to Thursday, 19 November 2026, 10:12 in Vienna.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL_CATALOG, fitFor } from '../../apps/server/src/ai-model-catalog.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const fixtures = JSON.parse(readFileSync(join(root, 'test/a11y/fixtures.json'), 'utf8'));
export const NOW = new Date('2026-11-19T10:12:00+01:00');

const CAL = fixtures['GET /api/calendar/calendars'].body.calendars[0];
const at = (day, hm) => `2026-11-${String(day).padStart(2, '0')}T${hm}:00+01:00`;

function event(uid, day, from, to, summary, location = '', extra = {}) {
  return {
    uid,
    url: `local:${uid}`,
    etag: '1',
    accountId: CAL.accountId,
    calendarUrl: CAL.url,
    color: CAL.color,
    summary,
    location,
    description: '',
    status: 'CONFIRMED',
    start: at(day, from),
    end: at(day, to),
    allDay: false,
    tzid: 'Europe/Vienna',
    recurring: false,
    recurrenceId: null,
    rrule: null,
    organizer: null,
    attendees: [],
    alarms: [15],
    ...extra
  };
}

function events(lang) {
  const t = (de, en) => (lang === 'en' ? en : de);
  return [
    event('e1', 16, '09:00', '10:00', t('Wochenstart Team', 'Team kick-off'), 'Teams'),
    event(
      'e2',
      17,
      '11:00',
      '12:30',
      t('Workshop Design-System', 'Design system workshop'),
      t('Besprechungsraum 2', 'Meeting room 2')
    ),
    event('e3', 18, '14:00', '15:00', t('Kundentermin Hofer IT', 'Client meeting Hofer IT'), 'Linz'),
    event('e4', 19, '10:30', '11:15', t('Abstimmung Relaunch', 'Relaunch check-in'), 'Teams', {
      attendees: [
        { email: 'anna.berger@beispiel.at', name: 'Anna Berger', partstat: 'ACCEPTED', role: 'REQ-PARTICIPANT' }
      ]
    }),
    event('e5', 19, '12:30', '13:30', t('Mittagessen mit Thomas', 'Lunch with Thomas'), 'Café Central'),
    event(
      'e6',
      20,
      '09:00',
      '10:00',
      t('Vertrag besprechen', 'Contract review'),
      t('Kanzlei Steiner', 'Steiner law office')
    ),
    event('e7', 20, '15:00', '16:00', t('Fokuszeit', 'Focus time')),
    {
      ...event('e8', 21, '00:00', '00:00', t('Ausflug Wachau', 'Trip to the Wachau')),
      allDay: true,
      start: '2026-11-21',
      end: '2026-11-22'
    }
  ];
}

const contacts = [
  ['Anna Berger', 'Anna', 'Berger', 'anna.berger@beispiel.at', '+43 660 1234567', 'Berger Design', 'Art Director'],
  ['Lukas Hofer', 'Lukas', 'Hofer', 'lukas@hofer-it.at', '+43 732 998877', 'Hofer IT', 'Geschäftsführer'],
  [
    'Maria Steiner',
    'Maria',
    'Steiner',
    'm.steiner@kanzlei-steiner.at',
    '+43 1 5551234',
    'Kanzlei Steiner',
    'Rechtsanwältin'
  ],
  ['Thomas Gruber', 'Thomas', 'Gruber', 'thomas.gruber@beispiel.at', '+43 664 7654321', '', ''],
  [
    'Sophie Wagner',
    'Sophie',
    'Wagner',
    'sophie.wagner@beispiel.at',
    '+43 699 1112233',
    'Wagner & Partner',
    'Projektleitung'
  ]
].map(([name, firstName, lastName, email, phone, organization, title], i) => ({
  uid: `c${i + 1}`,
  url: `local-contacts:c${i + 1}`,
  accountId: 'local',
  addressBookUrl: 'local-contacts:',
  name,
  firstName,
  lastName,
  emails: [{ value: email, type: 'work' }],
  phones: [{ value: phone, type: 'cell' }],
  organization,
  title,
  address: i === 0 ? 'Mariahilfer Straße 12, 1070 Wien' : '',
  birthday: i === 0 ? '1988-04-12' : '',
  note: ''
}));

function tasks(lang) {
  const t = (de, en) => (lang === 'en' ? en : de);
  const base = { remindAt: null, repeat: null, done: false, doneAt: null, mail: null, list: null };
  const stamp = { createdAt: '2026-11-17T09:00:00.000Z', updatedAt: '2026-11-17T09:00:00.000Z' };
  return [
    {
      ...base,
      ...stamp,
      id: 't1',
      title: t('Angebot an Hofer IT schicken', 'Send the quote to Hofer IT'),
      notes: t('Preise aus der Kalkulation übernehmen', 'Take the prices from the estimate'),
      due: '2026-11-19',
      priority: 'high',
      source: 'mail',
      mail: {
        accountId: 'managed-8998d6a1e1f6',
        folder: 'INBOX',
        uid: 12,
        subject: 'Angebot Website-Relaunch – Rückmeldung bis Freitag?',
        from: 'Anna Berger'
      }
    },
    {
      ...base,
      ...stamp,
      id: 't2',
      title: t('Rückruf Lukas', 'Call Lukas back'),
      notes: '',
      due: '2026-11-19T15:00:00+01:00',
      priority: 'none',
      source: 'manual',
      repeat: { freq: 'WEEKLY', interval: 1 }
    },
    {
      ...base,
      ...stamp,
      id: 't3',
      title: t('Vertragsentwurf v3 prüfen', 'Review contract draft v3'),
      notes: '',
      due: '2026-11-20',
      priority: 'medium',
      source: 'ai'
    },
    {
      ...base,
      ...stamp,
      id: 't4',
      title: t('Rechnung November bezahlen', 'Pay the November invoice'),
      notes: '',
      due: '2026-11-18',
      priority: 'high',
      source: 'manual'
    },
    {
      ...base,
      ...stamp,
      id: 't5',
      title: t('Moodboard Feedback geben', 'Give feedback on the moodboard'),
      notes: '',
      due: '2026-11-24',
      priority: 'none',
      source: 'manual'
    }
  ];
}

function aiStatus(enabled) {
  const status = structuredClone(fixtures['GET /api/ai/status'].body);
  if (enabled) {
    Object.assign(status.settings, {
      enabled: true,
      localRuntime: 'bundled',
      model: 'qwen3.5:9b',
      embedModel: 'bge-m3'
    });
    status.runtime = { ...(status.runtime || {}), available: true, ollama: { running: true } };
  }
  return status;
}

function localModels() {
  const ram = 16 * 1024 ** 3;
  return {
    reachable: true,
    ram,
    recommendedTier: 'standard',
    freeBytes: 120e9,
    runtime: { version: '0.40.16', running: true },
    selected: { model: 'qwen3.5:9b', embedModel: 'bge-m3', provider: 'ollama' },
    index: [{ accountId: 'managed-8998d6a1e1f6', messages: 1200, vectors: 1200, running: false }],
    models: MODEL_CATALOG.map(m => ({
      ...m,
      default: Boolean(m.default),
      fit: fitFor(m, ram),
      installed: m.id === 'bge-m3',
      mismatch: false,
      job: m.id === 'qwen3.5:9b' ? { status: 'downloading', completed: 3.4e9, total: m.size, error: null } : null
    }))
  };
}

const rename = (body, label) => ({ ...body, accounts: body.accounts.map(a => ({ ...a, label })) });

export function demoRoutes({ lang, ai, extra }) {
  const label = lang === 'en' ? 'Work' : 'Arbeit';
  return {
    'GET /api/accounts': rename(fixtures['GET /api/accounts'].body, label),
    'GET /api/accounts/management': rename(fixtures['GET /api/accounts/management'].body, label),
    'GET /api/calendar/events': { events: events(lang), errors: [] },
    'GET /api/contacts/list': { ...fixtures['GET /api/contacts/list'].body, contacts },
    'GET /api/tasks': { tasks: tasks(lang) },
    'GET /api/ai/status': aiStatus(ai),
    'GET /api/ai/settings': aiStatus(ai).settings,
    'GET /api/ai/local-models': localModels(),
    'GET /api/screening': { since: '2026-01-01T00:00:00.000Z', allowed: [], blocked: [] },
    'POST /api/screening/check': req => {
      const emails = req.postDataJSON()?.emails || [];
      return { unknown: emails.filter(e => e === 'lukas@hofer-it.at') };
    },
    ...extra
  };
}
