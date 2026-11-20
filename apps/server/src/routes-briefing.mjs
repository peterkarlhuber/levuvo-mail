// Routes of the morning briefing ("Mein Tag", briefing.mjs).
// GET /api/briefing builds the overview from local data only. POST /api/briefing/rank lets the AI
// say which of the waiting mails really need an answer today (the existing "prioritize" function):
// the mails are loaded again here, never taken from the client, and a run the user did not start
// (`auto`) only happens with a local model, as for every background AI work in Levuvo Mail.
import { internalApi } from './internal-api.mjs';
import { buildBriefing, MAX_PER_ACCOUNT } from './briefing.mjs';

const ACTION = 'ai-v1';
const RANGE_MAX = 2 * 86_400_000;
const RANK_MAX = 30;

function range(query) {
  const from = Date.parse(String(query?.from || ''));
  const to = Date.parse(String(query?.to || ''));
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > RANGE_MAX)
    throw Object.assign(new Error('Ungültiger Zeitraum.'), { statusCode: 400, code: 'briefing_invalid' });
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}

const zoneOf = value => {
  const tz = typeof value === 'string' ? value : '';
  try {
    if (tz && tz.length <= 64) {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return tz;
    }
  } catch {
    /* unknown zone */
  }
  return 'Europe/Vienna';
};

/** The data sources of the briefing, from the app context. */
export function briefingDeps(ctx, { timeZone = 'Europe/Vienna' } = {}) {
  const api = internalApi(ctx);
  return {
    accounts: ctx.accounts().map(a => ({ id: a.id, label: a.label || a.imap?.user || '' })),
    ownAddresses: ctx.ownAddresses(),
    listInbox: accountId => api.messages(accountId, { folder: 'INBOX', limit: MAX_PER_ACCOUNT }),
    events: (from, to) => api.events(from, to),
    tasks: ctx.tasks?.list ? view => ctx.tasks.list({ view, timeZone }) : null,
    followups: ctx.followups ? () => ctx.followups.followups() : null,
    spaces: () => api.spaces()
  };
}

export function registerBriefingRoutes(ctx) {
  const { api, ai, requireAction } = ctx;
  const send = (reply, err) => {
    const status = err.statusCode && err.statusCode < 600 ? err.statusCode : 500;
    return reply.code(status).send({
      error: status < 500 ? err.message : 'Übersicht konnte nicht erstellt werden.',
      code: err.code || (err.kind ? `ai_${err.kind}` : 'briefing_failed')
    });
  };

  api.get('/api/briefing', async (request, reply) => {
    try {
      const r = range(request.query);
      const deps = briefingDeps(ctx, { timeZone: zoneOf(request.query?.tz) });
      return await buildBriefing(deps, r);
    } catch (err) {
      return send(reply, err);
    }
  });

  api.post('/api/briefing/rank', { bodyLimit: 4 * 1024 }, async (request, reply) => {
    if (!requireAction(request, reply, ACTION)) return;
    const body = request.body || {};
    const lang = body.lang === 'en' ? 'en' : 'de';
    try {
      const r = range(body);
      const s = ai.ensureAllowed('prioritize', null);
      if (body.auto === true && s.provider !== 'ollama')
        throw Object.assign(new Error('Automatisch nur mit einem lokalen Modell.'), {
          statusCode: 409,
          code: 'ai_cloud_auto'
        });
      // Every waiting mail, not only the shown ones: the AI may move one up from "more".
      const deps = { ...briefingDeps(ctx), events: null, tasks: null, followups: null, spaces: null };
      const all = await buildBriefing(deps, { ...r, maxReplies: RANK_MAX });
      const byAccount = new Map();
      for (const m of all.replies) {
        if (ai.cloudBlocked(m.accountId)) continue;
        if (!byAccount.has(m.accountId)) byAccount.set(m.accountId, []);
        byAccount.get(m.accountId).push(m);
      }
      const items = [];
      for (const [accountId, list] of byAccount) {
        const result = await ai.run(
          'prioritize',
          {
            lang,
            me: ctx.ownAddresses().join(', '),
            messages: list.map(m => ({
              id: String(m.uid),
              from: `${m.fromName} <${m.fromEmail}>`,
              subject: m.subject,
              preview: m.preview
            }))
          },
          { accountId, source: body.auto ? 'briefing-auto' : 'briefing' }
        );
        for (const i of result.items || [])
          items.push({
            accountId,
            uid: Number(i.id),
            priority: i.priority,
            needsReply: i.needs_reply === true,
            reason: String(i.reason || '').slice(0, 200)
          });
      }
      return { items, provider: s.provider, model: s.model, generated: true };
    } catch (err) {
      return send(reply, err);
    }
  });
}
