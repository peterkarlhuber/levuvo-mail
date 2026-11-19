import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createSpeechModels, speechFilePath, SPEECH_CATALOG } from '../src/speech-models.mjs';
import { APP_CSP, contentTypeForAsset } from '../src/desktop-runtime.mjs';
import { NOT_BACKED_UP } from '../src/backup.mjs';

const sha = b => createHash('sha256').update(b).digest('hex');
const A = Buffer.from('{"model_type":"whisper"}');
const B = Buffer.alloc(3000, 7);
const CATALOG = [
  {
    id: 'whisper-test',
    name: 'Whisper Test',
    repo: 'org/whisper-test',
    revision: 'abc123',
    quality: 'fast',
    files: [
      { path: 'config.json', size: A.length, sha256: sha(A) },
      { path: 'onnx/encoder_model.onnx', size: B.length, sha256: sha(B) }
    ]
  }
];

function fakeFetch(bodies, calls = []) {
  return async (url, { signal } = {}) => {
    calls.push(url);
    const file = Object.keys(bodies).find(k => url.endsWith(k));
    if (!file) return new Response('nope', { status: 404 });
    if (signal?.aborted) throw new Error('aborted');
    return new Response(bodies[file]);
  };
}

const tmp = t => {
  const dir = mkdtempSync(join(tmpdir(), 'lv-speech-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const logs = () => {
  const entries = [];
  return { entries, add: async e => entries.push(e) };
};

test('a model downloads from the pinned revision, file by file, and is served only by listed paths', async t => {
  const dir = tmp(t);
  const calls = [];
  const log = logs();
  const s = createSpeechModels({
    dir,
    catalog: CATALOG,
    log,
    fetchImpl: fakeFetch({ 'config.json': A, 'encoder_model.onnx': B }, calls)
  });
  await s.download('whisper-test');
  await s.jobs.get('whisper-test').done;
  assert.equal(s.jobs.get('whisper-test').state, 'done');
  assert.ok(calls.every(u => u.startsWith('https://huggingface.co/org/whisper-test/resolve/abc123/')));
  const listed = (await s.list()).models[0];
  assert.equal(listed.installed, true);
  assert.equal(listed.size, A.length + B.length);
  assert.equal(readFileSync(await s.file('whisper-test', 'onnx/encoder_model.onnx')).length, B.length);
  assert.equal(await s.file('whisper-test', '../../accounts.json'), null);
  assert.equal(await s.file('whisper-test', 'onnx/other.onnx'), null);
  assert.equal(await s.file('nope', 'config.json'), null);
  assert.deepEqual(log.entries.at(-1), { type: 'download', kind: 'speech-model', model: 'whisper-test', ok: true });
  await s.remove('whisper-test');
  assert.equal(existsSync(join(dir, 'whisper-test')), false);
});

test('a file with other content is deleted again (fail closed), unknown models are refused', async t => {
  const dir = tmp(t);
  const s = createSpeechModels({
    dir,
    catalog: CATALOG,
    log: logs(),
    fetchImpl: fakeFetch({ 'config.json': A, 'encoder_model.onnx': Buffer.alloc(3000, 8) })
  });
  await s.download('whisper-test');
  await s.jobs.get('whisper-test').done;
  const job = s.jobs.get('whisper-test');
  assert.equal(job.state, 'error');
  assert.equal(job.error, 'checksum_mismatch');
  assert.equal(existsSync(join(dir, 'whisper-test')), false);
  assert.equal((await s.list()).models[0].installed, false);
  await assert.rejects(s.download('evil'), err => err.code === 'ai_not_in_catalog');
  // Too large: stops as soon as the pinned size is passed.
  const big = createSpeechModels({
    dir,
    catalog: CATALOG,
    fetchImpl: fakeFetch({ 'config.json': A, 'encoder_model.onnx': Buffer.alloc(5000, 7) })
  });
  await big.download('whisper-test');
  await big.jobs.get('whisper-test').done;
  assert.equal(big.jobs.get('whisper-test').error, 'checksum_mismatch');
});

test('not enough disk space: nothing is downloaded', async t => {
  const dir = tmp(t);
  const calls = [];
  const s = createSpeechModels({
    dir,
    catalog: CATALOG,
    statfs: async () => ({ bavail: 10, bsize: 4096 }),
    fetchImpl: fakeFetch({}, calls)
  });
  await s.download('whisper-test');
  await s.jobs.get('whisper-test').done;
  assert.equal(s.jobs.get('whisper-test').error, 'disk_full');
  assert.equal(calls.length, 0);
});

test('the real catalog pins every file, the app may run WebAssembly but no eval, models are not backed up', () => {
  for (const m of SPEECH_CATALOG) {
    assert.match(m.revision, /^[0-9a-f]{40}$/, `${m.id}: revision is a commit`);
    for (const f of m.files) {
      assert.match(f.sha256, /^[0-9a-f]{64}$/);
      assert.ok(f.size > 0);
      assert.doesNotMatch(f.path, /\.\.|^\//);
    }
    assert.ok(speechFilePath('/x', m.id, m.files[0].path).startsWith('/x'));
  }
  assert.match(APP_CSP, /script-src 'self' 'wasm-unsafe-eval'(;|$)/);
  assert.doesNotMatch(APP_CSP, /'unsafe-eval'/);
  assert.match(APP_CSP, /worker-src 'self'(;|$)/);
  assert.equal(contentTypeForAsset('x.wasm'), 'application/wasm');
  assert.ok(NOT_BACKED_UP['speech/']);
});
