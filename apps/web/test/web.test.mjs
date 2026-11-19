// Unit tests for UI logic that does not need a browser (run with Node's type stripping).
import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addDays, editorTimes, eventRange, hm, layoutDay, parseYmd, startOfWeek, ymd } from '../src/calendar-utils.ts';
import { orderFolders } from '../src/folder-utils.ts';
import { applySuggestions, bundleSuggester, registerBundleSuggester } from '../src/bundle-suggest.ts';
import { isTrackingImage, remoteImageKey, trackerHost } from '../src/trackers.ts';
import { shortcutAt } from '../src/templates.ts';
import { missingTranslations, loadDictionary } from '../../../scripts/check-i18n.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');

test('English UI: every text has a translation with the same placeholders', () => {
  assert.deepEqual(missingTranslations(root), []);
  const en = loadDictionary(root);
  for (const [de, english] of Object.entries(en)) {
    const vars = s => (s.match(/\{\w+\}/g) || []).sort().join();
    assert.equal(vars(english), vars(de), `Platzhalter: ${de}`);
    assert.ok(english.trim(), `empty: ${de}`);
  }
});

test('Calendar: all-day events (exclusive end), week starts on Monday', () => {
  const r = eventRange({ start: '2026-11-13', end: '2026-11-15', allDay: true });
  assert.equal(ymd(r.start), '2026-11-13');
  assert.equal(ymd(r.end), '2026-11-15');
  const single = eventRange({ start: '2026-11-13', end: '2026-11-13', allDay: true });
  assert.equal(ymd(single.end), '2026-11-14');
  assert.equal(ymd(startOfWeek(parseYmd('2026-11-15'))), '2026-11-09'); // Sunday → Monday before
  assert.equal(ymd(startOfWeek(parseYmd('2026-11-09'))), '2026-11-09');
  assert.equal(ymd(addDays(parseYmd('2026-03-28'), 2)), '2026-03-30'); // across DST
});

test('Calendar: overlapping events are arranged side by side', () => {
  const at = (h, m = 0) => new Date(2026, 10, 13, h, m);
  const layout = layoutDay([
    { start: at(9), end: at(10) },
    { start: at(9, 30), end: at(11) },
    { start: at(10), end: at(10, 30) },
    { start: at(12), end: at(13) }
  ]);
  assert.deepEqual(
    layout.map(l => l.cols),
    [2, 2, 2, 1]
  );
  assert.equal(layout[0].col, 0);
  assert.equal(layout[1].col, 1);
  assert.equal(layout[2].col, 0); // reuses the column that became free at 10:00
  assert.equal(layout[3].col, 0);
});

test('Folders: system folders first, subfolders indented', () => {
  const f = (path, specialUse = null) => ({ path, name: path.split('.').at(-1), specialUse, delimiter: '.' });
  const ordered = orderFolders([
    f('Projekte.Alpha'),
    f('Trash', '\\Trash'),
    f('INBOX'),
    f('Projekte'),
    f('Sent', '\\Sent'),
    f('INBOX.Kunden')
  ]);
  assert.deepEqual(
    ordered.map(o => [o.folder.path, o.depth]),
    [
      ['INBOX', 0],
      ['Sent', 0],
      ['Trash', 0],
      ['INBOX.Kunden', 0],
      ['Projekte', 0],
      ['Projekte.Alpha', 1]
    ]
  );
});

test('Templates: placeholders are replaced, unknown ones stay visible, HTML is escaped', async () => {
  const { fillTemplate, nameParts } = await import('../src/templates.ts');
  const vars = { ...nameParts('Anna Berger'), sender: 'Peter <Chef>', date: '13. November 2026' };
  assert.equal(
    fillTemplate('<p>Hallo {Vorname} {Nachname}, {Datum} – {Absender} · {Firma}</p>', vars),
    '<p>Hallo Anna Berger, 13. November 2026 – Peter &lt;Chef&gt; · {Firma}</p>'
  );
  assert.equal(fillTemplate('Dear {FirstName}', {}), 'Dear {FirstName}');
  assert.deepEqual(nameParts('anna@x.at'), {});
});

test('Calendar: drag & drop keeps the duration, month view starts on Monday', async () => {
  const { movedEventModel, monthMatrix, snapMinutes } = await import('../src/calendar-utils.ts');
  const timed = {
    start: new Date(2026, 10, 16, 9, 0).toISOString(),
    end: new Date(2026, 10, 16, 10, 30).toISOString(),
    allDay: false
  };
  const moved = movedEventModel(timed, { day: new Date(2026, 10, 18), minutes: 14 * 60 + 15 });
  assert.deepEqual([moved.start, moved.end, moved.allDay], ['2026-11-18T14:15', '2026-11-18T15:45', false]);
  // Month view: same time on the new day.
  assert.equal(movedEventModel(timed, { day: new Date(2026, 10, 20) }).start, '2026-11-20T09:00');
  const allDay = movedEventModel(
    { start: '2026-11-20', end: '2026-11-22', allDay: true },
    { day: new Date(2026, 10, 24) }
  );
  assert.deepEqual([allDay.start, allDay.end, allDay.tzid], ['2026-11-24', '2026-11-26', null]);
  assert.equal(snapMinutes(127), 120);
  assert.equal(snapMinutes(-30), 0);
  assert.equal(snapMinutes(24 * 60 + 40), 24 * 60 - 15);
  const grid = monthMatrix(new Date(2026, 10, 13));
  assert.equal(grid.length, 42);
  assert.equal(grid[0].getDay(), 1);
  assert.ok(grid.some(d => d.getDate() === 30 && d.getMonth() === 10));
});

test('Command palette: matches regardless of umlauts, word starts first', async () => {
  const { matchScore, normalize } = await import('../src/command-bus.ts');
  assert.equal(normalize('Entwürfe'), 'entwurfe');
  assert.ok(matchScore('entw', 'Entwürfe') > matchScore('entw', 'Neue Entwürfe-Vorlage'));
  assert.equal(matchScore('xyz', 'Posteingang'), -1);
  assert.ok(matchScore('dunk', 'Dunkles Design', 'theme dark') > 0);
  assert.ok(matchScore('dark', 'Dunkles Design', 'theme dark') > 0);
  assert.ok(matchScore('neu mail', 'Neue E-Mail schreiben') > 0);
  assert.equal(matchScore('', 'egal'), 0);
});

test('Event editor: saving without changing the time keeps an event of another time zone in place', () => {
  const e = {
    start: '2026-11-16T15:00:00.000Z',
    end: '2026-11-16T16:00:00.000Z',
    allDay: false,
    tzid: 'America/New_York'
  };
  const r = eventRange(e);
  const shown = { start: `${ymd(r.start)}T${hm(r.start)}`, end: `${ymd(r.end)}T${hm(r.end)}` };
  assert.deepEqual(editorTimes(e, shown, 'Europe/Vienna'), {
    tzid: 'America/New_York',
    start: '2026-11-16T10:00',
    end: '2026-11-16T11:00'
  });
  // A changed time is what the user typed, in the user's own zone.
  assert.deepEqual(editorTimes(e, { start: '2026-11-17T09:00', end: '2026-11-17T10:00' }, 'Europe/Vienna'), {
    tzid: 'Europe/Vienna',
    start: '2026-11-17T09:00',
    end: '2026-11-17T10:00'
  });
});

test('Inbox sync: snapshots taken before a local change are not applied', async () => {
  const { snapshotApplies } = await import('../src/mail-sync.ts');
  // Delete sent at t=100; a snapshot that started reading at t=90 may still contain the message.
  assert.equal(snapshotApplies(90, 0, 100), false);
  assert.equal(snapshotApplies(100, 0, 100), false);
  assert.equal(snapshotApplies(110, 0, 100), true);
  // Never an older snapshot than the one already shown.
  assert.equal(snapshotApplies(110, 120, 100), false);
});

test('Inbox sync: snapshot merge keeps one row per UID and older loaded pages', async () => {
  const { mergeSnapshot } = await import('../src/mail-sync.ts');
  const row = (uid, extra = {}) => ({ uid, subject: `S${uid}`, ...extra });
  const merged = mergeSnapshot(
    [row(5), row(4, { flagged: true }), row(2), row(1)],
    [row(6), row(4), row(4), row(3), row(0), row(Number.NaN)]
  );
  assert.deepEqual(
    merged.map(m => m.uid),
    [6, 4, 3, 2, 1]
  );
  assert.equal(merged[1].flagged, true);
  assert.deepEqual(mergeSnapshot([row(1)], []), []);
});

test('Inbox sync: a missing message is recognized, removal and flag actions are told apart', async () => {
  const { isMissingMessage, removesMessages } = await import('../src/mail-sync.ts');
  assert.equal(isMissingMessage(Object.assign(new Error('x'), { code: 'message_missing', status: 404 })), true);
  assert.equal(isMissingMessage(Object.assign(new Error('x'), { code: 'imap_write_failed' })), false);
  assert.equal(isMissingMessage(null), false);
  assert.equal(isMissingMessage('message_missing'), false);
  for (const action of ['trash', 'archive', 'move', 'spam', 'notSpam']) assert.equal(removesMessages(action), true);
  for (const action of ['markRead', 'markUnread', 'flag', 'unflag']) assert.equal(removesMessages(action), false);
});

test('Detected appointment becomes a calendar editor model', async () => {
  const { suggestionToEvent } = await import('../src/event-suggestion.ts');
  const labels = {
    kind: { flight: 'Flug', train: 'Zugfahrt', bus: 'Busfahrt', car: 'Mietwagen' },
    reservation: 'Buchungsnummer',
    fromMail: 'Aus der E-Mail',
    untitled: '(Ohne Titel)'
  };
  const mail = { subject: 'Ihre Buchung', from: [{ name: 'Airline', email: 'noreply@airline.test' }] };
  const flight = suggestionToEvent(
    {
      kind: 'flight',
      source: 'schema',
      summary: 'LH 1234 VIE → FRA',
      allDay: false,
      start: '2026-12-12T07:15:00.000Z',
      end: '2026-12-12T08:50:00.000Z',
      location: 'Wien (VIE)',
      description: '',
      reservationNumber: 'XK4P2Q'
    },
    mail,
    labels,
    'Europe/Vienna'
  );
  assert.equal(flight.summary, 'Flug LH 1234 VIE → FRA');
  assert.equal(flight.tzid, 'Europe/Vienna');
  const local = new Date('2026-12-12T07:15:00.000Z');
  assert.equal(flight.start, `${ymd(local)}T${hm(local)}`);
  assert.match(flight.description, /^Buchungsnummer: XK4P2Q\n\nAus der E-Mail: „Ihre Buchung“ – Airline$/);

  const text = suggestionToEvent(
    {
      kind: 'date',
      source: 'text',
      summary: '',
      allDay: false,
      start: '2026-12-05T09:00',
      end: '2026-12-05T09:00',
      floating: true,
      location: '',
      description: '',
      reservationNumber: ''
    },
    { subject: 'Treffen' },
    labels,
    'Europe/Vienna'
  );
  assert.deepEqual([text.summary, text.start, text.end], ['Treffen', '2026-12-05T09:00', '2026-12-05T10:00']);

  const hotel = suggestionToEvent(
    {
      kind: 'hotel',
      source: 'schema',
      summary: 'Hotel Sacher',
      allDay: true,
      start: '2026-12-12',
      end: '2026-12-15',
      location: '',
      description: '',
      reservationNumber: ''
    },
    {},
    labels
  );
  assert.deepEqual(
    [hotel.allDay, hotel.start, hotel.end, hotel.summary, hotel.description],
    [true, '2026-12-12', '2026-12-15', 'Hotel Sacher', '']
  );
});

test('Tracking pixels: tiny, hidden and known tracker images are recognised', () => {
  const yes = [
    { src: 'https://example.com/a.gif', width: '1', height: '1' },
    { src: '//example.com/a.gif', width: '0', height: '0' },
    { src: 'https://example.com/x', style: 'width:1px;height:1px' },
    { src: 'https://example.com/x', width: '1' },
    { src: 'https://example.com/logo.png', style: 'display: none !important' },
    { src: 'https://example.com/logo.png', style: 'opacity:0' },
    { src: 'https://mailtrack.io/trace/mail/abc.png' },
    { src: 'https://foo.list-manage.com/track/open.php?u=1&id=2' },
    { src: 'https://u123.ct.sendgrid.net/wf/open?upn=xyz' },
    { src: 'https://shop.example/email/track/open/123' },
    { src: 'https://news.example/pixel.gif?id=9' }
  ];
  const no = [
    { src: 'https://example.com/logo.png', width: '120', height: '40' },
    { src: 'https://example.com/banner.jpg' },
    { src: 'https://example.com/spacer.gif', width: '1', height: '20' },
    { src: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', width: '1', height: '1' },
    { src: 'cid:logo', width: '1', height: '1' },
    { src: 'https://example.com/logo.png', style: 'max-width:1px' },
    { src: 'https://list-manage.com/images/logo.png' },
    { src: 'https://example.com/open-source.png' }
  ];
  for (const img of yes) assert.equal(isTrackingImage(img), true, JSON.stringify(img));
  for (const img of no) assert.equal(isTrackingImage(img), false, JSON.stringify(img));
  assert.equal(trackerHost('https://www.mailtrack.io/x.png'), 'mailtrack.io');
});

test('Design tokens: stylesheets use the shared scale (no raw sizes, layers, radii, colours)', async () => {
  const { findViolations } = await import('../../../scripts/check-design-tokens.mjs');
  const v = findViolations(root);
  assert.deepEqual(
    v.map(x => `${x.file}:${x.line} ${x.prop}: ${x.value} → ${x.hint}`),
    [],
    'Use the tokens from docs/design-system.md'
  );
});

test('Tasks: title from subject, due values, due state and presets', async () => {
  const { taskTitleFromSubject, dueFromForm, formFromDue, dueDay, dueState, duePresets } =
    await import('../src/tasks.ts');
  assert.equal(taskTitleFromSubject('AW: Re: Fwd: Angebot Küche'), 'Angebot Küche');
  assert.equal(dueFromForm('', '10:00'), null);
  assert.equal(dueFromForm('2026-12-01', ''), '2026-12-01');
  const timed = dueFromForm('2026-12-01', '09:30');
  assert.equal(new Date(timed).getHours(), 9);
  assert.deepEqual(formFromDue(timed), { date: '2026-12-01', time: '09:30' });
  assert.deepEqual(formFromDue('2026-12-01'), { date: '2026-12-01', time: '' });
  assert.deepEqual(formFromDue(null), { date: '', time: '' });
  assert.equal(dueDay(timed), '2026-12-01');
  const now = new Date(2026, 10, 18, 12, 0); // Wed 18 Nov 2026, local
  assert.equal(dueState({ due: '2026-11-17', done: false }, now), 'overdue');
  assert.equal(dueState({ due: '2026-11-18', done: false }, now), 'today');
  assert.equal(dueState({ due: new Date(2026, 10, 18, 9, 0).toISOString(), done: false }, now), 'overdue');
  assert.equal(dueState({ due: '2026-11-22', done: false }, now), 'soon');
  assert.equal(dueState({ due: '2026-12-22', done: false }, now), 'later');
  assert.equal(dueState({ due: '2026-11-17', done: true }, now), 'none');
  assert.equal(dueState({ due: null, done: false }, now), 'none');
  assert.deepEqual(duePresets(now), {
    today: '2026-11-18',
    tomorrow: '2026-11-19',
    monday: '2026-11-23',
    week: '2026-11-25'
  });
  assert.equal(duePresets(new Date(2026, 10, 23, 8)).monday, '2026-11-30'); // on a Monday: the next one
});

test('Contact card: address book match and shared appointments', async () => {
  const { pickContact, sharedEvents } = await import('../src/contact-card.ts');
  const c = (name, email, extra = {}) => ({ name, emails: [{ value: email, type: 'work' }], phones: [], ...extra });
  const picked = pickContact(
    [c('', 'Anna@X.at'), c('Anna Muster', 'anna@x.at', { organization: 'X GmbH' }), c('Bob', 'bob@x.at')],
    'anna@x.at'
  );
  assert.equal(picked.name, 'Anna Muster');
  assert.equal(pickContact([c('Bob', 'bob@x.at')], 'anna@x.at'), null);

  const ev = (summary, start, end, who, extra = {}) => ({
    uid: summary,
    url: `/${summary}`,
    summary,
    start,
    end,
    allDay: false,
    organizer: null,
    attendees: who.map(email => ({ email, name: '', partstat: 'ACCEPTED' })),
    ...extra
  });
  const now = new Date('2026-11-18T12:00:00Z');
  const list = [
    ev('Alt', '2026-10-01T08:00:00Z', '2026-10-01T09:00:00Z', ['anna@x.at']),
    ev('Neuer', '2026-11-10T08:00:00Z', '2026-11-10T09:00:00Z', ['ANNA@x.at']),
    ev('Fremd', '2026-11-20T08:00:00Z', '2026-11-20T09:00:00Z', ['bob@x.at']),
    ev('Bald', '2026-11-25T08:00:00Z', '2026-11-25T09:00:00Z', [], { organizer: { email: 'anna@x.at', name: '' } }),
    ev('Morgen', '2026-11-19T08:00:00Z', '2026-11-19T09:00:00Z', ['anna@x.at']),
    ev('Morgen', '2026-11-19T08:00:00Z', '2026-11-19T09:00:00Z', ['anna@x.at']),
    ev('Laeuft', '2026-11-18T11:00:00Z', '2026-11-18T13:00:00Z', ['anna@x.at'])
  ];
  const r = sharedEvents(list, 'anna@x.at', now);
  assert.deepEqual(
    r.upcoming.map(e => e.summary),
    ['Laeuft', 'Morgen', 'Bald']
  );
  assert.deepEqual(
    r.past.map(e => e.summary),
    ['Neuer', 'Alt']
  );
});

test('assistant helpers: own part of a draft and default event end', async () => {
  const { ownPart, defaultEnd } = await import('../src/ai-utils.ts');
  assert.equal(ownPart('<p>Hi</p><p>-- </p><p>Sig</p>', ['<p>-- </p>', '<blockquote']), '<p>Hi</p>');
  assert.equal(ownPart('Nur Text', ['\n-- \n']), 'Nur Text');
  assert.equal(defaultEnd('2026-11-23T14:00', false), '2026-11-23T15:00');
  assert.equal(defaultEnd('2026-11-23T23:30', false), '2026-11-23T23:59');
  assert.equal(defaultEnd('2026-11-23', true), '2026-11-23');
  const { bundleFromClassification } = await import('../src/ai-utils.ts');
  const mapped = bundleFromClassification([
    { id: '4', bundle: 'newsletters', from_person: false },
    { id: '5', bundle: 'finance', from_person: true },
    { id: '6', bundle: 'work', from_person: false },
    { id: 'x', bundle: 'notifications' },
    { id: '7', bundle: 'notifications' }
  ]);
  assert.deepEqual(
    [...mapped],
    [
      [4, 'newsletter'],
      [5, null],
      [6, null],
      [7, 'notification']
    ]
  );
});

test('Templates: a shortcut right before the cursor is found', () => {
  const list = [
    { id: '1', name: 'Gruß', subject: '', html: '<p>MfG</p>', shortcut: 'mfg' },
    { id: '2', name: 'Ohne', subject: '', html: '<p>x</p>' }
  ];
  assert.equal(shortcutAt('Danke ;mfg', list)?.template.id, '1');
  assert.equal(shortcutAt(';MFG', list)?.length, 4);
  assert.equal(shortcutAt('Danke;mfg', list), null); // inside a word
  assert.equal(shortcutAt('Danke ;mfgx', list), null);
  assert.equal(shortcutAt('Danke mfg', list), null);
  assert.equal(shortcutAt(';', list), null);
});

test('bundle suggestions: optional second opinion over the local rules', () => {
  const base = { fromName: 'X', fromEmail: 'x@y.test', subject: 'S', date: null, unread: false };
  const messages = [
    { ...base, uid: 1, bundle: 'newsletter' },
    { ...base, uid: 2, bundle: null },
    { ...base, uid: 3 }
  ];
  assert.equal(applySuggestions(messages, new Map()), messages);
  const out = applySuggestions(
    messages,
    new Map([
      [1, { bundle: null, source: 'ai', reason: 'persönlich' }],
      [2, { bundle: 'invoice', source: 'ai' }],
      [3, { bundle: null, source: 'ai' }]
    ])
  );
  assert.deepEqual(
    out.map(m => [m.uid, m.bundle ?? null, m.bundleSource ?? null]),
    [
      [1, null, 'ai'],
      [2, 'invoice', 'ai'],
      [3, null, null]
    ]
  );
  assert.equal(out[0].bundleReason, 'persönlich');
  assert.equal(bundleSuggester(), null);
  const fn = async () => new Map();
  registerBundleSuggester(fn);
  assert.equal(bundleSuggester(), fn);
  registerBundleSuggester(null);
  assert.equal(bundleSuggester(), null);
});

test('Tasks: reminder choices, views and tasks of a mail', async () => {
  const { reminderFor, reminderChoice, filterView, viewCounts, tasksForMail, tasksInRange } =
    await import('../src/tasks.ts');
  const due = new Date(2026, 11, 3, 14, 30).toISOString();
  assert.equal(reminderFor('none', due), null);
  assert.equal(reminderFor('atDue', due), due);
  assert.equal(reminderFor('before15', due), new Date(2026, 11, 3, 14, 15).toISOString());
  assert.equal(reminderFor('before60', due), new Date(2026, 11, 3, 13, 30).toISOString());
  assert.equal(reminderFor('morning', '2026-12-03'), new Date(2026, 11, 3, 9, 0).toISOString());
  assert.equal(reminderFor('dayBefore', '2026-12-01'), new Date(2026, 10, 30, 9, 0).toISOString());
  assert.equal(reminderFor('custom', null, '2026-12-02T08:05'), new Date(2026, 11, 2, 8, 5).toISOString());
  assert.equal(reminderFor('custom', null, ''), null);
  assert.equal(reminderFor('morning', null), null);
  assert.equal(reminderChoice(new Date(2026, 11, 3, 13, 30).toISOString(), due), 'before60');
  assert.equal(reminderChoice(new Date(2026, 11, 1, 7, 0).toISOString(), due), 'custom');
  assert.equal(reminderChoice(null, due), 'none');

  const now = new Date(2026, 10, 18, 12, 0);
  const t = (id, due, extra = {}) => ({
    id,
    due,
    done: false,
    priority: 'none',
    doneAt: null,
    createdAt: id,
    ...extra
  });
  const list = [
    t('b-old', '2026-11-10'),
    t('c-today', '2026-11-18', { priority: 'low' }),
    t('a-today-high', '2026-11-18', { priority: 'high' }),
    t('d-soon', '2026-11-21'),
    t('e-later', '2026-12-30'),
    t('f-none', null),
    t('g-done', '2026-11-18', { done: true, doneAt: '2026-11-18T08:00:00Z' })
  ];
  assert.deepEqual(
    filterView(list, 'today', now).map(x => x.id),
    ['b-old', 'a-today-high', 'c-today']
  );
  assert.deepEqual(
    filterView(list, 'upcoming', now).map(x => x.id),
    ['d-soon']
  );
  assert.deepEqual(viewCounts(list, now), { today: 3, upcoming: 1, overdue: 1, open: 6, done: 1, all: 7 });
  assert.deepEqual(
    tasksInRange(list, '2026-11-18', '2026-11-22').map(x => x.id),
    ['c-today', 'a-today-high', 'd-soon']
  );
  const mailTask = { done: false, mail: { accountId: 'a', folder: 'INBOX', uid: 5, messageId: '<x@y>' } };
  assert.equal(tasksForMail([mailTask], { accountId: 'a', folder: 'INBOX', uid: 5, messageId: null }).length, 1);
  assert.equal(tasksForMail([mailTask], { accountId: 'a', folder: 'Archiv', uid: 77, messageId: '<x@y>' }).length, 1);
  assert.equal(tasksForMail([mailTask], { accountId: 'b', folder: 'INBOX', uid: 5, messageId: '<x@y>' }).length, 0);
  assert.equal(
    tasksForMail([{ ...mailTask, done: true }], { accountId: 'a', folder: 'INBOX', uid: 5, messageId: null }).length,
    0
  );
});

test('M-03 (audit 2.3.0): "load images" is bound to one message, not to its UID', () => {
  const a = { folder: 'INBOX', uid: 7, uidValidity: '1', messageId: '<a@x>' };
  const key = remoteImageKey('acc1', a);
  assert.equal(remoteImageKey('acc1', { ...a }), key);
  assert.notEqual(remoteImageKey('acc1', { ...a, folder: 'Archiv' }), key, 'same UID in another folder');
  assert.notEqual(remoteImageKey('acc2', a), key, 'same UID in another account');
  assert.notEqual(remoteImageKey('acc1', { ...a, uidValidity: '2' }), key, 'folder recreated');
  assert.equal(remoteImageKey('acc1', null), null);
});

test('Message list windowing: 50,000 rows, measured heights, keyboard targets', async () => {
  const { navigateIndex, renderIndices, rowAt, rowOffsets, scrollToShow, visibleRange } =
    await import('../src/list-window.ts');
  const COUNT = 50_000;
  const keys = Array.from({ length: COUNT }, (_, i) => `k${i}`);
  const measured = new Map([
    ['k0', 100],
    ['k1', 50]
  ]);
  const started = performance.now();
  const offsets = rowOffsets(keys, measured, 70);
  assert.equal(offsets.length, COUNT + 1);
  assert.equal(offsets[1], 100);
  assert.equal(offsets[2], 150);
  assert.equal(offsets[COUNT], 150 + (COUNT - 2) * 70);
  assert.equal(rowAt(offsets, 0), 0);
  assert.equal(rowAt(offsets, 99), 0);
  assert.equal(rowAt(offsets, 100), 1);
  assert.equal(rowAt(offsets, offsets[COUNT] + 500), COUNT - 1);
  // The rendered window stays small wherever the list is scrolled.
  for (const top of [0, offsets[COUNT] / 2, offsets[COUNT] - 900]) {
    const range = visibleRange(offsets, top, 900, 8);
    assert.ok(range.end - range.start <= 900 / 50 + 2 + 16, `window size at ${top}`);
    assert.ok(offsets[range.start] <= top && offsets[range.end] >= Math.min(offsets[COUNT], top + 900));
  }
  assert.deepEqual(visibleRange(rowOffsets([], measured, 70), 0, 900, 8), { start: 0, end: 0 });
  // Focused/selected rows outside the window are kept, sorted and without duplicates.
  assert.deepEqual(renderIndices({ start: 10, end: 13 }, [11, 40_000, -1, 2], COUNT), [2, 10, 11, 12, 40_000]);
  assert.deepEqual(renderIndices({ start: 0, end: 2 }, [COUNT + 5], COUNT), [0, 1]);
  // Scrolling to a row: only when it is not already fully visible.
  assert.equal(scrollToShow(offsets, 0, 0, 900), null);
  assert.equal(scrollToShow(offsets, COUNT - 1, 0, 900), offsets[COUNT] - 900);
  assert.equal(scrollToShow(offsets, 1, 500, 900), 100);
  assert.equal(scrollToShow(offsets, COUNT, 0, 900), null);
  // Keyboard targets.
  assert.equal(navigateIndex('ArrowDown', 0, COUNT, 10), 1);
  assert.equal(navigateIndex('ArrowUp', 0, COUNT, 10), 0);
  assert.equal(navigateIndex('End', 3, COUNT, 10), COUNT - 1);
  assert.equal(navigateIndex('Home', 3, COUNT, 10), 0);
  assert.equal(navigateIndex('PageDown', COUNT - 3, COUNT, 10), COUNT - 1);
  assert.equal(navigateIndex('PageUp', 5, COUNT, 10), 0);
  assert.equal(navigateIndex('x', 5, COUNT, 10), -1);
  assert.equal(navigateIndex('ArrowDown', 0, 0, 10), -1);
  assert.ok(performance.now() - started < 1_000, 'offsets for 50,000 rows are cheap');
});

// ---------- Audit 2026-11-19 (block D): accessibility and privacy regressions ----------
import { readFileSync } from 'node:fs';
const css = name => readFileSync(join(root, 'apps/web/src/styles', name), 'utf8');
function themeTokens(theme) {
  const src = css('tokens.css');
  const block =
    theme === 'dark' ? /:root,\s*\[data-theme='dark'\]\s*\{([^}]*)\}/ : /\[data-theme='light'\]\s*\{([^}]*)\}/;
  const out = {};
  for (const m of block.exec(src)[1].matchAll(/--([\w-]+):\s*(#[0-9a-f]{3,8})/gi)) out[m[1]] = m[2];
  return out;
}
function contrast(a, b) {
  const lum = hex => {
    const h = hex.length === 4 ? hex.replace(/(\w)/g, '$1$1').slice(1) : hex.slice(1, 7);
    const [r, g, bl] = [0, 2, 4].map(i => {
      const c = parseInt(h.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

test('UX-LEV-005/006: status, danger and star colours meet WCAG AA in both themes', () => {
  for (const theme of ['dark', 'light']) {
    const tk = themeTokens(theme);
    assert.ok(tk['on-danger'], `${theme}: --on-danger is defined per theme`);
    assert.ok(contrast(tk['on-danger'], tk.danger) >= 4.5, `${theme}: --on-danger on --danger`);
    for (const name of ['ok', 'warn', 'danger', 'text', 'muted'])
      assert.ok(contrast(tk[name], tk.bg) >= 4.5, `${theme}: --${name} on --bg (${contrast(tk[name], tk.bg)})`);
    assert.ok(contrast(tk.star, tk.bg) >= 3, `${theme}: --star is a non-text marker (3:1)`);
  }
});

test('UX-LEV-004/019/001: focus ring on fields, 24px targets, tasks navigation on small screens', () => {
  const base = css('base.css');
  assert.match(base, /input:focus-visible[\s\S]*?\{\s*outline: var\(--focus-ring\)/);
  assert.match(base, /\.searchbox:focus-within/);
  assert.match(css('mail.css'), /\.folder-more \{[^}]*min-width: var\(--touch-target\)/);
  assert.match(css('dialogs.css'), /\.toast-close \{[^}]*min-height: var\(--touch-target\)/);
  assert.match(
    css('tasks.css'),
    /@media \(max-width: 960px\)[\s\S]*\.calendar-sidebar\.tasks-sidebar \{[^}]*display: flex/
  );
});

test('UX-LEV-014: "Übernehmen" on AI suggestions is "Apply", the keychain button has its own text', async () => {
  const { EN: en } = await import('../src/i18n-en.ts');
  assert.equal(en['Übernehmen'], 'Apply');
  assert.equal(en['In den Schlüsselbund verschieben'], 'Move to keychain');
});

test('UX-LEV-015: date-only due dates are local days, never a clock time', async () => {
  const { dueDateLabel, setFormatLocale } = await import('../src/format.ts');
  setFormatLocale('de-AT');
  const now = new Date(2026, 10, 19, 23, 30);
  assert.equal(dueDateLabel('2026-11-19', now), '19. Nov.');
  assert.doesNotMatch(dueDateLabel('2026-11-19', now), /:/);
  assert.match(dueDateLabel('2027-01-02', now), /2027/);
  assert.equal(dueDateLabel('', now), '–');
});

test('SEC-LEV-006/007: remote CSS images are removed, data: images and other CSS stay', async () => {
  const { stripRemoteCss, isRemoteSrc } = await import('../src/trackers.ts');
  assert.equal(stripRemoteCss('color: red; background: url(https://t.example/p.gif)'), 'color: red;');
  assert.equal(stripRemoteCss("background-image:url( '//t.example/o' );color:blue"), 'color:blue');
  assert.equal(stripRemoteCss('.a{background:url(http://t.example/x)} .b{color:red}'), '.a{} .b{color:red}');
  // CSS escapes and image-set() cannot hide a tracker.
  assert.equal(stripRemoteCss('background: u\\72l(https://t.example/x)'), '');
  assert.equal(stripRemoteCss('background-image: image-set("https://t.example/x" 1x)'), '');
  const inline = 'background: url(data:image/png;base64,AAAA); color: red';
  assert.equal(stripRemoteCss(inline), inline);
  assert.equal(stripRemoteCss('content: "\\201C"'), 'content: "\\201C"');
  assert.equal(stripRemoteCss('x: url(https://t/x); y: "\\3c /style>"'), null);
  assert.equal(isRemoteSrc('https://t.example/p.gif'), true);
  assert.equal(isRemoteSrc('//t.example/p.gif'), true);
  assert.equal(isRemoteSrc('cid:logo'), false);
  assert.equal(isRemoteSrc('data:image/png;base64,AA'), false);
  assert.equal(isRemoteSrc(null), false);
});

test('QA-LEV-004 (A11Y-01): menu keyboard: arrows wrap, Home/End, Escape refocuses, Tab closes', async () => {
  const { menuKeyDown } = await import('../src/ui/menu-keys.ts');
  const doc = { activeElement: null };
  const items = ['a', 'b', 'c'].map(name => ({
    name,
    focus() {
      doc.activeElement = this;
    }
  }));
  const menu = { querySelectorAll: () => items };
  const saved = globalThis.document;
  globalThis.document = doc;
  try {
    const closed = [];
    const press = key => {
      const e = {
        key,
        currentTarget: menu,
        prevented: false,
        preventDefault() {
          this.prevented = true;
        },
        stopPropagation() {}
      };
      menuKeyDown(e, refocus => closed.push(refocus));
      return e;
    };
    items[0].focus();
    press('ArrowDown');
    assert.equal(doc.activeElement.name, 'b');
    press('ArrowUp');
    press('ArrowUp');
    assert.equal(doc.activeElement.name, 'c', 'wraps to the end');
    press('ArrowDown');
    assert.equal(doc.activeElement.name, 'a', 'wraps to the start');
    press('End');
    assert.equal(doc.activeElement.name, 'c');
    press('Home');
    assert.equal(doc.activeElement.name, 'a');
    assert.equal(press('Escape').prevented, true);
    assert.equal(press('Tab').prevented, false, 'Tab moves on normally');
    assert.deepEqual(closed, [true, false]);
  } finally {
    globalThis.document = saved;
  }
});

test('API-LEV-003: every AI error kind of the sidecar and server has its own text', async () => {
  const { readFileSync } = await import('node:fs');
  const { AI_ERROR_CODES, aiErrorText } = await import('../src/ai-errors.ts');
  const kinds = JSON.parse(readFileSync(join(root, 'apps/ai/levuvo_ai/error_kinds.json'), 'utf8'));
  const generic = aiErrorText(undefined, s => s);
  for (const kind of [...kinds.sidecar, ...kinds.server].filter(k => k !== 'internal')) {
    assert.ok(AI_ERROR_CODES.includes(`ai_${kind}`), `no text for ai_${kind}`);
    assert.notEqual(
      aiErrorText(`ai_${kind}`, s => s),
      generic
    );
  }
  assert.equal(
    aiErrorText('ai_internal', s => s),
    generic
  );
  assert.equal(
    aiErrorText('ai_unknown_future', s => s),
    generic
  );
});

test('PERF-LEV-009: bundle suggestions remember skipped messages, back off after errors, evict oldest first', async () => {
  const { createClassifyCache } = await import('../src/bundle-cache.ts');
  let clock = 0;
  const cache = createClassifyCache({ max: 3, baseDelayMs: 1000, maxDelayMs: 4000, now: () => clock });
  const m = uid => ({ uid, folder: 'INBOX' });
  cache.settle('a', [m(1), m(2)], new Map([[1, 'invoice']]));
  assert.equal(cache.get('a', m(1)), 'invoice');
  assert.equal(cache.get('a', m(2)), undefined);
  assert.ok(cache.known('a', m(2)), 'a message the model skipped is not sent again');
  assert.ok(!cache.known('b', m(2)), 'per account');
  assert.ok(!cache.known('a', { uid: 2, folder: 'Archiv' }), 'per folder');
  // LRU: reading 1 keeps it, the oldest unread entry goes.
  cache.get('a', m(1));
  cache.settle('a', [m(3), m(4)], new Map());
  assert.equal(cache.size, 3);
  assert.ok(cache.known('a', m(1)) && !cache.known('a', m(2)));
  // Backoff doubles up to the limit and ends with the next success.
  assert.ok(cache.ready('a'));
  cache.fail('a');
  assert.ok(!cache.ready('a'));
  clock = 1000;
  assert.ok(cache.ready('a'));
  cache.fail('a');
  clock = 2999;
  assert.ok(!cache.ready('a'));
  clock = 3000;
  cache.fail('a');
  cache.fail('a');
  clock = 3000 + 3999;
  assert.ok(!cache.ready('a'), 'capped at maxDelayMs');
  clock = 3000 + 4000;
  assert.ok(cache.ready('a'));
  cache.settle('a', [m(5)], new Map());
  cache.fail('a');
  clock += 1000;
  assert.ok(cache.ready('a'), 'a success resets the backoff');
});
