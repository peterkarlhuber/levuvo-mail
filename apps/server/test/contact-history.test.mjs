// Contact history (notes, linked tasks) and video call links.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMailServer } from '../src/app.mjs';
import { BACKUP_FILES } from '../src/backup.mjs';
import { contactAddress, createContactNotes } from '../src/contact-notes.mjs';
import { addressOf, tasksForContact } from '../src/routes-contact-history.mjs';
import { validateTask } from '../src/tasks.mjs';
import {
  DEFAULT_VIDEO_SERVER,
  newMeetingLink,
  normalizeVideoServer,
  videoRoomName,
  videoServerOf
} from '../src/video-call.mjs';

const SECRET = 'f'.repeat(64);
const PORT = 4781;
const HOST = `127.0.0.1:${PORT}`;
const GET = { host: HOST, cookie: `levuvo_desktop_session=${SECRET}` };
const POST = { ...GET, origin: `http://${HOST}`, 'content-type': 'application/json' };

const vault = () => {
  const m = new Map();
  return {
    available: true,
    get: (i, k) => m.get(`${i}:${k}`) || '',
    set: (i, k, v) => m.set(`${i}:${k}`, v),
    delete: (i, k) => m.delete(`${i}:${k}`)
  };
};
const tmpDir = t => {
  const dir = mkdtempSync(join(tmpdir(), 'lv-crm-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

// ------------------------------------------------------------------ video calls
test('Video calls: EU server by default, own https server optional, strict validation', () => {
  assert.equal(DEFAULT_VIDEO_SERVER, 'https://meet.ffmuc.net');
  assert.equal(normalizeVideoServer(''), '');
  assert.equal(normalizeVideoServer('  '), '');
  assert.equal(normalizeVideoServer('https://meet.ffmuc.net/'), '', 'the default is stored as empty');
  assert.equal(normalizeVideoServer('jitsi.example.org'), 'https://jitsi.example.org');
  assert.equal(normalizeVideoServer('https://Jitsi.Example.org:8443/meet/'), 'https://jitsi.example.org:8443/meet');
  for (const bad of [
    'http://jitsi.example.org',
    'https://user:pw@jitsi.example.org',
    'https://jitsi.example.org/?a=1',
    'https://jitsi.example.org/#x',
    'javascript:alert(1)',
    'https://localhost',
    'https://jitsi.example.org/a b',
    'ftp://jitsi.example.org',
    `https://${'a'.repeat(300)}.org`
  ])
    assert.throws(() => normalizeVideoServer(bad), { statusCode: 400 }, bad);
  assert.equal(videoServerOf({}), DEFAULT_VIDEO_SERVER);
  assert.equal(videoServerOf({ videoServer: 'http://bad' }), DEFAULT_VIDEO_SERVER, 'a broken setting falls back');
  assert.equal(videoServerOf({ videoServer: 'https://jitsi.example.org' }), 'https://jitsi.example.org');
});

test('Video calls: room names are random and unguessable (125 bits)', () => {
  const names = new Set(Array.from({ length: 200 }, () => videoRoomName()));
  assert.equal(names.size, 200);
  for (const n of names) assert.match(n, /^levuvo-(?:[a-km-np-z2-9]{5}-){4}[a-km-np-z2-9]{5}$/);
  const fixed = videoRoomName(n => Buffer.alloc(n, 0));
  assert.equal(fixed, 'levuvo-aaaaa-aaaaa-aaaaa-aaaaa-aaaaa');
  const link = newMeetingLink({ videoServer: 'https://jitsi.example.org/meet' });
  assert.equal(link.provider, 'jitsi');
  assert.equal(link.server, 'https://jitsi.example.org/meet');
  assert.equal(link.url, `https://jitsi.example.org/meet/${link.room}`);
});

// ------------------------------------------------------------------ notes
test('Contact notes: stored encrypted per address, edit, delete, forget', async t => {
  const file = join(tmpDir(t), 'contact-notes.json');
  const keys = vault();
  let clock = Date.parse('2026-11-19T10:00:00Z');
  const now = () => new Date((clock += 1000));
  const notes = await createContactNotes({ filename: file, vault: keys, now });
  const a = await notes.save({ email: ' Anna@Example.org ', text: 'Mag Kaffee ohne Zucker.\r\nRuft gern an.' });
  assert.equal(a.email, 'anna@example.org');
  assert.equal(a.text, 'Mag Kaffee ohne Zucker.\nRuft gern an.');
  await notes.save({ email: 'anna@example.org', text: 'Angebot bis Freitag.' });
  await notes.save({ email: 'ben@example.org', text: 'Ben-Notiz' });
  await notes.flush();
  const raw = readFileSync(file, 'utf8');
  assert.match(raw, /^\{"v":1/);
  assert.ok(!raw.includes('Kaffee') && !raw.includes('anna@example.org'), 'nothing readable on disk');

  const list = notes.list('ANNA@example.org');
  assert.deepEqual(
    list.map(n => n.text),
    ['Angebot bis Freitag.', 'Mag Kaffee ohne Zucker.\nRuft gern an.']
  );
  const edited = await notes.save({ id: a.id, text: 'Mag Tee.' });
  assert.equal(edited.text, 'Mag Tee.');
  assert.equal(edited.createdAt, a.createdAt);
  assert.notEqual(edited.updatedAt, a.updatedAt);

  // Opens again with the same key.
  const again = await createContactNotes({ filename: file, vault: keys });
  assert.equal(again.list('anna@example.org').length, 2);
  assert.equal(again.exportAll().length, 3);

  await notes.remove(a.id);
  assert.equal(notes.list('anna@example.org').length, 1);
  assert.equal(await notes.forget('anna@example.org'), 1);
  assert.deepEqual(notes.list('anna@example.org'), []);
  assert.equal(notes.list('ben@example.org').length, 1);

  await assert.rejects(notes.save({ email: 'anna@example.org', text: '   ' }), /leer/);
  await assert.rejects(notes.save({ email: 'anna@example.org', text: 'x'.repeat(5001) }), /5000/);
  await assert.rejects(notes.save({ email: 'keine-adresse', text: 'x' }), { code: 'contact_address_invalid' });
  await assert.rejects(notes.save({ id: 'missing', text: 'x' }), { statusCode: 404 });
  assert.throws(() => contactAddress('a b@example.org'));
});

test('Contact notes: fail closed without keychain or with a wrong key, file untouched', async t => {
  const dir = tmpDir(t);
  const file = join(dir, 'contact-notes.json');
  await assert.rejects(createContactNotes({ filename: file, vault: { available: false } }), {
    code: 'contact_notes_locked',
    statusCode: 423
  });
  const notes = await createContactNotes({ filename: file, vault: vault() });
  await notes.save({ email: 'anna@example.org', text: 'geheim' });
  await notes.flush();
  const before = readFileSync(file, 'utf8');
  // Another keychain (key lost): no new key for the existing file, nothing overwritten.
  const other = vault();
  await assert.rejects(createContactNotes({ filename: file, vault: other }), { statusCode: 423 });
  assert.equal(other.get('local', 'contact-notes-key'), '');
  const wrong = vault();
  wrong.set('local', 'contact-notes-key', 'a'.repeat(64));
  await assert.rejects(createContactNotes({ filename: file, vault: wrong }), { statusCode: 423 });
  assert.equal(readFileSync(file, 'utf8'), before);
  writeFileSync(file, 'kaputt');
  await assert.rejects(createContactNotes({ filename: file, vault: wrong }), { statusCode: 423 });
});

test('Contact notes are part of the backup (encrypted with their own key)', () => {
  assert.deepEqual(BACKUP_FILES['contact-notes.json'], { kind: 'json', encrypted: 'contact-notes-key' });
});

// ------------------------------------------------------------------ tasks
test('Tasks: optional contact link, matched by address or by the mail they came from', () => {
  const task = validateTask({ title: 'Angebot schicken', contact: { email: ' Anna@Example.org ', name: 'Anna' } });
  assert.deepEqual(task.contact, { email: 'anna@example.org', name: 'Anna' });
  assert.equal(validateTask({ title: 'x' }).contact, null);
  assert.equal(validateTask({ title: 'x', contact: { email: '' } }).contact, null);
  assert.throws(() => validateTask({ title: 'x', contact: { email: 'kein' } }), /Kontakt/);
  assert.equal(addressOf('Anna Berger <Anna@Example.org>'), 'anna@example.org');
  assert.equal(addressOf('anna@example.org'), 'anna@example.org');
  assert.equal(addressOf(''), '');
  const tasks = [
    { id: '1', contact: { email: 'anna@example.org', name: 'Anna' }, mail: null },
    { id: '2', contact: null, mail: { from: 'Anna <anna@example.org>' } },
    { id: '3', contact: null, mail: { from: 'Ben <ben@example.org>' } },
    { id: '4', contact: null, mail: null }
  ];
  assert.deepEqual(
    tasksForContact(tasks, 'anna@example.org').map(t => t.id),
    ['1', '2']
  );
});

// ------------------------------------------------------------------ API
async function server(t) {
  const dir = tmpDir(t);
  const s = await createMailServer({
    desktop: true,
    sessionSecret: SECRET,
    env: {},
    vault: vault(),
    accountsFile: join(dir, 'accounts.json'),
    staticRoot: join(dir, 'dist'),
    smtpFactory: () => ({ verify: async () => {}, close() {} }),
    watch: false,
    background: false
  });
  s.setPortForTesting(PORT);
  t.after(() => s.close());
  return { s, dir };
}
const post = (s, url, payload, action) =>
  s.api.inject({ method: 'POST', url, headers: { ...POST, 'x-levuvo-action': action }, payload });
const get = (s, url) => s.api.inject({ method: 'GET', url, headers: GET });

test('API: video settings and links, no network involved', async t => {
  const { s } = await server(t);
  const first = (await get(s, '/api/video')).json();
  assert.deepEqual(first, {
    provider: 'jitsi',
    server: DEFAULT_VIDEO_SERVER,
    custom: '',
    defaultServer: DEFAULT_VIDEO_SERVER
  });
  const link = (await post(s, '/api/video/link', {}, 'mail-v1')).json();
  assert.ok(link.url.startsWith(`${DEFAULT_VIDEO_SERVER}/levuvo-`));
  assert.equal((await post(s, '/api/video/link', {}, 'contacts-v1')).statusCode, 403, 'action header required');
  const bad = await post(s, '/api/video/settings', { server: 'http://jitsi.example.org' }, 'mail-v1');
  assert.equal(bad.statusCode, 400);
  const saved = (await post(s, '/api/video/settings', { server: 'jitsi.example.org' }, 'mail-v1')).json();
  assert.equal(saved.server, 'https://jitsi.example.org');
  assert.equal(saved.custom, 'https://jitsi.example.org');
  assert.equal((await get(s, '/api/app-settings')).json().videoServer, 'https://jitsi.example.org');
  const own = (await post(s, '/api/video/link', {}, 'mail-v1')).json();
  assert.ok(own.url.startsWith('https://jitsi.example.org/levuvo-'));
  const reset = (await post(s, '/api/video/settings', { server: '' }, 'mail-v1')).json();
  assert.equal(reset.server, DEFAULT_VIDEO_SERVER);
});

test('API: contact history returns notes and linked tasks; notes can be saved and forgotten', async t => {
  const { s, dir } = await server(t);
  const save = await post(
    s,
    '/api/contact-history/notes/save',
    { email: 'Anna@Example.org', text: 'Erstes Gespräch: Interesse an Angebot.' },
    'contacts-v1'
  );
  assert.equal(save.statusCode, 200, save.body);
  const note = save.json().note;
  assert.equal(
    (await post(s, '/api/contact-history/notes/save', { email: 'a@b.at', text: 'x' }, 'mail-v1')).statusCode,
    403
  );
  const task = await post(
    s,
    '/api/tasks/save',
    { task: { title: 'Angebot schicken', contact: { email: 'anna@example.org', name: 'Anna' } } },
    'mail-v1'
  );
  assert.equal(task.statusCode, 200, task.body);
  await post(s, '/api/tasks/save', { task: { title: 'Fremd' } }, 'mail-v1');

  const history = (await get(s, '/api/contact-history?email=anna%40example.org')).json();
  assert.equal(history.email, 'anna@example.org');
  assert.deepEqual(
    history.notes.map(n => n.id),
    [note.id]
  );
  assert.deepEqual(
    history.tasks.map(x => x.title),
    ['Angebot schicken']
  );
  assert.equal(history.tasks[0].sync, undefined, 'sync internals stay on the server');
  assert.equal((await get(s, '/api/contact-history?email=kein')).statusCode, 400);

  const raw = readFileSync(join(dir, 'contact-notes.json'), 'utf8');
  assert.ok(!raw.includes('Angebot'), 'encrypted on disk');

  const forget = (await post(s, '/api/contact-history/forget', { email: 'anna@example.org' }, 'contacts-v1')).json();
  assert.equal(forget.deleted, 1);
  assert.deepEqual((await get(s, '/api/contact-history?email=anna%40example.org')).json().notes, []);
});

test('API: without keychain the notes report their state, tasks still work', async t => {
  const dir = tmpDir(t);
  const s = await createMailServer({
    desktop: true,
    sessionSecret: SECRET,
    env: {},
    vault: { available: false, get: () => '', set() {}, delete() {} },
    accountsFile: join(dir, 'accounts.json'),
    staticRoot: join(dir, 'dist'),
    watch: false,
    background: false
  });
  s.setPortForTesting(PORT);
  t.after(() => s.close());
  const history = (await get(s, '/api/contact-history?email=anna%40example.org')).json();
  assert.deepEqual(history.notes, []);
  assert.equal(history.notesError.code, 'contact_notes_locked');
  const save = await post(
    s,
    '/api/contact-history/notes/save',
    { email: 'anna@example.org', text: 'x' },
    'contacts-v1'
  );
  assert.equal(save.statusCode, 423);
});
