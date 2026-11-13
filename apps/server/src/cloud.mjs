// Calendars and contacts of Microsoft 365 / Outlook.com (Microsoft Graph) and Google
// (Calendar API v3, People API) for mail accounts signed in with OAuth. The data is mapped
// to the same shapes as CalDAV/CardDAV (see dav.mjs), so the user interface treats both alike.
// Invitations to attendees are sent by the provider itself (Exchange / Google).

export const CLOUD_PREFIX = 'cloud:';
export const GRAPH_SCOPES = [
  'offline_access',
  'https://graph.microsoft.com/Calendars.ReadWrite',
  'https://graph.microsoft.com/Contacts.ReadWrite'
];
export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/contacts'];
export const DEFAULT_ENDPOINTS = {
  graph: 'https://graph.microsoft.com/v1.0',
  googleCalendar: 'https://www.googleapis.com/calendar/v3',
  googlePeople: 'https://people.googleapis.com/v1'
};

const DAY_NAMES = {
  MO: 'monday',
  TU: 'tuesday',
  WE: 'wednesday',
  TH: 'thursday',
  FR: 'friday',
  SA: 'saturday',
  SU: 'sunday'
};
const DAY_CODES = Object.fromEntries(Object.entries(DAY_NAMES).map(([k, v]) => [v, k]));
const GRAPH_PARTSTAT = {
  accepted: 'ACCEPTED',
  declined: 'DECLINED',
  tentativelyAccepted: 'TENTATIVE',
  organizer: 'ACCEPTED'
};
const GOOGLE_PARTSTAT = {
  accepted: 'ACCEPTED',
  declined: 'DECLINED',
  tentative: 'TENTATIVE',
  needsAction: 'NEEDS-ACTION'
};
const fail = (message, code, statusCode = 502, extra = {}) =>
  Object.assign(new Error(message), { code, statusCode, ...extra });

const id = value => `${CLOUD_PREFIX}${value}`;
export const isCloud = value => String(value || '').startsWith(CLOUD_PREFIX);
const rawId = value => String(value || '').slice(CLOUD_PREFIX.length);
const ymd = d => d.toISOString().slice(0, 10);
const addDays = (date, n) => ymd(new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000));
const stripHtml = html =>
  String(html || '')
    .replace(/<(br|\/p|\/div|\/li)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

// ---------------------------------------------------------------- recurrence mapping
/** Our rule ({freq, interval, count, until, byday}) → Graph patternedRecurrence. */
export function toGraphRecurrence(rrule, startDate) {
  if (!rrule) return null;
  const day = Number(startDate.slice(8, 10));
  const month = Number(startDate.slice(5, 7));
  const weekday = DAY_NAMES[['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][new Date(`${startDate}T12:00:00Z`).getUTCDay()]];
  const pattern =
    rrule.freq === 'DAILY'
      ? { type: 'daily', interval: rrule.interval }
      : rrule.freq === 'WEEKLY'
        ? {
            type: 'weekly',
            interval: rrule.interval,
            daysOfWeek: rrule.byday?.length ? rrule.byday.map(d => DAY_NAMES[d]) : [weekday],
            firstDayOfWeek: 'monday'
          }
        : rrule.freq === 'MONTHLY'
          ? { type: 'absoluteMonthly', interval: rrule.interval, dayOfMonth: day }
          : { type: 'absoluteYearly', interval: rrule.interval, dayOfMonth: day, month };
  const range = rrule.count
    ? { type: 'numbered', startDate, numberOfOccurrences: rrule.count }
    : rrule.until
      ? { type: 'endDate', startDate, endDate: rrule.until.slice(0, 10) }
      : { type: 'noEnd', startDate };
  return { pattern, range };
}
export function fromGraphRecurrence(rec) {
  if (!rec?.pattern) return null;
  const p = rec.pattern;
  const freq = {
    daily: 'DAILY',
    weekly: 'WEEKLY',
    absoluteMonthly: 'MONTHLY',
    relativeMonthly: 'MONTHLY',
    absoluteYearly: 'YEARLY',
    relativeYearly: 'YEARLY'
  }[p.type];
  if (!freq) return null;
  return {
    freq,
    interval: p.interval || 1,
    count: rec.range?.type === 'numbered' ? rec.range.numberOfOccurrences : null,
    until: rec.range?.type === 'endDate' ? rec.range.endDate : null,
    byday: freq === 'WEEKLY' ? (p.daysOfWeek || []).map(d => DAY_CODES[d]).filter(Boolean) : []
  };
}
/** Our rule → RFC 5545 RRULE line (Google). */
export function toRruleLine(rrule) {
  if (!rrule) return null;
  const parts = [`FREQ=${rrule.freq}`];
  if (rrule.interval > 1) parts.push(`INTERVAL=${rrule.interval}`);
  if (rrule.freq === 'WEEKLY' && rrule.byday?.length) parts.push(`BYDAY=${rrule.byday.join(',')}`);
  if (rrule.count) parts.push(`COUNT=${rrule.count}`);
  else if (rrule.until) parts.push(`UNTIL=${rrule.until.slice(0, 10).replace(/-/g, '')}T235959Z`);
  return `RRULE:${parts.join(';')}`;
}
export function fromRruleLines(lines) {
  const line = (lines || []).find(l => /^RRULE:/i.test(l));
  if (!line) return null;
  const parts = Object.fromEntries(
    line
      .slice(6)
      .split(';')
      .map(p => p.split('='))
  );
  const until = parts.UNTIL ? `${parts.UNTIL.slice(0, 4)}-${parts.UNTIL.slice(4, 6)}-${parts.UNTIL.slice(6, 8)}` : null;
  return {
    freq: parts.FREQ,
    interval: Number(parts.INTERVAL) || 1,
    count: parts.COUNT ? Number(parts.COUNT) : null,
    until,
    byday: parts.BYDAY ? parts.BYDAY.split(',').map(d => d.replace(/^[-+\d]+/, '')) : []
  };
}

// ---------------------------------------------------------------- local time helpers
/** "2026-11-13T09:00" in tzid for Graph/Google (seconds added). */
const localDateTime = value => (value.length === 16 ? `${value}:00` : value);
function utcIso(value) {
  // Graph returns "2026-11-13T08:00:00.0000000" in UTC (Prefer: outlook.timezone="UTC").
  const clean = String(value).replace(/\.\d+$/, '');
  return new Date(`${clean}Z`).toISOString();
}

// ---------------------------------------------------------------- provider adapters
function graphAdapter(call) {
  const toEvent = (e, cal, master) => {
    const allDay = Boolean(e.isAllDay);
    const start = allDay ? e.start.dateTime.slice(0, 10) : utcIso(e.start.dateTime);
    const end = allDay ? e.end.dateTime.slice(0, 10) : utcIso(e.end.dateTime);
    const organizer = e.organizer?.emailAddress
      ? { email: e.organizer.emailAddress.address.toLowerCase(), name: e.organizer.emailAddress.name || '' }
      : null;
    return {
      source: 'microsoft',
      uid: e.iCalUId || e.id,
      url: id(e.id),
      etag: e['@odata.etag'] || '',
      calendarUrl: id(cal.id),
      summary: e.subject || '',
      location: e.location?.displayName || '',
      description: e.body?.contentType === 'html' ? stripHtml(e.body.content) : e.body?.content || e.bodyPreview || '',
      status: e.isCancelled ? 'CANCELLED' : 'CONFIRMED',
      start,
      end,
      allDay,
      tzid:
        e.originalStartTimeZone && e.originalStartTimeZone !== 'tzone://Microsoft/Utc' ? e.originalStartTimeZone : null,
      recurring: e.type === 'occurrence' || e.type === 'exception' || e.type === 'seriesMaster',
      recurrenceId: e.seriesMasterId
        ? allDay
          ? String(e.originalStart || e.start.dateTime).slice(0, 10)
          : e.originalStart
            ? new Date(e.originalStart).toISOString()
            : start
        : null,
      seriesId: e.seriesMasterId ? id(e.seriesMasterId) : null,
      rrule: fromGraphRecurrence(master?.recurrence || e.recurrence),
      organizer,
      attendees: (e.attendees || []).map(a => ({
        email: String(a.emailAddress?.address || '').toLowerCase(),
        name: a.emailAddress?.name || '',
        partstat: GRAPH_PARTSTAT[a.status?.response] || 'NEEDS-ACTION'
      })),
      alarms: e.isReminderOn && Number.isInteger(e.reminderMinutesBeforeStart) ? [e.reminderMinutesBeforeStart] : []
    };
  };
  const body = (model, { forSeries = true } = {}) => {
    const tz = model.tzid || 'UTC';
    return {
      subject: model.summary,
      body: { contentType: 'text', content: model.description || '' },
      location: { displayName: model.location || '' },
      isAllDay: model.allDay,
      start: model.allDay
        ? { dateTime: `${model.start}T00:00:00`, timeZone: 'UTC' }
        : { dateTime: localDateTime(model.start), timeZone: tz },
      end: model.allDay
        ? { dateTime: `${model.end}T00:00:00`, timeZone: 'UTC' }
        : { dateTime: localDateTime(model.end), timeZone: tz },
      attendees: model.attendees.map(a => ({
        emailAddress: { address: a.email, name: a.name || a.email },
        type: 'required'
      })),
      isReminderOn: model.alarms.length > 0,
      ...(model.alarms.length ? { reminderMinutesBeforeStart: model.alarms[0] } : {}),
      ...(forSeries ? { recurrence: toGraphRecurrence(model.rrule, model.start.slice(0, 10)) } : {})
    };
  };
  const contactOut = c => {
    const phone = type => c.phones.filter(p => p.type === type).map(p => p.value);
    return {
      givenName: c.firstName || (c.lastName ? '' : c.name),
      surname: c.lastName || '',
      displayName: c.name,
      emailAddresses: c.emails.slice(0, 3).map(e => ({ address: e.value, name: c.name })),
      mobilePhone: phone('cell')[0] || phone('mobile')[0] || null,
      businessPhones: phone('work'),
      homePhones: phone('home'),
      companyName: c.organization || null,
      jobTitle: c.title || null,
      birthday: c.birthday ? `${c.birthday}T00:00:00Z` : null,
      personalNotes: c.note || '',
      businessAddress: c.address ? { street: c.address } : {}
    };
  };
  const contactIn = (c, accountId) => ({
    uid: c.id,
    url: id(c.id),
    etag: c['@odata.etag'] || '',
    accountId,
    addressBookUrl: id('contacts'),
    source: 'microsoft',
    name: c.displayName || [c.givenName, c.surname].filter(Boolean).join(' ') || c.emailAddresses?.[0]?.address || '',
    firstName: c.givenName || '',
    lastName: c.surname || '',
    emails: (c.emailAddresses || []).map(e => ({ value: e.address, type: 'work' })),
    phones: [
      ...(c.mobilePhone ? [{ value: c.mobilePhone, type: 'cell' }] : []),
      ...(c.businessPhones || []).map(v => ({ value: v, type: 'work' })),
      ...(c.homePhones || []).map(v => ({ value: v, type: 'home' }))
    ],
    organization: c.companyName || '',
    title: c.jobTitle || '',
    address: [
      c.businessAddress?.street,
      [c.businessAddress?.postalCode, c.businessAddress?.city].filter(Boolean).join(' '),
      c.businessAddress?.countryOrRegion
    ]
      .filter(Boolean)
      .join(', '),
    birthday: c.birthday ? c.birthday.slice(0, 10) : '',
    note: c.personalNotes || ''
  });
  return {
    async calendars() {
      const r = await call('GET', '/me/calendars?$top=100');
      return (r.value || []).map(c => ({
        id: c.id,
        name: c.name,
        color: c.hexColor || null,
        readOnly: c.canEdit === false,
        primary: Boolean(c.isDefaultCalendar)
      }));
    },
    async events(cal, from, to) {
      const out = [];
      let next = `/me/calendars/${encodeURIComponent(cal.id)}/calendarView?startDateTime=${encodeURIComponent(new Date(from).toISOString())}&endDateTime=${encodeURIComponent(new Date(to).toISOString())}&$top=500`;
      const raw = [];
      for (let page = 0; next && page < 10; page++) {
        const r = await call('GET', next, undefined, { Prefer: 'outlook.timezone="UTC"' });
        raw.push(...(r.value || []));
        next = r['@odata.nextLink'] || null;
      }
      const masters = new Map();
      for (const sid of [...new Set(raw.map(e => e.seriesMasterId).filter(Boolean))].slice(0, 50)) {
        try {
          masters.set(sid, await call('GET', `/me/events/${encodeURIComponent(sid)}?$select=recurrence,start,end`));
        } catch {
          /* series shown without rule */
        }
      }
      for (const e of raw) out.push(toEvent(e, cal, masters.get(e.seriesMasterId)));
      return out;
    },
    async event(eventId) {
      return call('GET', `/me/events/${encodeURIComponent(eventId)}`);
    },
    async create(cal, model) {
      const e = await call('POST', `/me/calendars/${encodeURIComponent(cal.id)}/events`, body(model));
      return { uid: e.iCalUId || e.id, invited: model.attendees.length };
    },
    async update(eventId, model, { series }) {
      await call('PATCH', `/me/events/${encodeURIComponent(eventId)}`, body(model, { forSeries: series }));
      return { invited: model.attendees.length };
    },
    async remove(eventId) {
      await call('DELETE', `/me/events/${encodeURIComponent(eventId)}`);
    },
    masterStart: master => (master.isAllDay ? master.start.dateTime.slice(0, 10) : utcIso(master.start.dateTime)),
    async findByUid(_cal, uid) {
      const r = await call(
        'GET',
        `/me/events?$filter=${encodeURIComponent(`iCalUId eq '${uid.replace(/'/g, "''")}'`)}&$top=5`
      );
      return r.value?.[0] || null;
    },
    async respond(eventId, partstat) {
      const action = { ACCEPTED: 'accept', TENTATIVE: 'tentativelyAccept', DECLINED: 'decline' }[partstat];
      await call('POST', `/me/events/${encodeURIComponent(eventId)}/${action}`, { sendResponse: true });
    },
    async createCalendar(name) {
      const c = await call('POST', '/me/calendars', { name });
      return { id: c.id };
    },
    async contacts(accountId) {
      const out = [];
      let next = '/me/contacts?$top=500';
      for (let page = 0; next && page < 20; page++) {
        const r = await call('GET', next);
        out.push(...(r.value || []).map(c => contactIn(c, accountId)));
        next = r['@odata.nextLink'] || null;
      }
      return out;
    },
    async saveContact(contactId, contact) {
      if (contactId) await call('PATCH', `/me/contacts/${encodeURIComponent(contactId)}`, contactOut(contact));
      else await call('POST', '/me/contacts', contactOut(contact));
    },
    async deleteContact(contactId) {
      await call('DELETE', `/me/contacts/${encodeURIComponent(contactId)}`);
    }
  };
}

function googleAdapter(call, endpoints) {
  const C = endpoints.googleCalendar;
  const P = endpoints.googlePeople;
  const toEvent = (e, cal, master) => {
    const allDay = Boolean(e.start?.date);
    const organizer = e.organizer?.email
      ? { email: e.organizer.email.toLowerCase(), name: e.organizer.displayName || '' }
      : null;
    return {
      source: 'google',
      uid: e.iCalUID || e.id,
      url: id(e.id),
      etag: e.etag || '',
      calendarUrl: id(cal.id),
      summary: e.summary || '',
      location: e.location || '',
      description: stripHtml(e.description || ''),
      status: e.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED',
      start: allDay ? e.start.date : new Date(e.start.dateTime).toISOString(),
      end: allDay ? e.end.date : new Date(e.end.dateTime).toISOString(),
      allDay,
      tzid: e.start?.timeZone || null,
      recurring: Boolean(e.recurringEventId || e.recurrence),
      recurrenceId: e.recurringEventId
        ? e.originalStartTime?.date ||
          (e.originalStartTime?.dateTime
            ? new Date(e.originalStartTime.dateTime).toISOString()
            : allDay
              ? e.start.date
              : new Date(e.start.dateTime).toISOString())
        : null,
      seriesId: e.recurringEventId ? id(e.recurringEventId) : null,
      rrule: fromRruleLines(master?.recurrence || e.recurrence),
      organizer,
      attendees: (e.attendees || []).map(a => ({
        email: String(a.email || '').toLowerCase(),
        name: a.displayName || '',
        partstat: GOOGLE_PARTSTAT[a.responseStatus] || 'NEEDS-ACTION'
      })),
      alarms: e.reminders?.useDefault ? [] : (e.reminders?.overrides || []).map(o => o.minutes).filter(Number.isInteger)
    };
  };
  const body = (model, { forSeries = true } = {}) => ({
    summary: model.summary,
    description: model.description || '',
    location: model.location || '',
    start: model.allDay
      ? { date: model.start }
      : { dateTime: localDateTime(model.start), timeZone: model.tzid || 'UTC' },
    end: model.allDay ? { date: model.end } : { dateTime: localDateTime(model.end), timeZone: model.tzid || 'UTC' },
    attendees: model.attendees.map(a => ({ email: a.email, ...(a.name ? { displayName: a.name } : {}) })),
    reminders: { useDefault: false, overrides: model.alarms.map(minutes => ({ method: 'popup', minutes })) },
    ...(forSeries ? { recurrence: model.rrule ? [toRruleLine(model.rrule)] : [] } : {})
  });
  const FIELDS = 'names,emailAddresses,phoneNumbers,organizations,addresses,birthdays,biographies';
  const contactOut = (c, etag) => ({
    ...(etag ? { etag } : {}),
    names: [{ givenName: c.firstName || (c.lastName ? '' : c.name), familyName: c.lastName || '' }],
    emailAddresses: c.emails.map(e => ({ value: e.value, type: e.type === 'home' ? 'home' : 'work' })),
    phoneNumbers: c.phones.map(p => ({
      value: p.value,
      type: { cell: 'mobile', mobile: 'mobile', home: 'home', work: 'work' }[p.type] || 'other'
    })),
    organizations: c.organization || c.title ? [{ name: c.organization || '', title: c.title || '' }] : [],
    addresses: c.address ? [{ formattedValue: c.address, type: 'work' }] : [],
    birthdays: c.birthday
      ? [
          {
            date: {
              year: Number(c.birthday.slice(0, 4)),
              month: Number(c.birthday.slice(5, 7)),
              day: Number(c.birthday.slice(8, 10))
            }
          }
        ]
      : [],
    biographies: c.note ? [{ value: c.note, contentType: 'TEXT_PLAIN' }] : []
  });
  const contactIn = (p, accountId) => {
    const n = p.names?.[0] || {};
    const b = p.birthdays?.[0]?.date;
    return {
      uid: p.resourceName,
      url: id(p.resourceName),
      etag: p.etag || '',
      accountId,
      addressBookUrl: id('contacts'),
      source: 'google',
      name:
        n.displayName || [n.givenName, n.familyName].filter(Boolean).join(' ') || p.emailAddresses?.[0]?.value || '',
      firstName: n.givenName || '',
      lastName: n.familyName || '',
      emails: (p.emailAddresses || []).map(e => ({ value: e.value, type: e.type === 'home' ? 'home' : 'work' })),
      phones: (p.phoneNumbers || []).map(x => ({
        value: x.value,
        type: { mobile: 'cell', home: 'home', work: 'work' }[x.type] || 'other'
      })),
      organization: p.organizations?.[0]?.name || '',
      title: p.organizations?.[0]?.title || '',
      address: p.addresses?.[0]?.formattedValue || '',
      birthday:
        b?.year && b?.month && b?.day
          ? `${b.year}-${String(b.month).padStart(2, '0')}-${String(b.day).padStart(2, '0')}`
          : '',
      note: p.biographies?.[0]?.value || ''
    };
  };
  const cal = calId => `${C}/calendars/${encodeURIComponent(calId)}`;
  return {
    async calendars() {
      const r = await call('GET', `${C}/users/me/calendarList?maxResults=250`);
      return (r.items || []).map(c => ({
        id: c.id,
        name: c.summaryOverride || c.summary,
        color: c.backgroundColor || null,
        readOnly: !['owner', 'writer'].includes(c.accessRole),
        primary: Boolean(c.primary)
      }));
    },
    async events(c, from, to) {
      const raw = [];
      let token = '';
      for (let page = 0; page < 10; page++) {
        const r = await call(
          'GET',
          `${cal(c.id)}/events?singleEvents=true&maxResults=2500&timeMin=${encodeURIComponent(new Date(from).toISOString())}&timeMax=${encodeURIComponent(new Date(to).toISOString())}${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`
        );
        raw.push(...(r.items || []));
        token = r.nextPageToken || '';
        if (!token) break;
      }
      const masters = new Map();
      for (const sid of [...new Set(raw.map(e => e.recurringEventId).filter(Boolean))].slice(0, 50)) {
        try {
          masters.set(sid, await call('GET', `${cal(c.id)}/events/${encodeURIComponent(sid)}`));
        } catch {
          /* series shown without rule */
        }
      }
      return raw.filter(e => e.status !== 'cancelled').map(e => toEvent(e, c, masters.get(e.recurringEventId)));
    },
    async event(eventId, c) {
      return call('GET', `${cal(c.id)}/events/${encodeURIComponent(eventId)}`);
    },
    async create(c, model, { notify }) {
      const e = await call('POST', `${cal(c.id)}/events?sendUpdates=${notify ? 'all' : 'none'}`, body(model));
      return { uid: e.iCalUID || e.id, invited: notify ? model.attendees.length : 0 };
    },
    async update(eventId, model, { series, notify, calendar }) {
      await call(
        'PATCH',
        `${cal(calendar.id)}/events/${encodeURIComponent(eventId)}?sendUpdates=${notify ? 'all' : 'none'}`,
        body(model, { forSeries: series })
      );
      return { invited: notify ? model.attendees.length : 0 };
    },
    async remove(eventId, { notify, calendar }) {
      await call(
        'DELETE',
        `${cal(calendar.id)}/events/${encodeURIComponent(eventId)}?sendUpdates=${notify ? 'all' : 'none'}`
      );
    },
    masterStart: master => (master.start?.date ? master.start.date : new Date(master.start.dateTime).toISOString()),
    async findByUid(c, uid) {
      const r = await call('GET', `${cal(c.id)}/events?iCalUID=${encodeURIComponent(uid)}`);
      return r.items?.[0] || null;
    },
    async respond(eventId, partstat, { calendar, me }) {
      const current = await call('GET', `${cal(calendar.id)}/events/${encodeURIComponent(eventId)}`);
      const status = { ACCEPTED: 'accepted', TENTATIVE: 'tentative', DECLINED: 'declined' }[partstat];
      const attendees = (current.attendees || []).map(a =>
        a.self || String(a.email).toLowerCase() === me ? { ...a, responseStatus: status } : a
      );
      await call('PATCH', `${cal(calendar.id)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`, { attendees });
    },
    async createCalendar(name) {
      const c = await call('POST', `${C}/calendars`, { summary: name });
      return { id: c.id };
    },
    async contacts(accountId) {
      const out = [];
      let token = '';
      for (let page = 0; page < 20; page++) {
        const r = await call(
          'GET',
          `${P}/people/me/connections?personFields=${FIELDS}&pageSize=1000${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`
        );
        out.push(...(r.connections || []).map(p => contactIn(p, accountId)));
        token = r.nextPageToken || '';
        if (!token) break;
      }
      return out;
    },
    async saveContact(resourceName, contact, etag) {
      if (resourceName)
        await call(
          'PATCH',
          `${P}/${resourceName}:updateContact?updatePersonFields=${FIELDS}`,
          contactOut(contact, etag)
        );
      else await call('POST', `${P}/people:createContact`, contactOut(contact));
    },
    async deleteContact(resourceName) {
      await call('DELETE', `${P}/${resourceName}:deleteContact`);
    }
  };
}

// ---------------------------------------------------------------- service
/**
 * @param {object} o
 * @param {() => object[]} o.accounts       mail accounts (only auth 'oauth2' are used)
 * @param {(account) => Promise<string>} o.token  access token for the provider's calendar/contacts API
 * @param {{ get(): object, save(v): Promise }} o.prefs  hidden calendars and colors
 */
export function createCloudService({
  accounts,
  token,
  prefs,
  fetchImpl = globalThis.fetch,
  endpoints = DEFAULT_ENDPOINTS,
  logger = () => {}
}) {
  const calendarCache = new Map(); // accountId → { at, list }
  const cloudAccounts = () =>
    accounts()
      .map(a => ({ ...a, oauthProvider: a.oauthProvider || a.imap?.oauth || '' }))
      .filter(
        a => a.auth === 'oauth2' && ['microsoft', 'google'].includes(a.oauthProvider) && a.imap?.configured !== false
      );

  function caller(account) {
    const base = account.oauthProvider === 'microsoft' ? endpoints.graph : '';
    return async (method, path, body, headers = {}) => {
      const url = /^https?:/.test(path) ? path : `${base}${path}`;
      let response;
      try {
        response = await fetchImpl(url, {
          method,
          headers: {
            Authorization: `Bearer ${await token(account)}`,
            Accept: 'application/json',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            ...headers
          },
          body: body ? JSON.stringify(body) : undefined
        });
      } catch (err) {
        if (err.code?.startsWith?.('oauth_')) throw err;
        throw fail('Kalender-/Kontaktdienst des Anbieters nicht erreichbar.', 'cloud_unreachable', 503);
      }
      if (response.status === 204) return {};
      const data = await response.json().catch(() => ({}));
      if (response.status === 401 || response.status === 403) {
        throw fail(
          'Für Kalender und Kontakte ist eine zusätzliche Freigabe nötig. Bitte „Kalender & Kontakte freigeben“ wählen.',
          'cloud_consent_required',
          403,
          { accountId: account.id }
        );
      }
      if (response.status === 404) throw fail('Termin oder Kontakt nicht gefunden.', 'cloud_not_found', 404);
      if (response.status === 409 || response.status === 412)
        throw fail('Der Eintrag wurde zwischenzeitlich geändert. Bitte neu laden.', 'cloud_conflict', 409);
      if (!response.ok) {
        logger(`cloud ${account.oauthProvider} ${method} ${response.status}`);
        throw fail('Der Anbieter hat die Änderung abgelehnt.', 'cloud_rejected', 502);
      }
      return data;
    };
  }
  const adapter = account =>
    account.oauthProvider === 'microsoft' ? graphAdapter(caller(account)) : googleAdapter(caller(account), endpoints);
  const accountById = accountId => {
    const a = cloudAccounts().find(x => x.id === accountId);
    if (!a) throw fail('Konto nicht gefunden.', 'cloud_account_missing', 404);
    return a;
  };
  const errInfo = (account, err) => ({
    accountId: account.id,
    accountLabel: account.label,
    provider: account.oauthProvider,
    error: err.message,
    code: err.code || 'cloud_failed'
  });
  const prefKey = (accountId, calId) => `${accountId}|${calId}`;
  async function calendarsOf(account, fresh = false) {
    const cached = calendarCache.get(account.id);
    if (!fresh && cached && Date.now() - cached.at < 5 * 60_000) return cached.list;
    const list = await adapter(account).calendars();
    calendarCache.set(account.id, { at: Date.now(), list });
    return list;
  }
  const decorate = (account, c) => {
    const p = prefs.get();
    const key = prefKey(account.id, c.id);
    return {
      accountId: account.id,
      accountLabel: account.label,
      source: account.oauthProvider,
      url: id(c.id),
      name: c.name,
      color: p.colors?.[key] || c.color || (account.oauthProvider === 'microsoft' ? '#2f6fde' : '#1a8f5a'),
      hidden: (p.hidden || []).includes(key),
      readOnly: c.readOnly,
      primary: c.primary
    };
  };
  async function calendarFor(accountId, calendarUrl) {
    const account = accountById(accountId);
    const cal = (await calendarsOf(account)).find(c => c.id === rawId(calendarUrl));
    if (!cal) throw fail('Kalender nicht gefunden.', 'calendar_missing', 404);
    return { account, cal };
  }

  return {
    accounts: () => cloudAccounts().map(a => ({ id: a.id, label: a.label, provider: a.oauthProvider })),
    reset(accountId) {
      calendarCache.delete(accountId);
    },
    async listCalendars() {
      const calendars = [];
      const errors = [];
      for (const account of cloudAccounts()) {
        try {
          calendars.push(...(await calendarsOf(account)).map(c => decorate(account, c)));
        } catch (err) {
          errors.push(errInfo(account, err));
        }
      }
      return { calendars, errors };
    },
    async events(from, to) {
      const events = [];
      const errors = [];
      for (const account of cloudAccounts()) {
        let cals;
        try {
          cals = await calendarsOf(account);
        } catch (err) {
          errors.push(errInfo(account, err));
          continue;
        }
        for (const cal of cals) {
          const d = decorate(account, cal);
          if (d.hidden) continue;
          try {
            for (const e of await adapter(account).events(cal, from, to))
              events.push({ ...e, accountId: account.id, color: d.color });
          } catch (err) {
            errors.push({ ...errInfo(account, err), calendar: cal.name });
          }
        }
      }
      return { events, errors };
    },
    async setCalendarPrefs(accountId, calendarUrl, { hidden, color }) {
      const key = prefKey(accountId, rawId(calendarUrl));
      const p = { hidden: [], colors: {}, ...prefs.get() };
      if (typeof hidden === 'boolean')
        p.hidden = hidden ? [...new Set([...p.hidden, key])] : p.hidden.filter(k => k !== key);
      if (typeof color === 'string') p.colors = { ...p.colors, [key]: color };
      await prefs.save(p);
    },
    async createCalendar(accountId, name) {
      const account = accountById(accountId);
      const r = await adapter(account).createCalendar(name);
      calendarCache.delete(accountId);
      return { url: id(r.id) };
    },
    /**
     * Saves an event. `scope: 'this'` changes one occurrence; `'all'` the series – shifted by the
     * same amount when edited from a later occurrence (like CalDAV, see calendar-model.mjs).
     */
    async saveEvent({
      accountId,
      calendarUrl,
      url,
      scope = 'all',
      model,
      notify = true,
      seriesId = null,
      occurrenceStart = null
    }) {
      const { account, cal } = await calendarFor(accountId, calendarUrl);
      const a = adapter(account);
      if (!url) return a.create(cal, model, { notify });
      if (scope === 'this' || !seriesId)
        return a.update(rawId(url), model, { series: scope !== 'this', notify, calendar: cal });
      const master = await a.event(rawId(seriesId), cal);
      return a.update(rawId(seriesId), shiftModel(model, a.masterStart(master), occurrenceStart), {
        series: true,
        notify,
        calendar: cal
      });
    },
    async deleteEvent({ accountId, calendarUrl, url, scope = 'all', seriesId = null, notify = true }) {
      const { account, cal } = await calendarFor(accountId, calendarUrl);
      const target = scope === 'all' && seriesId ? seriesId : url;
      await adapter(account).remove(rawId(target), { notify, calendar: cal });
      return { ok: true, cancelled: notify ? 1 : 0 };
    },
    /** Answers an invitation in the provider's calendar (the provider informs the organizer). */
    async respond({ accountId, calendarUrl, uid, partstat, me }) {
      const { account, cal } = await calendarFor(accountId, calendarUrl);
      const a = adapter(account);
      const event = await a.findByUid(cal, uid);
      if (!event) return { found: false };
      await a.respond(event.id, partstat, { calendar: cal, me });
      return { found: true };
    },
    async contacts() {
      const contacts = [];
      const addressBooks = [];
      const errors = [];
      for (const account of cloudAccounts()) {
        try {
          contacts.push(...(await adapter(account).contacts(account.id)));
          addressBooks.push({
            accountId: account.id,
            url: id('contacts'),
            name: account.oauthProvider === 'microsoft' ? 'Outlook' : 'Google',
            accountLabel: account.label,
            source: account.oauthProvider
          });
        } catch (err) {
          errors.push(errInfo(account, err));
        }
      }
      return { contacts, addressBooks, errors };
    },
    async saveContact({ accountId, url, etag, contact }) {
      const account = accountById(accountId);
      await adapter(account).saveContact(url ? rawId(url) : null, contact, etag);
      return { ok: true };
    },
    async deleteContact({ accountId, url }) {
      await adapter(accountById(accountId)).deleteContact(rawId(url));
      return { ok: true };
    }
  };
}

/** Applies the change made on one occurrence (start moved by Δ) to the series start. */
export function shiftModel(model, masterStart, occurrenceStart) {
  if (!occurrenceStart || !masterStart) return model;
  if (model.allDay) {
    const delta = Math.round(
      (Date.parse(`${model.start}T00:00:00Z`) - Date.parse(`${occurrenceStart.slice(0, 10)}T00:00:00Z`)) / 86_400_000
    );
    const length = Math.round(
      (Date.parse(`${model.end}T00:00:00Z`) - Date.parse(`${model.start}T00:00:00Z`)) / 86_400_000
    );
    const start = addDays(masterStart.slice(0, 10), delta);
    return { ...model, start, end: addDays(start, length) };
  }
  // model.start is local wall time in model.tzid; compute the shift in wall-clock minutes.
  const occLocal = wallClock(occurrenceStart, model.tzid);
  const shiftMin = (Date.parse(`${model.start}:00Z`) - Date.parse(`${occLocal}:00Z`)) / 60_000;
  const lengthMin = (Date.parse(`${model.end}:00Z`) - Date.parse(`${model.start}:00Z`)) / 60_000;
  const masterLocal = wallClock(masterStart, model.tzid);
  const startMs = Date.parse(`${masterLocal}:00Z`) + shiftMin * 60_000;
  const fmt = ms => new Date(ms).toISOString().slice(0, 16);
  return { ...model, start: fmt(startMs), end: fmt(startMs + lengthMin * 60_000) };
}
function wallClock(iso, tz) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return `${iso}T00:00`;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    })
      .formatToParts(new Date(iso))
      .map(p => [p.type, p.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
