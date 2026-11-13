// Calendar "on this device": works without any account. Events are stored as iCalendar objects
// (same model as CalDAV, so series, reminders and invitations behave identically), encrypted with
// AES-256-GCM; the key lives in the OS keychain. Without a keychain the file stays readable only
// for the user (0600).
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ICAL from 'ical.js';
import { expandObject, parseIcs } from './calendar-model.mjs';

export const LOCAL_ACCOUNT = 'local';
export const LOCAL_PREFIX = 'local:';
export const LOCAL_LABEL = 'Auf diesem Gerät';
const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });
const MAX_OBJECTS = 20_000;
const MAX_CALENDARS = 20;
const COLORS = ['#7c6cf2', '#1a8f5a', '#d9822b', '#c2417a', '#2f8fb8'];

export const isLocalCalendar = url => String(url || '').startsWith(LOCAL_PREFIX);

function encrypt(key, text) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return JSON.stringify({
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: body.toString('base64')
  });
}
function decrypt(key, raw) {
  const box = JSON.parse(raw);
  if (box.v !== 1) return raw;
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]).toString('utf8');
}

/**
 * @param {object} o
 * @param {string} o.filename
 * @param {{ available: boolean, get(id, kind): string, set(id, kind, v): void } | null} o.vault
 */
export async function createLocalCalendar({ filename, vault }) {
  let raw = null;
  try {
    raw = await readFile(filename, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const encrypted = raw !== null && raw.trimStart().startsWith('{"v":1');
  let key = null;
  if (vault?.available) {
    try {
      let hex = vault.get(LOCAL_ACCOUNT, 'calendar-key');
      // A new key only for a calendar that has no encrypted data yet: a fresh key for an existing
      // encrypted file would make it unreadable and the next save would overwrite every event.
      if (!hex && !encrypted) {
        hex = randomBytes(32).toString('hex');
        vault.set(LOCAL_ACCOUNT, 'calendar-key', hex);
      }
      key = hex ? Buffer.from(hex, 'hex') : null;
    } catch {
      key = null;
    }
  }
  let state = { calendars: [], objects: [] };
  if (encrypted) {
    // Never fall back to an empty calendar here: the file stays untouched until the key is back.
    if (!key) throw fail('Der lokale Kalender ist gesperrt (Schlüsselbund nicht verfügbar).', 'local_locked', 423);
    let text;
    try {
      text = decrypt(key, raw);
    } catch {
      throw fail(
        'Der lokale Kalender lässt sich mit dem Schlüssel aus dem Schlüsselbund nicht öffnen.',
        'local_locked',
        423
      );
    }
    state = { calendars: [], objects: [], ...JSON.parse(text) };
  } else if (raw !== null) {
    try {
      state = { calendars: [], objects: [], ...JSON.parse(raw) };
    } catch {
      // Unreadable plain file: keep a copy before starting over, so nothing is lost silently.
      await rename(filename, `${filename}.corrupt-${Date.now()}`);
      state = { calendars: [], objects: [] };
    }
  }
  if (!state.calendars.length)
    state.calendars.push({ id: randomUUID(), name: 'Persönlich', color: COLORS[0], hidden: false });

  let writing = Promise.resolve();
  function persist() {
    const snapshot = JSON.stringify(state);
    writing = writing.then(async () => {
      await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
      const tmp = `${filename}.${randomBytes(4).toString('hex')}.tmp`;
      await writeFile(tmp, key ? encrypt(key, snapshot) : snapshot, { mode: 0o600 });
      await rename(tmp, filename);
    });
    return writing;
  }
  const urlOf = cal => `${LOCAL_PREFIX}${cal.id}`;
  const calendarOf = url => {
    const cal = state.calendars.find(c => urlOf(c) === url);
    if (!cal) throw fail('Kalender nicht gefunden.', 'calendar_missing', 404);
    return cal;
  };
  const objectOf = url => {
    const obj = state.objects.find(o => o.url === url);
    if (!obj) throw fail('Termin nicht gefunden.', 'event_missing', 404);
    return obj;
  };
  const etag = () => `"${randomBytes(6).toString('hex')}"`;
  const checkEtag = (obj, given) => {
    if (given && given !== obj.etag)
      throw fail('Der Termin wurde zwischenzeitlich geändert. Bitte neu laden.', 'event_conflict', 409);
  };
  const uidOf = ics => {
    try {
      return parseIcs(ics).getFirstSubcomponent('vevent')?.getFirstPropertyValue('uid') || '';
    } catch {
      return '';
    }
  };

  return {
    encrypted: Boolean(key),
    listCalendars() {
      return {
        calendars: state.calendars.map(c => ({
          accountId: LOCAL_ACCOUNT,
          accountLabel: LOCAL_LABEL,
          source: 'local',
          url: urlOf(c),
          name: c.name,
          color: c.color,
          hidden: Boolean(c.hidden),
          readOnly: false
        })),
        errors: []
      };
    },
    events(from, to) {
      const out = [];
      for (const cal of state.calendars) {
        if (cal.hidden) continue;
        for (const obj of state.objects.filter(o => o.calendarId === cal.id)) {
          try {
            out.push(
              ...expandObject(obj.data, from, to, {
                calendarUrl: urlOf(cal),
                accountId: LOCAL_ACCOUNT,
                color: cal.color,
                url: obj.url,
                etag: obj.etag
              })
            );
          } catch {
            /* skip broken object */
          }
        }
      }
      return { events: out, errors: [] };
    },
    async setCalendarPrefs(url, { hidden, color, name }) {
      const cal = calendarOf(url);
      if (typeof hidden === 'boolean') cal.hidden = hidden;
      if (typeof color === 'string') cal.color = color;
      if (typeof name === 'string' && name.trim()) cal.name = name.trim().slice(0, 80);
      await persist();
      return { ok: true };
    },
    async createCalendar(name) {
      if (state.calendars.length >= MAX_CALENDARS) throw fail('Höchstens 20 lokale Kalender.', 'calendar_limit');
      const cal = { id: randomUUID(), name, color: COLORS[state.calendars.length % COLORS.length], hidden: false };
      state.calendars.push(cal);
      await persist();
      return { url: urlOf(cal) };
    },
    async deleteCalendar(url) {
      const cal = calendarOf(url);
      if (state.calendars.length === 1)
        throw fail('Der letzte lokale Kalender kann nicht gelöscht werden.', 'calendar_last');
      state.calendars = state.calendars.filter(c => c !== cal);
      state.objects = state.objects.filter(o => o.calendarId !== cal.id);
      await persist();
      return { ok: true };
    },
    object(url) {
      const obj = objectOf(url);
      return { url: obj.url, etag: obj.etag, data: obj.data };
    },
    findAllByUid(uid) {
      return state.objects
        .filter(o => o.uid === uid)
        .map(o => ({
          accountId: LOCAL_ACCOUNT,
          calendarUrl: `${LOCAL_PREFIX}${o.calendarId}`,
          url: o.url,
          etag: o.etag,
          data: o.data
        }));
    },
    async createCalendarObject(calendarUrl, uid, ics) {
      const cal = calendarOf(calendarUrl);
      if (state.objects.length >= MAX_OBJECTS) throw fail('Der lokale Kalender ist voll.', 'calendar_limit');
      if (state.objects.some(o => o.uid === uid && o.calendarId === cal.id))
        throw fail('Ein Termin mit dieser Kennung existiert bereits.', 'event_save_failed', 409);
      const obj = {
        url: `${LOCAL_PREFIX}${cal.id}/${randomUUID()}.ics`,
        calendarId: cal.id,
        uid,
        etag: etag(),
        data: ics
      };
      state.objects.push(obj);
      await persist();
      return { url: obj.url };
    },
    async updateCalendarObject(url, givenEtag, ics) {
      const obj = objectOf(url);
      checkEtag(obj, givenEtag);
      Object.assign(obj, { data: ics, etag: etag(), uid: uidOf(ics) || obj.uid });
      await persist();
      return { ok: true };
    },
    async deleteCalendarObject(url, givenEtag) {
      const obj = state.objects.find(o => o.url === url);
      if (!obj) return { ok: true };
      checkEtag(obj, givenEtag);
      state.objects = state.objects.filter(o => o !== obj);
      await persist();
      return { ok: true };
    },
    /** One .ics file with all events of a local calendar (or all of them). */
    exportIcs(url = null) {
      const cal = url ? calendarOf(url) : null;
      const out = new ICAL.Component(['vcalendar', [], []]);
      out.updatePropertyWithValue('prodid', '-//Levuvo//Levuvo Mail//DE');
      out.updatePropertyWithValue('version', '2.0');
      const zones = new Set();
      for (const obj of state.objects.filter(o => !cal || o.calendarId === cal.id)) {
        try {
          const vcal = parseIcs(obj.data);
          for (const tz of vcal.getAllSubcomponents('vtimezone')) {
            const id = tz.getFirstPropertyValue('tzid');
            if (!zones.has(id)) {
              zones.add(id);
              out.addSubcomponent(tz);
            }
          }
          for (const ev of vcal.getAllSubcomponents('vevent')) out.addSubcomponent(ev);
        } catch {
          /* skip */
        }
      }
      return out.toString();
    },
    /** Imports VEVENTs from an .ics file (other calendar apps); one object per UID. */
    async importIcs(calendarUrl, text) {
      const cal = calendarOf(calendarUrl);
      let vcal;
      try {
        vcal = new ICAL.Component(ICAL.parse(text));
      } catch {
        throw fail('Die Datei ist keine gültige Kalenderdatei (.ics).', 'ics_invalid');
      }
      const zones = vcal.getAllSubcomponents('vtimezone');
      const byUid = new Map();
      for (const ev of vcal.getAllSubcomponents('vevent')) {
        const uid = String(ev.getFirstPropertyValue('uid') || randomUUID());
        if (!ev.hasProperty('uid')) ev.updatePropertyWithValue('uid', uid);
        if (!byUid.has(uid)) byUid.set(uid, []);
        byUid.get(uid).push(ev);
      }
      if (!byUid.size) throw fail('Die Datei enthält keine Termine.', 'ics_invalid');
      if (state.objects.length + byUid.size > MAX_OBJECTS)
        throw fail('Der lokale Kalender ist voll.', 'calendar_limit');
      let imported = 0;
      let skipped = 0;
      for (const [uid, events] of byUid) {
        if (state.objects.some(o => o.uid === uid && o.calendarId === cal.id)) {
          skipped++;
          continue;
        }
        const one = new ICAL.Component(['vcalendar', [], []]);
        one.updatePropertyWithValue('prodid', '-//Levuvo//Levuvo Mail//DE');
        one.updatePropertyWithValue('version', '2.0');
        for (const tz of zones) one.addSubcomponent(new ICAL.Component(tz.toJSON()));
        for (const ev of events) one.addSubcomponent(new ICAL.Component(ev.toJSON()));
        state.objects.push({
          url: `${LOCAL_PREFIX}${cal.id}/${randomUUID()}.ics`,
          calendarId: cal.id,
          uid,
          etag: etag(),
          data: one.toString()
        });
        imported++;
      }
      await persist();
      return { imported, skipped };
    },
    flush: () => writing
  };
}
