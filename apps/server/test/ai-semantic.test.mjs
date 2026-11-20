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

test('with the encrypted local index: vectors are stored there and found by meaning', async t => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createLocalIndex } = await import('../src/local-index.mjs');
  const { syntheticMailbox } = await import('./helpers/synthetic-mailbox.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'lv-sem-'));
  const index = createLocalIndex({ dir, getKey: async () => Buffer.alloc(32, 7) });
  t.after(() => {
    index.close();
    rmSync(dir, { recursive: true, force: true });
  });
  await index.sync(syntheticMailbox(12, { textChars: 40 }), 'acc', [{ path: 'INBOX', flags: new Set() }]);
  const calls = [];
  const ai = fakeAi(calls);
  let saved = { accounts: {} };
  const stateFile = { get: () => saved, save: async v => (saved = v) };
  const semantic = createSemanticIndex({ localIndex: index, ai, stateFile });
  const first = await semantic.sync('acc');
  assert.equal(first.embedded, 12);
  assert.equal((await index.status('acc')).vectors, 12, 'vectors live in the index file');
  const hits = await semantic.search(['acc'], 'egal');
  assert.ok(hits.length > 0 && hits.every(h => h.accountId === 'acc' && Number.isInteger(h.uid)));
  // A restart reuses the stored vectors.
  assert.deepEqual(await createSemanticIndex({ localIndex: index, ai, stateFile }).sync('acc'), { embedded: 0 });
});

test('overview tells none, running with remaining time, paused, done and error apart', async t => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createLocalIndex } = await import('../src/local-index.mjs');
  const { syntheticMailbox } = await import('./helpers/synthetic-mailbox.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'lv-sem-'));
  const index = createLocalIndex({ dir, getKey: async () => Buffer.alloc(32, 7) });
  t.after(() => {
    index.close();
    rmSync(dir, { recursive: true, force: true });
  });
  await index.sync(syntheticMailbox(100, { textChars: 40 }), 'acc', [{ path: 'INBOX', flags: new Set() }]);
  const calls = [];
  const ai = fakeAi(calls);
  let clock = 1_000_000;
  let saved = { accounts: {} };
  const stateFile = { get: () => saved, save: async v => (saved = v) };
  const semantic = createSemanticIndex({ localIndex: index, ai, stateFile, now: () => clock });

  ai.settings.enabled = false;
  assert.equal((await semantic.overview(['acc'])).reason, 'ai_off');
  ai.settings.enabled = true;
  assert.equal((await semantic.overview(['acc'], { modelInstalled: false })).reason, 'model_missing');
  assert.equal((await semantic.overview([])).reason, 'index_off');
  const before = await semantic.overview(['acc']);
  assert.equal(before.state, 'none');
  assert.equal(before.reason, 'not_started');
  assert.equal(before.messages, 100);

  // Running: each batch takes 2 s on the fake clock; seen during the third batch: 64 stored in 6 s.
  let seen = null;
  const realRun = ai.run;
  ai.run = async (kind, input, opts) => {
    clock += 2000;
    const r = await realRun(kind, input, opts);
    if (!seen && calls.filter(c => c.embedded).length === 3) seen = await semantic.overview(['acc']);
    return r;
  };
  await semantic.sync('acc');
  assert.equal(seen.state, 'running');
  assert.equal(seen.vectors, 64);
  assert.equal(seen.etaSeconds, Math.ceil(36 / (64 / 6)));
  const done = await semantic.overview(['acc']);
  assert.equal(done.state, 'done');
  assert.equal(done.vectors, 100);
  assert.equal(done.finishedAt, clock);

  // Paused: survives a restart, stops a run and nothing is embedded meanwhile.
  await semantic.pause();
  assert.equal(saved.paused, true);
  const restarted = createSemanticIndex({ localIndex: index, ai, stateFile, now: () => clock });
  assert.equal((await restarted.overview(['acc'])).state, 'paused');
  assert.deepEqual(await restarted.sync('acc'), { skipped: true, paused: true });

  // Rebuild: vectors gone, pause lifted, the next run starts from zero.
  await restarted.rebuild(['acc']);
  assert.equal(saved.paused, false);
  assert.equal((await restarted.overview(['acc'])).vectors, 0);
  assert.deepEqual(await restarted.sync('acc'), { embedded: 100 });

  // Error: the model fails every batch; only the code is kept, never a message text.
  await restarted.rebuild(['acc']);
  ai.run = async () => {
    throw Object.assign(new Error('secret mail text'), { code: 'ai_unavailable' });
  };
  await assert.rejects(restarted.sync('acc'));
  const failed = await restarted.overview(['acc']);
  assert.equal(failed.state, 'error');
  assert.equal(failed.error.code, 'ai_unavailable');
  assert.ok(!JSON.stringify(saved).includes('secret'));
});
