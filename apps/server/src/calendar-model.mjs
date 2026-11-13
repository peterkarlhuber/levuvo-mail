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
    byday: r.parts?.BYDAY || []
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
    sequence: Number(comp.getFirstPropertyValue('sequence') || 0)
  };
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
const DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

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
    const until = r.until && DATE.test(r.until) ? r.until : null;
    const byday = Array.isArray(r.byday) ? r.byday.filter(d => DAYS.includes(d)) : [];
    rrule = { freq: r.freq, interval, count, until: count ? null : until, byday };
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
    alarms
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
      vcal.addSubcomponent(override);
    }
    override.updatePropertyWithValue('sequence', Number(master.getFirstPropertyValue('sequence') || 0) + 1);
    stamp(override);
    applyDetails(override, model, { organizer, scheduleByClient });
    return vcal.toString();
  }
  bumpSequence(master);
  stamp(master);
  // Editing "all" from one occurrence: shift the series by the same amount instead of
  // moving its first occurrence to the edited date.
  if (recurrenceId && master.hasProperty('rrule')) model = shiftSeries(model, master, recurrenceId);
  applyDetails(master, model, { organizer, scheduleByClient });
  setRrule(master, model.rrule);
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

/** Removes a single occurrence (EXDATE) from a series. */
export function excludeOccurrence(ics, recurrenceId) {
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
  bumpSequence(master);
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
    if (method === 'CANCEL') vevent.updatePropertyWithValue('status', 'CANCELLED');
  }
  return vcal.toString();
}

/** Applies an attendee's REPLY to the organizer's stored event. */
export function applyReply(storedIcs, replyIcs) {
  const reply = parseItip(replyIcs);
  if (!reply || reply.method !== 'REPLY' || !reply.attendees[0])
    throw fail('Antwort enthält keinen Teilnehmer.', 'ics_invalid');
  const vcal = parseIcs(storedIcs);
  let changed = false;
  for (const vevent of vcal.getAllSubcomponents('vevent')) {
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
