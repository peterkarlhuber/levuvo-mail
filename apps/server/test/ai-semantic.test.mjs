import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryVectorStore, createSemanticIndex, normalizeVector } from '../src/ai-semantic.mjs';

// Toy embedding: one dimension per keyword, so "meaning" is predictable.
const WORDS = ['rechnung', 'urlaub', 'meeting', 'vertrag'];
const embed = t => WORDS.map(w => (t.toLowerCase().includes(w) ? 1 : 0.01));

function fakeIndex() {
  const items = new Map([
    [
      'k1',
      {
        key: 'k1',
        folder: 'INBOX',
        uid: 1,
        date: '2026-11-01',
        subject: 'Rechnung November',
        text: 'Ihre Rechnung',
        fromName: 'A',
        fromEmail: 'a@x.at',
        updatedAt: 1
      }
    ],
    [
      'k2',
      {
        key: 'k2',
        folder: 'INBOX',
        uid: 2,
        date: '2026-11-02',
        subject: 'Urlaub',
        text: 'Ich bin im Urlaub',
        fromName: 'B',
        fromEmail: 'b@x.at',
        updatedAt: 1
      }
    ],
    [
      'k3',
      {
        key: 'k3',
        folder: 'Archiv',
        uid: 3,
        date: '2026-11-03',
        subject: 'Meeting',
        text: 'Meeting am Montag',
        fromName: 'C',
        fromEmail: 'c@x.at',
        updatedAt: 1
      }
    ]
  ]);
  let removed = [];
  let generation = 'g1';
  return {
    items,
    remove(key, at) {
      items.delete(key);
      removed.push([key, at]);
    },
    rebuild() {
      generation = 'g2';
      removed = [];
    },
    async status() {
      return { enabled: true, generation };
    },
    async *entries(_id, { since = null } = {}) {
      for (const e of items.values()) if (since === null || e.updatedAt > since) yield e;
    },
    async removedKeys(_id, since) {
      return removed.filter(([, at]) => at > since).map(([k]) => k);
    },
    async text(_id, folder, uid) {
      return [...items.values()].find(e => e.folder === folder && e.uid === uid) || null;
    }
  };
}
function fakeAi(calls) {
  const settings = { enabled: true, features: { search: true }, embedModel: 'qwen3-embedding:0.6b' };
  return {
    settings,
    get: () => settings,
    log: { add: e => calls.push(e) },
    async run(kind, input, opts) {
      assert.equal(kind, 'embed');
      assert.equal(opts.source, 'index');
      calls.push({ embedded: input.texts.length });
      return { vectors: input.texts.map(embed) };
    }
  };
}

test('semantic index embeds incrementally, follows removals and rebuilds, finds by meaning', async () => {
  const calls = [];
  const idx = fakeIndex();
  const ai = fakeAi(calls);
  const vectors = createMemoryVectorStore();
  const semantic = createSemanticIndex({ localIndex: idx, ai, vectors });
  assert.deepEqual(await semantic.sync('a1'), { embedded: 3 });
  const hits = await semantic.search(['a1'], 'Wo ist die Rechnung?');
  assert.equal(hits[0].uid, 1);
  assert.equal(hits[0].subject, 'Rechnung November');
  assert.equal((await semantic.search(['a1'], 'meeting', { folder: 'Archiv' }))[0].uid, 3);

  // Nothing new: no embedding call besides the query.
  const before = calls.filter(c => c.embedded).length;
  await semantic.sync('a1');
  assert.equal(calls.filter(c => c.embedded).length, before);

  idx.remove('k1', Date.now() + 1000);
  await semantic.sync('a1');
  assert.equal(vectors.size('a1', 'qwen3-embedding:0.6b'), 2);

  idx.rebuild();
  assert.deepEqual(await semantic.sync('a1'), { embedded: 2 });

  // Another model: vectors of the old one are dropped and everything is embedded again.
  ai.settings.embedModel = 'bge-m3';
  assert.deepEqual(await semantic.sync('a1'), { embedded: 2 });
  assert.equal(vectors.size('a1', 'qwen3-embedding:0.6b'), 0);

  ai.settings.features.search = false;
  assert.deepEqual(await semantic.sync('a1'), { skipped: true });
  assert.deepEqual(await semantic.search(['a1'], 'rechnung'), []);
  assert.ok(calls.some(c => c.type === 'index' && c.count === 3));
});

test('vectors are normalized for cosine scores', () => {
  const v = normalizeVector([3, 4]);
  assert.ok(Math.abs(v[0] - 0.6) < 1e-6 && Math.abs(v[1] - 0.8) < 1e-6);
});

test('with a persistent store, progress survives a restart and nothing is embedded twice', async () => {
  const calls = [];
  const idx = fakeIndex();
  const ai = fakeAi(calls);
  const vectors = { ...createMemoryVectorStore(), persistent: true };
  let saved = { accounts: {} };
  const stateFile = { get: () => saved, save: async v => (saved = v) };
  assert.deepEqual(await createSemanticIndex({ localIndex: idx, ai, vectors, stateFile }).sync('a1'), { embedded: 3 });
  assert.equal(saved.accounts.a1.model, 'qwen3-embedding:0.6b');
  const restarted = createSemanticIndex({ localIndex: idx, ai, vectors, stateFile });
  assert.deepEqual(await restarted.sync('a1'), { embedded: 0 });
});
