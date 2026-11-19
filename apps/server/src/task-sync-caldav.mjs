// CalDAV tasks (VTODO, RFC 5545 §3.6.2 / RFC 4791) for the task sync (task-sync.mjs): Nextcloud,
// mailbox.org, iCloud (app password), Radicale, … with the CalDAV accounts from dav.mjs.
//
// Only VTODO collections are listed. Unknown properties of a task (categories, attachments,
// properties of other apps) are kept: an update only changes the fields that changed.
// Basic auth goes only to https addresses of the account's own domain.
import ICAL from 'ical.js';
import { randomUUID } from 'node:crypto';
import { ensureTimezone } from './calendar-model.mjs';

const MAX_ITEMS = 5000;
const MAX_BODY = 20 * 1024 * 1024;
const fail = (message, code, statusCode = 502) => Object.assign(new Error(message), { code, statusCode });
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const pad = n => String(n).padStart(2, '0');

export const CALDAV_CAPS = {
  fields: ['title', 'notes', 'due', 'remindAt', 'priority', 'repeat', 'done'],
  dueTime: true,
  advancesRepeats: false
};

// ------------------------------------------------------------------ XML
const decode = s =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
const tagRe = (tag, flags = 'i') =>
  new RegExp(`<(?:[\\w-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}\\s*>`, flags);
const xmlText = (xml, tag) => {
  const m = tagRe(tag).exec(xml);
  return m ? decode(m[1]).trim() : null;
};
const xmlBlock = (xml, tag) => tagRe(tag).exec(xml)?.[1] ?? null;
const responsesOf = xml => [...String(xml).matchAll(tagRe('response', 'gi'))].map(m => m[1]);
/** Props of the propstat blocks with status 200 (others describe missing props). */
function okProps(response) {
  const blocks = [...response.matchAll(tagRe('propstat', 'gi'))].map(m => m[1]);
  if (!blocks.length) return response;
  return blocks.filter(p => !/<(?:[\w-]+:)?status[^>]*>[^<]*\s(?!200)\d{3}\s/i.test(p)).join('\n');
}

// ------------------------------------------------------------------ VTODO mapping
function registerZones(vcal) {
  for (const tz of vcal.getAllSubcomponents('vtimezone')) {
    const tzid = tz.getFirstPropertyValue('tzid');
    if (tzid && !ICAL.TimezoneService.has(tzid)) ICAL.TimezoneService.register(tz);
  }
  for (const todo of vcal.getAllSubcomponents('vtodo'))
    for (const name of ['due', 'dtstart']) {
      const tzid = todo.getFirstProperty(name)?.getParameter('tzid');
      if (tzid && !ICAL.TimezoneService.has(tzid)) ensureTimezone(tzid);
    }
}
const timeValue = t => (t.isDate ? `${t.year}-${pad(t.month)}-${pad(t.day)}` : t.toJSDate().toISOString());
const priorityIn = n => (!n ? 'none' : n <= 4 ? 'high' : n === 5 ? 'medium' : 'low');
const PRIORITY_OUT = { high: 1, medium: 5, low: 9 };
const ALLOWED_RULE = new Set(['FREQ', 'INTERVAL', 'WKST', 'COUNT', 'UNTIL']);

function repeatIn(todo) {
  const rule = todo.getFirstPropertyValue('rrule');
  if (!rule) return null;
  const parts = Object.keys(rule.toJSON()).map(k => k.toUpperCase());
  if (parts.some(p => !ALLOWED_RULE.has(p))) return null; // e.g. BYDAY: not representable
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(rule.freq)) return null;
  return { freq: rule.freq, interval: rule.interval || 1 };
}
function reminderIn(todo) {
  for (const alarm of todo.getAllSubcomponents('valarm')) {
    const prop = alarm.getFirstProperty('trigger');
    if (!prop) continue;
    const value = prop.getFirstValue();
    if (value instanceof ICAL.Time) return value.toJSDate().toISOString();
    if (value instanceof ICAL.Duration) {
      const related = String(prop.getParameter('related') || '').toUpperCase();
      const anchor =
        related === 'END' || !todo.getFirstPropertyValue('dtstart')
          ? todo.getFirstPropertyValue('due')
          : todo.getFirstPropertyValue('dtstart');
      if (!anchor) continue;
      return new Date(anchor.toJSDate().getTime() + value.toSeconds() * 1000).toISOString();
    }
  }
  return null;
}

/** The master VTODO of an object (null for anything else). */
function masterTodo(vcal) {
  const todos = vcal.getAllSubcomponents('vtodo').filter(t => !t.getFirstProperty('recurrence-id'));
  return todos.length === 1 ? todos[0] : null;
}

export function parseTodo(ics) {
  const vcal = new ICAL.Component(ICAL.parse(ics));
  registerZones(vcal);
  const todo = masterTodo(vcal);
  if (!todo) return null;
  const due = todo.getFirstPropertyValue('due');
  const status = String(todo.getFirstPropertyValue('status') || '').toUpperCase();
  const modified = todo.getFirstPropertyValue('last-modified') || todo.getFirstPropertyValue('dtstamp');
  return {
    uid: String(todo.getFirstPropertyValue('uid') || ''),
    modified: modified ? modified.toJSDate().toISOString() : null,
    fields: {
      title: String(todo.getFirstPropertyValue('summary') || ''),
      notes: String(todo.getFirstPropertyValue('description') || ''),
      due: due ? timeValue(due) : null,
      remindAt: reminderIn(todo),
      priority: priorityIn(Number(todo.getFirstPropertyValue('priority')) || 0),
      repeat: repeatIn(todo),
      done: status === 'COMPLETED' || Boolean(todo.getFirstProperty('completed'))
    }
  };
}

const icalTime = value =>
  DATE.test(value) ? ICAL.Time.fromDateString(value) : ICAL.Time.fromJSDate(new Date(value), true);
const utcNow = now => ICAL.Time.fromJSDate(now, true);

function setText(todo, name, value) {
  todo.removeAllProperties(name);
  if (value) todo.addPropertyWithValue(name, value);
}

/** Writes `patch` (projected fields) into the VTODO; everything else stays as it is. */
function applyPatch(todo, patch, now) {
  if ('title' in patch) setText(todo, 'summary', patch.title);
  if ('notes' in patch) setText(todo, 'description', patch.notes);
  if ('priority' in patch) {
    todo.removeAllProperties('priority');
    if (PRIORITY_OUT[patch.priority]) todo.addPropertyWithValue('priority', PRIORITY_OUT[patch.priority]);
  }
  if ('due' in patch) {
    todo.removeAllProperties('due');
    if (patch.due) {
      const due = icalTime(patch.due);
      todo.addPropertyWithValue('due', due);
      // DTSTART must be of the same type and not after DUE (RFC 5545 §3.8.2.3).
      const start = todo.getFirstPropertyValue('dtstart');
      if (start && (start.isDate !== due.isDate || start.compare(due) > 0)) {
        todo.removeAllProperties('dtstart');
        todo.addPropertyWithValue('dtstart', due.clone());
      }
    }
  }
  if ('repeat' in patch) {
    todo.removeAllProperties('rrule');
    if (patch.repeat) {
      todo.addPropertyWithValue(
        'rrule',
        ICAL.Recur.fromData({ freq: patch.repeat.freq, interval: patch.repeat.interval })
      );
      // A repeating task needs a start; the due date is used.
      const due = todo.getFirstPropertyValue('due');
      if (!todo.getFirstProperty('dtstart') && due) todo.addPropertyWithValue('dtstart', due.clone());
    }
  }
  if ('remindAt' in patch) {
    for (const alarm of todo.getAllSubcomponents('valarm')) todo.removeSubcomponent(alarm);
    if (patch.remindAt) {
      const alarm = new ICAL.Component('valarm');
      alarm.addPropertyWithValue('action', 'DISPLAY');
      alarm.addPropertyWithValue('description', todo.getFirstPropertyValue('summary') || 'Aufgabe');
      alarm.addPropertyWithValue('trigger', ICAL.Time.fromJSDate(new Date(patch.remindAt), true));
      todo.addSubcomponent(alarm);
    }
  }
  if ('done' in patch) {
    for (const name of ['status', 'completed', 'percent-complete']) todo.removeAllProperties(name);
    if (patch.done) {
      todo.addPropertyWithValue('status', 'COMPLETED');
      todo.addPropertyWithValue('completed', utcNow(now));
      todo.addPropertyWithValue('percent-complete', 100);
    } else todo.addPropertyWithValue('status', 'NEEDS-ACTION');
  }
  for (const name of ['dtstamp', 'last-modified']) {
    todo.removeAllProperties(name);
    todo.addPropertyWithValue(name, utcNow(now));
  }
  const seq = Number(todo.getFirstPropertyValue('sequence')) || 0;
  todo.removeAllProperties('sequence');
  todo.addPropertyWithValue('sequence', seq + 1);
}

export function createTodoIcs(fields, { uid = randomUUID(), now = new Date() } = {}) {
  const vcal = new ICAL.Component('vcalendar');
  vcal.addPropertyWithValue('prodid', '-//Levuvo Mail//Tasks//DE');
  vcal.addPropertyWithValue('version', '2.0');
  const todo = new ICAL.Component('vtodo');
  todo.addPropertyWithValue('uid', uid);
  todo.addPropertyWithValue('created', utcNow(now));
  vcal.addSubcomponent(todo);
  applyPatch(todo, { done: false, ...fields }, now);
  todo.removeAllProperties('sequence');
  todo.addPropertyWithValue('sequence', 0);
  return vcal.toString();
}
export function updateTodoIcs(ics, patch, { now = new Date() } = {}) {
  const vcal = new ICAL.Component(ICAL.parse(ics));
  const todo = masterTodo(vcal);
  if (!todo) throw fail('Die Aufgabe auf dem Server lässt sich nicht lesen.', 'task_sync_unreadable');
  applyPatch(todo, patch, now);
  return vcal.toString();
}

// ------------------------------------------------------------------ HTTP
/** https on the account's domain (iCloud answers from pNN-caldav.icloud.com), or the same origin. */
export function allowedUrl(url, serverUrl) {
  let u;
  let s;
  try {
    u = new URL(url);
    s = new URL(serverUrl);
  } catch {
    return false;
  }
  if (u.username || u.password) return false;
  if (u.origin === s.origin) return true;
  if (u.protocol !== 'https:') return false;
  const site = h => h.split('.').slice(-2).join('.');
  return site(u.hostname) === site(s.hostname) && u.hostname.includes('.');
}

export function createCaldavTasks({ store, fetchImpl = globalThis.fetch, now = () => new Date() }) {
  const accountOf = id => {
    const a = store.get(id);
    if (!a) throw fail('Das Kalenderkonto gibt es nicht mehr.', 'task_sync_account_missing', 404);
    return a;
  };
  async function request(account, method, url, { body, headers = {}, depth } = {}) {
    if (!allowedUrl(url, account.serverUrl))
      throw fail('Der Server verweist auf eine fremde Adresse.', 'task_sync_foreign_url');
    const password = store.password(account.id);
    if (!password) throw fail('Passwort für das Kalenderkonto fehlt. Bitte neu eingeben.', 'dav_auth_failed', 422);
    let res;
    try {
      res = await fetchImpl(url, {
        method,
        redirect: 'manual',
        headers: {
          Authorization: `Basic ${Buffer.from(`${account.username}:${password}`).toString('base64')}`,
          ...(body
            ? { 'Content-Type': method === 'PUT' ? 'text/calendar; charset=utf-8' : 'application/xml; charset=utf-8' }
            : {}),
          ...(depth !== undefined ? { Depth: String(depth) } : {}),
          ...headers
        },
        body
      });
    } catch {
      throw fail('Kalender-/Kontaktserver nicht erreichbar.', 'dav_unreachable', 503);
    }
    if (res.status === 401)
      throw fail(
        'Anmeldung am Kalender-/Kontaktserver fehlgeschlagen. Benutzername und (App-)Passwort prüfen.',
        'dav_auth_failed',
        422
      );
    return res;
  }
  async function text(res) {
    const len = Number(res.headers?.get?.('content-length') || 0);
    if (len > MAX_BODY) throw fail('Die Antwort des Servers ist zu groß.', 'task_sync_too_large');
    const t = await res.text();
    if (t.length > MAX_BODY) throw fail('Die Antwort des Servers ist zu groß.', 'task_sync_too_large');
    return t;
  }
  /** PROPFIND that follows up to three redirects within the allowed addresses. */
  async function propfind(account, url, depth, props) {
    let target = url;
    for (let hop = 0; hop < 4; hop++) {
      const res = await request(account, 'PROPFIND', target, {
        depth,
        body: `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:x="http://apple.com/ns/ical/"><d:prop>${props}</d:prop></d:propfind>`
      });
      if ([301, 302, 307, 308].includes(res.status) && res.headers.get('location')) {
        target = new URL(res.headers.get('location'), target).toString();
        continue;
      }
      if (res.status !== 207) return null;
      return { url: target, xml: await text(res) };
    }
    return null;
  }
  const hrefIn = (xml, tag, base) => {
    const block = xmlBlock(xml, tag);
    const href = block && xmlText(block, 'href');
    return href ? new URL(href, base).toString() : null;
  };

  async function homeOf(account) {
    const origin = new URL(account.serverUrl).origin;
    for (const start of [account.serverUrl, `${origin}/.well-known/caldav`]) {
      const r = await propfind(account, start, 0, '<d:current-user-principal/><c:calendar-home-set/>');
      if (!r) continue;
      const props = okProps(responsesOf(r.xml)[0] || '');
      const home = hrefIn(props, 'calendar-home-set', r.url);
      if (home) return home;
      const principal = hrefIn(props, 'current-user-principal', r.url);
      if (!principal) continue;
      const p = await propfind(account, principal, 0, '<c:calendar-home-set/>');
      const h = p && hrefIn(okProps(responsesOf(p.xml)[0] || ''), 'calendar-home-set', p.url);
      if (h) return h;
    }
    throw fail('Auf dem Server wurde kein Kalenderverzeichnis gefunden.', 'task_sync_no_home', 404);
  }

  return {
    caps: CALDAV_CAPS,
    async lists(ref) {
      const account = accountOf(ref.id);
      const home = await homeOf(account);
      const r = await propfind(
        account,
        home,
        1,
        '<d:resourcetype/><d:displayname/><c:supported-calendar-component-set/>'
      );
      if (!r) throw fail('Die Aufgabenlisten ließen sich nicht abrufen.', 'task_sync_failed');
      const out = [];
      for (const response of responsesOf(r.xml)) {
        const href = xmlText(response, 'href');
        if (!href) continue;
        const props = okProps(response);
        const type = xmlBlock(props, 'resourcetype') || '';
        if (!/<(?:[\w-]+:)?calendar[\s/>]/i.test(type)) continue;
        const comps = xmlBlock(props, 'supported-calendar-component-set');
        if (comps !== null && !/name=["']VTODO["']/i.test(comps)) continue;
        const url = new URL(href, r.url).toString();
        if (!allowedUrl(url, account.serverUrl)) continue;
        const name = xmlText(props, 'displayname') || decodeURIComponent(url.replace(/\/$/, '').split('/').pop() || '');
        out.push({ id: url, name: name.slice(0, 200) || 'Aufgaben' });
      }
      return out;
    },
    async pull(link) {
      const account = accountOf(link.accountId);
      const res = await request(account, 'REPORT', link.listId, {
        depth: 1,
        body: '<?xml version="1.0" encoding="utf-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VTODO"/></c:comp-filter></c:filter></c:calendar-query>'
      });
      if (res.status === 404)
        throw fail('Die Aufgabenliste gibt es auf dem Server nicht mehr.', 'task_sync_list_missing', 404);
      if (res.status !== 207) throw fail('Der Kalenderserver hat die Anfrage abgelehnt.', 'dav_failed');
      const xml = await text(res);
      const items = [];
      for (const response of responsesOf(xml)) {
        const props = okProps(response);
        const href = xmlText(response, 'href');
        const data = xmlText(props, 'calendar-data');
        if (!href) continue;
        const url = new URL(href, link.listId).toString();
        if (!allowedUrl(url, account.serverUrl)) continue;
        if (items.length >= MAX_ITEMS)
          throw fail(
            'Die Liste auf dem Server ist zu groß für den Abgleich. Zur Sicherheit wurde nichts geändert.',
            'task_sync_incomplete'
          );
        let parsed;
        try {
          parsed = data ? parseTodo(data) : null;
        } catch {
          parsed = null;
        }
        if (!parsed) {
          // Still there, only not readable here (no data, unknown format): never "deleted there".
          items.push({ remoteId: url, etag: xmlText(props, 'getetag') || '', unreadable: true });
          continue;
        }
        items.push({
          remoteId: url,
          etag: xmlText(props, 'getetag') || '',
          modified: parsed.modified,
          fields: parsed.fields,
          raw: data
        });
      }
      return items;
    },
    async create(link, fields) {
      const account = accountOf(link.accountId);
      const uid = randomUUID();
      const base = link.listId.endsWith('/') ? link.listId : `${link.listId}/`;
      const url = new URL(`${uid}.ics`, base).toString();
      const res = await request(account, 'PUT', url, {
        body: createTodoIcs(fields, { uid, now: now() }),
        headers: { 'If-None-Match': '*' }
      });
      if (res.status === 413)
        throw fail('Der Server hat die Aufgabe abgelehnt, weil sie zu groß ist.', 'task_sync_too_large', 413);
      if (!res.ok) throw fail('Der Kalenderserver hat die Aufgabe abgelehnt.', 'dav_failed');
      return { remoteId: url, etag: res.headers.get('etag') || '' };
    },
    async update(link, item, patch) {
      const account = accountOf(link.accountId);
      const res = await request(account, 'PUT', item.remoteId, {
        body: updateTodoIcs(item.raw, patch, { now: now() }),
        headers: item.etag ? { 'If-Match': item.etag } : {}
      });
      if (res.status === 412) throw fail('Die Aufgabe wurde auf dem Server geändert.', 'task_sync_conflict', 409);
      if (res.status === 404) throw fail('Die Aufgabe gibt es auf dem Server nicht mehr.', 'task_sync_conflict', 409);
      if (!res.ok) throw fail('Der Kalenderserver hat die Änderung abgelehnt.', 'dav_failed');
      return { etag: res.headers.get('etag') || '' };
    },
    async remove(link, remoteId, etag) {
      const account = accountOf(link.accountId);
      const res = await request(account, 'DELETE', remoteId, { headers: etag ? { 'If-Match': etag } : {} });
      if (res.status === 404 || res.status === 410) return true;
      if (res.status === 412) throw fail('Die Aufgabe wurde auf dem Server geändert.', 'task_sync_conflict', 409);
      if (!res.ok) throw fail('Der Kalenderserver hat das Löschen abgelehnt.', 'dav_failed');
      return true;
    }
  };
}
