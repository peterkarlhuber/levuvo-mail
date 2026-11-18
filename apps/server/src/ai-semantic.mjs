// Semantic search and "ask your mailbox" on top of the local search index.
//
// The texts come from the encrypted local index (entries(), removedKeys(), status().generation);
// embeddings are always computed by the local Ollama model, also when a cloud model writes answers.
// Vectors go to a vector store with the interface putVectors / searchVectors / dropVectors. The shared
// encrypted SQLite store of the index replaces the in-memory store below without changes here.

const BATCH = 32;
const TEXT_CHARS = 1500;
const MAX_MEMORY_ENTRIES = 5000;
const QUERY_PREFIX = 'Instruct: Given a search query, retrieve relevant emails that answer it\nQuery: ';

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

const passage = e =>
  `${e.subject || ''}\n${e.fromName || ''} <${e.fromEmail || ''}>\n${String(e.text || '').slice(0, TEXT_CHARS)}`;

/**
 * @param {object} o
 * @param {object} o.localIndex  entries / removedKeys / status / text of the local index
 * @param {object} o.ai          AI service (run, get)
 * @param {object} [o.vectors]   vector store (defaults to memory)
 */
export function createSemanticIndex({ localIndex, ai, vectors = createMemoryVectorStore(), logger = () => {} }) {
  const state = new Map(); // id -> { model, generation, syncedAt, running }

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
      const started = Date.now();
      let batch = [];
      let count = 0;
      const flush = async () => {
        if (!batch.length) return;
        const r = await ai.run('embed', { texts: batch.map(passage) }, { accountId: id, source: 'index' });
        await vectors.putVectors(
          id,
          m,
          batch.map((e, i) => ({ key: e.key, folder: e.folder, uid: e.uid, vector: r.vectors[i] }))
        );
        count += batch.length;
        batch = [];
      };
      // Newest first, so search is useful early; the memory store keeps only the newest entries.
      const all = [];
      for await (const e of localIndex.entries(id, { since })) all.push(e);
      all.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
      const limit = vectors.persistent ? all.length : Math.min(all.length, MAX_MEMORY_ENTRIES);
      for (const e of all.slice(0, limit)) {
        batch.push(e);
        if (batch.length >= BATCH) await flush();
      }
      await flush();
      state.set(id, { model: m, generation: status.generation, syncedAt: started, running: null });
      if (count) {
        logger(`Semantic index ${id}: ${count} messages embedded`);
        void ai.log?.add({ type: 'index', kind: 'embed', accountId: id, count, model: m });
      }
      return { embedded: count };
    })();
    state.set(id, { ...current, running: run });
    try {
      return await run;
    } catch (err) {
      state.set(id, { ...current, running: null });
      throw err;
    }
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
    const [vector] = (await ai.run('embed', { texts: [QUERY_PREFIX + text] }, { source: 'index' })).vectors;
    const m = model();
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

  return {
    sync,
    search,
    forget: async id => {
      for (const [key, s] of state) if (!id || key === id) if (s.model) await vectors.dropVectors(key, s.model);
      if (id) state.delete(id);
      else state.clear();
    },
    vectors
  };
}
