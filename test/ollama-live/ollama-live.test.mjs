// Live test of Levuvo's own Ollama with the real, pinned binary (CI job "Own Ollama").
//   LEVUVO_OLLAMA_BIN=<fetched>/bin/ollama node --test test/ollama-live/*.test.mjs
// Without LEVUVO_OLLAMA_BIN the test is skipped locally and fails in CI.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import os from 'node:os';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { createOllamaRuntime } from '../../apps/server/src/ollama-runtime.mjs';
import { createModelManager } from '../../apps/server/src/ollama-models.mjs';
import { catalogEntry } from '../../apps/server/src/ai-model-catalog.mjs';

const bin = process.env.LEVUVO_OLLAMA_BIN;
const lock = JSON.parse(readFileSync(new URL('../../scripts/ollama/ollama-lock.json', import.meta.url), 'utf8'));
const MODEL = 'qwen3-embedding:0.6b'; // the smallest catalog model

const until = async (fn, ms) => {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error('timeout');
    await new Promise(r => setTimeout(r, 500));
  }
};
const canConnect = (host, port) =>
  new Promise(resolve => {
    const s = net.connect({ host, port, timeout: 2000 });
    s.once('connect', () => (s.destroy(), resolve(true)));
    s.once('error', () => resolve(false));
    s.once('timeout', () => (s.destroy(), resolve(false)));
  });

test(
  'own Ollama: pinned binary, private folders, loopback only, cloud off, verified download',
  {
    skip: !bin && !process.env.CI && 'LEVUVO_OLLAMA_BIN not set'
  },
  async () => {
    assert.ok(bin && existsSync(bin), 'LEVUVO_OLLAMA_BIN must point at the fetched binary');
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'lv-ollama-live-'));
    const runtime = createOllamaRuntime({ dataDir, env: { PATH: process.env.PATH, LEVUVO_OLLAMA_BIN: bin } });
    try {
      const url = await runtime.ensure();
      const port = Number(new URL(url).port);
      assert.notEqual(port, 11434, 'never the default port of a user-installed Ollama');
      assert.equal(runtime.diagnostics().version, lock.version);
      // Its key pair is in the private home, not in the user's ~/.ollama.
      await until(() => existsSync(path.join(dataDir, 'ollama', 'home', '.ollama', 'id_ed25519')), 10_000);
      // Bound to 127.0.0.1 only: not reachable on any other address of this machine.
      const external = Object.values(os.networkInterfaces())
        .flat()
        .filter(a => a && !a.internal && a.family === 'IPv4')
        .map(a => a.address);
      for (const ip of external) assert.equal(await canConnect(ip, port), false, `reachable on ${ip}`);
      // Ollama's cloud models are switched off.
      const cloud = await fetch(`${url}/api/chat`, {
        method: 'POST',
        body: JSON.stringify({
          model: 'gpt-oss:120b-cloud',
          messages: [{ role: 'user', content: 'hi' }],
          stream: false
        })
      });
      assert.ok(cloud.status >= 400, `cloud model answered ${cloud.status}`);

      // A download whose digest differs from the pin is refused and removed again.
      const entry = catalogEntry(MODEL);
      const wrong = createModelManager({ runtime, catalog: [{ ...entry, digest: `sha256:${'0'.repeat(64)}` }] });
      await wrong.download(MODEL);
      await until(async () => ['error', 'done'].includes(wrong.jobs.get(MODEL)?.status), 600_000);
      assert.equal(wrong.jobs.get(MODEL).status, 'error');
      assert.equal(wrong.jobs.get(MODEL).error, 'checksum');
      const tags = await (await fetch(`${url}/api/tags`)).json();
      assert.equal(tags.models.length, 0, 'the unverified model was deleted');

      // The real pin: downloaded, verified, usable, deletable.
      const models = createModelManager({ runtime });
      await models.download(MODEL);
      await until(async () => ['error', 'done'].includes(models.jobs.get(MODEL)?.status), 600_000);
      assert.equal(models.jobs.get(MODEL).status, 'done', `download ended with ${models.jobs.get(MODEL).error}`);
      assert.equal(await models.isReady(MODEL), true);
      const res = await fetch(`${url}/api/embed`, {
        method: 'POST',
        body: JSON.stringify({ model: MODEL, input: ['Rechnung für Oktober'] })
      });
      const { embeddings } = await res.json();
      assert.equal(embeddings[0].length, 1024);
      assert.ok(existsSync(path.join(dataDir, 'ollama', 'models', 'blobs')), 'models in the app data folder');
      await models.remove(MODEL);
      assert.equal(await models.isReady(MODEL), false);

      await runtime.stop();
      assert.equal(await canConnect('127.0.0.1', port), false, 'stopped with the app');
    } finally {
      await runtime.stop();
      rmSync(dataDir, { recursive: true, force: true });
    }
  }
);
