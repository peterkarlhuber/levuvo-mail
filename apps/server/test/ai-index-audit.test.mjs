// Regression tests for the AI core and search index findings of the internal audit of
// 19 November 2026: PERF-LEV-001/002/011, DB-LEV-003/006.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalIndex as openIndex } from '../src/local-index.mjs';
import { createSemanticIndex } from '../src/ai-semantic.mjs';
import { syntheticMailbox } from './helpers/synthetic-mailbox.mjs';

const INBOX = [{ path: 'INBOX', flags: new Set() }];
const MODEL = 'qwen3-embedding:0.6b';
const KEY = Buffer.alloc(32, 9);

function setup(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'lv-aud-'));
  const opened = [];
  const make = (extra = {}) => {
    const index = openIndex({ dir, getKey: async () => KEY, ...options, ...extra });
    opened.push(index);
    return index;
  };
  t.after(() => {
    for (const index of opened) index.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return make;
}

const vectorOf = uid => Float32Array.from({ length: 8 }, (_, i) => (i === uid % 8 ? 1 : 0.05));
function fakeAi({ failFrom = Infinity, failTimes = 0 } = {}) {
  const settings = { enabled: true, features: { search: true }, embedModel: MODEL };
  const calls = { embed: 0, texts: [] };
  return {
    settings,
    calls,
    get: () => settings,
    log: { add: () => {} },
    async run(kind, input) {
      assert.equal(kind, 'embed');
      calls.embed++;
      if (calls.embed >= failFrom && calls.embed < failFrom + failTimes) throw new Error('ollama gone');
      calls.texts.push(...input.texts);
      return { vectors: input.texts.map(t => vectorOf(Number(/(\d+)/.exec(t)?.[1] || 0))) };
    }
  };
}

test('PERF-LEV-001: an interrupted first embedding run keeps its vectors, also without saved progress', async t => {
  const make = setup(t);
  const index = make();
  await index.sync(syntheticMailbox(200, { textChars: 30 }), 'acc', INBOX);
  // Batches 3–5 fail (Ollama stops): the run gives up after three failures in a row.
  const ai = fakeAi({ failFrom: 3, failTimes: 3 });
  const first = await createSemanticIndex({ localIndex: index, ai }).sync('acc');
  assert.equal(first.embedded, 64, 'two batches of 32 done before the failures');
  assert.equal((await index.status('acc')).vectors, 64, 'finished batches are stored right away');
  // A restart without any saved progress (no state file): nothing is dropped, only the rest is embedded.
  const ai2 = fakeAi();
  const second = await createSemanticIndex({ localIndex: index, ai: ai2 }).sync('acc');
  assert.equal(second.embedded, 136);
  assert.equal((await index.status('acc')).vectors, 200);
  assert.equal(ai2.calls.texts.length, 136, 'no message embedded twice');
});

test('PERF-LEV-001: a single failing batch is skipped and retried by the next run', async t => {
  const make = setup(t);
  const index = make();
  await index.sync(syntheticMailbox(100, { textChars: 30 }), 'acc', INBOX);
  const ai = fakeAi({ failFrom: 2, failTimes: 1 });
  const semantic = createSemanticIndex({ localIndex: index, ai });
  assert.equal((await semantic.sync('acc')).embedded, 68);
  assert.equal((await semantic.sync('acc')).embedded, 32);
  assert.equal((await index.status('acc')).vectors, 100);
});

test('PERF-LEV-001: a model switch drops the old vectors even when the saved state is gone', async t => {
  const make = setup(t);
  const index = make();
  await index.sync(syntheticMailbox(10, { textChars: 30 }), 'acc', INBOX);
  const ai = fakeAi();
  await createSemanticIndex({ localIndex: index, ai }).sync('acc');
  ai.settings.embedModel = 'bge-m3';
  assert.equal((await createSemanticIndex({ localIndex: index, ai }).sync('acc')).embedded, 10);
  assert.equal((await index.status('acc')).vectors, 10, 'only the vectors of the current model remain');
});

test('PERF-LEV-002: missing vectors come newest first in batches, without loading all texts at once', async t => {
  const make = setup(t);
  const index = make();
  await index.sync(syntheticMailbox(75, { textChars: 30 }), 'acc', INBOX);
  const batches = await Array.fromAsync(index.missingVectors('acc', MODEL, { batch: 32 }));
  assert.deepEqual(
    batches.map(b => b.length),
    [32, 32, 11]
  );
  const uids = batches.flat().map(e => e.uid);
  assert.deepEqual(
    uids,
    [...uids].sort((a, b) => b - a),
    'newest first'
  );
  assert.ok(batches[0][0].text.length > 0 && batches[0][0].key.includes('\u0000'));
  await index.putVectors(
    'acc',
    MODEL,
    batches[0].map(e => ({ key: e.key, vector: vectorOf(e.uid) }))
  );
  const rest = (await Array.fromAsync(index.missingVectors('acc', MODEL))).flat();
  assert.equal(rest.length, 43);
  assert.ok(!rest.some(e => batches[0].some(b => b.key === e.key)));
});

test('DB-LEV-003: rows written during a long sync carry a change stamp after a reader that started meanwhile', async t => {
  const make = setup(t);
  const index = make();
  const client = syntheticMailbox(120, { textChars: 30 });
  const fetch = client.fetch.bind(client);
  let readerStart = null;
  client.fetch = async function* (range, query, options) {
    // The incremental reader takes its cursor while the first FETCH batch is still on its way.
    if (readerStart === null && query.envelope) {
      await new Promise(resolve => setTimeout(resolve, 5));
      readerStart = Date.now();
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    yield* fetch(range, query, options);
  };
  await index.sync(client, 'acc', INBOX);
  const seen = await Array.fromAsync(index.entries('acc', { since: readerStart }));
  assert.equal(seen.length, 120, 'every row inserted after the reader started is found by it');
  // Stamps strictly increase, also within one millisecond.
  const stamps = (await Array.fromAsync(index.entries('acc'))).map(e => e.updatedAt);
  assert.equal(new Set(stamps).size, stamps.length);
  // Removals are stamped when they happen too.
  const before = Date.now();
  client.expunge(5);
  await index.sync(client, 'acc', INBOX);
  assert.equal((await index.removedKeys('acc', before - 1)).length, 1);
});

test('DB-LEV-003: the semantic index fills gaps left by an earlier skipped range', async t => {
  const make = setup(t);
  const index = make();
  const client = syntheticMailbox(40, { textChars: 30 });
  await index.sync(client, 'acc', INBOX);
  const ai = fakeAi();
  let saved = { accounts: {} };
  const stateFile = { get: () => saved, save: async v => (saved = v) };
  const semantic = createSemanticIndex({ localIndex: index, ai, stateFile });
  await semantic.sync('acc');
  // A vector lost for whatever reason (e.g. an old run that skipped rows) is found again.
  const [newest] = (await Array.fromAsync(index.entries('acc'))).slice(-1);
  await index.dropVectors('acc', MODEL);
  await index.putVectors(
    'acc',
    MODEL,
    (await Array.fromAsync(index.entries('acc')))
      .filter(e => e.key !== newest.key)
      .map(e => ({ key: e.key, vector: vectorOf(e.uid) }))
  );
  assert.equal((await semantic.sync('acc')).embedded, 1);
  client.append();
  await index.sync(client, 'acc', INBOX);
  assert.equal((await semantic.sync('acc')).embedded, 1);
});

test('DB-LEV-006: the schema version is read: older files are migrated, newer ones rebuilt', async t => {
  const make = setup(t);
  const v1 = make();
  await v1.sync(syntheticMailbox(5, { textChars: 30 }), 'acc', INBOX);
  const { generation } = await v1.status('acc');
  v1.close();

  const ran = [];
  const v2 = make({
    schema: 2,
    migrations: [
      undefined,
      db => {
        ran.push(1);
        db.exec('CREATE TABLE IF NOT EXISTS extra (k TEXT)');
      }
    ]
  });
  const after = await v2.status('acc');
  assert.deepEqual(ran, [1], 'migration 1 → 2 ran once');
  assert.equal(after.messages, 5, 'data kept');
  assert.equal(after.generation, generation, 'no rebuild');
  v2.close();
  const again = make({ schema: 2, migrations: [undefined, () => ran.push('again')] });
  await again.status('acc');
  assert.deepEqual(ran, [1], 'not run twice');
  again.close();

  // Rolled back to schema 1: a file of schema 2 is not read as if it were schema 1.
  const old = make();
  const rolledBack = await old.status('acc');
  assert.equal(rolledBack.messages, 0);
  assert.notEqual(rolledBack.generation, generation, 'consumers see a new generation and rebuild');
  old.close();

  // A failing migration empties the index instead of leaving it half-upgraded.
  const v1b = make();
  await v1b.sync(syntheticMailbox(3, { textChars: 30 }), 'acc', INBOX);
  v1b.close();
  const broken = make({
    schema: 2,
    migrations: [
      undefined,
      () => {
        throw new Error('boom');
      }
    ]
  });
  assert.equal((await broken.status('acc')).messages, 0);
});

test('PERF-LEV-011: the loaded vector set follows new and removed vectors without a full reload', async t => {
  const make = setup(t, { vectorIdleMs: 50 });
  const index = make();
  const client = syntheticMailbox(20, { textChars: 30 });
  await index.sync(client, 'acc', INBOX);
  const all = await Array.fromAsync(index.entries('acc'));
  const basis = n => Float32Array.from({ length: 64 }, (_, i) => (i === n ? 1 : 0.01));
  await index.putVectors(
    'acc',
    MODEL,
    all.slice(0, 10).map((e, n) => ({ key: e.key, vector: basis(n) }))
  );
  assert.equal((await index.searchVectors('acc', MODEL, basis(0), { limit: 1 }))[0].key, all[0].key);
  // New vectors appear in the loaded set right away (beyond its initial capacity too).
  await index.putVectors(
    'acc',
    MODEL,
    all.slice(10).map((e, n) => ({ key: e.key, vector: basis(10 + n) }))
  );
  assert.equal((await index.searchVectors('acc', MODEL, basis(15), { limit: 1 }))[0].key, all[15].key);
  // Overwriting a vector replaces it in place.
  await index.putVectors('acc', MODEL, [{ key: all[15].key, vector: basis(40) }]);
  assert.equal((await index.searchVectors('acc', MODEL, basis(40), { limit: 1 }))[0].key, all[15].key);
  assert.equal((await index.searchVectors('acc', MODEL, basis(15), { limit: 20 })).length, 20);
  // A removed message is gone from the loaded set.
  client.expunge(all[3].uid);
  await index.sync(client, 'acc', INBOX);
  const hits = await index.searchVectors('acc', MODEL, basis(3), { limit: 30 });
  assert.equal(hits.length, 19);
  assert.ok(!hits.some(h => h.key === all[3].key));
  // Released when idle, loaded again on the next search.
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal((await index.searchVectors('acc', MODEL, basis(0), { limit: 1 }))[0].key, all[0].key);
});
