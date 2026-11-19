// "Termin finden" and booking by e-mail (see scheduling.mjs for the rules and texts).
//
// Stored in scheduling.json, encrypted (key `scheduling-key` in the system keychain): polls and
// offers (title, participants' addresses, slots, votes), booking links (settings and token),
// and which reply mails were handled. Nothing leaves the device except the mails the user sends
// and the automatic answers of an active booking link. Finished polls are deleted 30 days after
// their last time; the list of handled mails keeps message IDs only.
import { randomUUID } from 'node:crypto';
import { internalApi } from './internal-api.mjs';
import {
  MAX_SLOTS,
  busyFromEvents,
  findSlots,
  fitsLink,
  isFree,
  linkRequest,
  linkSearch,
  mergeBusy,
  newToken,
  normalizeAddress,
  offersMail,
  parseSubjectToken,
  proposalMail,
  spreadSlots,
  tally,
  texts,
  validTimeZone,
  validateLink,
  validateSearch,
  votesFromText,
  wallClock
} from './scheduling.mjs';

const MAX_POLLS = 200;
const MAX_LINKS = 20;
const KEEP_DAYS = 30;
const MAX_PROCESSED = 3000;
/** Automatic answers of booking links: per sender and in total per day. */
const PER_SENDER_DAY = 5;
const TOTAL_DAY = 60;
const DAY = 86_400_000;
const SCAN_MS = 5 * 60_000;

const fail = (message, code = 'scheduling_invalid', statusCode = 400) =>
  Object.assign(new Error(message), { code, statusCode });
const clean = (v, max) =>
  String(v ?? '')
    .replace(/[\r\n\0]/g, ' ')
    .trim()
    .slice(0, max);

export const EMPTY_SCHEDULING = { polls: [], links: [], processed: [], answered: [] };

/**
 * The scheduling service. `api` is the app's internal API (events, calendars, messages, message,
 * send, saveEvent); `freeBusy(emails, from, to)` asks Microsoft 365 / Google; `identity(accountId)`
 * gives { address, name } of a mail account; `ownAddresses()` all of the user's addresses.
 */
export function createScheduling({
  file,
  api,
  freeBusy,
  identity,
  ownAddresses,
  now = () => Date.now(),
  logger = () => {}
}) {
  const state = () => ({ ...EMPTY_SCHEDULING, ...file.get() });
  const save = patch => file.save({ ...state(), ...patch });
  let queue = Promise.resolve();
  const serial = fn => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  };

  // ---------------------------------------------------------------- availability
  async function calendarEvents(from, to) {
    const r = await api.events(new Date(from).toISOString(), new Date(to).toISOString());
    return r.events || [];
  }
  /** Busy blocks per person: "me" from the own calendars, others from calendars or free/busy. */
  async function availability(input) {
    const search = validateSearch({ ...input, now: now() });
    const own = new Set(ownAddresses().map(a => a.toLowerCase()));
    const others = search.participants.filter(p => !own.has(p.email));
    const events = await calendarEvents(search.from - DAY, search.to + DAY);
    const assigned = new Set(others.map(p => p.calendarUrl).filter(Boolean));
    const opts = { ownAddresses: [...own], allDayBusy: search.allDayBusy, timeZone: search.timeZone };
    const people = {
      me: {
        busy: busyFromEvents(
          events.filter(e => !assigned.has(e.calendarUrl)),
          opts
        )
      }
    };
    const sources = [{ email: 'me', source: 'own' }];
    const viaCalendar = others.filter(p => p.calendarUrl);
    for (const p of viaCalendar) {
      people[p.email] = {
        busy: busyFromEvents(
          events.filter(e => e.calendarUrl === p.calendarUrl),
          { ...opts, ownAddresses: [p.email] }
        )
      };
      sources.push({ email: p.email, name: p.name, source: 'calendar' });
    }
    const ask = others.filter(p => !p.calendarUrl).map(p => p.email);
    let errors = [];
    if (ask.length && freeBusy) {
      const r = await freeBusy(ask, search.from, search.to).catch(err => ({
        people: {},
        errors: [{ error: err.message, code: err.code }]
      }));
      errors = r.errors || [];
      for (const email of ask) {
        const found = r.people?.[email];
        const name = others.find(p => p.email === email)?.name || '';
        if (found) {
          people[email] = { busy: mergeBusy(found.busy) };
          sources.push({ email, name, source: found.source });
        } else {
          people[email] = { unknown: true };
          sources.push({ email, name, source: 'unknown' });
        }
      }
    } else
      for (const email of ask) {
        people[email] = { unknown: true };
        sources.push({ email, name: others.find(p => p.email === email)?.name || '', source: 'unknown' });
      }
    return {
      slots: findSlots(people, search, { max: 30 }),
      people: sources,
      errors,
      search: { ...search, participants: undefined }
    };
  }
  async function ownBusy(from, to, timeZone) {
    return busyFromEvents(await calendarEvents(from - DAY, to + DAY), { ownAddresses: ownAddresses(), timeZone });
  }

  // ---------------------------------------------------------------- polls and offers
  const publicPoll = p => ({ ...p, token: undefined, ...tally(p) });
  function validSlots(list, minutes) {
    if (!Array.isArray(list) || !list.length) throw fail('Bitte mindestens eine Zeit auswählen.');
    if (list.length > MAX_SLOTS) throw fail(`Höchstens ${MAX_SLOTS} Zeiten.`);
    return list.map(s => {
      const start = Date.parse(s?.start);
      if (!Number.isFinite(start) || start < now() - 60_000) throw fail('Eine der Zeiten liegt in der Vergangenheit.');
      return { start: new Date(start).toISOString(), end: new Date(start + minutes * 60_000).toISOString() };
    });
  }
  async function sendMail(accountId, to, mail) {
    await api.send(accountId, {
      requestId: randomUUID(),
      confirm: 'SEND',
      to: [to],
      subject: mail.subject,
      html: mail.html
    });
  }

  async function createPoll(input = {}) {
    if (input.confirm !== 'SEND') throw fail('Versand muss ausdrücklich bestätigt werden.');
    const kind = input.kind === 'offer' ? 'offer' : 'poll';
    const accountId = clean(input.accountId, 200);
    const me = identity(accountId);
    if (!me) throw fail('Bitte ein E-Mail-Konto wählen.');
    const title = clean(input.title, 200);
    if (!title) throw fail('Bitte einen Titel eingeben.');
    const minutes = Number.isInteger(input.minutes) && input.minutes >= 15 && input.minutes <= 480 ? input.minutes : 30;
    const own = new Set(ownAddresses().map(a => a.toLowerCase()));
    const participants = [
      ...new Map(
        (Array.isArray(input.participants) ? input.participants : [])
          .map(p => ({ email: normalizeAddress(typeof p === 'string' ? p : p?.email), name: clean(p?.name, 200) }))
          .filter(p => !own.has(p.email))
          .map(p => [p.email, p])
      ).values()
    ];
    if (!participants.length) throw fail('Bitte mindestens eine andere Person angeben.');
    if (participants.length > 20) throw fail('Höchstens 20 Personen.');
    const slots = validSlots(input.slots, minutes);
    const timeZone = validTimeZone(input.timeZone) ? input.timeZone : 'Europe/Vienna';
    const lang = input.lang === 'en' ? 'en' : 'de';
    const s = state();
    if (s.polls.length >= MAX_POLLS) throw fail('Zu viele offene Abstimmungen. Bitte alte löschen.');
    const poll = {
      id: randomUUID(),
      token: newToken(),
      kind,
      accountId,
      organizer: me.address,
      title,
      minutes,
      location: clean(input.location, 300),
      message: String(input.message ?? '').slice(0, 2000),
      participants,
      slots,
      votes: {},
      lang,
      timeZone,
      calendar:
        input.calendar && typeof input.calendar === 'object'
          ? { accountId: clean(input.calendar.accountId, 200), url: String(input.calendar.url || '').slice(0, 2000) }
          : null,
      status: 'open',
      booked: null,
      createdAt: new Date(now()).toISOString()
    };
    const mail = proposalMail({ ...poll, replyTo: me.address, organizer: me.name || me.address });
    // One mail per person: nobody sees the other addresses, and the reply's sender identifies the vote.
    const sent = [];
    for (const p of participants) {
      try {
        await sendMail(accountId, p.email, mail);
        sent.push(p.email);
      } catch (err) {
        if (!sent.length) throw err;
        logger(`scheduling: proposal to one participant failed: ${err.code || err.message}`);
      }
    }
    await save({ polls: [...state().polls, { ...poll, sentTo: sent }] });
    return publicPoll({ ...poll, sentTo: sent });
  }

  function pollById(id) {
    const p = state().polls.find(x => x.id === id);
    if (!p) throw fail('Abstimmung nicht gefunden.', 'scheduling_missing', 404);
    return p;
  }
  async function updatePoll(id, patch) {
    const polls = state().polls.map(p => (p.id === id ? { ...p, ...patch } : p));
    await save({ polls });
    return polls.find(p => p.id === id);
  }
  async function pickCalendar(preferred) {
    const r = await api.calendars();
    const writable = (r.calendars || []).filter(c => !c.readOnly && !c.hidden);
    const hit = preferred && writable.find(c => c.accountId === preferred.accountId && c.url === preferred.url);
    const cal = hit || writable[0];
    if (!cal)
      throw fail('Es gibt keinen Kalender, in den der Termin eingetragen werden kann.', 'scheduling_no_calendar', 409);
    return cal;
  }
  /** Creates the event and sends the invitations (iMIP, or by Microsoft 365 / Google). */
  async function createEvent({ title, start, end, timeZone, location, attendees, organizer, calendar, lang }) {
    const cal = await pickCalendar(calendar);
    const r = await api.saveEvent({
      accountId: cal.accountId,
      calendarUrl: cal.url,
      organizer,
      notify: true,
      event: {
        summary: title,
        start: wallClock(start, timeZone),
        end: wallClock(end, timeZone),
        tzid: timeZone,
        location,
        description: lang === 'en' ? 'Booked with Levuvo Mail.' : 'Gebucht mit Levuvo Mail.',
        attendees: attendees.map(a => ({ email: a.email, name: a.name || '' }))
      }
    });
    return { uid: r.uid || null, calendar: { accountId: cal.accountId, url: cal.url } };
  }
  async function book(input = {}) {
    return serial(async () => {
      const poll = pollById(String(input.id || ''));
      if (poll.status !== 'open')
        throw fail('Für diese Abstimmung wurde schon ein Termin festgelegt.', 'scheduling_closed', 409);
      const n = Number(input.slot);
      const slot = poll.slots[n - 1];
      if (!slot) throw fail('Ungültige Zeit.');
      const event = await createEvent({
        ...poll,
        start: slot.start,
        end: slot.end,
        attendees: poll.participants,
        calendar: input.calendar || poll.calendar
      });
      return publicPoll(
        await updatePoll(poll.id, {
          status: 'booked',
          booked: { slot: n, ...event, at: new Date(now()).toISOString() }
        })
      );
    });
  }

  // ---------------------------------------------------------------- booking links
  const publicLink = (l, address) => ({
    ...l,
    request: address ? linkRequest({ token: l.token, link: l, address }) : null
  });
  async function saveLink(input = {}) {
    const s = state();
    const existing = input.id ? s.links.find(l => l.id === input.id) : null;
    if (input.id && !existing) throw fail('Buchungslink nicht gefunden.', 'scheduling_missing', 404);
    if (!existing && s.links.length >= MAX_LINKS) throw fail(`Höchstens ${MAX_LINKS} Buchungslinks.`);
    const accountId = clean(input.accountId ?? existing?.accountId, 200);
    const me = identity(accountId);
    if (!me) throw fail('Bitte ein E-Mail-Konto wählen.');
    const link = {
      id: existing?.id || randomUUID(),
      token: existing?.token || newToken(),
      accountId,
      ...validateLink(input, existing),
      calendar:
        input.calendar && typeof input.calendar === 'object'
          ? { accountId: clean(input.calendar.accountId, 200), url: String(input.calendar.url || '').slice(0, 2000) }
          : existing?.calendar || null,
      bookings: existing?.bookings || 0,
      createdAt: existing?.createdAt || new Date(now()).toISOString()
    };
    await save({ links: [...s.links.filter(l => l.id !== link.id), link] });
    return publicLink(link, me.address);
  }
  async function removeLink(id) {
    await save({ links: state().links.filter(l => l.id !== id) });
    return { ok: true };
  }
  async function linkSlots(link, exclude = null) {
    const search = linkSearch(link, now());
    const busy = await ownBusy(search.from, search.to, link.timeZone);
    const slots = findSlots({ me: { busy } }, search, { max: 40 }).filter(s => s.start !== exclude);
    return spreadSlots(slots, { max: MAX_SLOTS, perDay: 2, timeZone: link.timeZone });
  }

  // ---------------------------------------------------------------- incoming replies
  function allowAnswer(email) {
    const since = now() - DAY;
    const recent = state().answered.filter(a => Date.parse(a.at) >= since);
    if (recent.length >= TOTAL_DAY) return false;
    return recent.filter(a => a.to === email).length < PER_SENDER_DAY;
  }
  async function noteAnswer(email) {
    const since = now() - DAY;
    await save({
      answered: [
        ...state().answered.filter(a => Date.parse(a.at) >= since),
        { to: email, at: new Date(now()).toISOString() }
      ]
    });
  }
  async function answer(accountId, to, mail) {
    if (!allowAnswer(to)) {
      logger('scheduling: automatic answer skipped (daily limit)');
      return false;
    }
    await sendMail(accountId, to, mail);
    await noteAnswer(to);
    return true;
  }

  /** Handles one inbox message whose subject carries a token. Returns what was done. */
  async function handle(accountId, info) {
    const tok = parseSubjectToken(info.subject);
    if (!tok) return null;
    const key = `${accountId}:${info.messageId || `${info.uidValidity || ''}:${info.uid}`}`;
    if (state().processed.includes(key)) return null;
    const mark = async result => {
      await save({ processed: [...state().processed, key].slice(-MAX_PROCESSED) });
      return result;
    };
    const sender = String(info.fromEmail || '').toLowerCase();
    if (!sender || ownAddresses().some(a => a.toLowerCase() === sender)) return mark({ ignored: 'own' });
    const s = state();
    const poll = s.polls.find(p => p.token === tok.token);
    const link = !poll && s.links.find(l => l.token === tok.token);
    if (!poll && !link) return mark({ ignored: 'unknown' });
    let detail;
    try {
      detail = await api.message(accountId, info.folder || 'INBOX', info.uid);
    } catch {
      return null; // try again with the next refresh
    }
    if (detail?.automatic) return mark({ ignored: 'automatic' });
    if (poll) return mark(await onPollReply(poll, sender, tok, detail));
    return mark(await onLinkMail(link, accountId, sender, tok, detail));
  }

  async function onPollReply(poll, sender, tok, detail) {
    const participant = poll.participants.find(p => p.email === sender);
    if (!participant) return { ignored: 'not_invited' };
    if (poll.kind === 'poll') {
      if (poll.status !== 'open') return { ignored: 'closed' };
      const prev = poll.votes[sender] || { slots: [], none: false };
      let next;
      if (tok.slot === 0) next = { slots: [], none: true };
      else if (tok.slot)
        next = {
          slots: [...new Set([...prev.slots, tok.slot])].filter(n => n <= poll.slots.length).sort(),
          none: false
        };
      else {
        const nums = votesFromText(detail?.text, poll.slots.length);
        next = nums.length ? { slots: nums, none: false } : prev;
      }
      await updatePoll(poll.id, { votes: { ...poll.votes, [sender]: { ...next, at: new Date(now()).toISOString() } } });
      return { vote: next };
    }
    // An offer: the first time picked is booked.
    const slot = poll.slots[(tok.slot || 0) - 1];
    if (!slot) return { ignored: 'no_slot' };
    return serial(async () => {
      const current = pollById(poll.id);
      if (current.status === 'booked' && current.booked?.slot === tok.slot) return { ignored: 'already_booked' };
      const busy =
        current.status === 'open' ? await ownBusy(Date.parse(slot.start), Date.parse(slot.end), current.timeZone) : [];
      if (current.status !== 'open' || !isFree(busy, slot.start, slot.end)) {
        const rest = [];
        if (current.status === 'open') {
          const all = await ownBusy(
            Date.parse(current.slots[0].start),
            Date.parse(current.slots.at(-1).end),
            current.timeZone
          );
          rest.push(
            ...current.slots.filter(x => x !== slot && Date.parse(x.start) > now() && isFree(all, x.start, x.end))
          );
        }
        const me = identity(current.accountId);
        if (me) {
          const T = texts(current.lang);
          const mail = rest.length
            ? proposalMail({
                ...current,
                kind: 'offer',
                slots: rest,
                replyTo: me.address,
                organizer: me.name || me.address,
                message: T.taken
              })
            : {
                subject: `${T.takenSubject(current.title)}`,
                html: `<p>${T.takenNone}</p><p><small>${T.auto}</small></p>`
              };
          await answer(current.accountId, sender, mail).catch(() => {});
        }
        return { taken: true };
      }
      const event = await createEvent({
        ...current,
        start: slot.start,
        end: slot.end,
        attendees: current.participants
      });
      await updatePoll(current.id, {
        status: 'booked',
        booked: { slot: tok.slot, by: sender, ...event, at: new Date(now()).toISOString() }
      });
      return { booked: tok.slot };
    });
  }

  async function onLinkMail(link, accountId, sender, tok, detail) {
    if (!link.enabled) return { ignored: 'disabled' };
    const me = identity(link.accountId);
    if (!me) return { ignored: 'no_account' };
    const replyName = detail?.from?.[0]?.name || '';
    if (tok.at) {
      return serial(async () => {
        const end = new Date(Date.parse(tok.at) + link.minutes * 60_000).toISOString();
        const ok =
          fitsLink(link, tok.at, now()) &&
          isFree(
            await ownBusy(
              Date.parse(tok.at) - link.bufferMinutes * 60_000,
              Date.parse(end) + link.bufferMinutes * 60_000,
              link.timeZone
            ),
            new Date(Date.parse(tok.at) - link.bufferMinutes * 60_000).toISOString(),
            new Date(Date.parse(end) + link.bufferMinutes * 60_000).toISOString()
          );
        if (ok) {
          await createEvent({
            title: link.title,
            start: tok.at,
            end,
            timeZone: link.timeZone,
            location: link.location,
            attendees: [{ email: sender, name: replyName }],
            organizer: me.address,
            calendar: link.calendar,
            lang: link.lang
          });
          await save({
            links: state().links.map(l => (l.id === link.id ? { ...l, bookings: (l.bookings || 0) + 1 } : l))
          });
          return { booked: tok.at };
        }
        const slots = await linkSlots(link, tok.at);
        await answer(
          link.accountId,
          sender,
          offersMail({ token: link.token, link, slots, replyTo: me.address, lang: link.lang, taken: true })
        );
        return { taken: true };
      });
    }
    const slots = await linkSlots(link);
    const sent = await answer(
      link.accountId,
      sender,
      offersMail({ token: link.token, link, slots, replyTo: me.address, lang: link.lang })
    );
    return { offered: sent ? slots.length : 0 };
  }

  /** Handles new inbox messages (from the IDLE snapshot or a scan). */
  async function onMessages(accountId, messages) {
    const s = state();
    if (!s.polls.some(p => p.status === 'open' || p.kind === 'offer') && !s.links.some(l => l.enabled)) return [];
    const out = [];
    for (const m of messages || []) {
      if (!/\[LV-[A-Za-z0-9_-]{24}/.test(String(m.subject || ''))) continue;
      try {
        const r = await handle(accountId, m);
        if (r) out.push(r);
      } catch (err) {
        logger(`scheduling: reply not handled: ${err.code || err.message}`);
      }
    }
    return out;
  }

  /** Expired polls are kept for KEEP_DAYS after their last time, then deleted. */
  async function sweep() {
    const s = state();
    const cutoff = now() - KEEP_DAYS * DAY;
    const polls = s.polls
      .map(p => (p.status === 'open' && Date.parse(p.slots.at(-1)?.end) < now() ? { ...p, status: 'expired' } : p))
      .filter(p => Date.parse(p.slots.at(-1)?.end || p.createdAt) >= cutoff);
    if (polls.length !== s.polls.length || polls.some((p, i) => p.status !== s.polls[i].status)) await save({ polls });
  }
  const active = () => {
    const s = state();
    return s.polls.some(p => p.status === 'open') || s.links.some(l => l.enabled);
  };

  return {
    availability,
    createPoll,
    book,
    saveLink,
    removeLink,
    onMessages,
    handle,
    sweep,
    active,
    list() {
      return {
        polls: state()
          .polls.map(publicPoll)
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
        links: state().links.map(l => publicLink(l, identity(l.accountId)?.address))
      };
    },
    async cancel(id) {
      pollById(id);
      return publicPoll(await updatePoll(id, { status: 'cancelled' }));
    },
    async remove(id) {
      await save({ polls: state().polls.filter(p => p.id !== id) });
      return { ok: true };
    }
  };
}

export function registerSchedulingRoutes(ctx, { file }) {
  const { api, requireAction, errorResponse } = ctx;
  const internal = internalApi(ctx);
  const identity = accountId => {
    const a = ctx.accounts().find(x => x.id === accountId);
    if (!a?.smtp?.configured) return null;
    const from = ctx.fromFor(a, a.imap.user);
    return { address: String(from.address || a.imap.user).toLowerCase(), name: from.name || '' };
  };
  const service = createScheduling({
    file,
    api: {
      events: internal.events,
      calendars: internal.calendars,
      send: internal.send,
      saveEvent: internal.saveEvent,
      message: internal.message
    },
    freeBusy: ctx.cloud ? (emails, from, to) => ctx.cloud.freeBusy(emails, from, to) : null,
    identity,
    ownAddresses: () => ctx.ownAddresses?.() || ctx.accounts().map(a => a.imap.user),
    logger: ctx.logger
  });
  ctx.scheduling = service;

  const guard = (route, handler) =>
    api.post(route, { bodyLimit: 64 * 1024 }, async (request, reply) => {
      if (!requireAction(request, reply, 'calendar-v1')) return;
      try {
        return await handler(request.body || {});
      } catch (err) {
        return errorResponse(reply, err, { domain: 'scheduling' });
      }
    });
  api.get('/api/scheduling', async (_request, reply) => {
    try {
      await service.sweep();
      return service.list();
    } catch (err) {
      return errorResponse(reply, err, { domain: 'scheduling' });
    }
  });
  guard('/api/scheduling/availability', b => service.availability(b));
  guard('/api/scheduling/polls/create', b => service.createPoll(b));
  guard('/api/scheduling/polls/book', b => service.book(b));
  guard('/api/scheduling/polls/cancel', b => service.cancel(String(b.id || '')));
  guard('/api/scheduling/polls/delete', b => service.remove(String(b.id || '')));
  guard('/api/scheduling/links/save', b => service.saveLink(b));
  guard('/api/scheduling/links/delete', b => service.removeLink(String(b.id || '')));

  // Replies arrive in the inbox: the IDLE watcher's snapshot carries the newest messages.
  ctx.watchers?.subscribe?.((accountId, snapshot) => {
    if (!snapshot?.messages?.length) return;
    void service.onMessages(
      accountId,
      snapshot.messages.map(m => ({ ...m, folder: 'INBOX', uidValidity: snapshot.uidValidity }))
    );
  });
  // Without a working IDLE connection: look at the newest inbox messages every few minutes.
  ctx.jobs?.register(
    'scheduling-scan',
    async () => {
      await service.sweep();
      if (!service.active()) return;
      for (const a of ctx.accounts()) {
        const st = ctx.watchers?.status?.(a.id);
        if (st?.connected && st?.healthy) continue;
        const r = await internal.messages(a.id, { folder: 'INBOX', limit: 40 }).catch(() => null);
        if (r?.messages)
          await service.onMessages(
            a.id,
            r.messages.map(m => ({ ...m, folder: 'INBOX' }))
          );
      }
    },
    { every: SCAN_MS }
  );
  return service;
}
