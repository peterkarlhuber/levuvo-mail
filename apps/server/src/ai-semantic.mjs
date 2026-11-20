// Semantic search and "ask your mailbox" on top of the local search index.
//
// The texts come from the encrypted local index (entries(), removedKeys(), status().generation);
// embeddings are always computed by the local Ollama model, also when a cloud model writes answers.
// Vectors go to a vector store with the interface putVectors / searchVectors / dropVectors. The shared
// encrypted SQLite store of the index replaces the in-memory store below without changes here.

import { queryPrefixFor } from './ai-model-catalog.mjs';

const BATCH = 32;
// A run stops after this many failed batches in a row (model gone, Ollama stopped); what is
// embedded so far stays and the next run continues with the rest.
const MAX_FAILED_BATCHES = 3;
const TEXT_CHARS = 1500;
const MAX_MEMORY_ENTRIES = 5000;

/** Exact cosine search over normalized Float32 vectors, in memory (until the SQLite store is available). */
export function createMemoryVectorStore({ maxEntries = MAX_MEMORY_ENTRIES } = {}) {
  const spaces = new Map(); // `${id}\0${model}` -> Map(key -> {folder, uid, vector})
  const space = (id, model) => {
    const k = `${id}\u0000${model}`;
    if (!spaces.has(k)) spaces.set(k, new Map());
    return spaces.get(k);
  };
  return {
    persistent: false,
    async putVectors(id, model, items) {
      const s = space(id, model);
      for (const it of items) {
        s.delete(it.key);
        s.set(it.key, { folder: it.folder, uid: it.uid, vector: normalizeVector(it.vector) });
      }
      while (s.size > maxEntries) s.delete(s.keys().next().value);
    },
    async deleteVectors(id, model, keys) {
      const s = space(id, model);
      for (const key of keys) s.delete(key);
    },
    async searchVectors(id, model, vector, { limit = 20, folder = null } = {}) {
      const q = normalizeVector(vector);
      const out = [];
      for (const [key, v] of space(id, model)) {
        if (folder && v.folder !== folder) continue;
        out.push({ key, folder: v.folder, uid: v.uid, score: dot(q, v.vector) });
      }
      return out.sort((a, b) => b.score - a.score).slice(0, limit);
    },
    async dropVectors(id, model) {
      spaces.delete(`${id}\u0000${model}`);
    },
    size: (id, model) => space(id, model).size
  };
}

export function normalizeVector(v) {
  const out = Float32Array.from(v);
  let n = 0;
  for (const x of out) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= n;
  return out;
}
function dot(a, b) {
  let s = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) s += a[i] * b[i];
  return s;
}

const byDateDesc = (a, b) => String(b.date || '').localeCompare(String(a.date || ''));

const passage = e =>
  `${e.subject || ''}\n${e.fromName || ''} <${e.fromEmail || ''}>\n${String(e.text || '').slice(0, TEXT_CHARS)}`;

/**
 * @param {object} o
 * @param {object} o.localIndex  entries / removedKeys / status / text of the local index
 * @param {object} o.ai          AI service (run, get)
 * @param {object} [o.vectors]   vector store (defaults to memory)
 */
/** The encrypted vector store of the local index when it has one (SQLite), else memory. */
export function vectorStoreFor(localIndex) {
  if (typeof localIndex?.putVectors !== 'function') return createMemoryVectorStore();
  return {
    persistent: true,
    putVectors: (id, model, items) => localIndex.putVectors(id, model, items),
    searchVectors: (id, model, vector, opts) => localIndex.searchVectors(id, model, vector, opts),
    dropVectors: (id, model) => localIndex.dropVectors(id, model),
    dropOtherVectors: (id, model) => localIndex.dropOtherVectors?.(id, model),
    missing:
      typeof localIndex.missingVectors === 'function' ? (id, model, o) => localIndex.missingVectors(id, model, o) : null
    // Removed messages: the index deletes their vectors itself (tombstones).
  };
}

export function createSemanticIndex({
  localIndex,
  ai,
  vectors = vectorStoreFor(localIndex),
  logger = () => {},
  stateFile = null,
  now = Date.now
}) {
  // id -> { model, generation, syncedAt, finishedAt, error, running, run }
  // run: { startedAt, embedded } of the run under way, for the remaining time.
  const state = new Map();
  // Progress survives a restart only together with persistent vectors; the pause always does.
  const persisted = vectors.persistent && stateFile;
  let paused = Boolean(stateFile?.get().paused);
  // Raised by rebuild(): a run under way stops at its next batch.
  let generationOfRuns = 0;
  if (persisted)
    for (const [id, v] of Object.entries(stateFile.get().accounts || {}))
      state.set(id, {
        model: v.model,
        generation: v.generation,
        syncedAt: v.syncedAt,
        finishedAt: v.finishedAt ?? null,
        error: v.error ?? null,
        running: null,
        run: null
      });
  const saveState = async () => {
    if (!stateFile) return;
    const accounts = {};
    if (persisted)
      for (const [id, v] of state)
        accounts[id] = {
          model: v.model,
          generation: v.generation,
          syncedAt: v.syncedAt,
          finishedAt: v.finishedAt ?? null,
          error: v.error ?? null
        };
    await stateFile.save({ accounts, paused }).catch(() => {});
  };
  const blank = () => ({
    model: null,
    generation: null,
    syncedAt: null,
    finishedAt: null,
    error: null,
    running: null,
    run: null
  });
  const patch = (id, values) => state.set(id, { ...(state.get(id) || blank()), ...values });
  // Only the error code is kept (never message text, which could quote mail content).
  const errorOf = err => ({
    code: String(err?.code || (err?.kind ? `ai_${err.kind}` : 'ai_failed')).slice(0, 60),
    at: now()
  });

  function model() {
    return ai.get().embedModel;
  }
  function usable() {
    const s = ai.get();
    return Boolean(s.enabled && s.features?.search !== false);
  }

  /** Embeds what changed since the last run. Safe to call often; runs at most once per account at a time. */
  async function sync(id) {
    if (!usable()) return { skipped: true };
    if (paused) return { skipped: true, paused: true };
    const current = state.get(id) || blank();
    if (current.running) return current.running;
    const seq = generationOfRuns;
    const stop = () => paused || seq !== generationOfRuns;
    const run = (async () => {
      const status = await localIndex.status(id);
      if (!status?.enabled) return { skipped: true };
      const m = model();
      return vectors.persistent && vectors.missing
        ? fillMissing(id, m, status, current, stop)
        : syncChanges(id, m, status, current, stop);
    })();
    patch(id, { running: run, run: { startedAt: now(), embedded: 0 } });
    try {
      const result = await run;
      patch(id, { running: null, run: null, ...(result?.skipped ? {} : { finishedAt: now() }) });
      await saveState();
      return result;
    } catch (err) {
      patch(id, { running: null, run: null, error: errorOf(err) });
      await saveState();
      throw err;
    }
  }

  async function embedBatch(id, m, batch) {
    const r = await ai.run('embed', { texts: batch.map(passage) }, { accountId: id, source: 'index' });
    await vectors.putVectors(
      id,
      m,
      batch.map((e, i) => ({ key: e.key, folder: e.folder, uid: e.uid, vector: r.vectors?.[i] }))
    );
    const s = state.get(id);
    if (s?.run) s.run.embedded += batch.length;
    return batch.length;
  }

  function finished(id, m, count) {
    if (count) {
      logger(`Semantic index ${id}: ${count} messages embedded`);
      void ai.log?.add({ type: 'index', kind: 'embed', accountId: id, count, model: m });
    }
  }

  /**
   * Persistent store (the encrypted index): embeds every message that has no vector of the current
   * model yet, newest first. Each batch is stored as soon as it is computed, so a restart, sleep or
   * a failed batch never throws away finished work (PERF-LEV-001): the next run asks the index
   * again what is missing. Removed messages take their vectors with them inside the index.
   */
  async function fillMissing(id, m, status, current, stop) {
    // Only vectors of the current model are kept; also covers a model switch whose state was lost.
    if (vectors.dropOtherVectors) await vectors.dropOtherVectors(id, m);
    else if (current.model && current.model !== m) await vectors.dropVectors(id, current.model);
    patch(id, { model: m, generation: status.generation });
    await saveState();
    let count = 0;
    let failedInRow = 0;
    let lastError = null;
    for await (const batch of vectors.missing(id, m, { batch: BATCH })) {
      // Settings changed, paused or rebuilt: the next run continues cleanly.
      if (model() !== m || !usable() || stop()) break;
      try {
        count += await embedBatch(id, m, batch);
        failedInRow = 0;
      } catch (err) {
        lastError = err;
        if (++failedInRow >= MAX_FAILED_BATCHES) break;
      }
    }
    const failed = failedInRow >= MAX_FAILED_BATCHES;
    patch(id, { model: m, generation: status.generation, syncedAt: now(), error: failed ? errorOf(lastError) : null });
    await saveState();
    finished(id, m, count);
    if (failed && !count) throw lastError;
    return { embedded: count };
  }

  /**
   * In-memory store (no encrypted index available): follows the index by change time and keeps
   * only the newest entries.
   */
  async function syncChanges(id, m, status, current, stop) {
    let since = current.syncedAt;
    if (current.model !== m || current.generation !== status.generation) {
      if (current.model) await vectors.dropVectors(id, current.model);
      await vectors.dropVectors(id, m);
      since = null;
    } else if (since !== null) {
      const removed = await localIndex.removedKeys(id, since);
      if (removed === null) {
        await vectors.dropVectors(id, m);
        since = null;
      } else if (removed.length && vectors.deleteVectors) await vectors.deleteVectors(id, m, removed);
    }
    // One millisecond back: rows stamped in the same millisecond as the start are read again
    // next time instead of being missed (re-embedding the same key only overwrites it).
    const started = Date.now() - 1;
    // Newest first, so search is useful early; only key and date are sorted, texts are kept for
    // the newest MAX_MEMORY_ENTRIES only.
    const all = [];
    for await (const e of localIndex.entries(id, { since })) {
      all.push(e);
      if (all.length > MAX_MEMORY_ENTRIES * 2) {
        all.sort(byDateDesc);
        all.length = MAX_MEMORY_ENTRIES;
      }
    }
    all.sort(byDateDesc);
    let count = 0;
    for (let i = 0; i < Math.min(all.length, MAX_MEMORY_ENTRIES); i += BATCH) {
      // Interrupted: the change cursor stays where it was, the next run reads the rest again.
      if (stop()) {
        patch(id, { model: m, generation: status.generation });
        finished(id, m, count);
        return { embedded: count };
      }
      count += await embedBatch(id, m, all.slice(i, Math.min(i + BATCH, MAX_MEMORY_ENTRIES)));
    }
    patch(id, { model: m, generation: status.generation, syncedAt: started, error: null });
    await saveState();
    finished(id, m, count);
    return { embedded: count };
  }

  /** Messages closest in meaning to `query`, across accounts. */
  async function search(ids, query, { limit = 20, folder = null } = {}) {
    const text = String(query || '')
      .trim()
      .slice(0, 500);
    if (!text) return [];
    const usableIds = usable() ? ids : [];
    if (!usableIds.length) return [];
    // Catch up in the background; the search uses what is already embedded.
    for (const id of usableIds) void sync(id).catch(() => null);
    const m = model();
    // Each embedding model has its own search instruction (bge-m3 none, Qwen3-Embedding one).
    const [vector] = (await ai.run('embed', { texts: [queryPrefixFor(m) + text] }, { source: 'index' })).vectors;
    const hits = (
      await Promise.all(
        usableIds.map(async id =>
          (await vectors.searchVectors(id, m, vector, { limit, folder })).map(h => ({ ...h, accountId: id }))
        )
      )
    )
      .flat()
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    const out = [];
    for (const h of hits) {
      const item = await localIndex.text(h.accountId, h.folder, h.uid);
      if (item) out.push({ ...h, ...item });
    }
    return out;
  }

  /** Vectors of the current model for one account (capped at what the store can hold). */
  async function vectorCount(id, m, status) {
    if (!vectors.persistent) return vectors.size?.(id, m) ?? 0;
    if (vectors.count) return (await vectors.count(id, m)) ?? 0;
    return status.vectors ?? 0;
  }

  /** Rebuild progress per account: vectors of the current model against indexed messages. */
  async function progress(ids) {
    const m = model();
    const out = [];
    for (const id of ids) {
      const status = await localIndex.status(id).catch(() => null);
      if (!status?.enabled) continue;
      const s = state.get(id);
      out.push({
        accountId: id,
        model: m,
        messages: status.messages ?? null,
        vectors: await vectorCount(id, m, status),
        running: Boolean(s?.running)
      });
    }
    return out;
  }

  /**
   * One status for the UI: 'none' (with a reason), 'running', 'paused', 'pending' (incomplete,
   * continues at the next run), 'done' or 'error'. Counts only, never content.
   * @param {string[]} ids
   * @param {{modelInstalled?: boolean}} [o]
   */
  async function overview(ids, { modelInstalled = true } = {}) {
    const m = model();
    const s = ai.get();
    const out = {
      state: 'none',
      reason: null,
      model: m,
      paused,
      messages: 0,
      vectors: 0,
      etaSeconds: null,
      startedAt: null,
      finishedAt: null,
      error: null,
      accounts: []
    };
    if (!s.enabled) return { ...out, reason: 'ai_off' };
    if (s.features?.search === false) return { ...out, reason: 'search_off' };
    let rate = 0;
    for (const id of ids) {
      const status = await localIndex.status(id).catch(() => null);
      if (!status?.enabled) continue;
      const entry = state.get(id) || blank();
      const cap = vectors.persistent ? Infinity : MAX_MEMORY_ENTRIES;
      const messages = Math.min(status.messages || 0, cap);
      const count = Math.min(await vectorCount(id, m, status), messages);
      out.accounts.push({
        accountId: id,
        messages,
        vectors: count,
        running: Boolean(entry.running),
        finishedAt: entry.finishedAt ?? null,
        error: entry.error ?? null
      });
      out.messages += messages;
      out.vectors += count;
      if (entry.finishedAt && (!out.finishedAt || entry.finishedAt > out.finishedAt)) out.finishedAt = entry.finishedAt;
      if (entry.error && !out.error) out.error = entry.error;
      if (entry.run) {
        out.startedAt = Math.min(out.startedAt ?? Infinity, entry.run.startedAt);
        const seconds = (now() - entry.run.startedAt) / 1000;
        // A rate only after a few batches, so the first estimate is not wild.
        if (entry.run.embedded >= BATCH && seconds >= 5) rate += entry.run.embedded / seconds;
      }
    }
    if (!modelInstalled) return { ...out, reason: 'model_missing' };
    if (!out.accounts.length) return { ...out, reason: 'index_off' };
    if (!out.messages) return { ...out, reason: 'no_messages' };
    const running = out.accounts.some(a => a.running);
    const remaining = out.messages - out.vectors;
    if (paused) out.state = 'paused';
    else if (running) out.state = 'running';
    else if (remaining <= 0) out.state = 'done';
    else if (out.error) out.state = 'error';
    else if (!out.vectors) out.reason = 'not_started';
    else out.state = 'pending';
    if (out.state !== 'error') out.error = null;
    if (running && rate > 0 && remaining > 0) out.etaSeconds = Math.ceil(remaining / rate);
    return out;
  }

  /** Stops runs at their next batch; nothing is embedded until resume() or rebuild(). */
  async function pause() {
    paused = true;
    await saveState();
  }
  async function resume() {
    paused = false;
    await saveState();
  }

  /** Throws away the vectors of `ids` and lifts a pause; the caller starts the new run. */
  async function rebuild(ids) {
    generationOfRuns++;
    paused = false;
    await Promise.all(ids.map(id => state.get(id)?.running?.catch(() => null)));
    const m = model();
    for (const id of ids) {
      await vectors.dropVectors(id, m);
      if (vectors.dropOtherVectors) await vectors.dropOtherVectors(id, m);
      patch(id, { model: m, generation: null, syncedAt: null, finishedAt: null, error: null });
    }
    await saveState();
  }

  return {
    sync,
    search,
    progress,
    overview,
    pause,
    resume,
    rebuild,
    isPaused: () => paused,
    forget: async id => {
      for (const [key, s] of state) if (!id || key === id) if (s.model) await vectors.dropVectors(key, s.model);
      if (id) state.delete(id);
      else state.clear();
      await saveState();
    },
    vectors
  };
}
