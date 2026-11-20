// Morning briefing ("Mein Tag"): one overview of the day from data that is already on this computer:
// today's events, tasks due today or overdue, follow-ups whose reminder is due, recent mail from
// people that still waits for an answer, and news from shared spaces. Building it needs no AI and
// sends nothing anywhere; the optional AI ranking of the mail runs separately (only with a local
// model, see routes-briefing.mjs). The result holds references and short previews, no full text.

export const REPLY_DAYS = 3;
export const MAX_REPLIES = 8;
export const MAX_PER_ACCOUNT = 40;
const MAX_EVENTS = 20;
const MAX_TASKS = 15;
const MAX_SPACES = 6;
const SPACE_DAYS = 1;

// Automated senders that never wait for a human answer (same idea as bundles.mjs).
const AUTOMATED_LOCAL =
  /^(no-?reply|do-?not-?reply|donotreply|notifications?|notify|alerts?|mailer-daemon|postmaster|automated|system|bounce[s]?|news(letter)?s?|marketing|info|service|support|billing|invoice|rechnung)([+._-].*)?$/i;

/** True when the message looks like it was written by a person and still waits for the user. */
export function waitsForReply(m, { own = new Set(), since = 0 } = {}) {
  if (!m || m.answered || m.bundle) return false;
  const email = String(m.fromEmail || '').toLowerCase();
  if (!email || own.has(email)) return false;
  if (AUTOMATED_LOCAL.test(email.split('@')[0])) return false;
  const at = Date.parse(m.date || '');
  return Number.isFinite(at) && at >= since;
}

/**
 * Builds the briefing. Every source is optional and fails on its own: a locked task list or a
 * calendar error leaves that section empty with an `unavailable` note instead of failing the whole
 * overview.
 *
 * @param {object} deps
 * @param {Array<{id:string,label?:string}>} deps.accounts
 * @param {string[]} deps.ownAddresses
 * @param {(accountId:string) => Promise<{messages?:object[]}>} deps.listInbox
 * @param {(from:string, to:string) => Promise<{events?:object[]}>} [deps.events]
 * @param {(view:string) => object[]} [deps.tasks]
 * @param {() => object[]} [deps.followups]
 * @param {() => Promise<{spaces?:object[], invitations?:object[]}>} [deps.spaces]
 * @param {{from:string, to:string, now?:number, maxReplies?:number}} range the user's local day (from the UI)
 */
export async function buildBriefing(deps, { from, to, now = Date.now(), maxReplies = MAX_REPLIES }) {
  const unavailable = [];
  const guard = async (name, fn, fallback) => {
    try {
      return await fn();
    } catch {
      unavailable.push(name);
      return fallback;
    }
  };
  const own = new Set((deps.ownAddresses || []).map(a => String(a).toLowerCase()));

  const events = deps.events
    ? await guard(
        'calendar',
        async () =>
          ((await deps.events(from, to)).events || [])
            .filter(e => e.status !== 'CANCELLED')
            .slice(0, MAX_EVENTS)
            .map(e => ({
              uid: e.uid,
              url: e.url,
              accountId: e.accountId,
              summary: String(e.summary || ''),
              location: String(e.location || ''),
              start: e.start,
              end: e.end,
              allDay: Boolean(e.allDay),
              color: e.color || null,
              attendees: Array.isArray(e.attendees) ? e.attendees.length : 0
            })),
        []
      )
    : [];

  const tasks = deps.tasks
    ? await guard(
        'tasks',
        () => {
          const overdue = new Set(deps.tasks('overdue').map(t => t.id));
          const seen = new Set();
          return [...deps.tasks('overdue'), ...deps.tasks('today')]
            .filter(t => !seen.has(t.id) && seen.add(t.id))
            .slice(0, MAX_TASKS)
            .map(t => ({
              id: t.id,
              title: t.title,
              due: t.due || null,
              priority: t.priority || 'none',
              overdue: overdue.has(t.id),
              mail: t.mail ? { accountId: t.mail.accountId, folder: t.mail.folder, uid: t.mail.uid } : null
            }));
        },
        []
      )
    : [];

  const followups = deps.followups
    ? await guard(
        'followups',
        () =>
          deps
            .followups()
            .filter(f => f.state === 'due' || (f.due && Date.parse(f.due) <= now))
            .slice(0, MAX_TASKS)
            .map(f => ({
              id: f.id,
              accountId: f.accountId,
              subject: String(f.subject || ''),
              to: Array.isArray(f.to) ? f.to.slice(0, 5) : [],
              due: f.due || null
            })),
        []
      )
    : [];

  const since = now - REPLY_DAYS * 86_400_000;
  const replies = [];
  for (const account of deps.accounts || []) {
    const listed = await guard(`mail:${account.id}`, () => deps.listInbox(account.id), { messages: [] });
    for (const m of (listed.messages || []).slice(0, MAX_PER_ACCOUNT))
      if (waitsForReply(m, { own, since }))
        replies.push({
          accountId: account.id,
          accountLabel: account.label || '',
          folder: 'INBOX',
          uid: m.uid,
          fromName: String(m.fromName || ''),
          fromEmail: String(m.fromEmail || ''),
          subject: String(m.subject || ''),
          date: m.date,
          unread: Boolean(m.unread),
          flagged: Boolean(m.flagged),
          preview: String(m.preview || '').slice(0, 200)
        });
  }
  // Flagged first, then newest.
  replies.sort((a, b) => Number(b.flagged) - Number(a.flagged) || String(b.date).localeCompare(String(a.date)));

  const spaceSince = now - SPACE_DAYS * 86_400_000;
  const spaces = deps.spaces
    ? await guard(
        'spaces',
        async () => {
          const list = await deps.spaces();
          return {
            updated: (list.spaces || [])
              .filter(s => s.status === 'active' && Date.parse(s.updatedAt) >= spaceSince)
              .slice(0, MAX_SPACES)
              .map(s => ({ id: s.id, name: s.name, updatedAt: s.updatedAt, openTasks: s.openTasks || 0 })),
            invitations: (list.invitations || [])
              .filter(i => !i.expired)
              .slice(0, MAX_SPACES)
              .map(i => ({ id: i.id, name: i.name, from: i.from?.name || i.from?.email || '' }))
          };
        },
        { updated: [], invitations: [] }
      )
    : { updated: [], invitations: [] };

  return {
    from,
    to,
    generatedAt: new Date(now).toISOString(),
    events,
    tasks,
    followups,
    replies: replies.slice(0, maxReplies),
    moreReplies: Math.max(0, replies.length - maxReplies),
    spaces,
    unavailable
  };
}
