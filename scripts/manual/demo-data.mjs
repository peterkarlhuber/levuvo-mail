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
      embedModel: 'qwen3-embedding:0.6b'
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
    selected: { model: 'qwen3.5:9b', embedModel: 'qwen3-embedding:0.6b', provider: 'ollama' },
    index: [{ accountId: 'managed-8998d6a1e1f6', messages: 1200, vectors: 1200, running: false }],
    models: MODEL_CATALOG.map(m => ({
      ...m,
      default: Boolean(m.default),
      fit: fitFor(m, ram),
      installed: m.id === 'qwen3-embedding:0.6b',
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

// English edition: the demo mailbox (recorded in German for the a11y fixtures) in English.
const ANNA_DE =
  'Hallo Alex,\n\nanbei wie besprochen unser Angebot für den Relaunch. Wir haben die Punkte aus dem Workshop eingearbeitet:\n\n1. Neues Design-System mit Komponentenbibliothek\n2. Barrierefreiheit nach WCAG 2.2 AA\n3. Mehrsprachigkeit (DE/EN)\n\nKönntest du mir bis Freitag Bescheid geben, ob wir am Montag, 23.11. um 10:00 starten können?\n\nViele Grüße\nAnna\n';
const ANNA_EN =
  'Hi Alex,\n\nas discussed, here is our proposal for the relaunch. We have included the points from the workshop:\n\n1. New design system with a component library\n2. Accessibility to WCAG 2.2 AA\n3. Multiple languages (DE/EN)\n\nCould you let me know by Friday whether we can start on Monday, 23 Nov at 10:00?\n\nBest regards\nAnna\n';
const EN_TEXT = new Map([
  ['Angebot Website-Relaunch – Rückmeldung bis Freitag?', 'Website relaunch proposal – feedback by Friday?'],
  [ANNA_DE, ANNA_EN],
  [
    'Hallo Alex, anbei wie besprochen unser Angebot für den Relaunch. Wir haben die Punkte aus dem Workshop eingearbeitet: 1. Neues Design-System mit Komponentenbibliothek 2. Barrieref',
    'Hi Alex, as discussed, here is our proposal for the relaunch. We have included the points from the workshop: 1. New design system with a component library 2. Accessib'
  ],
  ['Design Weekly #212: Tokens, Raster und Dark Mode', 'Design Weekly #212: tokens, grids and dark mode'],
  [
    'Diese Woche: Warum Design-Tokens die Basis jedes Systems sind.',
    'This week: why design tokens are the base of every system.'
  ],
  ['Erst Inhalte, dann Design.', 'Content first, then design.'],
  ['Finanzamt Österreich', 'Tax Office'],
  [
    'Hallo Alex, hier das Moodboard. Freue mich auf Feedback!',
    'Hi Alex, here is the mood board. Looking forward to your feedback!'
  ],
  ['Hallo Alex, wir planen die Migration für Samstag.', 'Hi Alex, we are planning the migration for Saturday.'],
  ['Hallo zusammen, anbei das Protokoll vom Workshop.', 'Hi all, attached are the notes from the workshop.'],
  [
    'Hi Alex, die Migration ist durch, alle Postfächer laufen wieder. Bitte kurz prüfen, ob bei dir alles passt. LG Lukas',
    'Hi Alex, the migration is done and all mailboxes are running again. Please check that everything works for you. Cheers, Lukas'
  ],
  ['Ihre Rechnung November 2026', 'Your invoice for November 2026'],
  ['Ihre Rechnung ist verfügbar.', 'Your invoice is available.'],
  [
    'Ihre Sendung 1Z999 wird heute zwischen 10 und 14 Uhr zugestellt.',
    'Your parcel 1Z999 will be delivered today between 10:00 and 14:00.'
  ],
  ['Ihre Sendung wird heute zugestellt', 'Your parcel arrives today'],
  ['Logo freigeben', 'Approve the logo'],
  ['Mittagessen nächste Woche?', 'Lunch next week?'],
  ['Moodboard für das neue Logo', 'Mood board for the new logo'],
  ['Neue Nachricht in FinanzOnline', 'New message in your tax account'],
  ['Projekt Relaunch', 'Relaunch project'],
  ['Protokoll Workshop 12.11.', 'Workshop notes 12 Nov'],
  ['Re: Server-Migration am Wochenende', 'Re: Server migration this weekend'],
  ['Server-Migration am Wochenende', 'Server migration this weekend'],
  [
    'Sehr geehrter Herr Muster, anbei der überarbeitete Vertragsentwurf. Änderungen sind markiert. Mit freundlichen Grüßen Maria Steiner',
    'Dear Mr Muster, please find attached the revised contract draft. Changes are marked. Kind regards, Maria Steiner'
  ],
  ['Servus Alex, hast du Dienstag oder Mittwoch Zeit?', 'Hi Alex, are you free on Tuesday or Wednesday?'],
  ['Sie haben eine neue Nachricht.', 'You have a new message.'],
  ['Texte liefern', 'Deliver the copy'],
  ['Vertragsentwurf v3 zur Durchsicht', 'Contract draft v3 for review'],
  ['Website-Relaunch mit Hofer IT', 'Website relaunch with Hofer IT'],
  ['[levuvo-mail] CI: alle Checks erfolgreich', '[levuvo-mail] CI: all checks passed'],
  ['Österreichische Post', 'Austrian Post'],
  ['Geschäftsführer', 'Managing director'],
  ['Rechtsanwältin', 'Lawyer'],
  ['Mariahilfer Straße 12, 1070 Wien', 'Mariahilfer Strasse 12, 1070 Vienna'],
  ['Angebot_Relaunch_2026.pdf', 'Relaunch_proposal_2026.pdf'],
  ['Abnahme', 'Sign-off'],
  // "My day"
  ['Angebot an Hofer IT schicken', 'Send the quote to Hofer IT'],
  ['Jour fixe Relaunch', 'Relaunch weekly'],
  ['Büro Linz', 'Linz office'],
  ['Vertragsentwurf', 'Contract draft'],
  ['Angebot Website-Relaunch', 'Website relaunch proposal'],
  ['Re: Angebot Website-Relaunch', 'Re: Website relaunch proposal'],
  ['Kannst du mir bis Freitag Bescheid geben?', 'Can you let me know by Friday?'],
  ['Angebot an Lukas schicken', 'Send the quote to Lukas'],
  ['Lukas schickt die Zugangsdaten', 'Lukas sends the login details']
]);

/** The subject the screenshots open, per language. */
export const OPEN_SUBJECT = { de: 'Angebot Website-Relaunch', en: 'Website relaunch proposal' };
export const SPACE_NAME = { de: 'Projekt Relaunch', en: 'Relaunch project' };

/** A response body in the edition's language: German demo texts become English ones. */
export function localize(body, lang) {
  if (lang !== 'en') return body;
  const walk = v =>
    typeof v === 'string'
      ? (EN_TEXT.get(v) ?? v)
      : Array.isArray(v)
        ? v.map(walk)
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
          : v;
  return walk(body);
}
