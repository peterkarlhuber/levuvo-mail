// Calendar (CalDAV) and contacts (CardDAV) accounts, e.g. Nextcloud, iCloud (app
// password), mailbox.org, Radicale. Metadata in dav.json, passwords in the OS keychain.
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { DAVClient } from 'tsdav';
import { expandObject } from './calendar-model.mjs';
import { parseVCard } from './vcard.mjs';

const MAX_ACCOUNTS = 5;
const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });
const COLORS = ['#4f8cff', '#3fb68b', '#e5a23c', '#d9534f', '#9b6bdf', '#2bb3c0', '#e46fa8', '#8a9a5b'];

export function normalizeServerUrl(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    throw fail('Bitte eine gültige Server-Adresse eingeben (https://…).', 'dav_url_invalid');
  }
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
    throw fail('Nur verschlüsselte Verbindungen (https) sind erlaubt.', 'dav_url_insecure');
  if (url.username || url.password) throw fail('Zugangsdaten bitte nicht in die Adresse schreiben.', 'dav_url_invalid');
  // Nextcloud: the bare instance URL is completed to the DAV endpoint.
  if (/^\/?$/.test(url.pathname) === false && !url.pathname.endsWith('/')) url.pathname += '/';
  return url.toString();
}

export function davErrorInfo(err) {
  const text = String(err?.message || '');
  if (/401|unauthori[sz]ed|invalid credentials/i.test(text))
    return fail(
      'Anmeldung am Kalender-/Kontaktserver fehlgeschlagen. Benutzername und (App-)Passwort prüfen.',
      'dav_auth_failed',
      422
    );
  if (
    /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|fetch failed|ECONNRESET/i.test(text) ||
    /ENOTFOUND|ECONNREFUSED|ETIMEDOUT/.test(String(err?.cause?.code))
  ) {
    return fail('Kalender-/Kontaktserver nicht erreichbar.', 'dav_unreachable', 503);
  }
  if (/certificate|CERT_|self.signed/i.test(text + String(err?.cause?.code)))
    return fail('TLS-Zertifikat des Servers konnte nicht geprüft werden.', 'dav_tls_failed', 422);
  return fail('Der Kalender-/Kontaktserver hat die Anfrage abgelehnt.', 'dav_failed', 502);
}

/** Accounts file + secrets. */
export async function createDavStore({ filename, vault }) {
  let accounts = [];
  try {
    const doc = JSON.parse(await readFile(filename, 'utf8'));
    if (doc.version === 1 && Array.isArray(doc.accounts)) accounts = doc.accounts.slice(0, MAX_ACCOUNTS);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  async function persist() {
    await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
    const tmp = `${filename}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(tmp, `${JSON.stringify({ version: 1, accounts }, null, 2)}\n`, { mode: 0o600 });
    await rename(tmp, filename);
  }
  const secret = id => {
    try {
      return vault?.available ? vault.get(id, 'dav') : '';
    } catch {
      return '';
    }
  };
  return {
    list: () => accounts.map(a => ({ ...a, hasPassword: Boolean(secret(a.id)) })),
    get: id => accounts.find(a => a.id === id) || null,
    password: secret,
    async create(input, password) {
      if (!vault?.available) throw fail('Der Schlüsselbund ist nicht verfügbar.', 'vault_unavailable', 503);
      if (accounts.length >= MAX_ACCOUNTS) throw fail('Maximal fünf Kalender-/Kontaktkonten.', 'dav_limit', 409);
      const item = {
        id: `dav-${randomBytes(6).toString('hex')}`,
        label: input.label,
        serverUrl: input.serverUrl,
        username: input.username,
        hidden: [],
        colors: {},
        defaultCalendar: '',
        defaultAddressBook: ''
      };
      vault.set(item.id, 'dav', password);
      accounts.push(item);
      try {
        await persist();
      } catch (err) {
        accounts.pop();
        vault.delete(item.id, 'dav');
        throw err;
      }
      return item;
    },
    async update(id, patch, password) {
      const item = accounts.find(a => a.id === id);
      if (!item) throw fail('Konto nicht gefunden.', 'dav_missing', 404);
      Object.assign(item, patch);
      if (password) vault.set(id, 'dav', password);
      await persist();
      return item;
    },
    async remove(id) {
      accounts = accounts.filter(a => a.id !== id);
      await persist();
      try {
        vault.delete(id, 'dav');
      } catch {
        /* best effort */
      }
    }
  };
}

function connect(serverUrl, username, password, type) {
  return new DAVClient({
    serverUrl,
    credentials: { username, password },
    authMethod: 'Basic',
    defaultAccountType: type
  });
}

/** Login test for both services; at least one must work. */
export async function verifyDav({ serverUrl, username, password }) {
  const result = { caldav: false, carddav: false };
  let lastError;
  for (const type of ['caldav', 'carddav']) {
    try {
      await connect(serverUrl, username, password, type).login();
      result[type] = true;
    } catch (err) {
      lastError = err;
    }
  }
  if (!result.caldav && !result.carddav) throw davErrorInfo(lastError);
  return result;
}

const addressBookBody = name => `<?xml version="1.0" encoding="utf-8"?>
<d:mkcol xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav"><d:set><d:prop>
<d:resourcetype><d:collection/><c:addressbook/></d:resourcetype><d:displayname>${name}</d:displayname>
</d:prop></d:set></d:mkcol>`;

/**
 * Runtime service: calendars, events (with expansion), contacts. Objects are cached in
 * memory per collection and refreshed when the collection's ctag changes.
 */
const authHeader = (account, store) =>
  `Basic ${Buffer.from(`${account.username}:${store.password(account.id)}`).toString('base64')}`;
const xmlText = (xml, tag) => {
  const m = new RegExp(`<(?:[a-z]+:)?${tag}[^>]*>([\\s\\S]*?)</(?:[a-z]+:)?${tag}>`, 'i').exec(xml);
  return m
    ? m[1]
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#13;/g, '\r')
        .replace(/&amp;/g, '&')
    : null;
};

export function createDavService({ store, fetchImpl = globalThis.fetch }) {
  /** CalDAV calendar-query by UID (RFC 4791 §7.8.6). */
  async function uidQuery(account, calendarUrl, uid) {
    const body = `<?xml version="1.0" encoding="utf-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:prop-filter name="UID"><c:text-match collation="i;octet">${uid.replace(/[<>&"]/g, '')}</c:text-match></c:prop-filter></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
    const res = await fetchImpl(calendarUrl, {
      method: 'REPORT',
      headers: {
        Depth: '1',
        'Content-Type': 'application/xml; charset=utf-8',
        Authorization: authHeader(account, store)
      },
      body
    });
    if (!res.ok) return null;
    const xml = await res.text();
    const response = /<(?:[a-z]+:)?response[\s>][\s\S]*?<\/(?:[a-z]+:)?response>/i.exec(xml)?.[0];
    if (!response) return null;
    const href = xmlText(response, 'href');
    const data = xmlText(response, 'calendar-data');
    if (!href || !data) return null;
    return {
      url: new URL(href.trim(), calendarUrl).toString(),
      etag: xmlText(response, 'getetag')?.trim() || '',
      data
    };
  }
  const clients = new Map();
  const calendarCache = new Map(); // accountId -> { at, list }
  const objectCache = new Map(); // calendarUrl -> { ctag, from, to, objects }
  const cardCache = new Map(); // addressBookUrl -> { ctag, cards }

  async function client(account, type) {
    const key = `${account.id}|${type}`;
    if (clients.has(key)) return clients.get(key);
    const password = store.password(account.id);
    if (!password) throw fail('Passwort für das Kalenderkonto fehlt. Bitte neu eingeben.', 'dav_auth_failed', 422);
    const c = connect(account.serverUrl, account.username, password, type);
    try {
      await c.login();
    } catch (err) {
      throw davErrorInfo(err);
    }
    clients.set(key, c);
    return c;
  }
  const reset = id => {
    for (const key of [...clients.keys()]) if (key.startsWith(`${id}|`)) clients.delete(key);
    calendarCache.delete(id);
  };

  async function calendars(account, { force = false } = {}) {
    const cached = calendarCache.get(account.id);
    if (cached && !force && Date.now() - cached.at < 60_000) return cached.list;
    const c = await client(account, 'caldav');
    let list;
    try {
      list = await c.fetchCalendars();
    } catch (err) {
      throw davErrorInfo(err);
    }
    list = list.filter(cal => !cal.components || cal.components.includes('VEVENT'));
    const out = list.map((cal, i) => ({
      accountId: account.id,
      url: cal.url,
      name: typeof cal.displayName === 'string' && cal.displayName ? cal.displayName : 'Kalender',
      color:
        account.colors?.[cal.url] ||
        (typeof cal.calendarColor === 'string' ? cal.calendarColor.slice(0, 7) : COLORS[i % COLORS.length]),
      ctag: cal.ctag || cal.syncToken || '',
      hidden: (account.hidden || []).includes(cal.url),
      readOnly: false,
      raw: cal
    }));
    calendarCache.set(account.id, { at: Date.now(), list: out });
    return out;
  }

  async function objectsFor(account, cal, from, to) {
    const cached = objectCache.get(cal.url);
    if (cached && cached.ctag === cal.ctag && cached.from <= from && cached.to >= to) return cached.objects;
    const c = await client(account, 'caldav');
    const wideFrom = new Date(Math.min(from, Date.now()) - 62 * 86400_000).toISOString();
    const wideTo = new Date(to + 62 * 86400_000).toISOString();
    let objects;
    try {
      objects = await c.fetchCalendarObjects({
        calendar: cal.raw,
        timeRange: { start: wideFrom, end: wideTo },
        expand: false
      });
    } catch (err) {
      throw davErrorInfo(err);
    }
    const clean = objects
      .filter(o => typeof o.data === 'string' && o.data.includes('BEGIN:VEVENT'))
      .map(o => ({ url: o.url, etag: o.etag, data: o.data }));
    objectCache.set(cal.url, { ctag: cal.ctag, from: Date.parse(wideFrom), to: Date.parse(wideTo), objects: clean });
    return clean;
  }

  return {
    reset,
    async listCalendars() {
      const all = [];
      const errors = [];
      for (const account of store.list()) {
        try {
          all.push(...(await calendars(account)).map(({ raw: _raw, ...c }) => ({ ...c, accountLabel: account.label })));
        } catch (err) {
          errors.push({ accountId: account.id, error: err.message, code: err.code });
        }
      }
      return { calendars: all, errors };
    },

    async events(from, to, { includeHidden = false } = {}) {
      const out = [];
      const errors = [];
      for (const account of store.list()) {
        let cals;
        try {
          cals = await calendars(account);
        } catch (err) {
          errors.push({ accountId: account.id, error: err.message });
          continue;
        }
        for (const cal of cals) {
          if (cal.hidden && !includeHidden) continue;
          try {
            for (const obj of await objectsFor(account, cal, from, to)) {
              try {
                out.push(
                  ...expandObject(obj.data, from, to, {
                    calendarUrl: cal.url,
                    accountId: account.id,
                    color: cal.color,
                    url: obj.url,
                    etag: obj.etag
                  })
                );
              } catch {
                /* skip broken object */
              }
            }
          } catch (err) {
            errors.push({ accountId: account.id, calendar: cal.name, error: err.message });
          }
        }
      }
      out.sort((a, b) => String(a.start).localeCompare(String(b.start)));
      return { events: out, errors };
    },

    async object(accountId, url) {
      for (const [, entry] of objectCache) {
        const hit = entry.objects.find(o => o.url === url);
        if (hit) return hit;
      }
      const account = store.get(accountId);
      if (!account) throw fail('Konto nicht gefunden.', 'dav_missing', 404);
      const c = await client(account, 'caldav');
      const cal = (await calendars(account)).find(x => url.startsWith(x.url));
      if (!cal) throw fail('Kalender nicht gefunden.', 'calendar_missing', 404);
      const objects = await c.fetchCalendarObjects({ calendar: cal.raw, objectUrls: [url] });
      if (!objects[0]?.data) throw fail('Termin nicht gefunden.', 'event_missing', 404);
      return { url, etag: objects[0].etag, data: objects[0].data };
    },

    /** All stored copies of an iCalendar UID (optionally only in one DAV account). */
    async findAllByUid(uid, { accountId = null } = {}) {
      const hits = [];
      for (const account of store.list()) {
        if (accountId && account.id !== accountId) continue;
        let cals;
        try {
          cals = await calendars(account);
        } catch {
          continue;
        }
        for (const cal of cals) {
          try {
            const hit = await uidQuery(account, cal.url, uid);
            if (hit) hits.push({ accountId: account.id, calendarUrl: cal.url, ...hit });
          } catch {
            /* continue */
          }
        }
      }
      return hits;
    },
    async findByUid(uid, options) {
      return (await this.findAllByUid(uid, options))[0] || null;
    },

    async createCalendarObject(accountId, calendarUrl, uid, ics) {
      const account = store.get(accountId);
      if (!account) throw fail('Konto nicht gefunden.', 'dav_missing', 404);
      const cal = (await calendars(account)).find(x => x.url === calendarUrl);
      if (!cal) throw fail('Kalender nicht gefunden.', 'calendar_missing', 404);
      const c = await client(account, 'caldav');
      const filename = `${uid.replace(/[^a-z0-9-]/gi, '') || randomUUID()}.ics`;
      const res = await c.createCalendarObject({ calendar: cal.raw, filename, iCalString: ics });
      if (!res.ok)
        throw fail(
          res.status === 412
            ? 'Ein Termin mit dieser Kennung existiert bereits.'
            : 'Termin konnte nicht gespeichert werden.',
          'event_save_failed',
          res.status === 412 ? 409 : 502
        );
      objectCache.delete(cal.url);
      calendarCache.delete(account.id);
      return { url: new URL(filename, cal.url).toString() };
    },
    async updateCalendarObject(accountId, url, etag, ics) {
      const account = store.get(accountId);
      if (!account) throw fail('Konto nicht gefunden.', 'dav_missing', 404);
      const c = await client(account, 'caldav');
      const res = await c.updateCalendarObject({ calendarObject: { url, etag, data: ics } });
      if (res.status === 412)
        throw fail('Der Termin wurde zwischenzeitlich geändert. Bitte neu laden.', 'event_conflict', 409);
      if (!res.ok) throw fail('Termin konnte nicht gespeichert werden.', 'event_save_failed', 502);
      for (const [key] of objectCache) if (url.startsWith(key)) objectCache.delete(key);
      calendarCache.delete(account.id);
      return { ok: true };
    },
    async deleteCalendarObject(accountId, url, etag) {
      const account = store.get(accountId);
      if (!account) throw fail('Konto nicht gefunden.', 'dav_missing', 404);
      const c = await client(account, 'caldav');
      const res = await c.deleteCalendarObject({ calendarObject: { url, etag } });
      if (res.status === 412)
        throw fail('Der Termin wurde zwischenzeitlich geändert. Bitte neu laden.', 'event_conflict', 409);
      if (!res.ok && res.status !== 404) throw fail('Termin konnte nicht gelöscht werden.', 'event_delete_failed', 502);
      for (const [key] of objectCache) if (url.startsWith(key)) objectCache.delete(key);
      calendarCache.delete(account.id);
      return { ok: true };
    },
    async createCalendar(accountId, name) {
      const account = store.get(accountId);
      const c = await client(account, 'caldav');
      const url = new URL(`${randomUUID()}/`, c.account.homeUrl).toString();
      await c.makeCalendar({ url, props: { displayname: name } });
      calendarCache.delete(accountId);
      return { url };
    },

    // ---------------- contacts
    async addressBooks(account) {
      const c = await client(account, 'carddav');
      let books;
      try {
        books = await c.fetchAddressBooks();
      } catch (err) {
        throw davErrorInfo(err);
      }
      if (!books.length) {
        const url = new URL('contacts/', c.account.homeUrl).toString();
        const res = await fetchImpl(url, {
          method: 'MKCOL',
          headers: { 'Content-Type': 'application/xml; charset=utf-8', Authorization: authHeader(account, store) },
          body: addressBookBody('Kontakte')
        }).catch(() => null);
        if (res?.ok) books = await c.fetchAddressBooks();
      }
      return books;
    },
    async contacts() {
      const out = [];
      const books = [];
      const errors = [];
      for (const account of store.list()) {
        let list;
        try {
          list = await this.addressBooks(account);
        } catch (err) {
          errors.push({ accountId: account.id, error: err.message });
          continue;
        }
        const c = await client(account, 'carddav');
        for (const book of list) {
          books.push({
            accountId: account.id,
            url: book.url,
            name: typeof book.displayName === 'string' && book.displayName ? book.displayName : 'Kontakte',
            accountLabel: account.label
          });
          const cached = cardCache.get(book.url);
          let cards = cached && cached.ctag && cached.ctag === book.ctag ? cached.cards : null;
          if (!cards) {
            try {
              cards = (await c.fetchVCards({ addressBook: book }))
                .filter(v => typeof v.data === 'string')
                .map(v => ({ url: v.url, etag: v.etag, data: v.data }));
            } catch (err) {
              errors.push({ accountId: account.id, error: davErrorInfo(err).message });
              continue;
            }
            cardCache.set(book.url, { ctag: book.ctag, cards });
          }
          for (const card of cards) {
            const parsed = parseVCard(card.data);
            if (parsed)
              out.push({ ...parsed, url: card.url, etag: card.etag, accountId: account.id, addressBookUrl: book.url });
          }
        }
      }
      out.sort((a, b) => a.name.localeCompare(b.name, 'de'));
      return { contacts: out, addressBooks: books, errors };
    },
    async saveContact(accountId, { url, etag, addressBookUrl, uid, vcard }) {
      const account = store.get(accountId);
      if (!account) throw fail('Konto nicht gefunden.', 'dav_missing', 404);
      const c = await client(account, 'carddav');
      let res;
      if (url) res = await c.updateVCard({ vCard: { url, etag, data: vcard } });
      else {
        const book = (await this.addressBooks(account)).find(b => b.url === addressBookUrl);
        if (!book) throw fail('Adressbuch nicht gefunden.', 'addressbook_missing', 404);
        res = await c.createVCard({ addressBook: book, filename: `${uid}.vcf`, vCardString: vcard });
      }
      if (res.status === 412)
        throw fail('Der Kontakt wurde zwischenzeitlich geändert. Bitte neu laden.', 'contact_conflict', 409);
      if (!res.ok) throw fail('Kontakt konnte nicht gespeichert werden.', 'contact_save_failed', 502);
      cardCache.clear();
      return { ok: true };
    },
    async deleteContact(accountId, url, etag) {
      const account = store.get(accountId);
      if (!account) throw fail('Konto nicht gefunden.', 'dav_missing', 404);
      const c = await client(account, 'carddav');
      const res = await c.deleteVCard({ vCard: { url, etag } });
      if (!res.ok && res.status !== 404)
        throw fail('Kontakt konnte nicht gelöscht werden.', 'contact_delete_failed', 502);
      cardCache.clear();
      return { ok: true };
    }
  };
}
