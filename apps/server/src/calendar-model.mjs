// iCalendar (RFC 5545) model on top of ical.js: parsing, expansion of recurring events
// (RRULE/EXDATE/overrides), building and editing events with real time zones (VTIMEZONE),
// and iTIP/iMIP messages (REQUEST, REPLY, CANCEL).
import ICAL from 'ical.js';
import { randomUUID } from 'node:crypto';
import { tzlib_get_ical_block } from 'timezones-ical-library';

const PRODID = '-//Levuvo//Levuvo Mail 2.0//DE';
const MAX_ITERATIONS = 20_000;
const MAX_OCCURRENCES = 2_000;
const fail = (message, code = 'event_invalid', statusCode = 400) =>
  Object.assign(new Error(message), { code, statusCode });

// ------------------------------------------------------------------ time zones
const registered = new Set();
function vtimezoneComponent(tzid) {
  try {
    const block = tzlib_get_ical_block(tzid)?.[0];
    if (!block || !block.includes('BEGIN:VTIMEZONE')) return null;
    return new ICAL.Component(
      ICAL.parse(`BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${block}\r\nEND:VCALENDAR`)
    ).getFirstSubcomponent('vtimezone');
  } catch {
    return null;
  }
}
export function ensureTimezone(tzid) {
  if (!tzid || tzid === 'UTC' || registered.has(tzid) || ICAL.TimezoneService.has(tzid))
    return ICAL.TimezoneService.get(tzid) || null;
  const comp = vtimezoneComponent(tzid);
  if (!comp) return null;
  ICAL.TimezoneService.register(comp);
  registered.add(tzid);
  return ICAL.TimezoneService.get(tzid);
}
export function validTimezone(tzid) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tzid });
    return true;
  } catch {
    return false;
  }
}
function registerCalendarZones(comp) {
  for (const tz of comp.getAllSubcomponents('vtimezone')) {
    const id = tz.getFirstPropertyValue('tzid');
    if (id && !ICAL.TimezoneService.has(id)) ICAL.TimezoneService.register(tz);
  }
  // Zones referenced but not embedded (some servers omit VTIMEZONE)
  for (const ev of comp.getAllSubcomponents('vevent')) {
    for (const name of ['dtstart', 'dtend', 'recurrence-id']) {
      const tzid = ev.getFirstProperty(name)?.getParameter('tzid');
      if (tzid && !ICAL.TimezoneService.has(tzid)) ensureTimezone(tzid);
    }
  }
}

const pad = n => String(n).padStart(2, '0');
const dateOnly = t => `${t.year}-${pad(t.month)}-${pad(t.day)}`;
function timeOut(t) {
  if (t.isDate) return dateOnly(t);
  return t.toJSDate().toISOString();
}

// ------------------------------------------------------------------ parsing
function people(comp) {
  return comp
    .getAllProperties('attendee')
    .map(p => ({
      email: String(p.getFirstValue() || '')
        .replace(/^mailto:/i, '')
        .toLowerCase(),
      name: p.getParameter('cn') || '',
      partstat: (p.getParameter('partstat') || 'NEEDS-ACTION').toUpperCase(),
      role: (p.getParameter('role') || 'REQ-PARTICIPANT').toUpperCase(),
      rsvp: String(p.getParameter('rsvp') || '').toUpperCase() === 'TRUE'
    }))
    .filter(a => a.email);
}
function organizerOf(comp) {
  const p = comp.getFirstProperty('organizer');
  if (!p) return null;
  return {
    email: String(p.getFirstValue() || '')
      .replace(/^mailto:/i, '')
      .toLowerCase(),
    name: p.getParameter('cn') || ''
  };
}
function alarmsOf(comp) {
  return comp
    .getAllSubcomponents('valarm')
    .map(a => {
      const trigger = a.getFirstPropertyValue('trigger');
      if (trigger && typeof trigger.toSeconds === 'function') return Math.round(-trigger.toSeconds() / 60);
      return null;
    })
    .filter(m => Number.isFinite(m) && m >= 0)
    .slice(0, 5);
}
function rruleOf(comp) {
  const r = comp.getFirstPropertyValue('rrule');
  if (!r) return null;
  return {
    freq: r.freq,
    interval: r.interval || 1,
    count: r.count || null,
    until: r.until ? (r.until.isDate ? dateOnly(r.until) : r.until.toJSDate().toISOString()) : null,
    byday: r.parts?.BYDAY || [],
    // Kept so that editing a series from another app does not drop parts of its rule.
    bymonthday: r.parts?.BYMONTHDAY || [],
    bysetpos: r.parts?.BYSETPOS || [],
    bymonth: r.parts?.BYMONTH || []
  };
}
function details(comp) {
  return {
    summary: comp.getFirstPropertyValue('summary') || '',
    location: comp.getFirstPropertyValue('location') || '',
    description: comp.getFirstPropertyValue('description') || '',
    status: (comp.getFirstPropertyValue('status') || 'CONFIRMED').toUpperCase(),
    organizer: organizerOf(comp),
    attendees: people(comp),
    alarms: alarmsOf(comp),
    attachments: attachmentsOf(comp),
    sequence: Number(comp.getFirstPropertyValue('sequence') || 0)
  };
}

// ------------------------------------------------------------------ attachments (RFC 5545 ATTACH)
// Files are stored inline (ENCODING=BASE64;VALUE=BINARY), so they travel with the event to the
// device calendar, CalDAV servers and .ics exports. Links (ATTACH as URI) from other apps are kept.
// Decimal like every size shown in the app: "5 MB" and "10 MB" mean exactly that.
export const ATTACH_MAX_FILE = 5_000_000;
export const ATTACH_MAX_TOTAL = 10_000_000;
export const ATTACH_MAX_COUNT = 20;
const FILENAME_PARAMS = ['x-filename', 'filename', 'x-apple-filename', 'x-oracle-filename', 'x-ms-filename'];
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export function base64Size(b64) {
  const s = String(b64 || '').replace(/\s+/g, '');
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((s.length * 3) / 4) - pad);
}
/** File name without paths, control characters or characters that are unsafe on Windows. */
export function safeFilename(name, fallback = 'Anhang') {
  const clean = String(name || '')
    .split(/[\\/]/)
    .pop()
    .replace(/[\u0000-\u001f\u007f<>:"|?*]+/g, '')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, 200);
  return clean || fallback;
}
export const safeMimeType = type =>
  /^[a-z0-9][\w.+-]*\/[\w.+-]+$/i.test(String(type || '')) ? String(type).toLowerCase() : 'application/octet-stream';
function nameFromUri(uri) {
  try {
    const u = new URL(uri);
    return decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || u.hostname);
  } catch {
    return '';
  }
}
function attachEntry(p, i) {
  const value = p.getFirstValue();
  const binary =
    p.type === 'binary' ||
    String(p.getParameter('value') || '').toUpperCase() === 'BINARY' ||
    String(p.getParameter('encoding') || '').toUpperCase() === 'BASE64';
  const given = FILENAME_PARAMS.map(n => p.getParameter(n)).find(v => typeof v === 'string' && v);
  const type = safeMimeType(p.getParameter('fmttype'));
  if (binary) {
    const data = String(typeof value === 'string' ? value : value?.value || '').replace(/\s+/g, '');
    return { id: String(i), name: safeFilename(given, `Anhang ${i + 1}`), type, size: base64Size(data), data };
  }
  const uri = String(value || '');
  const web = /^https?:\/\//i.test(uri);
  return {
    id: String(i),
    name: safeFilename(given || (web ? nameFromUri(uri) : ''), `Anhang ${i + 1}`),
    type,
    size: Number(p.getParameter('size')) || 0,
    // Only web links can be opened; other schemes (cid:, managed ids) are shown by name.
    ...(web ? { uri } : {})
  };
}
const attachEntries = comp => comp.getAllProperties('attach').map(attachEntry);
/** Attachment list without file contents (for the event list). */
export function attachmentsOf(comp) {
  return attachEntries(comp).map(({ data: _d, ...meta }) => meta);
}
/** The VEVENT an occurrence is shown from: its override, otherwise the master. */
function componentFor(vcal, recurrenceId) {
  const vevents = vcal.getAllSubcomponents('vevent');
  const master = vevents.find(v => !v.hasProperty('recurrence-id')) || vevents[0];
  if (!recurrenceId) return master;
  return (
    vevents.find(
      v => v.hasProperty('recurrence-id') && timeOut(v.getFirstPropertyValue('recurrence-id')) === recurrenceId
    ) || master
  );
}
/** One attachment with its content (Buffer) or link. */
export function attachmentContent(ics, recurrenceId, id) {
  const comp = componentFor(parseIcs(ics), recurrenceId || null);
  const entry = comp && attachEntries(comp).find(a => a.id === String(id));
  if (!entry) throw fail('Anhang nicht gefunden.', 'attachment_missing', 404);
  if (entry.data === undefined) return entry;
  const { data, ...meta } = entry;
  return { ...meta, content: Buffer.from(data, 'base64') };
}
/**
 * Turns the editor's list (kept ids + new files) into the final attachments with content,
 * read from the version of the event the user saw. Enforces the size limits.
 * `list` null keeps all existing attachments.
 */
export function resolveAttachments(ics, recurrenceId, list = null) {
  const existing = ics ? attachEntries(componentFor(parseIcs(ics), recurrenceId || null)) : [];
  // null: all attachments as they are (moving an event to another calendar).
  const out = (list ?? existing.map(e => ({ id: e.id }))).map(a => {
    if (a.id === undefined) return a;
    const hit = existing.find(e => e.id === a.id);
    if (!hit) throw fail('Anhang nicht gefunden. Bitte neu laden.', 'attachment_missing', 409);
    return withoutId(hit);
  });
  checkAttachmentTotal(out);
  return out;
}
export const withoutId = ({ id: _id, ...rest }) => rest;
export function checkAttachmentTotal(list) {
  if (list.length > ATTACH_MAX_COUNT) throw fail('Höchstens 20 Anhänge pro Termin.', 'attachment_too_large', 413);
  if (list.reduce((n, a) => n + (a.size || 0), 0) > ATTACH_MAX_TOTAL)
    throw fail('Die Anhänge sind zusammen zu groß (höchstens 10 MB pro Termin).', 'attachment_too_large', 413);
}
function setAttachments(vevent, list) {
  vevent.removeAllProperties('attach');
  for (const a of list) {
    const p = new ICAL.Property('attach', vevent);
    if (a.data !== undefined) {
      p.resetType('binary');
      p.setParameter('encoding', 'BASE64');
      p.setValue(new ICAL.Binary(a.data));
    } else if (a.uri) {
      p.setValue(a.uri);
    } else continue;
    if (a.type && a.type !== 'application/octet-stream') p.setParameter('fmttype', a.type);
    if (a.name) p.setParameter('x-filename', a.name);
    vevent.addProperty(p);
  }
}
/** Files of the event as e-mail attachments (for invitations, which carry no inline files). */
export function inlineAttachments(ics) {
  const comp = componentFor(parseIcs(ics), null);
  if (!comp) return [];
  return attachEntries(comp)
    .filter(a => a.data !== undefined)
    .map(a => ({ filename: a.name, contentType: a.type, content: Buffer.from(a.data, 'base64') }));
}

export function parseIcs(ics) {
  let comp;
  try {
    comp = new ICAL.Component(ICAL.parse(String(ics)));
  } catch {
    throw fail('Ungültige Kalenderdaten.', 'ics_invalid');
  }
  registerCalendarZones(comp);
  return comp;
}

/** All occurrences of one calendar object resource within [from, to). */
export function expandObject(ics, from, to, meta = {}) {
  const comp = parseIcs(ics);
  const vevents = comp.getAllSubcomponents('vevent');
  const master = vevents.find(v => !v.hasProperty('recurrence-id')) || vevents[0];
  if (!master) return [];
  const event = new ICAL.Event(master);
  for (const ex of vevents) if (ex !== master && ex.hasProperty('recurrence-id')) event.relateException(ex);
  const rangeStart = ICAL.Time.fromJSDate(new Date(from), true);
  const rangeEnd = ICAL.Time.fromJSDate(new Date(to), true);
  const base = {
    ...meta,
    uid: event.uid,
    recurring: event.isRecurring(),
    rrule: rruleOf(master),
    tzid: master.getFirstProperty('dtstart')?.getParameter('tzid') || null
  };
  const out = [];
  const push = (item, start, end, recurrenceId) => {
    const occStart = start.toJSDate().getTime();
    const occEnd = (end || start).toJSDate().getTime();
    if (occEnd <= rangeStart.toJSDate().getTime() && occStart !== occEnd) return;
    if (occStart >= rangeEnd.toJSDate().getTime()) return;
    out.push({
      ...base,
      ...details(item.component),
      recurrenceId,
      allDay: start.isDate,
      start: timeOut(start),
      end: timeOut(end || start)
    });
  };
  if (!event.isRecurring()) {
    push(event, event.startDate, event.endDate, null);
    return out;
  }
  const it = event.iterator();
  let next;
  let iterations = 0;
  while ((next = it.next()) && iterations++ < MAX_ITERATIONS && out.length < MAX_OCCURRENCES) {
    if (next.compare(rangeEnd) >= 0) break;
    const occurrence = event.getOccurrenceDetails(next);
    push(occurrence.item, occurrence.startDate, occurrence.endDate, timeOut(occurrence.recurrenceId));
  }
  return out;
}

// ------------------------------------------------------------------ validation of editor input
const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const FREQS = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];
// BYDAY with an optional ordinal (1MO, -1FR) as used by monthly and yearly rules.
const BYDAY = /^([+-]?(?:[1-9]|[1-4]\d|5[0-3]))?(MO|TU|WE|TH|FR|SA|SU)$/;
const intList = (v, min, max) =>
  (Array.isArray(v) ? v : []).filter(n => Number.isInteger(n) && n !== 0 && n >= min && n <= max).slice(0, 31);

export function validateEventInput(input) {
  if (!input || typeof input !== 'object') throw fail('Ungültiger Termin.');
  const text = (v, max, label) => {
    if (v === undefined || v === null) return '';
    if (typeof v !== 'string' || v.length > max || v.includes('\0')) throw fail(`Ungültiges Feld: ${label}.`);
    return v;
  };
  const summary = text(input.summary, 300, 'Titel').trim();
  if (!summary) throw fail('Bitte einen Titel eingeben.');
  const allDay = input.allDay === true;
  const tzid = allDay ? null : text(input.tzid || 'Europe/Vienna', 64, 'Zeitzone');
  if (tzid && !validTimezone(tzid)) throw fail('Unbekannte Zeitzone.');
  const re = allDay ? DATE : LOCAL;
  if (!re.test(input.start || '') || !re.test(input.end || '')) throw fail('Ungültiger Beginn oder Ende.');
  if (input.end < input.start || (!allDay && input.end === input.start))
    throw fail('Das Ende muss nach dem Beginn liegen.');
  let rrule = null;
  if (input.rrule) {
    const r = input.rrule;
    if (!FREQS.includes(r.freq)) throw fail('Ungültige Wiederholung.');
    const interval = Number.isInteger(r.interval) && r.interval >= 1 && r.interval <= 99 ? r.interval : 1;
    const count = Number.isInteger(r.count) && r.count >= 1 && r.count <= 999 ? r.count : null;
    // The end date comes back from a stored series as a date-time (UNTIL in UTC); only its date
    // counts. Dropping it silently turned a series with an end into an endless one.
    const untilRaw = typeof r.until === 'string' ? r.until.slice(0, 10) : '';
    const until = DATE.test(untilRaw) ? untilRaw : null;
    const byday = Array.isArray(r.byday) ? r.byday.filter(d => typeof d === 'string' && BYDAY.test(d)) : [];
    rrule = {
      freq: r.freq,
      interval,
      count,
      until: count ? null : until,
      byday,
      bymonthday: intList(r.bymonthday, -31, 31),
      bysetpos: intList(r.bysetpos, -366, 366),
      bymonth: intList(r.bymonth, 1, 12)
    };
  }
  const attendees = (Array.isArray(input.attendees) ? input.attendees : []).slice(0, 50).map(a => {
    const email = text(a?.email, 254, 'Teilnehmer').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail(`Ungültige Teilnehmeradresse: ${email || '–'}`);
    return {
      email,
      name: text(a.name, 120, 'Name'),
      partstat: ['ACCEPTED', 'DECLINED', 'TENTATIVE', 'NEEDS-ACTION'].includes(a.partstat) ? a.partstat : 'NEEDS-ACTION'
    };
  });
  const alarms = (Array.isArray(input.alarms) ? input.alarms : [])
    .filter(m => Number.isInteger(m) && m >= 0 && m <= 40320)
    .slice(0, 5);
  // null: attachments stay as they are (e.g. when an event is only moved).
  let attachments = null;
  if (input.attachments !== undefined && input.attachments !== null) {
    if (!Array.isArray(input.attachments) || input.attachments.length > ATTACH_MAX_COUNT)
      throw fail('Höchstens 20 Anhänge pro Termin.', 'attachment_too_large', 413);
    attachments = input.attachments.map(a => {
      if (typeof a?.id === 'string') {
        if (!/^[A-Za-z0-9+/=_-]{1,512}$/.test(a.id)) throw fail('Ungültiger Anhang.');
        return { id: a.id };
      }
      const data = typeof a?.data === 'string' ? a.data : '';
      if (!data || !BASE64.test(data)) throw fail('Ungültiger Anhang.');
      const size = base64Size(data);
      if (size > ATTACH_MAX_FILE)
        throw fail('Ein Anhang ist zu groß (höchstens 5 MB pro Datei).', 'attachment_too_large', 413);
      return { name: safeFilename(text(a.name, 255, 'Dateiname')), type: safeMimeType(a.type), size, data };
    });
    checkAttachmentTotal(attachments.filter(a => a.id === undefined));
  }
  return {
    summary,
    allDay,
    tzid,
    start: input.start,
    end: input.end,
    location: text(input.location, 500, 'Ort'),
    description: text(input.description, 10_000, 'Beschreibung'),
    rrule,
    attendees,
    alarms,
    attachments
  };
}

// ------------------------------------------------------------------ building
function toTime(value, allDay, tzid) {
  if (allDay) {
    const [y, m, d] = value.split('-').map(Number);
    return ICAL.Time.fromData({ year: y, month: m, day: d, isDate: true });
  }
  const [date, clock] = value.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = clock.split(':').map(Number);
  const zone = ensureTimezone(tzid);
  return ICAL.Time.fromData({ year: y, month: m, day: d, hour: hh, minute: mm, second: 0 }, zone || undefined);
}
function setTime(comp, name, time, tzid) {
  comp.removeAllProperties(name);
  const prop = new ICAL.Property(name, comp);
  prop.setValue(time);
  if (!time.isDate && tzid && tzid !== 'UTC') prop.setParameter('tzid', tzid);
  comp.addProperty(prop);
}
function setText(comp, name, value) {
  comp.removeAllProperties(name);
  if (value) comp.addPropertyWithValue(name, value);
}
function stamp(comp) {
  const now = ICAL.Time.fromJSDate(new Date(), true);
  comp.updatePropertyWithValue('dtstamp', now);
  comp.updatePropertyWithValue('last-modified', now);
}

function applyDetails(vevent, model, { organizer, scheduleByClient }) {
  setText(vevent, 'summary', model.summary);
  setText(vevent, 'location', model.location);
  setText(vevent, 'description', model.description);
  setTime(vevent, 'dtstart', toTime(model.start, model.allDay, model.tzid), model.tzid);
  setTime(vevent, 'dtend', toTime(model.end, model.allDay, model.tzid), model.tzid);
  vevent.removeAllProperties('duration');
  vevent.removeAllProperties('attendee');
  vevent.removeAllProperties('organizer');
  if (model.attendees.length && organizer) {
    const org = new ICAL.Property('organizer', vevent);
    org.setValue(`mailto:${organizer.email}`);
    if (organizer.name) org.setParameter('cn', organizer.name);
    vevent.addProperty(org);
    const seen = new Set();
    for (const a of model.attendees) {
      if (seen.has(a.email)) continue;
      seen.add(a.email);
      const p = new ICAL.Property('attendee', vevent);
      p.setValue(`mailto:${a.email}`);
      if (a.name) p.setParameter('cn', a.name);
      p.setParameter('role', 'REQ-PARTICIPANT');
      p.setParameter('partstat', a.email === organizer.email ? 'ACCEPTED' : a.partstat || 'NEEDS-ACTION');
      p.setParameter('rsvp', 'TRUE');
      // Levuvo Mail sends the iMIP messages itself; the CalDAV server must not (RFC 6638).
      if (scheduleByClient) p.setParameter('schedule-agent', 'CLIENT');
      vevent.addProperty(p);
    }
  }
  for (const alarm of vevent.getAllSubcomponents('valarm')) vevent.removeSubcomponent(alarm);
  for (const minutes of model.alarms) {
    const valarm = new ICAL.Component('valarm');
    valarm.addPropertyWithValue('action', 'DISPLAY');
    valarm.addPropertyWithValue('description', model.summary);
    const trigger = new ICAL.Property('trigger', valarm);
    trigger.setValue(ICAL.Duration.fromSeconds(-minutes * 60));
    valarm.addProperty(trigger);
    vevent.addSubcomponent(valarm);
  }
}
function setRrule(vevent, rrule) {
  vevent.removeAllProperties('rrule');
  if (!rrule) return;
  const data = { freq: rrule.freq, interval: rrule.interval };
  if (rrule.count) data.count = rrule.count;
  if (rrule.until) {
    const [y, m, d] = rrule.until.split('-').map(Number);
    data.until = ICAL.Time.fromData(
      { year: y, month: m, day: d, hour: 23, minute: 59, second: 59, isDate: false },
      ICAL.Timezone.utcTimezone
    );
  }
  const recur = new ICAL.Recur(data);
  if (rrule.byday.length) recur.setComponent('BYDAY', rrule.byday);
  if (rrule.bymonthday?.length) recur.setComponent('BYMONTHDAY', rrule.bymonthday);
  if (rrule.bymonth?.length) recur.setComponent('BYMONTH', rrule.bymonth);
  if (rrule.bysetpos?.length) recur.setComponent('BYSETPOS', rrule.bysetpos);
  vevent.addPropertyWithValue('rrule', recur);
}
function ensureVtimezone(vcal, tzid) {
  if (!tzid || tzid === 'UTC') return;
  if (vcal.getAllSubcomponents('vtimezone').some(t => t.getFirstPropertyValue('tzid') === tzid)) return;
  const comp = vtimezoneComponent(tzid);
  if (comp) vcal.addSubcomponent(comp);
}
const bumpSequence = vevent =>
  vevent.updatePropertyWithValue('sequence', Number(vevent.getFirstPropertyValue('sequence') || 0) + 1);

/** New calendar object resource. */
export function createEventIcs(model, { organizer = null, scheduleByClient = true, uid = randomUUID() } = {}) {
  const vcal = new ICAL.Component(['vcalendar', [], []]);
  vcal.addPropertyWithValue('prodid', PRODID);
  vcal.addPropertyWithValue('version', '2.0');
  vcal.addPropertyWithValue('calscale', 'GREGORIAN');
  ensureVtimezone(vcal, model.tzid);
  const vevent = new ICAL.Component('vevent');
  vevent.addPropertyWithValue('uid', uid);
  vevent.addPropertyWithValue('sequence', 0);
  vevent.addPropertyWithValue('created', ICAL.Time.fromJSDate(new Date(), true));
  stamp(vevent);
  applyDetails(vevent, model, { organizer, scheduleByClient });
  setRrule(vevent, model.rrule);
  if (Array.isArray(model.attachments)) setAttachments(vevent, model.attachments);
  vcal.addSubcomponent(vevent);
  return { uid, ics: vcal.toString() };
}

/**
 * Edits an existing resource. scope "all" changes the series (master), scope "this"
 * writes an override for the occurrence identified by recurrenceId.
 */
export function updateEventIcs(
  ics,
  model,
  { scope = 'all', recurrenceId = null, organizer = null, scheduleByClient = true } = {}
) {
  const vcal = parseIcs(ics);
  const vevents = vcal.getAllSubcomponents('vevent');
  const master = vevents.find(v => !v.hasProperty('recurrence-id')) || vevents[0];
  if (!master) throw fail('Termin nicht gefunden.', 'event_missing', 404);
  ensureVtimezone(vcal, model.tzid);
  if (scope === 'this' && recurrenceId && master.hasProperty('rrule')) {
    const masterTz = master.getFirstProperty('dtstart').getParameter('tzid');
    const rid = recurrenceIdTime(recurrenceId, master);
    let override = vevents.find(
      v => v.hasProperty('recurrence-id') && timeOut(v.getFirstPropertyValue('recurrence-id')) === timeOut(rid)
    );
    if (!override) {
      override = new ICAL.Component('vevent');
      override.addPropertyWithValue('uid', master.getFirstPropertyValue('uid'));
      setTime(override, 'recurrence-id', rid, masterTz);
      // A new override shows the same files as the series until they are changed.
      for (const p of master.getAllProperties('attach')) override.addProperty(new ICAL.Property(p.toJSON()));
      vcal.addSubcomponent(override);
    }
    override.updatePropertyWithValue('sequence', Number(master.getFirstPropertyValue('sequence') || 0) + 1);
    stamp(override);
    applyDetails(override, model, { organizer, scheduleByClient });
    if (Array.isArray(model.attachments)) setAttachments(override, model.attachments);
    return vcal.toString();
  }
  bumpSequence(master);
  stamp(master);
  // Editing "all" from one occurrence: shift the series by the same amount instead of
  // moving its first occurrence to the edited date.
  if (recurrenceId && master.hasProperty('rrule')) model = shiftSeries(model, master, recurrenceId);
  applyDetails(master, model, { organizer, scheduleByClient });
  setRrule(master, model.rrule);
  if (Array.isArray(model.attachments)) setAttachments(master, model.attachments);
  if (!model.rrule) for (const ex of vevents) if (ex !== master) vcal.removeSubcomponent(ex);
  return vcal.toString();
}

function localString(ms, tzid) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tzid || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    })
      .formatToParts(new Date(ms))
      .map(p => [p.type, p.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
function shiftSeries(model, master, recurrenceId) {
  const masterStart = master.getFirstPropertyValue('dtstart');
  const rid = recurrenceIdTime(recurrenceId, master);
  const start = toTime(model.start, model.allDay, model.tzid);
  const end = toTime(model.end, model.allDay, model.tzid);
  if (masterStart.isDate !== model.allDay || rid.isDate !== model.allDay) return model;
  const shift = start.toJSDate().getTime() - rid.toJSDate().getTime();
  const length = end.toJSDate().getTime() - start.toJSDate().getTime();
  const begin = masterStart.toJSDate().getTime() + shift;
  if (model.allDay) {
    const day = ms => new Date(ms).toISOString().slice(0, 10);
    const base =
      Date.UTC(masterStart.year, masterStart.month - 1, masterStart.day) + Math.round(shift / 86400_000) * 86400_000;
    return { ...model, start: day(base), end: day(base + Math.round(length / 86400_000) * 86400_000) };
  }
  return { ...model, start: localString(begin, model.tzid), end: localString(begin + length, model.tzid) };
}
function recurrenceIdTime(recurrenceId, master) {
  const start = master.getFirstPropertyValue('dtstart');
  if (start.isDate) {
    const [y, m, d] = recurrenceId.slice(0, 10).split('-').map(Number);
    return ICAL.Time.fromData({ year: y, month: m, day: d, isDate: true });
  }
  const utc = ICAL.Time.fromJSDate(new Date(recurrenceId), true);
  return start.zone && start.zone.tzid !== 'UTC' && start.zone.tzid !== 'floating'
    ? utc.convertToZone(start.zone)
    : utc;
}

/**
 * Removes a single occurrence (EXDATE) from a series. `bump: false` for an attendee's copy: its
 * SEQUENCE belongs to the organizer and is compared with later iTIP messages.
 */
export function excludeOccurrence(ics, recurrenceId, { bump = true } = {}) {
  const vcal = parseIcs(ics);
  const vevents = vcal.getAllSubcomponents('vevent');
  const master = vevents.find(v => !v.hasProperty('recurrence-id'));
  if (!master) throw fail('Termin nicht gefunden.', 'event_missing', 404);
  const rid = recurrenceIdTime(recurrenceId, master);
  for (const ex of vevents) {
    if (ex !== master && timeOut(ex.getFirstPropertyValue('recurrence-id')) === timeOut(rid))
      vcal.removeSubcomponent(ex);
  }
  const tzid = master.getFirstProperty('dtstart').getParameter('tzid');
  const prop = new ICAL.Property('exdate', master);
  prop.setValue(rid);
  if (!rid.isDate && tzid) prop.setParameter('tzid', tzid);
  master.addProperty(prop);
  if (bump) bumpSequence(master);
  stamp(master);
  return vcal.toString();
}

// ------------------------------------------------------------------ iTIP / iMIP
/** Invitation/answer contained in a mail (text/calendar part). */
export function parseItip(ics) {
  const vcal = parseIcs(ics);
  const method = String(vcal.getFirstPropertyValue('method') || '').toUpperCase();
  const vevent = vcal.getFirstSubcomponent('vevent');
  if (!vevent) return null;
  const event = new ICAL.Event(vevent);
  return {
    method,
    uid: event.uid,
    sequence: Number(vevent.getFirstPropertyValue('sequence') || 0),
    recurrenceId: vevent.hasProperty('recurrence-id') ? timeOut(vevent.getFirstPropertyValue('recurrence-id')) : null,
    summary: event.summary || '',
    location: event.location || '',
    description: event.description || '',
    allDay: event.startDate?.isDate || false,
    start: event.startDate ? timeOut(event.startDate) : null,
    end: event.endDate ? timeOut(event.endDate) : null,
    recurring: event.isRecurring(),
    rrule: rruleOf(vevent),
    tzid: vevent.getFirstProperty('dtstart')?.getParameter('tzid') || null,
    organizer: organizerOf(vevent),
    attendees: people(vevent)
  };
}

/** The organizer's request turned into a stored event (method removed, own PARTSTAT set). */
export function invitationToStoredIcs(ics, ownEmail, partstat) {
  const vcal = parseIcs(ics);
  vcal.removeAllProperties('method');
  for (const vevent of vcal.getAllSubcomponents('vevent')) {
    for (const p of vevent.getAllProperties('attendee')) {
      if (
        String(p.getFirstValue())
          .replace(/^mailto:/i, '')
          .toLowerCase() === ownEmail.toLowerCase()
      ) {
        p.setParameter('partstat', partstat);
        p.removeParameter('rsvp');
      }
    }
  }
  return vcal.toString();
}

/** iTIP REPLY from an attendee (RFC 5546 §3.2.3). */
export function buildReply(ics, attendee, partstat) {
  const source = parseIcs(ics);
  const vevent = source.getFirstSubcomponent('vevent');
  if (!vevent) throw fail('Einladung enthält keinen Termin.', 'ics_invalid');
  const own = vevent.getAllProperties('attendee').find(
    p =>
      String(p.getFirstValue())
        .replace(/^mailto:/i, '')
        .toLowerCase() === attendee.email.toLowerCase()
  );
  const reply = new ICAL.Component(['vcalendar', [], []]);
  reply.addPropertyWithValue('prodid', PRODID);
  reply.addPropertyWithValue('version', '2.0');
  reply.addPropertyWithValue('method', 'REPLY');
  for (const tz of source.getAllSubcomponents('vtimezone')) reply.addSubcomponent(new ICAL.Component(tz.toJSON()));
  const out = new ICAL.Component('vevent');
  for (const name of ['uid', 'sequence', 'dtstart', 'dtend', 'duration', 'recurrence-id', 'summary', 'organizer']) {
    for (const p of vevent.getAllProperties(name)) out.addProperty(new ICAL.Property(p.toJSON()));
  }
  stamp(out);
  const prop = new ICAL.Property('attendee', out);
  prop.setValue(`mailto:${attendee.email}`);
  const cn = attendee.name || own?.getParameter('cn');
  if (cn) prop.setParameter('cn', cn);
  prop.setParameter('partstat', partstat);
  out.addProperty(prop);
  reply.addSubcomponent(out);
  return reply.toString();
}

/** Organizer → attendees: REQUEST (new/changed) or CANCEL. Alarms are personal and removed. */
export function buildOrganizerMessage(ics, method) {
  const vcal = parseIcs(ics);
  vcal.removeAllProperties('method');
  vcal.addPropertyWithValue('method', method);
  for (const vevent of vcal.getAllSubcomponents('vevent')) {
    for (const alarm of vevent.getAllSubcomponents('valarm')) vevent.removeSubcomponent(alarm);
    for (const p of vevent.getAllProperties('attendee')) p.removeParameter('schedule-agent');
    // Inline files go along as regular e-mail attachments (see inlineAttachments); links stay.
    for (const p of vevent.getAllProperties('attach'))
      if (attachEntry(p, 0).data !== undefined) vevent.removeProperty(p);
    if (method === 'CANCEL') vevent.updatePropertyWithValue('status', 'CANCELLED');
  }
  return vcal.toString();
}

const ridOf = vevent =>
  vevent.hasProperty('recurrence-id') ? timeOut(vevent.getFirstPropertyValue('recurrence-id')) : null;
const sameInstant = (a, b) => {
  if (!a || !b) return false;
  if (a === b) return true;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  return Number.isFinite(ta) && ta === tb;
};
function seriesParts(vcal) {
  const vevents = vcal.getAllSubcomponents('vevent');
  return { vevents, master: vevents.find(v => !v.hasProperty('recurrence-id')) || null };
}

/**
 * Attendee receives an iTIP CANCEL for a stored event (RFC 5546 §3.2.5). Returns what to do with
 * the stored copy: { action: 'delete' } for the whole event, { action: 'update', ics } when only
 * one occurrence of a series is cancelled, or { action: 'ignore', reason } when the message does
 * not come from the event's organizer or is older than the stored state (SEQUENCE).
 */
export function applyCancel(storedIcs, cancelIcs, senderEmail) {
  const cancel = parseItip(cancelIcs);
  if (!cancel || cancel.method !== 'CANCEL')
    throw fail('Diese Kalendernachricht kann nicht übernommen werden.', 'ics_invalid');
  const vcal = parseIcs(storedIcs);
  const { vevents, master } = seriesParts(vcal);
  const head = master || vevents[0];
  if (!head) return { action: 'ignore', reason: 'not_in_calendar' };
  // Only the organizer may cancel: an event without organizer is the user's own, and a CANCEL
  // from anyone else (any mail with a calendar part) must not delete it.
  const organizer = organizerOf(head)?.email || '';
  const sender = String(senderEmail || '').toLowerCase();
  if (!organizer || sender !== organizer || (cancel.organizer?.email || '') !== organizer)
    return { action: 'ignore', reason: 'not_organizer' };
  const target = cancel.recurrenceId ? vevents.find(v => sameInstant(ridOf(v), cancel.recurrenceId)) || head : head;
  if (cancel.sequence < Number(target.getFirstPropertyValue('sequence') || 0))
    return { action: 'ignore', reason: 'outdated' };
  if (!cancel.recurrenceId || !master?.hasProperty('rrule')) {
    // A single occurrence stored on its own (only that instance was ever received).
    if (cancel.recurrenceId && !master && !vevents.some(v => !sameInstant(ridOf(v), cancel.recurrenceId)))
      return { action: 'delete' };
    if (cancel.recurrenceId && !master) {
      for (const v of vevents) if (sameInstant(ridOf(v), cancel.recurrenceId)) vcal.removeSubcomponent(v);
      return { action: 'update', ics: vcal.toString() };
    }
    return { action: 'delete' };
  }
  return { action: 'update', ics: excludeOccurrence(storedIcs, cancel.recurrenceId, { bump: false }) };
}

/**
 * Attendee answers a REQUEST and already has the event stored. An invitation for one occurrence
 * (RECURRENCE-ID) only changes that occurrence of the stored series instead of replacing it;
 * declining it removes just that occurrence. A REQUEST older than the stored state (SEQUENCE)
 * changes nothing. Returns { action: 'delete' | 'update' | 'ignore', ics? }.
 */
export function mergeInvitation(storedIcs, invitationIcs, ownEmail, partstat) {
  const inv = parseItip(invitationIcs);
  if (!inv) throw fail('Einladung enthält keinen Termin.', 'ics_invalid');
  const stored = parseIcs(storedIcs);
  const { vevents, master } = seriesParts(stored);
  const head = master || vevents[0];
  const target = inv.recurrenceId ? vevents.find(v => sameInstant(ridOf(v), inv.recurrenceId)) || head : head;
  if (target && inv.sequence < Number(target.getFirstPropertyValue('sequence') || 0))
    return { action: 'ignore', reason: 'outdated' };
  const instanceOfSeries = Boolean(inv.recurrenceId && master?.hasProperty('rrule'));
  if (!instanceOfSeries) {
    if (partstat === 'DECLINED') return { action: 'delete' };
    return { action: 'update', ics: invitationToStoredIcs(invitationIcs, ownEmail, partstat) };
  }
  if (partstat === 'DECLINED')
    return { action: 'update', ics: excludeOccurrence(storedIcs, inv.recurrenceId, { bump: false }) };
  const incoming = parseIcs(invitationToStoredIcs(invitationIcs, ownEmail, partstat));
  for (const v of vevents) if (sameInstant(ridOf(v), inv.recurrenceId)) stored.removeSubcomponent(v);
  const zones = new Set(stored.getAllSubcomponents('vtimezone').map(z => z.getFirstPropertyValue('tzid')));
  for (const tz of incoming.getAllSubcomponents('vtimezone'))
    if (!zones.has(tz.getFirstPropertyValue('tzid'))) stored.addSubcomponent(new ICAL.Component(tz.toJSON()));
  for (const v of incoming.getAllSubcomponents('vevent'))
    if (v.hasProperty('recurrence-id')) stored.addSubcomponent(new ICAL.Component(v.toJSON()));
  return { action: 'update', ics: stored.toString() };
}

/**
 * Applies an attendee's REPLY to the organizer's stored event. A reply for one occurrence
 * (RECURRENCE-ID) only changes that occurrence, never the whole series.
 */
export function applyReply(storedIcs, replyIcs) {
  const reply = parseItip(replyIcs);
  if (!reply || reply.method !== 'REPLY' || !reply.attendees[0])
    throw fail('Antwort enthält keinen Teilnehmer.', 'ics_invalid');
  const vcal = parseIcs(storedIcs);
  let changed = false;
  for (const vevent of vcal.getAllSubcomponents('vevent')) {
    if (reply.recurrenceId && !sameInstant(ridOf(vevent), reply.recurrenceId)) continue;
    for (const p of vevent.getAllProperties('attendee')) {
      if (
        String(p.getFirstValue())
          .replace(/^mailto:/i, '')
          .toLowerCase() === reply.attendees[0].email
      ) {
        p.setParameter('partstat', reply.attendees[0].partstat);
        changed = true;
      }
    }
  }
  return changed ? vcal.toString() : null;
}

/** Due reminders within [from, to) from expanded occurrences. */
export function dueAlarms(occurrences, from, to) {
  const out = [];
  for (const o of occurrences) {
    if (o.status === 'CANCELLED') continue;
    const start = o.allDay ? new Date(`${o.start}T09:00:00`).getTime() : Date.parse(o.start);
    for (const minutes of o.alarms || []) {
      const at = start - minutes * 60_000;
      if (at >= from && at < to)
        out.push({
          key: `${o.uid}|${o.recurrenceId || ''}|${minutes}`,
          at,
          title: o.summary,
          start: o.start,
          allDay: o.allDay,
          location: o.location
        });
    }
  }
  return out;
}
