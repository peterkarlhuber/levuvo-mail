// Meeting preparation: for one calendar event, what belongs to it — the attendees with their address
// book entries, recent mail with them (from the local search index), files (event attachments and
// mails with attachments), open tasks, follow-ups and promises that involve them. Everything comes
// from data on this computer; no AI and nothing sent. The optional AI summary of the open points is
// started by the user in the UI (the existing "digest" function on the mails found here).

const MAX_ATTENDEES = 12;
const MAX_MAILS = 8;
const PER_PERSON = 6;
const MAX_ITEMS = 8;
const TOPIC_WORDS = 3;

const lower = v =>
  String(v || '')
    .trim()
    .toLowerCase();

// Words of the event title worth searching for ("Jour fixe Relaunch" → "relaunch").
const STOP = new Set(
  'und oder mit für von der die das den dem ein eine zum zur bei call meeting termin besprechung abstimmung jour fixe weekly daily sync update kickoff kick-off the and with for of to on in a an re aw fw wg'.split(
    ' '
  )
);
export function topicWords(summary) {
  return [
    ...new Set(
      String(summary || '')
        .toLowerCase()
        .split(/[^\p{L}\p{N}-]+/u)
        .filter(w => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w))
    )
  ].slice(0, TOPIC_WORDS);
}

/** The people of an event other than the user: organizer first, then attendees. */
export function peopleOf(event, own) {
  const seen = new Set();
  const out = [];
  const add = (email, name, role) => {
    const e = lower(email);
    if (!e || own.has(e) || seen.has(e)) return;
    seen.add(e);
    out.push({ email: e, name: String(name || ''), role });
  };
  if (event.organizer) add(event.organizer.email, event.organizer.name, 'organizer');
  for (const a of event.attendees || []) add(a.email, a.name, 'attendee');
  return out.slice(0, MAX_ATTENDEES);
}

function contactFor(contacts, email) {
  const matches = contacts.filter(c => (c.emails || []).some(x => lower(x.value) === email));
  if (!matches.length) return null;
  const score = c => (c.name ? 2 : 0) + (c.organization ? 1 : 0) + (c.title ? 1 : 0) + (c.phones?.length ? 1 : 0);
  const c = [...matches].sort((a, b) => score(b) - score(a))[0];
  return {
    name: c.name || '',
    organization: c.organization || '',
    title: c.title || '',
    phone: c.phones?.[0]?.value || ''
  };
}

/**
 * @param {object} deps
 * @param {object} deps.event the calendar event (from the server's own calendar data)
 * @param {string[]} deps.ownAddresses
 * @param {string[]} deps.accountIds
 * @param {() => Promise<{contacts?:object[]}>} [deps.contacts]
 * @param {(ids:string[], query:string, opts:object) => Promise<object[]>} [deps.search] local index search
 * @param {() => object[]} [deps.tasks] open tasks
 * @param {() => object[]} [deps.followups]
 * @param {() => object[]} [deps.commitments] open promises
 */
export async function buildMeetingPrep(deps) {
  const { event } = deps;
  const own = new Set((deps.ownAddresses || []).map(lower));
  const unavailable = [];
  const guard = async (name, fn, fallback) => {
    try {
      return await fn();
    } catch {
      unavailable.push(name);
      return fallback;
    }
  };
  const people = peopleOf(event, own);
  const emails = new Set(people.map(p => p.email));

  const contacts = deps.contacts ? await guard('contacts', async () => (await deps.contacts()).contacts || [], []) : [];
  const attendees = people.map(p => {
    const card = contactFor(contacts, p.email);
    const partstat = (event.attendees || []).find(a => lower(a.email) === p.email)?.partstat || '';
    return { ...p, name: p.name || card?.name || '', contact: card, partstat };
  });

  // Mail with the attendees (newest first), then mail about the topic of the title.
  const mails = [];
  const seenMail = new Set();
  const addHits = (hits, reason) => {
    for (const h of hits) {
      const key = `${h.accountId}|${h.folder}|${h.uid}`;
      if (seenMail.has(key)) continue;
      seenMail.add(key);
      mails.push({
        accountId: h.accountId,
        folder: h.folder,
        uid: h.uid,
        subject: h.subject,
        fromName: h.fromName,
        fromEmail: h.fromEmail,
        date: h.date,
        hasAttachments: Boolean(h.hasAttachments),
        preview: String(h.preview || '').slice(0, 160),
        reason
      });
    }
  };
  if (deps.search) {
    await guard(
      'mail',
      async () => {
        for (const p of people) addHits(await deps.search(deps.accountIds, p.email, { limit: PER_PERSON }), 'person');
        const words = topicWords(event.summary);
        if (words.length) addHits(await deps.search(deps.accountIds, words.join(' '), { limit: PER_PERSON }), 'topic');
      },
      null
    );
  }
  mails.sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const words = topicWords(event.summary);
  const about = text => {
    const t = lower(text);
    return words.some(w => t.includes(w));
  };
  const involves = mail => mail && (emails.has(lower(mail.from)) || about(mail.subject));

  const tasks = deps.tasks
    ? await guard(
        'tasks',
        () =>
          deps
            .tasks()
            .filter(t => !t.done && (involves(t.mail) || about(t.title)))
            .slice(0, MAX_ITEMS)
            .map(t => ({ id: t.id, title: t.title, due: t.due || null })),
        []
      )
    : [];
  const followups = deps.followups
    ? await guard(
        'followups',
        () =>
          deps
            .followups()
            .filter(f => (f.to || []).some(x => emails.has(lower(x))))
            .slice(0, MAX_ITEMS)
            .map(f => ({ id: f.id, subject: f.subject || '', state: f.state, due: f.due || null })),
        []
      )
    : [];
  const promises = deps.commitments
    ? await guard(
        'commitments',
        () =>
          deps
            .commitments()
            .filter(c => emails.has(lower(c.who)))
            .slice(0, MAX_ITEMS)
            .map(c => ({ id: c.id, direction: c.direction, what: c.what, who: c.who, due: c.due || null })),
        []
      )
    : [];

  const shown = mails.slice(0, MAX_MAILS);
  const files = [
    ...(event.attachments || []).slice(0, MAX_ITEMS).map(a => ({ source: 'event', name: String(a.name || '') })),
    ...shown
      .filter(m => m.hasAttachments)
      .slice(0, MAX_ITEMS)
      .map(m => ({ source: 'mail', name: m.subject, accountId: m.accountId, folder: m.folder, uid: m.uid }))
  ];

  return {
    event: {
      uid: event.uid,
      summary: String(event.summary || ''),
      start: event.start,
      end: event.end,
      allDay: Boolean(event.allDay),
      location: String(event.location || ''),
      description: String(event.description || '').slice(0, 1000)
    },
    attendees,
    mails: shown,
    files,
    tasks,
    followups,
    promises,
    unavailable
  };
}
