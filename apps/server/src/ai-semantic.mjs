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
  stateFile = null
}) {
  const state = new Map(); // id -> { model, generation, syncedAt, running }
  // Progress survives a restart only together with persistent vectors.
  const persisted = vectors.persistent && stateFile;
  if (persisted)
    for (const [id, v] of Object.entries(stateFile.get().accounts || {}))
      state.set(id, { model: v.model, generation: v.generation, syncedAt: v.syncedAt, running: null });
  const saveState = async () => {
    if (!persisted) return;
    const accounts = {};
    for (const [id, v] of state) accounts[id] = { model: v.model, generation: v.generation, syncedAt: v.syncedAt };
    await stateFile.save({ accounts }).catch(() => {});
  };

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
    const current = state.get(id) || { model: null, generation: null, syncedAt: null, running: null };
    if (current.running) return current.running;
    const run = (async () => {
      const status = await localIndex.status(id);
      if (!status?.enabled) return { skipped: true };
      const m = model();
      return vectors.persistent && vectors.missing
        ? fillMissing(id, m, status, current)
        : syncChanges(id, m, status, current);
    })();
    state.set(id, { ...current, running: run });
    try {
      return await run;
    } catch (err) {
      state.set(id, { ...current, running: null });
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
  async function fillMissing(id, m, status, current) {
    // Only vectors of the current model are kept; also covers a model switch whose state was lost.
    if (vectors.dropOtherVectors) await vectors.dropOtherVectors(id, m);
    else if (current.model && current.model !== m) await vectors.dropVectors(id, current.model);
    state.set(id, {
      model: m,
      generation: status.generation,
      syncedAt: current.syncedAt,
      running: state.get(id)?.running
    });
    await saveState();
    let count = 0;
    let failedInRow = 0;
    let lastError = null;
    for await (const batch of vectors.missing(id, m, { batch: BATCH })) {
      if (model() !== m || !usable()) break; // settings changed: the next run starts over cleanly
      try {
        count += await embedBatch(id, m, batch);
        failedInRow = 0;
      } catch (err) {
        lastError = err;
        if (++failedInRow >= MAX_FAILED_BATCHES) break;
      }
    }
    state.set(id, { model: m, generation: status.generation, syncedAt: Date.now(), running: null });
    await saveState();
    finished(id, m, count);
    if (failedInRow >= MAX_FAILED_BATCHES && !count) throw lastError;
    return { embedded: count };
  }

  /**
   * In-memory store (no encrypted index available): follows the index by change time and keeps
   * only the newest entries.
   */
  async function syncChanges(id, m, status, current) {
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
    for (let i = 0; i < Math.min(all.length, MAX_MEMORY_ENTRIES); i += BATCH)
      count += await embedBatch(id, m, all.slice(i, Math.min(i + BATCH, MAX_MEMORY_ENTRIES)));
    state.set(id, { model: m, generation: status.generation, syncedAt: started, running: null });
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
        vectors: vectors.persistent ? (status.vectors ?? null) : (vectors.size?.(id, m) ?? null),
        running: Boolean(s?.running)
      });
    }
    return out;
  }

  return {
    sync,
    search,
    progress,
    forget: async id => {
      for (const [key, s] of state) if (!id || key === id) if (s.model) await vectors.dropVectors(key, s.model);
      if (id) state.delete(id);
      else state.clear();
      await saveState();
    },
    vectors
  };
}
