// Models of Levuvo's own Ollama: what is installed, downloads with progress, cancel, resume and
// delete. Only models of the fixed catalog (ai-model-catalog.mjs) are downloaded, and a download only
// counts as finished when the model's manifest digest equals the pinned one; anything else is
// deleted again (fail closed).
//
// Resume: Ollama keeps the parts of a cancelled download (the runtime runs with OLLAMA_NOPRUNE),
// so choosing the model again continues where it stopped. "Discard" removes those parts.
import { readdir, rm, stat, statfs as fsStatfs } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MODEL_CATALOG, catalogEntry, fitFor, ollamaName, recommendedTier } from './ai-model-catalog.mjs';

// Room left on the disk after a download: the system and the mailbox need space too.
export const DISK_RESERVE = 2 * 1024 ** 3;
const PULL_STALL_MS = 120_000;
const PARTIAL = /^sha256-[0-9a-f]{64}-partial/;

const stripDigest = d => String(d || '').replace(/^sha256:/, '');

export class ModelError extends Error {
  constructor(kind, message, extra = {}) {
    super(message || kind);
    this.kind = kind;
    this.code = `ai_${kind}`;
    this.statusCode = extra.statusCode || 409;
    Object.assign(this, extra);
  }
}

/** Sums the bytes of every layer from Ollama's pull progress lines. */
export function progressTracker(expected) {
  const layers = new Map();
  return {
    update(line) {
      if (line?.digest && Number.isFinite(line.total))
        layers.set(line.digest, { total: line.total, completed: Number(line.completed) || 0 });
    },
    get completed() {
      let n = 0;
      for (const l of layers.values()) n += Math.min(l.completed, l.total);
      return n;
    },
    get total() {
      let n = 0;
      for (const l of layers.values()) n += l.total;
      return Math.max(n, expected || 0);
    }
  };
}

/** Reads newline-delimited JSON from a fetch body. */
async function* jsonLines(body) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (line) yield JSON.parse(line);
    }
  }
  if (buffer.trim()) yield JSON.parse(buffer);
}

export function createModelManager({
  runtime,
  fetchImpl = fetch,
  statfs = fsStatfs,
  totalmem = os.totalmem,
  log = null,
  logger = () => {},
  catalog = MODEL_CATALOG
}) {
  const jobs = new Map(); // id -> job
  const readyListeners = new Set();
  const entryOf = id => {
    const entry = catalog.find(m => m.id === id) || (catalog === MODEL_CATALOG ? catalogEntry(id) : null);
    if (!entry) throw new ModelError('not_in_catalog', 'Dieses Modell steht nicht in der Liste.', { statusCode: 400 });
    return entry;
  };

  async function api(pathname, init = {}) {
    const base = await runtime.ensure();
    return fetchImpl(`${base}${pathname}`, init);
  }

  /** Installed catalog models with their verification state, keyed by catalog id. */
  async function installed() {
    const res = await api('/api/tags', { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new ModelError('unreachable');
    const { models = [] } = await res.json();
    const out = new Map();
    for (const m of models) {
      const entry = catalog.find(e => ollamaName(e.id) === m.name);
      if (!entry) continue;
      out.set(entry.id, { verified: stripDigest(m.digest) === stripDigest(entry.digest), size: m.size });
    }
    return out;
  }

  async function freeBytes() {
    try {
      const s = await statfs(runtime.paths.models);
      return Number(s.bavail) * Number(s.bsize);
    } catch {
      return null;
    }
  }

  const publicJob = j =>
    j
      ? {
          status: j.status,
          completed: j.completed,
          total: j.total,
          error: j.error || null,
          startedAt: j.startedAt
        }
      : null;

  async function list() {
    const ram = totalmem();
    let have = new Map();
    let reachable = true;
    try {
      have = await installed();
    } catch {
      reachable = false;
    }
    return {
      runtime: runtime.diagnostics(),
      reachable,
      ram,
      recommendedTier: recommendedTier(ram),
      freeBytes: await freeBytes(),
      models: catalog.map(e => ({
        id: e.id,
        name: e.name,
        vendor: e.vendor,
        origin: e.origin,
        eu: e.eu,
        kind: e.kind,
        tier: e.tier,
        license: e.license,
        licenseUrl: e.licenseUrl,
        size: e.size,
        default: Boolean(e.default),
        fit: fitFor(e, ram),
        installed: have.get(e.id)?.verified === true,
        mismatch: have.has(e.id) && have.get(e.id).verified !== true,
        job: publicJob(jobs.get(e.id))
      }))
    };
  }

  async function verify(entry) {
    const have = await installed();
    if (have.get(entry.id)?.verified) return;
    // Unknown content under a catalog name: never used, removed right away.
    await api('/api/delete', { method: 'DELETE', body: JSON.stringify({ model: ollamaName(entry.id) }) }).catch(
      () => {}
    );
    throw new ModelError('checksum', 'Prüfsumme stimmt nicht. Das Modell wurde wieder entfernt.');
  }

  async function runPull(entry, job) {
    const tracker = progressTracker(entry.size);
    let stall = null;
    const armStall = () => {
      clearTimeout(stall);
      stall = setTimeout(() => job.controller.abort(new ModelError('network')), PULL_STALL_MS);
      stall.unref?.();
    };
    try {
      armStall();
      const res = await api('/api/pull', {
        method: 'POST',
        body: JSON.stringify({ model: ollamaName(entry.id), stream: true }),
        signal: job.controller.signal
      });
      if (!res.ok || !res.body) throw new ModelError('download_failed', `Ollama ${res.status}`);
      let success = false;
      for await (const line of jsonLines(res.body)) {
        armStall();
        if (line.error) throw new ModelError('download_failed', String(line.error).slice(0, 200));
        tracker.update(line);
        job.completed = tracker.completed;
        job.total = tracker.total;
        if (/verifying/i.test(line.status || '')) job.status = 'verifying';
        if (line.status === 'success') success = true;
      }
      if (!success) throw new ModelError('download_failed', 'Download unvollständig.');
      job.status = 'verifying';
      await verify(entry);
      job.status = 'done';
      job.completed = job.total;
      for (const fn of readyListeners)
        Promise.resolve()
          .then(() => fn(entry.id))
          .catch(() => {});
      void log?.add({ type: 'model_download', model: entry.id, ok: true });
      logger(`ollama: ${entry.id} downloaded and verified`);
    } catch (err) {
      const reason = job.controller.signal.reason;
      if (job.canceled) {
        job.status = 'canceled';
        job.pausedAt = Date.now();
        job.parts = [...new Set([...(job.parts || []), ...(await partsSince(job.startedAt).catch(() => []))])];
      } else {
        job.status = 'error';
        job.error = (reason instanceof ModelError ? reason : err).kind || 'download_failed';
        void log?.add({ type: 'model_download', model: entry.id, ok: false, error: job.error });
      }
    } finally {
      clearTimeout(stall);
    }
  }

  async function download(id) {
    const entry = entryOf(id);
    const running = jobs.get(entry.id);
    if (running && ['downloading', 'verifying'].includes(running.status)) return publicJob(running);
    const have = await installed().catch(() => {
      throw new ModelError('unreachable', 'Levuvos Ollama startet nicht.', { statusCode: 503 });
    });
    if (have.get(entry.id)?.verified) {
      const done = { status: 'done', completed: entry.size, total: entry.size, startedAt: Date.now() };
      jobs.set(entry.id, done);
      return publicJob(done);
    }
    const free = await freeBytes();
    if (free !== null && free < entry.size + DISK_RESERVE)
      throw new ModelError('disk_full', 'Nicht genug Speicherplatz für dieses Modell.', {
        needed: entry.size + DISK_RESERVE,
        free
      });
    const job = {
      status: 'downloading',
      completed: running?.completed || 0,
      total: entry.size,
      startedAt: Date.now(),
      parts: running?.parts || [],
      controller: new AbortController(),
      canceled: false
    };
    jobs.set(entry.id, job);
    job.promise = runPull(entry, job);
    return publicJob(job);
  }

  function cancel(id) {
    const entry = entryOf(id);
    const job = jobs.get(entry.id);
    if (job && ['downloading', 'verifying'].includes(job.status)) {
      job.canceled = true;
      job.controller.abort();
    }
    return publicJob(job);
  }

  // Parts of a paused download, so that one model's parts can be discarded while another model
  // downloads. Taken when the download stops: the partial blobs written since it started.
  async function partsSince(since) {
    const dir = path.join(runtime.paths.models, 'blobs');
    const out = [];
    for (const name of await readdir(dir).catch(() => []))
      if (PARTIAL.test(name)) {
        const file = path.join(dir, name);
        const st = await stat(file).catch(() => null);
        if (st && st.mtimeMs >= since - 1000) out.push(file);
      }
    return out;
  }

  /**
   * Removes the parts of cancelled downloads: of one model (id), also while another model
   * downloads, or of all paused ones while nothing downloads. A part changed after its model was
   * paused is shared with the running download and stays (on Windows an open file cannot be
   * removed anyway).
   */
  async function discardPartial(id) {
    const running = [...jobs.values()].some(j => ['downloading', 'verifying'].includes(j.status));
    let targets;
    if (id) {
      const entry = entryOf(id);
      const job = jobs.get(entry.id);
      if (!job || job.status !== 'canceled') return { removed: 0 };
      targets = [entry.id];
    } else {
      if (running) throw new ModelError('busy', 'Während eines Downloads nicht möglich.');
      targets = [...jobs].filter(([, j]) => j.status === 'canceled').map(([k]) => k);
    }
    const dir = path.join(runtime.paths.models, 'blobs');
    const files = id
      ? jobs.get(targets[0]).parts || []
      : (await readdir(dir).catch(() => [])).filter(n => PARTIAL.test(n)).map(n => path.join(dir, n));
    let removed = 0;
    const pausedAt = id ? jobs.get(targets[0]).pausedAt || 0 : 0;
    for (const file of files) {
      if (id) {
        const st = await stat(file).catch(() => null);
        if (!st || st.mtimeMs > pausedAt + 1000) continue;
      }
      try {
        await rm(file);
        removed += 1;
      } catch {
        // gone already, or still open by Ollama
      }
    }
    for (const k of targets) jobs.delete(k);
    return { removed };
  }

  async function remove(id) {
    const entry = entryOf(id);
    cancel(entry.id);
    const res = await api('/api/delete', { method: 'DELETE', body: JSON.stringify({ model: ollamaName(entry.id) }) });
    if (!res.ok && res.status !== 404) throw new ModelError('ollama', `Ollama ${res.status}`);
    jobs.delete(entry.id);
    void log?.add({ type: 'model_delete', model: entry.id });
    return { removed: true };
  }

  /** True when the catalog model is downloaded and verified (tasks refuse anything else). */
  async function isReady(id) {
    const entry = catalog.find(m => m.id === id);
    if (!entry) return false;
    return (await installed().catch(() => new Map())).get(entry.id)?.verified === true;
  }

  /** Called with the catalog id after a model was downloaded and verified. */
  const onReady = fn => {
    readyListeners.add(fn);
    return () => readyListeners.delete(fn);
  };

  return { list, download, cancel, remove, discardPartial, isReady, onReady, jobs };
}
