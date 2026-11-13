// Unit tests for UI logic that does not need a browser (run with Node's type stripping).
import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addDays, eventRange, layoutDay, parseYmd, startOfWeek, ymd } from '../src/calendar-utils.ts';
import { orderFolders } from '../src/folder-utils.ts';
import { missingTranslations, loadDictionary } from '../../../scripts/check-i18n.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');

test('Englische Oberfläche: jeder Text hat eine Übersetzung mit denselben Platzhaltern', () => {
  assert.deepEqual(missingTranslations(root), []);
  const en = loadDictionary(root);
  for (const [de, english] of Object.entries(en)) {
    const vars = s => (s.match(/\{\w+\}/g) || []).sort().join();
    assert.equal(vars(english), vars(de), `Platzhalter: ${de}`);
    assert.ok(english.trim(), `leer: ${de}`);
  }
});

test('Kalender: ganztägige Termine (exklusives Ende), Wochenbeginn Montag', () => {
  const r = eventRange({ start: '2026-11-13', end: '2026-11-15', allDay: true });
  assert.equal(ymd(r.start), '2026-11-13');
  assert.equal(ymd(r.end), '2026-11-15');
  const single = eventRange({ start: '2026-11-13', end: '2026-11-13', allDay: true });
  assert.equal(ymd(single.end), '2026-11-14');
  assert.equal(ymd(startOfWeek(parseYmd('2026-11-15'))), '2026-11-09'); // Sunday → Monday before
  assert.equal(ymd(startOfWeek(parseYmd('2026-11-09'))), '2026-11-09');
  assert.equal(ymd(addDays(parseYmd('2026-03-28'), 2)), '2026-03-30'); // across DST
});

test('Kalender: überlappende Termine werden nebeneinander angeordnet', () => {
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

test('Ordner: Systemordner zuerst, Unterordner eingerückt', () => {
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

test('Vorlagen: Platzhalter werden ersetzt, unbekannte bleiben sichtbar, HTML wird maskiert', async () => {
  const { fillTemplate, nameParts } = await import('../src/templates.ts');
  const vars = { ...nameParts('Anna Berger'), sender: 'Peter <Chef>', date: '13. November 2026' };
  assert.equal(
    fillTemplate('<p>Hallo {Vorname} {Nachname}, {Datum} – {Absender} · {Firma}</p>', vars),
    '<p>Hallo Anna Berger, 13. November 2026 – Peter &lt;Chef&gt; · {Firma}</p>'
  );
  assert.equal(fillTemplate('Dear {FirstName}', {}), 'Dear {FirstName}');
  assert.deepEqual(nameParts('anna@x.at'), {});
});

test('Kalender: Verschieben per Drag & Drop behält Dauer, Monatsübersicht beginnt am Montag', async () => {
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

test('Befehlspalette: Treffer unabhängig von Umlauten, Wortanfänge zuerst', async () => {
  const { matchScore, normalize } = await import('../src/command-bus.ts');
  assert.equal(normalize('Entwürfe'), 'entwurfe');
  assert.ok(matchScore('entw', 'Entwürfe') > matchScore('entw', 'Neue Entwürfe-Vorlage'));
  assert.equal(matchScore('xyz', 'Posteingang'), -1);
  assert.ok(matchScore('dunk', 'Dunkles Design', 'theme dark') > 0);
  assert.ok(matchScore('dark', 'Dunkles Design', 'theme dark') > 0);
  assert.ok(matchScore('neu mail', 'Neue E-Mail schreiben') > 0);
  assert.equal(matchScore('', 'egal'), 0);
});
