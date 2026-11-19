// Finding a time with others ("Termin finden") and booking by e-mail, without a server of our own.
//
// - Common free slots over the calendars of several people (own calendars, free/busy of colleagues
//   from Microsoft 365 / Google, or calendars shared with the user).
// - Proposals by e-mail: every slot is a mailto: link. A click opens a prepared reply in the
//   recipient's own mail program; Levuvo Mail recognises the reply by the token in the subject.
//   Polls collect who can when; one-off offers and booking links book the first slot picked.
//
// This module is pure (no I/O): the routes in routes-scheduling.mjs do the calendar and mail work.
import { randomBytes } from 'node:crypto';

export const MAX_PARTICIPANTS = 20;
export const MAX_SLOTS = 8;
export const MAX_RANGE_DAYS = 62;
export const STEP_MINUTES = 15;
const DAY = 86_400_000;
const WEEKDAYS = [1, 2, 3, 4, 5];

const fail = (message, code = 'scheduling_invalid', statusCode = 400) =>
  Object.assign(new Error(message), { code, statusCode });

// ------------------------------------------------------------------ tokens in subjects
/** 24 characters base64url (144 bit): unguessable, so a reply cannot be forged without the mail. */
export const newToken = () => randomBytes(18).toString('base64url');
const TOKEN = /\[LV-([A-Za-z0-9_-]{24})(?:\s+(?:#(\d{1,2})|@(\d{8}T\d{4})Z))?\]/;

/**
 * `[LV-token]`        request (booking link) or a vote with the numbers in the text
 * `[LV-token #2]`     slot 2 of a poll or offer; `#0` = none of the times fits
 * `[LV-token @20261124T0900Z]` a time from a booking link (UTC)
 */
export function parseSubjectToken(subject) {
  const m = TOKEN.exec(String(subject || ''));
  if (!m) return null;
  let at = null;
  if (m[3]) {
    const s = m[3];
    const ms = Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(9, 11), +s.slice(11, 13));
    if (Number.isFinite(ms)) at = new Date(ms).toISOString();
  }
  return { token: m[1], slot: m[2] !== undefined ? Number(m[2]) : null, at };
}
export const stamp = iso => {
  const d = new Date(iso);
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}Z`;
};
export const subjectTag = (token, { slot = null, at = null } = {}) =>
  `[LV-${token}${slot !== null ? ` #${slot}` : at ? ` @${stamp(at)}` : ''}]`;

/** Slot numbers written in a reply ("2 und 4", "1,3"), quoted lines ignored; [] when none. */
export function votesFromText(text, count) {
  const own = String(text || '')
    .split(/\r?\n/)
    .filter(l => !/^\s*>/.test(l))
    .join('\n');
  // Only the part above a quoted original ("Am … schrieb", "On … wrote", "-----Original").
  const head = own
    .split(/\n(?:Am .{3,120}schrieb|On .{3,120}wrote|-{2,}\s*(?:Original|Ursprüngliche))/i)[0]
    .slice(0, 2000);
  const nums = [...head.matchAll(/(?<![\d:.,/-])(\d{1,2})(?!\d)(?![:.,/-]\d)/g)].map(m => Number(m[1]));
  return [...new Set(nums.filter(n => n >= 1 && n <= count))].sort((a, b) => a - b);
}

// ------------------------------------------------------------------ time zone helpers
const partFormatters = new Map();
function partsIn(ms, timeZone) {
  let f = partFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
    partFormatters.set(timeZone, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return {
    day: `${p.year}-${p.month}-${p.day}`,
    weekday: { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday],
    minutes: Number(p.hour) * 60 + Number(p.minute)
  };
}
/** "YYYY-MM-DDTHH:mm" wall-clock time of an instant in a time zone (for the event editor model). */
export function wallClock(iso, timeZone) {
  const ms = Date.parse(iso);
  const p = partsIn(ms, timeZone);
  const pad = n => String(n).padStart(2, '0');
  return `${p.day}T${pad(Math.floor(p.minutes / 60))}:${pad(p.minutes % 60)}`;
}
export function validTimeZone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ search input
const int = (v, min, max, fallback) => (Number.isInteger(v) && v >= min && v <= max ? v : fallback);
const EMAIL = /^[^\s@<>,;"]{1,64}@[^\s@<>,;"]{1,255}$/;
export function normalizeAddress(value) {
  const email = String(value || '')
    .trim()
    .toLowerCase();
  if (!EMAIL.test(email)) throw fail('Ungültige E-Mail-Adresse.');
  return email;
}

/** Validates what to search: who, how long, where in the calendar. */
export function validateSearch(input = {}) {
  const from = Date.parse(input.from);
  const to = Date.parse(input.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) throw fail('Ungültiger Zeitraum.');
  if (to - from > MAX_RANGE_DAYS * DAY) throw fail(`Höchstens ${MAX_RANGE_DAYS} Tage auf einmal.`);
  const minutes = int(input.minutes, 15, 480, 30);
  const dayStart = int(input.dayStart, 0, 23, 8);
  const dayEnd = int(input.dayEnd, 1, 24, 18);
  if (dayEnd <= dayStart || (dayEnd - dayStart) * 60 < minutes)
    throw fail('Die Arbeitszeit ist kürzer als der Termin.');
  const weekdays = Array.isArray(input.weekdays)
    ? [...new Set(input.weekdays.filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    : WEEKDAYS;
  if (!weekdays.length) throw fail('Bitte mindestens einen Wochentag wählen.');
  const timeZone = validTimeZone(input.timeZone) ? input.timeZone : 'Europe/Vienna';
  const people = (Array.isArray(input.participants) ? input.participants : []).map(p => {
    const email = normalizeAddress(typeof p === 'string' ? p : p?.email);
    const calendarUrl = typeof p?.calendarUrl === 'string' && p.calendarUrl.length <= 2000 ? p.calendarUrl : '';
    const name = typeof p?.name === 'string' ? p.name.slice(0, 200).replace(/[\r\n\0]/g, ' ') : '';
    return { email, name, calendarUrl };
  });
  const unique = [...new Map(people.map(p => [p.email, p])).values()];
  if (unique.length > MAX_PARTICIPANTS) throw fail(`Höchstens ${MAX_PARTICIPANTS} Personen.`);
  // Earliest start: never in the past, with a little lead time.
  const notBefore = Math.max(from, Number.isFinite(input.now) ? input.now : Date.now());
  return {
    from: notBefore,
    to,
    minutes,
    dayStart,
    dayEnd,
    weekdays,
    timeZone,
    participants: unique,
    allDayBusy: input.allDayBusy === true,
    bufferMinutes: int(input.bufferMinutes, 0, 120, 0)
  };
}

// ------------------------------------------------------------------ busy times
/**
 * Busy blocks [start, end] in ms from calendar events: cancelled events, events the person
 * declined and (unless `allDayBusy`) all-day events do not block.
 */
export function busyFromEvents(events, { ownAddresses = [], allDayBusy = false, timeZone = 'Europe/Vienna' } = {}) {
  const own = new Set(ownAddresses.map(a => String(a).toLowerCase()));
  const out = [];
  for (const e of events || []) {
    if (!e || e.status === 'CANCELLED' || e.transparent === true) continue;
    const declined = (e.attendees || []).some(a => own.has(String(a.email).toLowerCase()) && a.partstat === 'DECLINED');
    if (declined) continue;
    if (e.allDay) {
      if (!allDayBusy) continue;
      const s = dayStartMs(e.start, timeZone);
      const en = dayStartMs(e.end || e.start, timeZone);
      if (Number.isFinite(s)) out.push([s, Number.isFinite(en) && en > s ? en : s + DAY]);
      continue;
    }
    const s = Date.parse(e.start);
    const en = Date.parse(e.end);
    if (Number.isFinite(s) && Number.isFinite(en) && en > s) out.push([s, en]);
  }
  return mergeBusy(out);
}
/** Midnight of a calendar day (YYYY-MM-DD) in a time zone, in ms. */
function dayStartMs(date, timeZone) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date || ''));
  if (!m) return NaN;
  let guess = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  // Two corrections are enough for any offset (also on days with a DST switch).
  for (let i = 0; i < 2; i++) {
    const p = partsIn(guess, timeZone);
    const diffDays = Math.round((Date.parse(`${p.day}T00:00:00Z`) - Date.parse(`${m[0]}T00:00:00Z`)) / DAY);
    guess -= diffDays * DAY + p.minutes * 60_000;
  }
  return guess;
}
export function mergeBusy(list) {
  const sorted = list.filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [s, e] of sorted) {
    const last = out.at(-1);
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}
const overlaps = (busy, s, e) => {
  // busy is sorted and merged: binary search for the first block ending after s.
  let lo = 0;
  let hi = busy.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (busy[mid][1] <= s) lo = mid + 1;
    else hi = mid;
  }
  return lo < busy.length && busy[lo][0] < e;
};

/**
 * Slots within working hours on the chosen weekdays. `people` maps a person (e-mail or "me") to
 * `{ busy }` (merged blocks) or `{ unknown: true }` when their calendar could not be read.
 * Slots where everyone known is free come first; when there are none, the slots where the most
 * people are free. Slots do not overlap each other.
 */
export function findSlots(people, search, { max = 30 } = {}) {
  const { from, to, minutes, dayStart, dayEnd, weekdays, timeZone, bufferMinutes = 0 } = search;
  const step = STEP_MINUTES * 60_000;
  const len = minutes * 60_000;
  const buffer = bufferMinutes * 60_000;
  const entries = Object.entries(people);
  const known = entries.filter(([, p]) => !p.unknown);
  const unknown = entries.filter(([, p]) => p.unknown).map(([k]) => k);
  const candidates = [];
  for (let t = Math.ceil(from / step) * step; t + len <= to; t += step) {
    const p = partsIn(t, timeZone);
    if (!weekdays.includes(p.weekday)) continue;
    if (p.minutes < dayStart * 60 || p.minutes + minutes > dayEnd * 60) continue;
    // The end must be on the same day in that time zone (also across a DST switch).
    if (partsIn(t + len - 1, timeZone).day !== p.day) continue;
    const free = known.filter(([, x]) => !overlaps(x.busy, t - buffer, t + len + buffer)).map(([k]) => k);
    if (!free.length && known.length) continue;
    candidates.push({ t, free });
  }
  const pick = list => {
    const out = [];
    let until = -Infinity;
    for (const c of list) {
      if (c.t < until) continue;
      out.push(c);
      until = c.t + len;
    }
    return out;
  };
  const everyone = pick(candidates.filter(c => c.free.length === known.length));
  let chosen = everyone;
  if (everyone.length < Math.min(max, 5) && known.length > 1) {
    // Too few times for everyone: add the best partial ones, most people first.
    const partial = pick(candidates.filter(c => c.free.length < known.length)).sort(
      (a, b) => b.free.length - a.free.length || a.t - b.t
    );
    chosen = [...everyone, ...partial.slice(0, max - everyone.length)];
  }
  return chosen.slice(0, max).map(c => ({
    start: new Date(c.t).toISOString(),
    end: new Date(c.t + len).toISOString(),
    free: c.free,
    busy: known.map(([k]) => k).filter(k => !c.free.includes(k)),
    unknown,
    all: c.free.length === known.length
  }));
}

/** Is [start, end) still free in these busy blocks? */
export const isFree = (busy, start, end) => !overlaps(busy, Date.parse(start), Date.parse(end));

// ------------------------------------------------------------------ booking link windows
/** Validates a booking link's settings. */
export function validateLink(input = {}, existing = null) {
  const title = String(input.title ?? existing?.title ?? '')
    .replace(/[\r\n\0]/g, ' ')
    .trim()
    .slice(0, 120);
  if (!title) throw fail('Bitte einen Titel eingeben.');
  const dayStart = int(input.dayStart, 0, 23, existing?.dayStart ?? 9);
  const dayEnd = int(input.dayEnd, 1, 24, existing?.dayEnd ?? 17);
  const minutes = int(input.minutes, 15, 240, existing?.minutes ?? 30);
  if (dayEnd <= dayStart || (dayEnd - dayStart) * 60 < minutes)
    throw fail('Die Arbeitszeit ist kürzer als der Termin.');
  const weekdays = Array.isArray(input.weekdays)
    ? [...new Set(input.weekdays.filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    : existing?.weekdays || WEEKDAYS;
  if (!weekdays.length) throw fail('Bitte mindestens einen Wochentag wählen.');
  return {
    title,
    minutes,
    dayStart,
    dayEnd,
    weekdays,
    daysAhead: int(input.daysAhead, 1, 60, existing?.daysAhead ?? 14),
    noticeHours: int(input.noticeHours, 0, 168, existing?.noticeHours ?? 12),
    bufferMinutes: int(input.bufferMinutes, 0, 120, existing?.bufferMinutes ?? 0),
    location: String(input.location ?? existing?.location ?? '')
      .replace(/[\r\n\0]/g, ' ')
      .slice(0, 300),
    enabled: input.enabled === undefined ? (existing?.enabled ?? true) : input.enabled === true,
    timeZone: validTimeZone(input.timeZone) ? input.timeZone : existing?.timeZone || 'Europe/Vienna',
    lang: input.lang === 'en' || input.lang === 'de' ? input.lang : existing?.lang || 'de'
  };
}
/** The search a booking link answers with at `now`. */
export function linkSearch(link, now) {
  return {
    from: now + link.noticeHours * 3600_000,
    to: now + link.daysAhead * DAY,
    minutes: link.minutes,
    dayStart: link.dayStart,
    dayEnd: link.dayEnd,
    weekdays: link.weekdays,
    timeZone: link.timeZone,
    bufferMinutes: link.bufferMinutes
  };
}
/** Does a picked time fit the link's rules (grid, hours, weekdays, notice, range)? */
export function fitsLink(link, at, now) {
  const t = Date.parse(at);
  const s = linkSearch(link, now);
  if (!Number.isFinite(t) || t < s.from || t + link.minutes * 60_000 > s.to) return false;
  if (t % (STEP_MINUTES * 60_000) !== 0) return false;
  const p = partsIn(t, link.timeZone);
  return (
    s.weekdays.includes(p.weekday) &&
    p.minutes >= s.dayStart * 60 &&
    p.minutes + link.minutes <= s.dayEnd * 60 &&
    partsIn(t + link.minutes * 60_000 - 1, link.timeZone).day === p.day
  );
}

/** Spreads offers over several days: at most `perDay` per day, `max` in total. */
export function spreadSlots(slots, { max = MAX_SLOTS, perDay = 2, timeZone = 'Europe/Vienna' } = {}) {
  const byDay = new Map();
  const out = [];
  for (const s of slots) {
    const day = partsIn(Date.parse(s.start), timeZone).day;
    const n = byDay.get(day) || 0;
    if (n >= perDay) continue;
    byDay.set(day, n + 1);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

// ------------------------------------------------------------------ mail texts
const TEXT = {
  de: {
    pollIntro: (who, title) => `${who} sucht einen Termin für „${title}“. Welche Zeiten passen dir?`,
    pollHow:
      'Klicke bei jeder Zeit, die passt, auf „Passt“. Dein Mailprogramm öffnet eine vorbereitete Antwort, die du nur noch abschickst. Du kannst auch einfach antworten und die Nummern nennen, z. B. „1 und 3“.',
    offerIntro: (who, title) => `${who} bietet dir diese Zeiten für „${title}“ an.`,
    offerHow:
      'Klicke auf die Zeit, die dir passt. Dein Mailprogramm öffnet eine vorbereitete Antwort, die du nur noch abschickst. Du bekommst danach eine Kalendereinladung.',
    fits: 'Passt',
    book: 'Diese Zeit buchen',
    none: 'Keine dieser Zeiten passt',
    location: 'Ort',
    duration: m => `Dauer: ${m} Minuten`,
    voteBody: label => `Passt für mich: ${label}`,
    noneBody: 'Leider passt keine dieser Zeiten.',
    bookBody: label => `Ich möchte diese Zeit buchen: ${label}`,
    pollSubject: title => `Terminabstimmung: ${title}`,
    offerSubject: title => `Terminvorschläge: ${title}`,
    linkSubject: title => `Freie Zeiten: ${title}`,
    linkIntro: title => `Danke für deine Anfrage. Diese Zeiten sind für „${title}“ frei:`,
    linkNone: title =>
      `Danke für deine Anfrage. Für „${title}“ ist in den nächsten Tagen leider keine Zeit frei. Bitte versuche es später noch einmal.`,
    takenSubject: title => `Diese Zeit ist leider vergeben: ${title}`,
    taken: 'Diese Zeit ist leider nicht mehr frei. Hier sind andere freie Zeiten:',
    takenNone: 'Diese Zeit ist leider nicht mehr frei, und gerade sind keine anderen Zeiten frei.',
    auto: 'Diese Nachricht wurde von Levuvo Mail automatisch beantwortet.',
    footer:
      'Gesendet mit Levuvo Mail. Es wird kein Dienst eines Dritten verwendet, die Antwort geht nur an den Absender.',
    request: title => `Terminanfrage: ${title}`,
    requestBody: 'Bitte schick mir freie Zeiten.'
  },
  en: {
    pollIntro: (who, title) => `${who} is looking for a time for “${title}”. Which times work for you?`,
    pollHow:
      'Click “Works” next to every time that suits you. Your mail program opens a prepared reply that you only need to send. You can also just reply with the numbers, for example “1 and 3”.',
    offerIntro: (who, title) => `${who} offers you these times for “${title}”.`,
    offerHow:
      'Click the time that suits you. Your mail program opens a prepared reply that you only need to send. You will then receive a calendar invitation.',
    fits: 'Works',
    book: 'Book this time',
    none: 'None of these times works',
    location: 'Location',
    duration: m => `Duration: ${m} minutes`,
    voteBody: label => `Works for me: ${label}`,
    noneBody: 'Unfortunately none of these times works for me.',
    bookBody: label => `I would like to book this time: ${label}`,
    pollSubject: title => `Scheduling poll: ${title}`,
    offerSubject: title => `Suggested times: ${title}`,
    linkSubject: title => `Free times: ${title}`,
    linkIntro: title => `Thank you for your request. These times are free for “${title}”:`,
    linkNone: title =>
      `Thank you for your request. Unfortunately there is no free time for “${title}” in the next days. Please try again later.`,
    takenSubject: title => `This time is no longer available: ${title}`,
    taken: 'Unfortunately this time is no longer free. Here are other free times:',
    takenNone: 'Unfortunately this time is no longer free, and there are no other free times right now.',
    auto: 'This message was answered automatically by Levuvo Mail.',
    footer: 'Sent with Levuvo Mail. No third-party service is used; replies go only to the sender.',
    request: title => `Meeting request: ${title}`,
    requestBody: 'Please send me free times.'
  }
};
export const texts = lang => TEXT[lang === 'en' ? 'en' : 'de'];

export function slotLabel(slot, { lang = 'de', timeZone = 'Europe/Vienna' } = {}) {
  const locale = lang === 'en' ? 'en-GB' : 'de-AT';
  const s = new Date(slot.start);
  const e = new Date(slot.end);
  const day = new Intl.DateTimeFormat(locale, { timeZone, weekday: 'long', day: 'numeric', month: 'long' }).format(s);
  const time = new Intl.DateTimeFormat(locale, { timeZone, hour: '2-digit', minute: '2-digit' });
  return `${day}, ${time.format(s)}–${time.format(e)}`;
}
const tzLabel = (timeZone, lang) => (lang === 'en' ? `Times in ${timeZone}` : `Zeiten in ${timeZone}`);

export function mailtoUrl(address, subject, body) {
  return `mailto:${encodeURIComponent(address).replace(/%40/g, '@')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
const esc = s =>
  String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * The proposal mail of a poll (`kind: 'poll'`, everyone votes) or a one-off offer
 * (`kind: 'offer'`, the first pick is booked). Returns { subject, text, html }.
 */
export function proposalMail({
  kind,
  token,
  title,
  slots,
  replyTo,
  organizer,
  message = '',
  lang,
  timeZone,
  minutes,
  location = ''
}) {
  const T = texts(lang);
  const poll = kind === 'poll';
  const subject = `${poll ? T.pollSubject(title) : T.offerSubject(title)} ${subjectTag(token)}`;
  const rows = slots.map((s, i) => {
    const label = slotLabel(s, { lang, timeZone });
    const url = mailtoUrl(
      replyTo,
      `Re: ${title} ${subjectTag(token, { slot: i + 1 })}`,
      poll ? T.voteBody(label) : T.bookBody(label)
    );
    return { n: i + 1, label, url };
  });
  const noneUrl = mailtoUrl(replyTo, `Re: ${title} ${subjectTag(token, { slot: 0 })}`, T.noneBody);
  const intro = poll ? T.pollIntro(organizer, title) : T.offerIntro(organizer, title);
  const how = poll ? T.pollHow : T.offerHow;
  const facts = [T.duration(minutes), location ? `${T.location}: ${location}` : '', tzLabel(timeZone, lang)].filter(
    Boolean
  );
  const text = [
    intro,
    ...(message ? ['', message] : []),
    '',
    ...rows.map(r => `${r.n}. ${r.label}\n   ${poll ? T.fits : T.book}: ${r.url}`),
    ...(poll ? ['', `${T.none}: ${noneUrl}`] : []),
    '',
    how,
    '',
    ...facts,
    '',
    T.footer
  ].join('\n');
  const html = [
    `<p>${esc(intro)}</p>`,
    message ? `<p>${esc(message).replace(/\n/g, '<br>')}</p>` : '',
    '<ol>',
    ...rows.map(r => `<li>${esc(r.label)} – <a href="${esc(r.url)}">${esc(poll ? T.fits : T.book)}</a></li>`),
    '</ol>',
    poll ? `<p><a href="${esc(noneUrl)}">${esc(T.none)}</a></p>` : '',
    `<p>${esc(how)}</p>`,
    `<p>${facts.map(esc).join('<br>')}</p>`,
    `<p><small>${esc(T.footer)}</small></p>`
  ]
    .filter(Boolean)
    .join('\n');
  return { subject, text, html };
}

/** Free times answered to a booking link request (or after a time was taken). */
export function offersMail({ token, link, slots, replyTo, lang, taken = false }) {
  const T = texts(lang);
  const subject = `${taken ? T.takenSubject(link.title) : T.linkSubject(link.title)} ${subjectTag(token)}`;
  const rows = slots.map((s, i) => {
    const label = slotLabel(s, { lang, timeZone: link.timeZone });
    return {
      n: i + 1,
      label,
      url: mailtoUrl(replyTo, `Re: ${link.title} ${subjectTag(token, { at: s.start })}`, T.bookBody(label))
    };
  });
  const intro = slots.length
    ? taken
      ? T.taken
      : T.linkIntro(link.title)
    : taken
      ? T.takenNone
      : T.linkNone(link.title);
  const facts = [
    T.duration(link.minutes),
    link.location ? `${T.location}: ${link.location}` : '',
    tzLabel(link.timeZone, lang)
  ].filter(Boolean);
  const text = [
    intro,
    '',
    ...rows.map(r => `${r.n}. ${r.label}\n   ${T.book}: ${r.url}`),
    ...(rows.length ? ['', T.offerHow, ''] : ['']),
    ...facts,
    '',
    T.auto,
    T.footer
  ].join('\n');
  const html = [
    `<p>${esc(intro)}</p>`,
    rows.length ? '<ol>' : '',
    ...rows.map(r => `<li>${esc(r.label)} – <a href="${esc(r.url)}">${esc(T.book)}</a></li>`),
    rows.length ? '</ol>' : '',
    rows.length ? `<p>${esc(T.offerHow)}</p>` : '',
    `<p>${facts.map(esc).join('<br>')}</p>`,
    `<p><small>${esc(T.auto)} ${esc(T.footer)}</small></p>`
  ]
    .filter(Boolean)
    .join('\n');
  return { subject, text, html };
}

/** The address and text people use to ask for times (for a signature or a web page). */
export function linkRequest({ token, link, address }) {
  const T = texts(link.lang);
  const url = mailtoUrl(address, `${T.request(link.title)} ${subjectTag(token)}`, T.requestBody);
  return { url, subject: `${T.request(link.title)} ${subjectTag(token)}` };
}

// ------------------------------------------------------------------ incoming replies
/** Tallies the votes of a poll: per slot who can, plus who answered "none". */
export function tally(poll) {
  const counts = poll.slots.map(() => []);
  const none = [];
  for (const [email, v] of Object.entries(poll.votes || {})) {
    if (v.none) none.push(email);
    for (const n of v.slots || []) if (counts[n - 1]) counts[n - 1].push(email);
  }
  return { counts, none };
}
