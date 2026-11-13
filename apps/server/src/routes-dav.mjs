// Calendar (CalDAV), contacts (CardDAV) and invitations (iTIP/iMIP over e-mail).
import nodemailer from 'nodemailer';
import { normalizeServerUrl, verifyDav } from './dav.mjs';
import {
  validateEventInput,
  createEventIcs,
  updateEventIcs,
  excludeOccurrence,
  buildOrganizerMessage,
  buildReply,
  invitationToStoredIcs,
  applyReply,
  parseItip,
  dueAlarms
} from './calendar-model.mjs';
import { validateContact, buildVCard, splitVcards } from './vcard.mjs';
import { loadParsedMessage } from './message-service.mjs';
import { validFolder, validUid } from './message-utils.mjs';
import { submitEmail, appendToSent } from './send-service.mjs';
import { randomUUID } from 'node:crypto';
import { isCloud } from './cloud.mjs';
import { LOCAL_ACCOUNT, isLocalCalendar } from './local-calendar.mjs';

const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });
const RANGE_MAX = 400 * 86400_000;
const PARTSTAT = { accept: 'ACCEPTED', tentative: 'TENTATIVE', decline: 'DECLINED' };
const ANSWER_TEXT = { ACCEPTED: 'Zugesagt', TENTATIVE: 'Mit Vorbehalt', DECLINED: 'Abgelehnt' };

export function registerDavRoutes(ctx) {
  const { api, davStore, davService, requireAction, errorResponse, withImap } = ctx;
  const cloud = ctx.cloud;
  const local = ctx.localCalendar;
  // CalDAV and the local calendar share one interface (iCalendar objects).
  const localBackend = {
    object: (_a, url) => local.object(url),
    createCalendarObject: (_a, calendarUrl, uid, ics) => local.createCalendarObject(calendarUrl, uid, ics),
    updateCalendarObject: (_a, url, etag, ics) => local.updateCalendarObject(url, etag, ics),
    deleteCalendarObject: (_a, url, etag) => local.deleteCalendarObject(url, etag)
  };
  const backend = accountId => (accountId === LOCAL_ACCOUNT && local ? localBackend : davService);
  const isCloudAccount = accountId => Boolean(cloud?.accounts().some(a => a.id === accountId));
  /** CalDAV/CardDAV and Microsoft 365/Google merged into one answer. */
  async function merged(fromDav, fromCloud, key) {
    const [a, b] = await Promise.all([fromDav(), cloud ? fromCloud() : null]);
    if (!b) return a;
    const out = { ...a, errors: [...(a.errors || []), ...(b.errors || [])] };
    for (const k of key) out[k] = [...(a[k] || []), ...(b[k] || [])];
    return out;
  }
  const allCalendars = async () => {
    const r = await merged(
      () => davService.listCalendars(),
      () => cloud.listCalendars(),
      ['calendars']
    );
    // The device calendar comes last, so connected calendars stay the default for new events.
    return local ? { ...r, calendars: [...r.calendars, ...local.listCalendars().calendars] } : r;
  };
  const allEvents = async (from, to) => {
    const r = await merged(
      () => davService.events(from, to),
      () => cloud.events(from, to),
      ['events']
    );
    if (local) r.events = [...r.events, ...local.events(from, to).events];
    r.events.sort((a, b) => String(a.start).localeCompare(String(b.start)));
    return r;
  };
  const allContacts = async () => {
    const r = await merged(
      () => davService.contacts(),
      () => cloud.contacts(),
      ['contacts', 'addressBooks']
    );
    r.contacts.sort((a, b) => a.name.localeCompare(b.name, 'de'));
    return r;
  };

  function str(value, max, label) {
    if (typeof value !== 'string' || value.length > max || /[\0\r\n]/.test(value))
      throw fail(`Ungültiges Feld: ${label}.`, 'dav_invalid');
    return value.trim();
  }
  const guard = (route, action, handler, limit = 64 * 1024) =>
    api.post(route, { bodyLimit: limit }, async (request, reply) => {
      if (!requireAction(request, reply, action)) return;
      try {
        return await handler(request, reply);
      } catch (err) {
        return errorResponse(reply, err);
      }
    });

  // ------------------------------------------------------------ accounts
  api.get('/api/dav/accounts', async () => ({
    accounts: davStore.list().map(({ hidden: _h, colors: _c, ...a }) => a)
  }));
  guard('/api/dav/accounts/verify', 'accounts-v1', async request => {
    const b = request.body || {};
    const existing = b.id ? davStore.get(b.id) : null;
    return verifyDav({
      serverUrl: normalizeServerUrl(b.serverUrl ?? existing?.serverUrl),
      username: str(b.username ?? existing?.username ?? '', 254, 'Benutzer'),
      password: b.password || (existing ? davStore.password(existing.id) : '')
    });
  });
  guard('/api/dav/accounts/create', 'accounts-v1', async (request, reply) => {
    const b = request.body || {};
    const serverUrl = normalizeServerUrl(b.serverUrl);
    const username = str(b.username || '', 254, 'Benutzer');
    if (typeof b.password !== 'string' || !b.password || b.password.length > 1024)
      throw fail('Bitte das (App-)Passwort eingeben.', 'dav_invalid');
    const services = await verifyDav({ serverUrl, username, password: b.password });
    const account = await davStore.create(
      { label: str(b.label || new URL(serverUrl).hostname, 80, 'Name'), serverUrl, username },
      b.password
    );
    return reply.code(201).send({ account, services });
  });
  guard('/api/dav/accounts/update', 'accounts-v1', async request => {
    const b = request.body || {};
    const existing = davStore.get(b.id);
    if (!existing) throw fail('Konto nicht gefunden.', 'dav_missing', 404);
    const patch = { label: str(b.label ?? existing.label, 80, 'Name') };
    if (b.password)
      await verifyDav({ serverUrl: existing.serverUrl, username: existing.username, password: b.password });
    davService.reset(existing.id);
    return { account: await davStore.update(existing.id, patch, b.password || '') };
  });
  guard('/api/dav/accounts/remove', 'accounts-v1', async request => {
    if (request.body?.confirm !== 'REMOVE_DAV_ACCOUNT') throw fail('Entfernen muss bestätigt werden.', 'dav_invalid');
    davService.reset(request.body.id);
    await davStore.remove(request.body.id);
    return { removed: true };
  });

  // ------------------------------------------------------------ calendars & events
  api.get('/api/calendar/calendars', async (_request, reply) => {
    try {
      return await allCalendars();
    } catch (err) {
      return errorResponse(reply, err);
    }
  });
  guard('/api/calendar/calendars/update', 'calendar-v1', async request => {
    const { accountId, url, hidden, color, name } = request.body || {};
    if (isLocalCalendar(url)) {
      if (typeof color === 'string' && !/^#[0-9a-f]{6}$/i.test(color)) throw fail('Ungültige Farbe.', 'dav_invalid');
      return local.setCalendarPrefs(url, {
        hidden,
        color,
        name: typeof name === 'string' ? str(name, 80, 'Name') : undefined
      });
    }
    if (isCloud(url)) {
      if (typeof color === 'string' && !/^#[0-9a-f]{6}$/i.test(color)) throw fail('Ungültige Farbe.', 'dav_invalid');
      await cloud.setCalendarPrefs(accountId, url, { hidden, color });
      return { ok: true };
    }
    const account = davStore.get(accountId);
    if (!account) throw fail('Konto nicht gefunden.', 'dav_missing', 404);
    const patch = {};
    if (typeof hidden === 'boolean')
      patch.hidden = hidden
        ? [...new Set([...(account.hidden || []), url])]
        : (account.hidden || []).filter(u => u !== url);
    if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color))
      patch.colors = { ...(account.colors || {}), [url]: color };
    await davStore.update(accountId, patch);
    davService.reset(accountId);
    return { ok: true };
  });
  guard('/api/calendar/calendars/create', 'calendar-v1', async request => {
    const name = str(request.body?.name || 'Kalender', 80, 'Name');
    if (isCloudAccount(request.body?.accountId)) return cloud.createCalendar(request.body.accountId, name);
    if (request.body?.accountId === LOCAL_ACCOUNT) return local.createCalendar(name);
    return davService.createCalendar(request.body?.accountId, name);
  });
  guard('/api/calendar/calendars/delete', 'calendar-v1', async request => {
    if (request.body?.confirm !== 'DELETE_LOCAL_CALENDAR') throw fail('Löschen muss bestätigt werden.', 'dav_invalid');
    if (!isLocalCalendar(request.body?.url))
      throw fail('Nur lokale Kalender können hier gelöscht werden.', 'dav_invalid');
    return local.deleteCalendar(request.body.url);
  });
  // Local calendar: .ics export (backup, other apps) and import.
  api.get('/api/calendar/local/export', async (request, reply) => {
    try {
      const url = typeof request.query?.url === 'string' && request.query.url ? request.query.url : null;
      reply.headers({
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'attachment; filename="Levuvo-Kalender.ics"',
        'Cache-Control': 'no-store'
      });
      return local.exportIcs(url);
    } catch (err) {
      return errorResponse(reply, err);
    }
  });
  guard(
    '/api/calendar/local/import',
    'calendar-v1',
    async request => {
      if (!isLocalCalendar(request.body?.url)) throw fail('Bitte einen lokalen Kalender wählen.', 'dav_invalid');
      return local.importIcs(request.body.url, String(request.body?.ics || ''));
    },
    5 * 1024 * 1024
  );
  api.get('/api/calendar/events', async (request, reply) => {
    const from = Date.parse(String(request.query?.from || ''));
    const to = Date.parse(String(request.query?.to || ''));
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > RANGE_MAX)
      return reply.code(400).send({ error: 'Ungültiger Zeitraum.' });
    try {
      return await allEvents(from, to);
    } catch (err) {
      return errorResponse(reply, err);
    }
  });
  api.get('/api/calendar/alarms', async (request, reply) => {
    const from = Date.parse(String(request.query?.from || ''));
    const to = Date.parse(String(request.query?.to || ''));
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 2 * 86400_000)
      return reply.code(400).send({ error: 'Ungültiger Zeitraum.' });
    try {
      const { events } = await allEvents(from - 86400_000, to + 8 * 86400_000);
      return { alarms: dueAlarms(events, from, to) };
    } catch {
      return { alarms: [] };
    }
  });

  /** Mail account + identity that acts as organizer/attendee for an address. */
  function mailIdentityFor(email) {
    const e = String(email || '').toLowerCase();
    for (const a of ctx.accounts()) {
      if (a.imap.user.toLowerCase() === e) return { account: a, from: ctx.fromFor(a, a.imap.user) };
      const alias = (a.identities || []).find(i => i.email === e);
      if (alias) return { account: a, from: ctx.fromFor(a, alias.email) };
    }
    return null;
  }
  /** iMIP: an e-mail with text/calendar (method) plus a readable text part. */
  async function sendItip(identity, to, subject, text, method, ics) {
    const { account, from } = identity;
    const composer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' });
    const built = await composer.sendMail({
      from,
      to,
      subject,
      text,
      icalEvent: { method, content: ics, filename: method === 'REPLY' ? 'reply.ics' : 'invite.ics' },
      headers: { 'X-Mailer': 'Levuvo Mail' },
      disableFileAccess: true,
      disableUrlAccess: true
    });
    const smtp = await ctx.smtpConfigFor(account);
    await submitEmail(smtp, { to, cc: [], bcc: [] }, built.message, ctx.smtpFactory(smtp));
    await appendToSent(fn => withImap(fn, account, { retryConnect: false }), built.message, account.sentFolder).catch(
      () => {}
    );
  }
  const when = e =>
    e.allDay
      ? e.start
      : new Date(e.start).toLocaleString('de-AT', {
          dateStyle: 'full',
          timeStyle: 'short',
          timeZone: e.tzid || 'Europe/Vienna'
        });
  function invitationText(e, method) {
    const lines = [method === 'CANCEL' ? `Abgesagt: ${e.summary}` : `Einladung: ${e.summary}`, '', `Wann: ${when(e)}`];
    if (e.location) lines.push(`Wo: ${e.location}`);
    if (e.description) lines.push('', e.description);
    lines.push('', 'Gesendet mit Levuvo Mail.');
    return lines.join('\n');
  }

  guard('/api/calendar/events/save', 'calendar-v1', async request => {
    const b = request.body || {};
    const model = validateEventInput(b.event);
    // Moving to another calendar (also between local, CalDAV, Microsoft and Google): the event is
    // created in the target and removed from the source (as a whole series).
    const target = b.targetAccountId ? String(b.targetAccountId) : null;
    if (b.url && target && b.sourceCalendarUrl && (target !== b.accountId || b.calendarUrl !== b.sourceCalendarUrl)) {
      const saved = await saveEvent(
        { ...b, accountId: target, url: null, etag: null, scope: 'all', seriesId: null, recurrenceId: null },
        model
      );
      await removeEvent({
        accountId: b.accountId,
        calendarUrl: b.sourceCalendarUrl,
        url: b.url,
        seriesId: b.seriesId || null,
        scope: 'all',
        notify: false
      });
      return { ...saved, moved: true };
    }
    return saveEvent(b, model);
  });
  async function saveEvent(b, model) {
    if (isCloud(b.calendarUrl) || isCloud(b.url)) {
      // Microsoft 365 / Google send invitations and updates to attendees themselves.
      const r = await cloud.saveEvent({
        accountId: b.accountId,
        calendarUrl: b.calendarUrl,
        url: b.url || null,
        scope: b.scope === 'this' ? 'this' : 'all',
        seriesId: b.seriesId || null,
        occurrenceStart: b.recurrenceId || null,
        model,
        notify: b.notify === true
      });
      return { ok: true, uid: r.uid || null, invited: r.invited || 0 };
    }
    const identity = model.attendees.length
      ? mailIdentityFor(b.organizer) || mailIdentityFor(ctx.accounts()[0]?.imap.user)
      : null;
    if (model.attendees.length && !identity)
      throw fail('Für Einladungen wird ein eingerichtetes E-Mail-Konto benötigt.', 'calendar_no_mail_account', 409);
    const organizer = identity ? { email: identity.from.address, name: identity.from.name } : null;
    let ics;
    let uid;
    if (b.url) {
      const current = await backend(b.accountId).object(b.accountId, b.url);
      ics = updateEventIcs(current.data, model, {
        scope: b.scope === 'this' ? 'this' : 'all',
        recurrenceId: b.recurrenceId || null,
        organizer
      });
      await backend(b.accountId).updateCalendarObject(b.accountId, b.url, b.etag || current.etag, ics);
      uid = parseItip(ics)?.uid;
    } else {
      ({ uid, ics } = createEventIcs(model, { organizer }));
      await backend(b.accountId).createCalendarObject(b.accountId, b.calendarUrl, uid, ics);
    }
    let invited = 0;
    if (b.notify === true && identity && model.attendees.length) {
      const recipients = model.attendees.map(a => a.email).filter(e => e !== organizer.email);
      if (recipients.length) {
        await sendItip(
          identity,
          recipients,
          `${b.url ? 'Aktualisiert' : 'Einladung'}: ${model.summary}`,
          invitationText({ ...parseItip(ics), tzid: model.tzid }, 'REQUEST'),
          'REQUEST',
          buildOrganizerMessage(ics, 'REQUEST')
        );
        invited = recipients.length;
      }
    }
    return { ok: true, uid, invited };
  }

  guard('/api/calendar/events/delete', 'calendar-v1', async request => removeEvent(request.body || {}));
  async function removeEvent(b) {
    if (isCloud(b.url))
      return cloud.deleteEvent({
        accountId: b.accountId,
        calendarUrl: b.calendarUrl,
        url: b.url,
        scope: b.scope === 'this' ? 'this' : 'all',
        seriesId: b.seriesId || null,
        notify: b.notify === true
      });
    const store = backend(b.accountId);
    const current = await store.object(b.accountId, b.url);
    const info = parseItip(current.data);
    if (b.scope === 'this' && b.recurrenceId) {
      await store.updateCalendarObject(
        b.accountId,
        b.url,
        b.etag || current.etag,
        excludeOccurrence(current.data, b.recurrenceId)
      );
    } else {
      await store.deleteCalendarObject(b.accountId, b.url, b.etag || current.etag);
    }
    let cancelled = 0;
    if (b.notify === true && info?.organizer && info.attendees.length && b.scope !== 'this') {
      const identity = mailIdentityFor(info.organizer.email);
      const recipients = info.attendees.map(a => a.email).filter(e => e !== info.organizer.email);
      if (identity && recipients.length) {
        await sendItip(
          identity,
          recipients,
          `Abgesagt: ${info.summary}`,
          invitationText(info, 'CANCEL'),
          'CANCEL',
          buildOrganizerMessage(current.data, 'CANCEL')
        );
        cancelled = recipients.length;
      }
    }
    return { ok: true, cancelled };
  }

  // ------------------------------------------------------------ invitations in mail
  api.get('/api/invitations/calendars', async (_request, reply) => {
    try {
      return { calendars: (await allCalendars()).calendars.filter(c => !c.readOnly) };
    } catch (err) {
      return errorResponse(reply, err);
    }
  });
  async function loadInvitation(request) {
    const { folder, uid } = request.body || {};
    if (!validFolder(folder) || !validUid(String(uid))) throw fail('Ungültige Nachricht.', 'invitation_invalid');
    const loaded = await withImap(
      client =>
        loadParsedMessage(client, folder, Number(uid), {
          context: { ownAddresses: ctx.accountAddresses(request.mailAccount) }
        }),
      request.mailAccount
    );
    if (!loaded?.ics || !loaded.detail.invitation)
      throw fail('Die Nachricht enthält keine Einladung.', 'invitation_missing', 404);
    return loaded;
  }
  /** Attendee answers REQUEST: REPLY to the organizer + store/update/remove the event. */
  guard('/api/invitations/respond', 'calendar-v1', async request => {
    const partstat = PARTSTAT[request.body?.response];
    if (!partstat) throw fail('Ungültige Antwort.', 'invitation_invalid');
    const loaded = await loadInvitation(request);
    const inv = loaded.detail.invitation;
    if (inv.method !== 'REQUEST')
      throw fail('Auf diese Nachricht kann nicht geantwortet werden.', 'invitation_invalid');
    const own = ctx.accountAddresses(request.mailAccount);
    const me = inv.attendees.find(a => own.includes(a.email)) || null;
    const myEmail = me?.email || request.mailAccount.imap.user;
    const identity = mailIdentityFor(myEmail) || {
      account: request.mailAccount,
      from: ctx.fromFor(request.mailAccount)
    };
    const calendar = request.body?.calendar;
    if (calendar?.url && isCloud(calendar.url)) {
      // Exchange/Gmail already put the invitation into the calendar: answer there, the
      // provider informs the organizer. Otherwise answer by e-mail and add the event.
      const answered = await cloud.respond({
        accountId: calendar.accountId,
        calendarUrl: calendar.url,
        uid: inv.uid,
        partstat,
        me: myEmail.toLowerCase()
      });
      if (answered.found) return { ok: true, partstat, stored: partstat !== 'DECLINED', replied: true };
      if (inv.organizer?.email)
        await sendItip(
          identity,
          [inv.organizer.email],
          `${ANSWER_TEXT[partstat]}: ${inv.summary}`,
          `${ANSWER_TEXT[partstat]}: ${inv.summary}\n\nGesendet mit Levuvo Mail.`,
          'REPLY',
          buildReply(loaded.ics, { email: myEmail, name: identity.from.name }, partstat)
        );
      if (partstat !== 'DECLINED' && inv.start && inv.end) {
        const local = v => (inv.allDay ? v.slice(0, 10) : localWall(v, 'Europe/Vienna'));
        await cloud.saveEvent({
          accountId: calendar.accountId,
          calendarUrl: calendar.url,
          model: validateEventInput({
            summary: inv.summary || '—',
            allDay: inv.allDay,
            tzid: inv.allDay ? null : 'Europe/Vienna',
            start: local(inv.start),
            end: local(inv.end),
            location: inv.location,
            description: inv.description
          }),
          notify: false
        });
      }
      return { ok: true, partstat, stored: partstat !== 'DECLINED', replied: Boolean(inv.organizer?.email) };
    }
    if (inv.organizer?.email) {
      const replyIcs = buildReply(loaded.ics, { email: myEmail, name: identity.from.name }, partstat);
      await sendItip(
        identity,
        [inv.organizer.email],
        `${ANSWER_TEXT[partstat]}: ${inv.summary}`,
        `${ANSWER_TEXT[partstat]}: ${inv.summary}\n\nGesendet mit Levuvo Mail.`,
        'REPLY',
        replyIcs
      );
    }
    let stored = false;
    // Only the attendee's own calendar account is touched (never the organizer's copy).
    const existing =
      calendar?.accountId === LOCAL_ACCOUNT && local
        ? local.findAllByUid(inv.uid)[0] || null
        : await davService.findByUid(inv.uid, { accountId: calendar?.accountId || null });
    if (partstat === 'DECLINED') {
      if (existing)
        await backend(existing.accountId).deleteCalendarObject(existing.accountId, existing.url, existing.etag);
    } else {
      const ics = invitationToStoredIcs(loaded.ics, myEmail, partstat);
      if (existing)
        await backend(existing.accountId).updateCalendarObject(existing.accountId, existing.url, existing.etag, ics);
      else if (calendar?.accountId && calendar?.url)
        await backend(calendar.accountId).createCalendarObject(
          calendar.accountId,
          calendar.url,
          inv.uid || randomUUID(),
          ics
        );
      stored = Boolean(existing || calendar?.url);
    }
    return { ok: true, partstat, stored, replied: Boolean(inv.organizer?.email) };
  });
  /** Organizer receives REPLY → update PARTSTAT; attendee receives CANCEL → remove. */
  guard('/api/invitations/apply', 'calendar-v1', async request => {
    const loaded = await loadInvitation(request);
    const inv = loaded.detail.invitation;
    const own = ctx.ownAddresses();
    const copies = [...(await davService.findAllByUid(inv.uid)), ...(local ? local.findAllByUid(inv.uid) : [])];
    if (!copies.length) return { ok: true, applied: false, reason: 'not_in_calendar' };
    if (inv.method === 'REPLY') {
      // The organizer's copies (ORGANIZER is one of our addresses) receive the new status.
      let applied = 0;
      for (const copy of copies) {
        if (!own.includes(parseItip(copy.data)?.organizer?.email || '')) continue;
        const updated = applyReply(copy.data, loaded.ics);
        if (updated) {
          await backend(copy.accountId).updateCalendarObject(copy.accountId, copy.url, copy.etag, updated);
          applied++;
        }
      }
      return { ok: true, applied: applied > 0 };
    }
    if (inv.method === 'CANCEL') {
      for (const copy of copies)
        await backend(copy.accountId).deleteCalendarObject(copy.accountId, copy.url, copy.etag);
      return { ok: true, applied: true };
    }
    throw fail('Diese Kalendernachricht kann nicht übernommen werden.', 'invitation_invalid');
  });

  // ------------------------------------------------------------ contacts
  api.get('/api/contacts/list', async (_request, reply) => {
    try {
      return await allContacts();
    } catch (err) {
      return errorResponse(reply, err);
    }
  });
  guard('/api/contacts/save', 'contacts-v1', async request => {
    const b = request.body || {};
    const contact = validateContact(b.contact);
    if (isCloud(b.url) || isCloud(b.addressBookUrl))
      return cloud.saveContact({ accountId: b.accountId, url: b.url || null, etag: b.etag || null, contact });
    const uid = b.uid || randomUUID();
    await davService.saveContact(b.accountId, {
      url: b.url || null,
      etag: b.etag || null,
      addressBookUrl: b.addressBookUrl,
      uid,
      vcard: buildVCard(contact, uid)
    });
    return { ok: true };
  });
  guard('/api/contacts/delete', 'contacts-v1', async request =>
    isCloud(request.body?.url)
      ? cloud.deleteContact({ accountId: request.body.accountId, url: request.body.url })
      : davService.deleteContact(request.body?.accountId, request.body?.url, request.body?.etag)
  );
  guard(
    '/api/contacts/import',
    'contacts-v1',
    async request => {
      const vcf = String(request.body?.vcf || '');
      const cards = splitVcards(vcf);
      if (!cards.length) throw fail('Die Datei enthält keine Kontakte (vCard).', 'contact_invalid');
      if (cards.length > 2000) throw fail('Höchstens 2000 Kontakte pro Import.', 'contact_invalid');
      let imported = 0;
      for (const card of cards) {
        const uid = randomUUID();
        const { parseVCard } = await import('./vcard.mjs');
        const parsed = parseVCard(card);
        if (!parsed) continue;
        if (isCloud(request.body.addressBookUrl)) {
          await cloud.saveContact({ accountId: request.body.accountId, contact: validateContact(parsed) });
          imported++;
          continue;
        }
        await davService.saveContact(request.body.accountId, {
          addressBookUrl: request.body.addressBookUrl,
          uid,
          vcard: buildVCard(validateContact(parsed), uid)
        });
        imported++;
      }
      return { imported };
    },
    5 * 1024 * 1024
  );
  api.get('/api/contacts/export', async (_request, reply) => {
    try {
      const { contacts } = await allContacts();
      reply.headers({
        'Content-Type': 'text/vcard; charset=utf-8',
        'Content-Disposition': 'attachment; filename="Levuvo-Kontakte.vcf"'
      });
      return contacts.map(c => buildVCard(c, c.uid || randomUUID())).join('');
    } catch (err) {
      return errorResponse(reply, err);
    }
  });
}

/** UTC instant → wall-clock "YYYY-MM-DDTHH:mm" in a time zone. */
function localWall(iso, tz) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
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
