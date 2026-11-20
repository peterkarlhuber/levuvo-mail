// Routes of the meeting preparation (meeting-prep.mjs). The event is looked up again on the server by
// its UID and start, so the card only ever shows data of a real event in the user's calendars.
import { internalApi } from './internal-api.mjs';
import { buildMeetingPrep, peopleOf } from './meeting-prep.mjs';

// The card asks a few minutes ahead; "prepare next meeting" looks up to a day ahead.
const MAX_AHEAD_MIN = 24 * 60;
const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });

/** Events that start within the next `minutes` and have other people in them (not all-day, not cancelled). */
export function upcomingMeetings(events, { now = Date.now(), minutes = 10, own = new Set() } = {}) {
  return (events || [])
    .filter(e => !e.allDay && e.status !== 'CANCELLED')
    .filter(e => {
      const at = Date.parse(e.start);
      return Number.isFinite(at) && at >= now - 5 * 60_000 && at <= now + minutes * 60_000;
    })
    .filter(e => peopleOf(e, own).length > 0)
    .map(e => ({
      uid: e.uid,
      start: e.start,
      end: e.end,
      summary: String(e.summary || ''),
      location: e.location || ''
    }))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

export function registerMeetingPrepRoutes(ctx) {
  const { api } = ctx;
  const own = () => new Set(ctx.ownAddresses().map(a => a.toLowerCase()));
  const send = (reply, err) => {
    const status = err.statusCode && err.statusCode < 600 ? err.statusCode : 500;
    return reply.code(status).send({
      error: status < 500 ? err.message : 'Vorbereitung konnte nicht erstellt werden.',
      code: err.code || 'meeting_prep_failed'
    });
  };

  // The client asks once a minute whether a meeting is about to start.
  api.get('/api/meeting-prep/upcoming', async (request, reply) => {
    try {
      const minutes = Math.max(1, Math.min(MAX_AHEAD_MIN, Number(request.query?.minutes) || 10));
      const now = Date.now();
      const { events } = await internalApi(ctx).events(
        new Date(now - 10 * 60_000).toISOString(),
        new Date(now + (minutes + 1) * 60_000).toISOString()
      );
      return { meetings: upcomingMeetings(events, { now, minutes, own: own() }) };
    } catch (err) {
      return send(reply, err);
    }
  });

  api.get('/api/meeting-prep', async (request, reply) => {
    try {
      const uid = String(request.query?.uid || '');
      const start = Date.parse(String(request.query?.start || ''));
      if (!uid || uid.length > 1000 || !Number.isFinite(start)) throw fail('Termin fehlt.', 'meeting_prep_invalid');
      const { events } = await internalApi(ctx).events(
        new Date(start - 3600_000).toISOString(),
        new Date(start + 3600_000).toISOString()
      );
      const event =
        (events || []).find(e => e.uid === uid && Date.parse(e.start) === start) ||
        (events || []).find(e => e.uid === uid);
      if (!event) throw fail('Termin nicht gefunden.', 'meeting_prep_missing', 404);
      const accountIds = ctx.accounts().map(a => a.id);
      return await buildMeetingPrep({
        event,
        ownAddresses: ctx.ownAddresses(),
        accountIds,
        contacts: () => internalApi(ctx).contacts(),
        search: ctx.localIndex?.search ? (ids, q, opts) => ctx.localIndex.search(ids, q, opts) : null,
        tasks: ctx.tasks?.list ? () => ctx.tasks.list({ view: 'open' }) : null,
        followups: ctx.followups ? () => ctx.followups.followups() : null,
        commitments: ctx.commitments ? () => ctx.commitments.open() : null
      });
    } catch (err) {
      return send(reply, err);
    }
  });
}
