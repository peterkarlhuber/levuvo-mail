// Levuvo Mail's own Ollama: the pinned model catalog, the isolated runtime and the model downloads.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MODEL_CATALOG,
  DEFAULT_CHAT_MODEL,
  DEFAULT_EMBED_MODEL,
  catalogEntry,
  defaultModel,
  fitFor,
  ollamaName,
  queryPrefixFor,
  recommendedTier
} from '../src/ai-model-catalog.mjs';
import { createOllamaRuntime, ollamaEnv, ollamaPaths, resolveOllama } from '../src/ollama-runtime.mjs';
import { createModelManager, progressTracker, DISK_RESERVE } from '../src/ollama-models.mjs';
import { createAiService, validateAiSettings, DEFAULT_AI_SETTINGS } from '../src/ai-service.mjs';
import { NOT_BACKED_UP } from '../src/backup.mjs';
import { NODE_BIN } from './fixtures/node-bin.mjs';

const GiB = 1024 ** 3;
const tmp = () => mkdtempSync(path.join(tmpdir(), 'lv-ollama-test-'));

test('catalog: every model is pinned by digest and size, with a permissive license', () => {
  const ids = new Set();
  for (const m of MODEL_CATALOG) {
    assert.ok(!ids.has(m.id), `duplicate ${m.id}`);
    ids.add(m.id);
    assert.match(m.digest, /^sha256:[0-9a-f]{64}$/, m.id);
    assert.ok(Number.isSafeInteger(m.size) && m.size > 100e6, m.id);
    assert.ok(['Apache-2.0', 'MIT'].includes(m.license), `${m.id}: ${m.license}`);
    assert.match(m.licenseUrl, /^https:\/\//);
    assert.equal(m.eu, ['FR', 'DE', 'AT', 'IT', 'ES', 'NL', 'PT', 'SE', 'FI', 'PL'].includes(m.origin), m.id);
    assert.equal(m.kind === 'embed', m.tier === 'search', m.id);
    assert.ok(!/cloud/i.test(m.id), m.id);
  }
  for (const tier of ['small', 'standard', 'large', 'search'])
    assert.equal(MODEL_CATALOG.filter(m => m.tier === tier && m.default).length, 1, `one default for ${tier}`);
  assert.ok(MODEL_CATALOG.some(m => m.eu && m.tier === 'small'));
  assert.ok(MODEL_CATALOG.some(m => m.eu && m.tier === 'standard'));
  assert.ok(MODEL_CATALOG.some(m => m.eu && m.tier === 'large'));
  assert.equal(DEFAULT_CHAT_MODEL, 'qwen3.5:9b');
  // The German comparison (docs/ai/MODELS.md) made bge-m3 the default search model.
  assert.equal(DEFAULT_EMBED_MODEL, 'bge-m3');
  assert.equal(DEFAULT_AI_SETTINGS.embedModel, 'bge-m3');
});

test('catalog: tier by memory, fit, names and search instructions', () => {
  assert.equal(recommendedTier(7.6 * GiB), 'small');
  assert.equal(recommendedTier(15.5 * GiB), 'standard');
  assert.equal(recommendedTier(31.8 * GiB), 'large');
  assert.equal(defaultModel('small'), 'qwen3.5:4b');
  assert.equal(defaultModel('large'), 'qwen3.8:27b');
  const big = catalogEntry('mistral-small3.2:24b');
  assert.equal(fitFor(big, 8 * GiB), 'too_big');
  assert.equal(fitFor(big, 16 * GiB), 'tight');
  assert.equal(fitFor(big, 32 * GiB), 'good');
  assert.equal(fitFor(catalogEntry('bge-m3'), 8 * GiB), 'good');
  assert.equal(ollamaName('bge-m3'), 'bge-m3:latest');
  assert.equal(catalogEntry('bge-m3:latest').id, 'bge-m3');
  assert.equal(catalogEntry('llama3:8b'), null);
  assert.equal(queryPrefixFor('bge-m3'), '');
  assert.match(queryPrefixFor('qwen3-embedding:0.6b'), /^Instruct: /);
});

test('runtime environment: own home, models, port on 127.0.0.1, cloud off, nothing of the user setup', () => {
  const env = ollamaEnv({
    env: {
      PATH: '/usr/bin',
      HOME: '/home/user',
      OLLAMA_HOST: '0.0.0.0:11434',
      OLLAMA_MODELS: '/home/user/.ollama/models',
      OLLAMA_ORIGINS: '*',
      OLLAMA_DEBUG_LOG_REQUESTS: '1',
      HTTPS_PROXY: 'http://proxy:8080',
      LEVUVO_SESSION_SECRET: 'secret'
    },
    home: '/data/ollama/home',
    models: '/data/ollama/models',
    port: 47811
  });
  assert.equal(env.OLLAMA_HOST, '127.0.0.1:47811');
  assert.equal(env.OLLAMA_MODELS, '/data/ollama/models');
  assert.equal(env.HOME, '/data/ollama/home');
  assert.equal(env.USERPROFILE, '/data/ollama/home');
  assert.equal(env.OLLAMA_NO_CLOUD, '1');
  assert.equal(env.OLLAMA_NOPRUNE, '1');
  assert.equal(env.OLLAMA_ORIGINS, undefined);
  assert.equal(env.OLLAMA_DEBUG_LOG_REQUESTS, undefined);
  assert.equal(env.LEVUVO_SESSION_SECRET, undefined);
  assert.equal(env.HTTPS_PROXY, 'http://proxy:8080');
  assert.match(env.NO_PROXY, /127\.0\.0\.1/);
  const p = ollamaPaths('/data');
  assert.equal(p.models, path.join('/data', 'ollama', 'models'));
});

test('runtime binary: only the bundled one or LEVUVO_OLLAMA_BIN, never an Ollama from PATH', () => {
  const dir = tmp();
  try {
    assert.equal(resolveOllama({ resourcesPath: dir, env: { PATH: '/usr/local/bin' }, platform: 'linux' }), null);
    mkdirSync(path.join(dir, 'ollama'));
    writeFileSync(path.join(dir, 'ollama', 'ollama.exe'), '');
    assert.deepEqual(resolveOllama({ resourcesPath: dir, env: {}, platform: 'win32' }), {
      command: path.join(dir, 'ollama', 'ollama.exe'),
      bundled: true
    });
    const dev = path.join(dir, 'dev-ollama');
    writeFileSync(dev, '');
    assert.deepEqual(resolveOllama({ resourcesPath: '', env: { LEVUVO_OLLAMA_BIN: dev }, platform: 'linux' }), {
      command: dev,
      bundled: false
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runtime: starts its own server in the app data folder and stops it again', async () => {
  const dir = tmp();
  const fake = fileURLToPath(new URL('./fixtures/fake-ollama.mjs', import.meta.url));
  const runtime = createOllamaRuntime({
    dataDir: dir,
    resolve: () => ({ command: 'ollama', bundled: true }),
    spawn: (_cmd, args, opts) => nodeSpawn(NODE_BIN, [fake, ...args], opts),
    env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, OLLAMA_HOST: '0.0.0.0:11434' }
  });
  try {
    assert.equal(runtime.available, true);
    const [a, b] = await Promise.all([runtime.ensure(), runtime.ensure()]);
    assert.equal(a, b, 'one server for parallel callers');
    assert.match(a, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.notEqual(new URL(a).port, '11434');
    assert.equal(runtime.diagnostics().version, '0.0.0-test');
    const seen = JSON.parse(readFileSync(path.join(dir, 'ollama', 'home', 'env.json'), 'utf8'));
    assert.equal(seen.OLLAMA_MODELS, path.join(dir, 'ollama', 'models'));
    assert.equal(seen.OLLAMA_HOST, `127.0.0.1:${new URL(a).port}`);
    assert.equal(seen.OLLAMA_NO_CLOUD, '1');
    await runtime.stop();
    assert.equal(runtime.running, false);
    await assert.rejects(fetch(`${a}/api/version`));
  } finally {
    await runtime.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runtime: missing binary fails with runtime_missing', async () => {
  const runtime = createOllamaRuntime({ dataDir: tmp(), resolve: () => null });
  assert.equal(runtime.available, false);
  await assert.rejects(runtime.ensure(), { kind: 'runtime_missing' });
});

/** In-process stand-in for the Ollama HTTP API (tags, pull with progress, delete). */
async function fakeOllama({ digestFor = e => e.digest, slow = false } = {}) {
  const installed = new Map();
  const calls = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const json = body ? JSON.parse(body) : {};
    calls.push(`${req.method} ${req.url} ${json.model || ''}`);
    if (req.url === '/api/tags') {
      res.end(JSON.stringify({ models: [...installed.values()] }));
    } else if (req.url === '/api/pull') {
      const entry = MODEL_CATALOG.find(m => ollamaName(m.id) === json.model);
      res.write(`${JSON.stringify({ status: 'pulling manifest' })}\n`);
      const half = Math.floor(entry.size / 2);
      res.write(`${JSON.stringify({ status: 'pulling a', digest: 'sha256:a', total: half, completed: half })}\n`);
      if (slow) {
        // Second layer never finishes: the test cancels.
        res.write(
          `${JSON.stringify({ status: 'pulling b', digest: 'sha256:b', total: entry.size - half, completed: 1 })}\n`
        );
        req.on('close', () => res.destroy());
        return;
      }
      res.write(
        `${JSON.stringify({ status: 'pulling b', digest: 'sha256:b', total: entry.size - half, completed: entry.size - half })}\n`
      );
      res.write(`${JSON.stringify({ status: 'verifying sha256 digest' })}\n`);
      installed.set(entry.id, {
        name: ollamaName(entry.id),
        size: entry.size,
        digest: digestFor(entry).replace('sha256:', '')
      });
      res.end(`${JSON.stringify({ status: 'success' })}\n`);
    } else if (req.url === '/api/delete') {
      const entry = MODEL_CATALOG.find(m => ollamaName(m.id) === json.model);
      res.statusCode = installed.delete(entry?.id) ? 200 : 404;
      res.end('{}');
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, installed, calls, close: () => new Promise(r => server.close(r)) };
}
const runtimeAt = (url, models) => ({
  ensure: async () => url,
  paths: { models },
  diagnostics: () => ({ running: true, version: 'test' })
});
const until = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error('timeout');
    await new Promise(r => setTimeout(r, 20));
  }
};

test('downloads: progress, digest check, ready listener and delete', async () => {
  const ollama = await fakeOllama();
  const dir = tmp();
  const ready = [];
  const mm = createModelManager({
    runtime: runtimeAt(ollama.url, dir),
    statfs: async () => ({ bavail: 1e6, bsize: 1e6 }),
    totalmem: () => 16 * GiB
  });
  mm.onReady(id => ready.push(id));
  try {
    const first = await mm.download('bge-m3');
    assert.equal(first.status, 'downloading');
    await until(async () => (await mm.list()).models.find(m => m.id === 'bge-m3').installed);
    const list = await mm.list();
    const bge = list.models.find(m => m.id === 'bge-m3');
    assert.equal(bge.job.status, 'done');
    assert.equal(bge.job.completed, bge.size);
    assert.equal(list.recommendedTier, 'standard');
    assert.equal(list.models.find(m => m.id === 'qwen3.8:27b').fit, 'tight');
    await until(() => ready.includes('bge-m3'));
    assert.equal(await mm.isReady('bge-m3'), true);
    // Already there: nothing is downloaded again.
    const pulls = ollama.calls.filter(c => c.startsWith('POST /api/pull')).length;
    assert.equal((await mm.download('bge-m3')).status, 'done');
    assert.equal(ollama.calls.filter(c => c.startsWith('POST /api/pull')).length, pulls);
    await mm.remove('bge-m3');
    assert.equal(await mm.isReady('bge-m3'), false);
  } finally {
    await ollama.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('downloads: an unexpected digest is deleted again and never counts as installed', async () => {
  const ollama = await fakeOllama({ digestFor: () => `sha256:${'0'.repeat(64)}` });
  const dir = tmp();
  const mm = createModelManager({
    runtime: runtimeAt(ollama.url, dir),
    statfs: async () => ({ bavail: 1e6, bsize: 1e6 })
  });
  try {
    await mm.download('qwen3-embedding:0.6b');
    await until(async () => (await mm.list()).models.find(m => m.id === 'qwen3-embedding:0.6b').job.status === 'error');
    const m = (await mm.list()).models.find(x => x.id === 'qwen3-embedding:0.6b');
    assert.equal(m.job.error, 'checksum');
    assert.equal(m.installed, false);
    assert.ok(ollama.calls.includes('DELETE /api/delete qwen3-embedding:0.6b'));
    assert.equal(ollama.installed.size, 0);
  } finally {
    await ollama.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('downloads: cancel keeps the progress, a new download resumes, discard removes the parts', async () => {
  const ollama = await fakeOllama({ slow: true });
  const dir = tmp();
  mkdirSync(path.join(dir, 'blobs'));
  const partial = path.join(dir, 'blobs', `sha256-${'a'.repeat(64)}-partial-0`);
  writeFileSync(partial, 'x');
  writeFileSync(path.join(dir, 'blobs', `sha256-${'b'.repeat(64)}`), 'keep');
  const mm = createModelManager({
    runtime: runtimeAt(ollama.url, dir),
    statfs: async () => ({ bavail: 1e6, bsize: 1e6 })
  });
  try {
    await mm.download('ministral-3:3b');
    await until(async () => (await mm.list()).models.find(m => m.id === 'ministral-3:3b').job.completed > 0);
    await assert.rejects(mm.discardPartial(), { kind: 'busy' });
    mm.cancel('ministral-3:3b');
    await until(async () => (await mm.list()).models.find(m => m.id === 'ministral-3:3b').job.status === 'canceled');
    const paused = (await mm.list()).models.find(m => m.id === 'ministral-3:3b').job;
    assert.ok(paused.completed > 0 && paused.completed < paused.total);
    const resumed = await mm.download('ministral-3:3b');
    assert.equal(resumed.status, 'downloading');
    assert.equal(resumed.completed, paused.completed, 'resumes from the last progress');
    mm.cancel('ministral-3:3b');
    await until(async () => (await mm.list()).models.find(m => m.id === 'ministral-3:3b').job.status === 'canceled');
    assert.deepEqual(await mm.discardPartial(), { removed: 1 });
    assert.equal(existsSync(partial), false);
    assert.equal(existsSync(path.join(dir, 'blobs', `sha256-${'b'.repeat(64)}`)), true);
    assert.equal((await mm.list()).models.find(m => m.id === 'ministral-3:3b').job, null);
  } finally {
    await ollama.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('downloads: refused without disk space and for models outside the catalog', async () => {
  const ollama = await fakeOllama();
  const dir = tmp();
  const mm = createModelManager({
    runtime: runtimeAt(ollama.url, dir),
    statfs: async () => ({ bavail: (5e9 + DISK_RESERVE - 1) / 4096, bsize: 4096 })
  });
  try {
    await assert.rejects(mm.download('qwen3.8:27b'), err => err.kind === 'disk_full' && err.needed > err.free);
    await assert.rejects(mm.download('llama3:8b'), { kind: 'not_in_catalog' });
    await assert.rejects(mm.download('gpt-oss:120b-cloud'), { kind: 'not_in_catalog' });
    assert.equal(ollama.calls.filter(c => c.startsWith('POST /api/pull')).length, 0);
  } finally {
    await ollama.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('progress adds up every layer and never shrinks below the catalog size', () => {
  const p = progressTracker(1000);
  p.update({ digest: 'a', total: 300, completed: 100 });
  p.update({ digest: 'b', total: 600, completed: 700 });
  assert.equal(p.completed, 700);
  assert.equal(p.total, 1000);
  p.update({ digest: 'a', total: 300, completed: 300 });
  assert.equal(p.completed, 900);
});

test('settings with the own runtime: only catalog models, the right kind for each slot', () => {
  const current = { ...DEFAULT_AI_SETTINGS };
  assert.throws(() => validateAiSettings({ model: 'llama3:8b' }, current, { managed: true }), {
    code: 'ai_not_in_catalog'
  });
  assert.throws(() => validateAiSettings({ model: 'bge-m3' }, current, { managed: true }), {
    code: 'ai_not_in_catalog'
  });
  assert.throws(() => validateAiSettings({ embedModel: 'qwen3.5:9b' }, current, { managed: true }), {
    code: 'ai_not_in_catalog'
  });
  assert.equal(validateAiSettings({ embedModel: 'bge-m3:latest' }, current, { managed: true }).embedModel, 'bge-m3');
  assert.equal(validateAiSettings({ model: 'ministral-3:8b' }, current, { managed: true }).model, 'ministral-3:8b');
  // A cloud model name is fine while a cloud provider is chosen.
  assert.equal(
    validateAiSettings({ provider: 'anthropic', model: 'claude-sonnet-5-5' }, current, { managed: true }).model,
    'claude-sonnet-5-5'
  );
  // Without the own runtime (development) any local name is still accepted.
  assert.equal(validateAiSettings({ model: 'llama3:8b' }, current).model, 'llama3:8b');
});

function service({ stored = {}, ready = true, totalmem = 16 * GiB } = {}) {
  let saved = { ...stored };
  const calls = [];
  const sidecar = {
    running: true,
    call: async (method, params) => {
      calls.push([method, params]);
      return method === 'task' ? { vectors: [[1]] } : {};
    },
    stop: async () => {},
    diagnostics: () => ({})
  };
  const ai = createAiService({
    settingsFile: { get: () => saved, save: async v => (saved = v) },
    vault: null,
    sidecar,
    log: { add: async () => {}, list: async () => [], clear: async () => {} },
    localRuntime: { available: true, ensure: async () => 'http://127.0.0.1:47811', diagnostics: () => ({}) },
    models: { isReady: async () => ready },
    totalmem: () => totalmem
  });
  return { ai, calls };
}

test('first start: the language model matches the memory of the computer', () => {
  assert.equal(service({ totalmem: 8 * GiB }).ai.get().model, 'qwen3.5:4b');
  assert.equal(service({ totalmem: 16 * GiB }).ai.get().model, 'qwen3.5:9b');
  assert.equal(service({ totalmem: 64 * GiB }).ai.get().model, 'qwen3.8:27b');
  assert.equal(service({ stored: { model: 'ministral-3:3b' }, totalmem: 64 * GiB }).ai.get().model, 'ministral-3:3b');
  assert.equal(service().ai.publicSettings().localRuntime, 'bundled');
});

test('tasks use the own runtime address and refuse a model that is not downloaded and verified', async () => {
  const ok = service({ stored: { enabled: true } });
  await ok.ai.run('embed', { texts: ['x'] });
  const configure = ok.calls.find(([m]) => m === 'configure')[1];
  assert.equal(configure.baseUrl, 'http://127.0.0.1:47811');
  const missing = service({ stored: { enabled: true }, ready: false });
  await assert.rejects(missing.ai.run('embed', { texts: ['x'] }), { kind: 'model_missing' });
  assert.equal(missing.calls.filter(([m]) => m === 'task').length, 0);
});

test('backup: the models and the key pair of the own Ollama stay out', () => {
  assert.ok(Object.hasOwn(NOT_BACKED_UP, 'ollama/'));
});

test('supply chain: Ollama is pinned per platform by version, size, SHA-256 and signer', async () => {
  const { LOCK, assetFor, download } = await import('../../../scripts/fetch-ollama.mjs');
  assert.match(LOCK.version, /^\d+\.\d+\.\d+$/);
  assert.equal(LOCK.license, 'MIT');
  assert.equal(LOCK.signers.darwin, '3MU9H2V9Y9');
  assert.equal(LOCK.signers.win32, 'Ollama Inc.');
  for (const [platform, arch] of [
    ['darwin', 'arm64'],
    ['win32', 'arm64'],
    ['win32', 'x64']
  ]) {
    const a = assetFor(platform, arch);
    assert.match(a.sha256, /^[0-9a-f]{64}$/);
    assert.equal(a.url, `https://github.com/ollama/ollama/releases/download/v${LOCK.version}/${a.file}`);
  }
  assert.throws(() => assetFor('darwin', 'x64'), /no pinned Ollama build/);
  const dir = tmp();
  try {
    const bytes = new TextEncoder().encode('ollama');
    const fetchImpl = async () => new Response(bytes);
    const file = path.join(dir, 'a');
    const { createHash } = await import('node:crypto');
    const sha = createHash('sha256').update(bytes).digest('hex');
    assert.deepEqual(await download('https://x', file, { expectSha256: sha, expectSize: 6, fetchImpl }), {
      sha256: sha,
      size: 6
    });
    await assert.rejects(download('https://x', file, { expectSha256: '0'.repeat(64), fetchImpl }), /sha256 mismatch/);
    await assert.rejects(download('https://x', file, { expectSize: 7, fetchImpl }), /size mismatch/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('supply chain: advisories are matched against the pinned version', async () => {
  const { compareVersions, inRange } = await import('../../../scripts/ollama/check-ollama-runtime.mjs');
  assert.ok(compareVersions('v0.40.16', '0.40.9') > 0);
  assert.equal(compareVersions('0.40.16', 'v0.40.16'), 0);
  assert.equal(inRange('0.40.16', '< 0.40.17'), true);
  assert.equal(inRange('0.40.16', '< 0.12.4'), false);
  assert.equal(inRange('0.40.16', '>= 0.40.0, < 0.40.20'), true);
  assert.equal(inRange('0.40.16', '<= 0.40.15'), false);
  assert.equal(inRange('0.40.16', ''), false);
});

test('supply chain: signed builds refuse a missing or foreign Ollama, installers ship it', async () => {
  const { ollamaRuntimeProblems } = await import('../../../scripts/release-signed.mjs');
  const { LOCK, assetFor } = await import('../../../scripts/fetch-ollama.mjs');
  const dir = tmp();
  try {
    assert.match(ollamaRuntimeProblems(dir, 'win32', 'x64')[0], /ollama-runtime\.json missing/);
    const arm = assetFor('win32', 'arm64');
    writeFileSync(
      path.join(dir, 'ollama-runtime.json'),
      JSON.stringify({ version: LOCK.version, file: arm.file, sha256: arm.sha256 })
    );
    assert.match(ollamaRuntimeProblems(dir, 'win32', 'x64').join(), /needs ollama-windows-amd64\.zip/);
    assert.match(ollamaRuntimeProblems(dir, 'win32', 'arm64').join(), /binary missing/);
    writeFileSync(path.join(dir, 'ollama.exe'), '');
    assert.deepEqual(ollamaRuntimeProblems(dir, 'win32', 'arm64'), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const read = f => readFileSync(new URL(`../../../${f}`, import.meta.url), 'utf8');
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.build.extraResources.some(r => r.from === 'build/ollama-runtime' && r.to === 'ollama'));
  assert.match(
    read('.github/workflows/build-desktop.yml'),
    /node scripts\/fetch-ollama\.mjs --arch \$\{\{ matrix\.arch \}\}/
  );
  assert.match(read('.github/workflows/supply-chain.yml'), /check-ollama-runtime\.mjs/);
  assert.match(read('.github/workflows/supply-chain.yml'), /check-catalog\.mjs/);
  assert.match(read('.github/workflows/ci.yml'), /test\/ollama-live/);
});
