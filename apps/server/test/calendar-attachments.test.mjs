import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as C from '../src/calendar-model.mjs';
import { createMailServer } from '../src/app.mjs';
import { createCloudService } from '../src/cloud.mjs';

const b64 = text => Buffer.from(text).toString('base64');
const base = { summary: 'Planung', start: '2026-11-20T09:00', end: '2026-11-20T10:00', tzid: 'Europe/Vienna' };
const file = (name, text, type = 'text/plain') => ({ name, type, data: b64(text) });

test('Attachments: stored inline in the event, listed without content, kept, removed and downloaded', () => {
  const model = C.validateEventInput({
    ...base,
    attachments: [file('Agenda.txt', 'Punkt 1'), file('../x/Plan.pdf', '%PDF', 'application/pdf')]
  });
  const { ics } = C.createEventIcs({ ...model, attachments: C.resolveAttachments(null, null, model.attachments) });
  assert.match(
    ics.replace(/\r\n /g, ''),
    /ATTACH;ENCODING=BASE64;FMTTYPE=text\/plain;X-FILENAME=Agenda.txt;VALUE=BINARY:UHVua3QgMQ==/
  );
  const [occ] = C.expandObject(ics, '2026-11-01', '2026-12-01');
  assert.deepEqual(occ.attachments, [
    { id: '0', name: 'Agenda.txt', type: 'text/plain', size: 7 },
    { id: '1', name: 'Plan.pdf', type: 'application/pdf', size: 4 }
  ]);
  assert.equal(C.attachmentContent(ics, null, '1').content.toString(), '%PDF');
  assert.throws(() => C.attachmentContent(ics, null, '7'), { code: 'attachment_missing' });

  // Saving without an attachment list (e.g. drag & drop) leaves the files alone.
  const moved = C.updateEventIcs(
    ics,
    C.validateEventInput({ ...base, start: '2026-11-21T09:00', end: '2026-11-21T10:00' })
  );
  assert.equal(C.expandObject(moved, '2026-11-01', '2026-12-01')[0].attachments.length, 2);

  // Keep the second one, drop the first, add a new one.
  const edit = C.validateEventInput({ ...base, attachments: [{ id: '1' }, file('Notiz.txt', 'neu')] });
  const updated = C.updateEventIcs(ics, { ...edit, attachments: C.resolveAttachments(ics, null, edit.attachments) });
  assert.deepEqual(
    C.expandObject(updated, '2026-11-01', '2026-12-01')[0].attachments.map(a => a.name),
    ['Plan.pdf', 'Notiz.txt']
  );
  assert.throws(() => C.resolveAttachments(ics, null, [{ id: '9' }]), { code: 'attachment_missing' });
});

test('Attachments: one occurrence of a series starts with the series files; invitations carry them as mail attachments', () => {
  const model = C.validateEventInput({
    ...base,
    rrule: { freq: 'WEEKLY', interval: 1, count: 3 },
    attachments: [file('Agenda.txt', 'A')]
  });
  const { ics } = C.createEventIcs({ ...model, attachments: C.resolveAttachments(null, null, model.attachments) });
  const occ = C.expandObject(ics, '2026-11-01', '2026-12-31');
  const one = C.updateEventIcs(
    ics,
    C.validateEventInput({ ...base, summary: 'Nur heute', start: '2026-11-27T09:00', end: '2026-11-27T10:00' }),
    {
      scope: 'this',
      recurrenceId: occ[1].recurrenceId
    }
  );
  const after = C.expandObject(one, '2026-11-01', '2026-12-31');
  assert.equal(after[1].summary, 'Nur heute');
  assert.deepEqual(
    after[1].attachments.map(a => a.name),
    ['Agenda.txt']
  );
  assert.equal(C.attachmentContent(one, after[1].recurrenceId, '0').content.toString(), 'A');

  const request = C.buildOrganizerMessage(ics, 'REQUEST');
  assert.doesNotMatch(request, /ATTACH/);
  const mail = C.inlineAttachments(ics);
  assert.equal(mail[0].filename, 'Agenda.txt');
  assert.equal(mail[0].content.toString(), 'A');
});

test('Attachments: links from other apps are shown, only web links can be opened; limits and names are checked', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:x1',
    'DTSTART:20261120T090000Z',
    'DTEND:20261120T100000Z',
    'SUMMARY:Extern',
    'ATTACH;FMTTYPE=application/pdf;FILENAME=/Bericht.pdf:https://cloud.example/f/12',
    'ATTACH:cid:part1@example',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
  const [occ] = C.expandObject(ics, '2026-11-01', '2026-12-01');
  assert.deepEqual(occ.attachments, [
    { id: '0', name: 'Bericht.pdf', type: 'application/pdf', size: 0, uri: 'https://cloud.example/f/12' },
    { id: '1', name: 'Anhang 2', type: 'application/octet-stream', size: 0 }
  ]);
  assert.equal(C.safeFilename('..\\\\evil<>.exe'), 'evil.exe');
  assert.equal(C.safeFilename('   '), 'Anhang');
  assert.equal(C.safeMimeType('text/html; x'), 'application/octet-stream');
  const big = 'A'.repeat(Math.ceil((C.ATTACH_MAX_FILE * 4) / 3) + 8);
  assert.throws(() => C.validateEventInput({ ...base, attachments: [{ name: 'gross.bin', data: big }] }), {
    code: 'attachment_too_large'
  });
  assert.throws(() => C.validateEventInput({ ...base, attachments: [{ name: 'x', data: 'no base64!' }] }), {
    code: 'event_invalid'
  });
  const four = 'A'.repeat(Math.floor((4 * 1024 * 1024 * 4) / 3));
  assert.throws(
    () => C.validateEventInput({ ...base, attachments: [1, 2, 3].map(i => ({ name: `${i}.bin`, data: four })) }),
    { code: 'attachment_too_large' }
  );
});

// ------------------------------------------------------------------ through the API (device calendar)
const SECRET = 'f'.repeat(64);
const HOST = '127.0.0.1:4778';
const GET = { host: HOST, cookie: `levuvo_desktop_session=${SECRET}` };
const POST = { ...GET, origin: `http://${HOST}`, 'content-type': 'application/json', 'x-levuvo-action': 'calendar-v1' };
function vault() {
  const m = new Map();
  return {
    available: true,
    get: (i, k) => m.get(`${i}:${k}`) || '',
    set: (i, k, v) => m.set(`${i}:${k}`, v),
    delete: (i, k) => m.delete(`${i}:${k}`)
  };
}

test('Attachments API: add, show, preview, download, remove and move with the device calendar', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'lv-att-'));
  const s = await createMailServer({
    desktop: true,
    sessionSecret: SECRET,
    env: {},
    vault: vault(),
    accountsFile: join(dir, 'accounts.json'),
    staticRoot: join(dir, 'dist'),
    watch: false
  });
  s.setPortForTesting(4778);
  t.after(async () => {
    await s.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const post = async (url, payload) => s.api.inject({ method: 'POST', url, headers: POST, payload });
  const range = '?from=2026-11-01T00:00:00Z&to=2026-12-01T00:00:00Z';
  const events = async () =>
    (await s.api.inject({ method: 'GET', url: `/api/calendar/events${range}`, headers: GET })).json().events;

  const cals = (await s.api.inject({ method: 'GET', url: '/api/calendar/calendars', headers: GET })).json().calendars;
  const local = cals.find(c => c.accountId === 'local');
  // A file larger than the normal 64 KB request limit goes through.
  const pdf = Buffer.alloc(300_000, 7);
  const saved = await post('/api/calendar/events/save', {
    accountId: 'local',
    calendarUrl: local.url,
    event: { ...base, attachments: [{ name: 'Plan.pdf', type: 'application/pdf', data: pdf.toString('base64') }] }
  });
  assert.equal(saved.statusCode, 200, saved.body);
  let [ev] = await events();
  assert.deepEqual(ev.attachments, [{ id: '0', name: 'Plan.pdf', type: 'application/pdf', size: 300_000 }]);

  const q = `accountId=local&url=${encodeURIComponent(ev.url)}&id=0`;
  const dl = await s.api.inject({ method: 'GET', url: `/api/calendar/events/attachment?${q}`, headers: GET });
  assert.equal(dl.statusCode, 200);
  assert.equal(dl.headers['content-type'], 'application/octet-stream');
  assert.match(dl.headers['content-disposition'], /^attachment;.*Plan\.pdf/);
  assert.deepEqual(dl.rawPayload, pdf);
  const inline = await s.api.inject({
    method: 'GET',
    url: `/api/calendar/events/attachment?${q}&inline=1`,
    headers: GET
  });
  assert.equal(inline.headers['content-type'], 'application/pdf');
  const missing = await s.api.inject({
    method: 'GET',
    url: `/api/calendar/events/attachment?accountId=local&url=${encodeURIComponent(ev.url)}&id=4`,
    headers: GET
  });
  assert.equal(missing.statusCode, 404);
  // Without the desktop session nothing is handed out.
  const anon = await s.api.inject({
    method: 'GET',
    url: `/api/calendar/events/attachment?${q}`,
    headers: { host: HOST }
  });
  assert.equal(anon.statusCode, 401);

  // Move to a second device calendar: the file goes along.
  const second = (await post('/api/calendar/calendars/create', { accountId: 'local', name: 'Projekt' })).json();
  const move = await post('/api/calendar/events/save', {
    accountId: 'local',
    calendarUrl: second.url,
    url: ev.url,
    etag: ev.etag,
    targetAccountId: 'local',
    sourceCalendarUrl: ev.calendarUrl,
    event: { ...base, attachments: [{ id: '0' }, { name: 'Notiz.txt', type: 'text/plain', data: b64('hallo') }] }
  });
  assert.equal(move.statusCode, 200, move.body);
  [ev] = await events();
  assert.equal(ev.calendarUrl, second.url);
  assert.deepEqual(
    ev.attachments.map(a => [a.name, a.size]),
    [
      ['Plan.pdf', 300_000],
      ['Notiz.txt', 5]
    ]
  );

  // Remove one.
  const removed = await post('/api/calendar/events/save', {
    accountId: 'local',
    calendarUrl: second.url,
    url: ev.url,
    etag: ev.etag,
    event: { ...base, attachments: [{ id: '1' }] }
  });
  assert.equal(removed.statusCode, 200, removed.body);
  [ev] = await events();
  assert.deepEqual(
    ev.attachments.map(a => a.name),
    ['Notiz.txt']
  );
});

// ------------------------------------------------------------------ Microsoft 365 / Google
const E = {
  graph: 'https://graph.test/v1.0',
  googleCalendar: 'https://gcal.test/v3',
  googlePeople: 'https://people.test/v1'
};
function fakeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const key = `${init.method || 'GET'} ${u.origin}${u.pathname}`;
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ key, url: u, body });
    const handler = routes[key];
    if (!handler) return new Response(JSON.stringify({ error: 'nf' }), { status: 404 });
    const [status, data] = await handler({ url: u, body });
    return status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(data), { status });
  };
  return { fetchImpl, calls };
}
const prefs = () => {
  let v = { hidden: [], colors: {} };
  return { get: () => v, save: async n => (v = n) };
};

test('Attachments: Microsoft 365 files are listed, downloaded, added and removed on the event', async () => {
  const ms = { id: 'm1', label: 'Arbeit', auth: 'oauth2', imap: { oauth: 'microsoft', user: 'me@firma.test' } };
  const { fetchImpl, calls } = fakeFetch({
    [`GET ${E.graph}/me/calendars`]: () => [200, { value: [{ id: 'CAL1', name: 'Kalender', canEdit: true }] }],
    [`GET ${E.graph}/me/events/EV1/attachments`]: () => [
      200,
      {
        value: [
          {
            '@odata.type': '#microsoft.graph.fileAttachment',
            id: 'A1',
            name: 'Agenda.docx',
            contentType: 'application/msword',
            size: 12
          },
          { '@odata.type': '#microsoft.graph.itemAttachment', id: 'A2', name: 'Mail', size: 99 }
        ]
      }
    ],
    [`GET ${E.graph}/me/events/EV1/attachments/A1`]: () => [
      200,
      { id: 'A1', name: 'Agenda.docx', contentType: 'application/msword', contentBytes: b64('docx') }
    ],
    [`PATCH ${E.graph}/me/events/EV1`]: () => [200, {}],
    [`DELETE ${E.graph}/me/events/EV1/attachments/A1`]: () => [204],
    [`POST ${E.graph}/me/events/EV1/attachments`]: () => [201, { id: 'A3' }]
  });
  const cloud = createCloudService({
    accounts: () => [ms],
    prefs: prefs(),
    fetchImpl,
    endpoints: E,
    token: async () => 't'
  });
  const where = { accountId: 'm1', calendarUrl: 'cloud:CAL1', url: 'cloud:EV1' };
  assert.deepEqual(await cloud.attachments(where), [
    { id: 'A1', name: 'Agenda.docx', type: 'application/msword', size: 12 }
  ]);
  assert.equal((await cloud.attachment({ ...where, id: 'A1' })).content.toString(), 'docx');

  const model = C.validateEventInput({ ...base, attachments: [file('Neu.txt', 'neu')] });
  await cloud.saveEvent({ ...where, model, notify: false });
  const posted = calls.find(c => c.key === `POST ${E.graph}/me/events/EV1/attachments`);
  assert.deepEqual(posted.body, {
    '@odata.type': '#microsoft.graph.fileAttachment',
    name: 'Neu.txt',
    contentType: 'text/plain',
    contentBytes: b64('neu')
  });
  assert.ok(
    calls.some(c => c.key === `DELETE ${E.graph}/me/events/EV1/attachments/A1`),
    'removed file is deleted'
  );

  const tooBig = C.validateEventInput({ ...base, attachments: [{ name: 'gross.bin', data: 'A'.repeat(4_200_000) }] });
  await assert.rejects(cloud.saveEvent({ ...where, model: tooBig, notify: false }), { code: 'attachment_too_large' });
});

test('Attachments: Google shows Drive links, keeps or removes them and explains that files go via Drive', async () => {
  const gg = { id: 'g1', label: 'Privat', auth: 'oauth2', imap: { oauth: 'google', user: 'me@gmail.test' } };
  const event = {
    id: 'GE1',
    etag: '"1"',
    summary: 'Termin',
    start: { dateTime: '2026-11-20T08:00:00Z' },
    end: { dateTime: '2026-11-20T09:00:00Z' },
    attachments: [
      { fileUrl: 'https://drive.google.com/file/d/1', title: 'Folien', mimeType: 'application/pdf', fileId: '1' },
      {
        fileUrl: 'https://drive.google.com/file/d/2',
        title: 'Tabelle',
        mimeType: 'application/vnd.ms-excel',
        fileId: '2'
      }
    ]
  };
  const { fetchImpl, calls } = fakeFetch({
    [`GET ${E.googleCalendar}/users/me/calendarList`]: () => [
      200,
      { items: [{ id: 'primary', summary: 'Ich', accessRole: 'owner' }] }
    ],
    [`GET ${E.googleCalendar}/calendars/primary/events`]: () => [200, { items: [event] }],
    [`GET ${E.googleCalendar}/calendars/primary/events/GE1`]: () => [200, event],
    [`PATCH ${E.googleCalendar}/calendars/primary/events/GE1`]: () => [200, event]
  });
  const cloud = createCloudService({
    accounts: () => [gg],
    prefs: prefs(),
    fetchImpl,
    endpoints: E,
    token: async () => 't'
  });
  const { events } = await cloud.events(Date.parse('2026-11-01'), Date.parse('2026-12-01'));
  assert.deepEqual(events[0].attachments[0], {
    id: '0',
    name: 'Folien',
    type: 'application/pdf',
    size: 0,
    uri: 'https://drive.google.com/file/d/1'
  });
  const where = { accountId: 'g1', calendarUrl: 'cloud:primary', url: 'cloud:GE1' };
  await cloud.saveEvent({
    ...where,
    model: C.validateEventInput({ ...base, attachments: [{ id: '1' }] }),
    notify: false
  });
  const patch = calls.find(c => c.key.startsWith('PATCH'));
  assert.equal(patch.url.searchParams.get('supportsAttachments'), 'true');
  assert.deepEqual(
    patch.body.attachments.map(a => a.title),
    ['Tabelle']
  );
  await assert.rejects(
    cloud.saveEvent({
      ...where,
      model: C.validateEventInput({ ...base, attachments: [file('a.txt', 'a')] }),
      notify: false
    }),
    { code: 'attachment_unsupported' }
  );
});
