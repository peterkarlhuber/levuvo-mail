// Privacy cockpit: what was blocked, what the AI read, and what left Levuvo Mail.
//
// Data minimisation: the cockpit adds only daily counters (privacy-stats.json) – no addresses,
// subjects, hosts, message IDs or content. Everything else is derived from the existing AI log
// (ai-log.jsonl, also without content). Both keep 30 days and can be deleted by the user.

export const STATS_DAYS = 30;
/** Counter names; anything else is ignored. */
export const COUNTERS = ['trackers', 'remoteImages', 'unsubscribeOneClick', 'unsubscribeMail'];
const CLOUD_PROVIDERS = new Set(['anthropic', 'openai']);
const MAX_PER_CALL = 500;

const dayOf = (date = new Date()) => date.toISOString().slice(0, 10);
const cutoffDay = (now = new Date()) => dayOf(new Date(now.getTime() - (STATS_DAYS - 1) * 86400_000));

export function isCloudProvider(provider) {
  return CLOUD_PROVIDERS.has(String(provider || '').toLowerCase());
}

/** Keeps only valid days inside the retention window and known counters with sane values. */
export function pruneDays(days = {}, now = new Date()) {
  const from = cutoffDay(now);
  const out = {};
  for (const [day, counts] of Object.entries(days || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < from || !counts || typeof counts !== 'object') continue;
    const kept = {};
    for (const name of COUNTERS) {
      const n = Number(counts[name]);
      if (Number.isInteger(n) && n > 0) kept[name] = Math.min(n, 1e9);
    }
    if (Object.keys(kept).length) out[day] = kept;
  }
  return out;
}

/** `file` is a createJsonFile() store with the shape { days: { 'YYYY-MM-DD': { counter: n } } }. */
export function createPrivacyStats(file, { now = () => new Date() } = {}) {
  let queue = Promise.resolve();
  const save = days => {
    queue = queue.then(() => file.save({ days })).catch(() => {});
    return queue;
  };
  return {
    /** Adds to today's counters; returns once the write is queued. */
    add(counts = {}) {
      const days = pruneDays(file.get().days, now());
      const today = dayOf(now());
      const entry = { ...(days[today] || {}) };
      let changed = false;
      for (const name of COUNTERS) {
        const n = Math.floor(Number(counts[name]) || 0);
        if (n <= 0) continue;
        entry[name] = (entry[name] || 0) + Math.min(n, MAX_PER_CALL);
        changed = true;
      }
      if (!changed) return queue;
      days[today] = entry;
      return save(days);
    },
    days: () => pruneDays(file.get().days, now()),
    sweep() {
      const days = pruneDays(file.get().days, now());
      if (JSON.stringify(days) === JSON.stringify(file.get().days || {})) return queue;
      return save(days);
    },
    clear: () => save({})
  };
}

/**
 * Builds the cockpit view from the counters and the AI log entries (newest first, as
 * ai.log.list() returns them). Returns only aggregates and the latest entries' metadata.
 */
export function privacyOverview(days, entries = [], { now = new Date() } = {}) {
  const totals = Object.fromEntries(COUNTERS.map(c => [c, 0]));
  const perDay = [];
  for (let i = STATS_DAYS - 1; i >= 0; i--) {
    const day = dayOf(new Date(now.getTime() - i * 86400_000));
    const counts = days[day] || {};
    for (const c of COUNTERS) totals[c] += counts[c] || 0;
    perDay.push({ day, trackers: counts.trackers || 0 });
  }

  const ai = { local: 0, cloud: 0, failed: 0, kinds: {}, providers: {}, lastAt: null, lastCloudAt: null };
  const agents = new Map();
  const downloads = [];
  const recent = [];
  let indexRuns = 0;
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    if (e.type === 'task' || e.type === 'agent') {
      const cloud = isCloudProvider(e.provider);
      const kind = e.type === 'agent' ? 'agent' : String(e.kind || 'task');
      if (e.ok === false) ai.failed++;
      else {
        ai[cloud ? 'cloud' : 'local']++;
        const k = (ai.kinds[kind] ||= { local: 0, cloud: 0, sources: {} });
        k[cloud ? 'cloud' : 'local']++;
        const source = String(e.source || 'user');
        k.sources[source] = (k.sources[source] || 0) + 1;
        if (cloud) ai.providers[e.provider] = (ai.providers[e.provider] || 0) + 1;
      }
      ai.lastAt ||= e.at;
      if (cloud) ai.lastCloudAt ||= e.at;
      if (recent.length < 25)
        recent.push({
          at: e.at,
          kind,
          where: cloud ? 'cloud' : 'local',
          provider: e.provider || null,
          source: e.source || null,
          ok: e.ok !== false
        });
    } else if (e.type === 'tool') {
      const name = String(e.agent || '?');
      const a = agents.get(name) || { name, calls: 0, denied: 0, tools: {}, lastAt: null };
      if (e.ok === false) a.denied++;
      else a.calls++;
      a.tools[e.tool] = (a.tools[e.tool] || 0) + 1;
      a.lastAt ||= e.at;
      agents.set(name, a);
      if (recent.length < 25)
        recent.push({ at: e.at, kind: String(e.tool || 'tool'), where: 'agent', agent: name, ok: e.ok !== false });
    } else if (e.type === 'index') {
      indexRuns++;
    } else if (e.type === 'model_download' || e.type === 'download') {
      if (downloads.length < 20) downloads.push({ at: e.at, kind: e.kind || 'model', model: e.model || null });
    }
  }
  return {
    days: STATS_DAYS,
    blocked: { trackers: totals.trackers, perDay },
    remoteImages: totals.remoteImages,
    unsubscribe: { oneClick: totals.unsubscribeOneClick, mail: totals.unsubscribeMail },
    ai: { ...ai, indexRuns },
    agents: [...agents.values()],
    downloads,
    recent
  };
}
