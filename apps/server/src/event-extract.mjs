// Detects appointments in a mail so the reader can offer "add to calendar".
// Three sources, most reliable first:
//   1. schema.org JSON-LD in the HTML (airlines, hotels, ticket shops, booking sites),
//   2. a plain .ics attachment without iTIP method (invitations are handled separately),
//   3. a date + time written in the text ("am 12.12.2026 um 14:30", "on 3 December at 2 pm").
// Pure functions, no network, nothing leaves the computer.
//
// A suggestion has the shape of the calendar editor's model:
//   { kind, source, summary, allDay, start, end, location, description, reservationNumber }
// Timed start/end are ISO instants ("2026-12-12T07:15:00.000Z") when the source names a zone,
// otherwise floating local times ("2026-12-12T08:15", floating: true) that the client reads in
// the user's zone. All-day start/end are dates; the end is exclusive.

import { parseItip } from './calendar-model.mjs';

const MAX_SUGGESTIONS = 3;
const MAX_HTML = 2_000_000;
const MAX_TEXT = 200_000;

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDaysYmd = (date, n) => {
  const [y, m, d] = date.split('-').map(Number);
  return ymd(new Date(Date.UTC(y, m - 1, d + n)));
};
const str = v => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const clip = (s, max) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

// ------------------------------------------------------------------ date values
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i;

/** schema.org date or date-time → { allDay, value, floating } or null. */
export function schemaTime(v) {
  const s = str(v);
  if (DATE_ONLY.test(s)) return validDate(s) ? { allDay: true, value: s } : null;
  const m = DATE_TIME.exec(s);
  if (!m) return null;
  const [, y, mo, d, h, mi, , zone] = m;
  if (!validDate(`${y}-${mo}-${d}`) || Number(h) > 23 || Number(mi) > 59) return null;
  if (!zone) return { allDay: false, value: `${y}-${mo}-${d}T${h}:${mi}`, floating: true };
  const instant = new Date(s.replace(' ', 'T').replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isNaN(instant.getTime()) ? null : { allDay: false, value: instant.toISOString(), floating: false };
}
function validDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return y >= 1970 && y <= 2200 && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
/** Adds minutes to a timed value (instant or floating), keeping its form. */
function plusMinutes(t, minutes) {
  if (!t.floating) return new Date(Date.parse(t.value) + minutes * 60_000).toISOString();
  const [date, time] = t.value.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, h, mi + minutes));
  return `${ymd(dt)}T${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}`;
}
function later(a, b) {
  if (a.floating !== b.floating) return true; // cannot compare, trust the source
  return a.floating ? b.value > a.value : Date.parse(b.value) > Date.parse(a.value);
}

/** Builds a suggestion from a start/end pair; returns null for unusable times. */
function span(startRaw, endRaw, { defaultMinutes = 60, allDayInclusive = false } = {}) {
  const s = schemaTime(startRaw);
  if (!s) return null;
  const e = schemaTime(endRaw);
  if (s.allDay) {
    const endDate = e ? (e.allDay ? e.value : e.value.slice(0, 10)) : s.value;
    const end = endDate > s.value ? (allDayInclusive ? addDaysYmd(endDate, 1) : endDate) : addDaysYmd(s.value, 1);
    return { allDay: true, start: s.value, end };
  }
  const end = e && !e.allDay && later(s, e) ? e.value : plusMinutes(s, defaultMinutes);
  return { allDay: false, start: s.value, end, ...(s.floating ? { floating: true } : {}) };
}
/** Hotel stays: check-in to check-out as whole days (check-out day included). */
function staySpan(inRaw, outRaw) {
  const s = schemaTime(inRaw);
  if (!s) return null;
  const startDate = s.allDay ? s.value : s.value.slice(0, 10);
  const o = schemaTime(outRaw);
  const outDate = o ? (o.allDay ? o.value : o.value.slice(0, 10)) : startDate;
  return { allDay: true, start: startDate, end: addDaysYmd(outDate > startDate ? outDate : startDate, 1) };
}

// ------------------------------------------------------------------ schema.org
const typeOf = node => {
  const t = Array.isArray(node?.['@type']) ? node['@type'][0] : node?.['@type'];
  return str(t).replace(/^https?:\/\/schema\.org\//i, '');
};
function placeText(p) {
  if (!p) return '';
  if (typeof p === 'string') return p.trim();
  if (Array.isArray(p)) return placeText(p[0]);
  const name = str(p.name);
  const code = str(p.iataCode);
  const addr = addressText(p.address);
  if (typeOf(p) === 'VirtualLocation') return str(p.url) || name;
  return [name || code, code && name ? `(${code})` : '', addr && addr !== name ? addr : '']
    .filter(Boolean)
    .join(name && code ? ' ' : ', ')
    .replace(' , ', ', ');
}
function addressText(a) {
  if (!a) return '';
  if (typeof a === 'string') return a.trim();
  return [
    str(a.streetAddress),
    [str(a.postalCode), str(a.addressLocality)].filter(Boolean).join(' '),
    str(a.addressCountry?.name || a.addressCountry)
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * Contents of <script type="application/ld+json"> blocks. Scanned with indexOf instead of one
 * large regular expression: linear time on hostile input and tolerant of "</script >".
 */
export function jsonLdBlocks(src) {
  const lower = src.toLowerCase();
  const blocks = [];
  let at = 0;
  while (blocks.length < 20) {
    const open = lower.indexOf('<script', at);
    if (open < 0) break;
    const tagEnd = lower.indexOf('>', open);
    if (tagEnd < 0) break;
    const close = lower.indexOf('</script', tagEnd);
    if (close < 0) break;
    const tag = lower.slice(open, tagEnd);
    if (/\btype\s*=\s*["']?application\/ld\+json/.test(tag)) blocks.push(src.slice(tagEnd + 1, close));
    at = close + 8;
  }
  return blocks;
}

/** All JSON-LD objects of an HTML document (flattened: arrays, @graph). */
export function jsonLdNodes(html) {
  const out = [];
  const src = String(html || '').slice(0, MAX_HTML);
  for (const body of jsonLdBlocks(src)) {
    let data;
    try {
      data = JSON.parse(decodeEntities(unwrapComment(body.trim())));
    } catch {
      continue;
    }
    const walk = v => {
      if (out.length > 50) return;
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') {
        if (Array.isArray(v['@graph'])) walk(v['@graph']);
        if (v['@type']) out.push(v);
      }
    };
    walk(data);
  }
  return out;
}
/** Some generators wrap the JSON in an HTML comment marker; only the outer markers go. */
const unwrapComment = s => {
  let t = s;
  if (t.startsWith('<!--')) t = t.slice(4);
  if (t.endsWith('-->')) t = t.slice(0, -3);
  return t.trim();
};
const decodeEntities = s =>
  s.includes('&') && !s.trim().startsWith('{') && !s.trim().startsWith('[')
    ? s
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
    : s;

function fromSchemaNode(node) {
  const type = typeOf(node);
  const res = /Reservation$/.test(type) ? node : null;
  const target = res ? (Array.isArray(res.reservationFor) ? res.reservationFor[0] : res.reservationFor) || {} : node;
  const reservationNumber = res ? str(res.reservationNumber || res.reservationId) : '';
  const base = { source: 'schema', reservationNumber, description: '' };

  if (type === 'FlightReservation' || typeOf(target) === 'Flight') {
    const f = target;
    const airline = str(f.airline?.iataCode || f.airline?.name);
    const number = str(f.flightNumber);
    const flight = number && airline && !number.startsWith(airline) ? `${airline} ${number}` : number || airline;
    const from = str(f.departureAirport?.iataCode) || placeText(f.departureAirport);
    const to = str(f.arrivalAirport?.iataCode) || placeText(f.arrivalAirport);
    const time = span(f.departureTime || res?.startTime, f.arrivalTime, { defaultMinutes: 120 });
    if (!time) return null;
    return {
      ...base,
      kind: 'flight',
      summary: [flight, from && to ? `${from} → ${to}` : from || to].filter(Boolean).join(' '),
      location: placeText(f.departureAirport),
      ...time
    };
  }
  if (type === 'TrainReservation' || type === 'BusReservation' || /^(TrainTrip|BusTrip)$/.test(typeOf(target))) {
    const trip = target;
    const isTrain = type === 'TrainReservation' || typeOf(trip) === 'TrainTrip';
    const number = str(isTrain ? trip.trainNumber || trip.trainName : trip.busNumber || trip.busName);
    const from = placeText(isTrain ? trip.departureStation : trip.departureBusStop);
    const to = placeText(isTrain ? trip.arrivalStation : trip.arrivalBusStop);
    const time = span(trip.departureTime, trip.arrivalTime, { defaultMinutes: 120 });
    if (!time) return null;
    return {
      ...base,
      kind: isTrain ? 'train' : 'bus',
      summary: [number, from && to ? `${from} → ${to}` : from || to].filter(Boolean).join(' '),
      location: from,
      ...time
    };
  }
  if (type === 'LodgingReservation') {
    const time = staySpan(res.checkinTime || res.checkinDate, res.checkoutTime || res.checkoutDate);
    if (!time) return null;
    return {
      ...base,
      kind: 'hotel',
      summary: str(target.name) || 'Hotel',
      location: addressText(target.address) || str(target.name),
      ...time
    };
  }
  if (type === 'RentalCarReservation') {
    const time = span(res.pickupTime, res.dropoffTime);
    if (!time) return null;
    const car = target;
    return {
      ...base,
      kind: 'car',
      summary: [str(car.rentalCompany?.name || car.brand?.name), str(car.name || car.model)].filter(Boolean).join(' '),
      location: placeText(res.pickupLocation),
      ...time
    };
  }
  if (type === 'FoodEstablishmentReservation') {
    const time = span(res.startTime, res.endTime, { defaultMinutes: 120 });
    if (!time) return null;
    return {
      ...base,
      kind: 'restaurant',
      summary: str(target.name),
      location: addressText(target.address) || str(target.name),
      ...time
    };
  }
  // Events (EventReservation, Event and its subtypes such as MusicEvent, BusinessEvent, …).
  const ev = target;
  if (/Event$/.test(typeOf(ev)) || type === 'EventReservation') {
    const time = span(ev.startDate || res?.startTime, ev.endDate || res?.endTime, {
      defaultMinutes: 120,
      allDayInclusive: true
    });
    if (!time) return null;
    return {
      ...base,
      kind: 'event',
      summary: str(ev.name),
      location: placeText(ev.location),
      description: clip(str(ev.description), 2000),
      ...time
    };
  }
  return null;
}

export function suggestionsFromSchema(html) {
  return jsonLdNodes(html).map(fromSchemaNode).filter(Boolean);
}

// ------------------------------------------------------------------ plain .ics
export function suggestionsFromIcs(ics) {
  let info;
  try {
    info = parseItip(ics);
  } catch {
    return [];
  }
  if (!info || info.method || !info.start) return [];
  const end =
    info.end && info.end > info.start
      ? info.end
      : info.allDay
        ? addDaysYmd(info.start, 1)
        : plusMinutes({ value: info.start }, 60);
  return [
    {
      kind: 'calendar',
      source: 'ics',
      summary: info.summary,
      allDay: info.allDay,
      start: info.start,
      end,
      location: info.location,
      description: clip(info.description, 2000),
      reservationNumber: ''
    }
  ];
}

// ------------------------------------------------------------------ text heuristic
const MONTHS = {
  jan: 1, januar: 1, jänner: 1, jaenner: 1, january: 1,
  feb: 2, februar: 2, february: 2,
  mär: 3, mrz: 3, märz: 3, maerz: 3, mar: 3, march: 3,
  apr: 4, april: 4,
  mai: 5, may: 5,
  jun: 6, juni: 6, june: 6,
  jul: 7, juli: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oct: 10, oktober: 10, october: 10,
  nov: 11, november: 11,
  dez: 12, dec: 12, dezember: 12, december: 12
}; // prettier-ignore
const MONTH_RE = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join('|');
const WEEKDAY =
  '(?:(?:mo|di|mi|do|fr|sa|so|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\\.?,?\\s+)?';
// A date: 12.12.2026 · 12.12.26 · 12.12. · 12. Dezember 2026 · 12 December 2026 · December 12, 2026 · 2026-12-12
const DATE_PATTERNS = [
  { re: new RegExp(`\\b${WEEKDAY}(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4}|\\d{2})?(?!\\d)`, 'giu'), parts: m => [m[1], m[2], m[3]] },
  { re: new RegExp(`\\b${WEEKDAY}(\\d{1,2})\\.?\\s+(${MONTH_RE})\\.?(?:\\s+(\\d{4}))?(?![\\p{L}\\d])`, 'giu'), parts: m => [m[1], m[2], m[3]] },
  { re: new RegExp(`\\b${WEEKDAY}(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?(?:\\s+(\\d{4}))?(?![\\p{L}\\d])`, 'giu'), parts: m => [m[2], m[1], m[3]] },
  { re: /\b(\d{4})-(\d{2})-(\d{2})(?![\d:T])/g, parts: m => [m[3], m[2], m[1]] }
]; // prettier-ignore
// A time right after the date: "um 14:30", ", 14.30 Uhr", "at 2 pm", "von 9 bis 11 Uhr", "14:00–15:30"
const TIME_AFTER =
  /^[\s,/\-–—]*(?:(?:um|ab|at|from|von)\s+)?(\d{1,2})(?:[:.](\d{2}))?(?:\s*(uhr|h|am|pm|a\.m\.|p\.m\.)(?![a-zäöü]))?(?:\s*(?:-|–|—|bis|to|until)\s*(\d{1,2})(?:[:.](\d{2}))?(?:\s*(uhr|h|am|pm|a\.m\.|p\.m\.)(?![a-zäöü]))?)?/i;

function hour24(h, suffix) {
  let n = Number(h);
  const s = String(suffix || '')
    .toLowerCase()
    .replace(/\./g, '');
  if (s === 'pm' && n < 12) n += 12;
  if (s === 'am' && n === 12) n = 0;
  return n;
}
/** Year for a date written without one: the next occurrence on or after the mail date. */
function inferYear(day, month, ref) {
  const y = ref.getUTCFullYear();
  const candidate = Date.UTC(y, month - 1, day);
  return candidate < Date.UTC(y, ref.getUTCMonth(), ref.getUTCDate()) - 7 * 86_400_000 ? y + 1 : y;
}
/** "-----Original Message-----", "Am … schrieb Anna:", "From: x@y" start the quoted history. */
function isHistoryStart(line) {
  const t = line.trim();
  if (/^-{2,}\s*(original|ursprüngliche|weitergeleitete|forwarded)/i.test(t)) return true;
  if (/^(von|from):\s/i.test(t) && t.includes('@')) return true;
  return /^(am|on)\s/i.test(t) && t.endsWith(':') && /\b(schrieb|wrote)\b/i.test(t) && t.length < 300;
}
/** Only the new part of a mail: quoted replies and forwarded history are skipped. */
export function ownText(text) {
  const lines = String(text || '')
    .slice(0, MAX_TEXT)
    .split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    if (/^\s*>/.test(line)) continue;
    if (out.length && isHistoryStart(line)) break;
    out.push(line);
  }
  return out.join('\n');
}

export function suggestionsFromText(text, { subject = '', date = null } = {}) {
  const ref = date && !Number.isNaN(new Date(date).getTime()) ? new Date(date) : new Date();
  const body = `${subject}\n${ownText(text)}`;
  const found = [];
  for (const { re, parts } of DATE_PATTERNS) {
    for (const m of body.matchAll(re)) {
      const [dRaw, moRaw, yRaw] = parts(m);
      const day = Number(dRaw);
      const month = /^\d+$/.test(moRaw) ? Number(moRaw) : MONTHS[moRaw.toLowerCase().replace(/\.$/, '')];
      if (!month || day < 1 || day > 31) continue;
      let year = yRaw ? Number(yRaw) : inferYear(day, month, ref);
      if (year < 100) year += 2000;
      const dateStr = `${year}-${pad(month)}-${pad(day)}`;
      if (!validDate(dateStr)) continue;
      const t = TIME_AFTER.exec(body.slice(m.index + m[0].length, m.index + m[0].length + 40));
      // Require a real time: "14:30", "14.30 Uhr", "14 Uhr", "2 pm" (a bare number is a count).
      if (!t || !(t[2] || t[3] || (t[4] && t[6]))) continue;
      const h = hour24(t[1], t[3] || t[6]);
      const mi = Number(t[2] || 0);
      if (h > 23 || mi > 59) continue;
      // Appointments in the past (older than the mail) are history, not plans.
      if (
        Date.UTC(year, month - 1, day) <
        Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate()) - 86_400_000
      )
        continue;
      const start = { value: `${dateStr}T${pad(h)}:${pad(mi)}`, floating: true };
      let end = plusMinutes(start, 60);
      if (t[4]) {
        const eh = hour24(t[4], t[6] || t[3]);
        const em = Number(t[5] || 0);
        if (eh <= 23 && em <= 59) {
          const candidate = `${dateStr}T${pad(eh)}:${pad(em)}`;
          if (candidate > start.value) end = candidate;
        }
      }
      found.push({ index: m.index, start: start.value, end });
    }
  }
  found.sort((a, b) => a.index - b.index);
  const summary = clip(
    String(subject || '')
      .replace(/^\s*((re|aw|wg|fw|fwd|antw)\s*:\s*)+/i, '')
      .trim(),
    200
  );
  return found.map(f => ({
    kind: 'date',
    source: 'text',
    summary,
    allDay: false,
    start: f.start,
    end: f.end,
    floating: true,
    location: '',
    description: '',
    reservationNumber: ''
  }));
}

// ------------------------------------------------------------------ combined
/**
 * Suggestions for one mail, best first, without duplicates. `ics` is a calendar part that is not
 * an iTIP invitation (those get the invitation card instead).
 */
export function extractEventSuggestions({ html = '', text = '', subject = '', date = null, ics = null } = {}) {
  const structured = [...suggestionsFromSchema(html), ...(ics ? suggestionsFromIcs(ics) : [])];
  // The text heuristic only runs when the mail carries no structured data: booking mails also
  // mention dates in their text, which would show up twice.
  const all = structured.length ? structured : suggestionsFromText(text, { subject, date });
  const seen = new Set();
  const out = [];
  for (const s of all) {
    if (!s.summary) s.summary = clip(String(subject || '').trim(), 200);
    const key = `${s.start}|${s.summary}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...s, summary: clip(s.summary, 300), location: clip(s.location || '', 500) });
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}
