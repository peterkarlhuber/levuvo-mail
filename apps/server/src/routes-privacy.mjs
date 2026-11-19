// Privacy cockpit routes. The UI reports counters (blocked trackers, loaded external images) as
// plain numbers; the overview combines them with the AI log. Nothing here stores content.
import { createPrivacyStats, privacyOverview } from './privacy-stats.mjs';

export async function registerPrivacyRoutes(ctx, { createJsonFile, file }) {
  const { api, requireAction } = ctx;
  const stats = createPrivacyStats(await createJsonFile(file, { days: {} }));
  ctx.privacy = stats;
  ctx.jobs?.register?.('privacy-stats-sweep', () => stats.sweep(), { every: 12 * 3600_000 });

  api.post('/api/privacy/events', { bodyLimit: 1024 }, async (request, reply) => {
    if (!requireAction(request, reply, 'mail-v1')) return;
    const body = request.body || {};
    const counts = {};
    for (const name of ['trackers', 'remoteImages']) {
      const n = body[name];
      if (n === undefined) continue;
      if (!Number.isInteger(n) || n < 0 || n > 500)
        return reply.code(400).send({ error: 'Ungültige Anfrage.', code: 'invalid_request' });
      counts[name] = n;
    }
    await stats.add(counts);
    return { ok: true };
  });

  api.get('/api/privacy/overview', async () => {
    const entries = ctx.ai?.log ? await ctx.ai.log.list(5000) : [];
    return privacyOverview(stats.days(), entries);
  });

  api.post('/api/privacy/clear', { bodyLimit: 1024 }, async (request, reply) => {
    if (!requireAction(request, reply, 'mail-v1')) return;
    await stats.clear();
    return { ok: true };
  });
}
