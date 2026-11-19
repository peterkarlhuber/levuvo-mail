// Regression tests for the AI sidecar findings of the internal audit of 19 November 2026.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isOllamaCloudModel } from '../src/ai-service.mjs';

test('Ollama cloud models (":cloud" and "-cloud" tags) are never accepted as local models', () => {
  for (const name of ['gpt-oss:120b-cloud', 'qwen3-coder:480b-cloud', 'kimi:cloud', ' deepseek-v3.1:671B-CLOUD '])
    assert.equal(isOllamaCloudModel(name), true, name);
  for (const name of ['qwen3.5:9b', 'bge-m3', 'qwen3-embedding:0.6b', 'cloudy:7b', 'claude-sonnet-5-5', ''])
    assert.equal(isOllamaCloudModel(name), false, name);
});

test('the error kinds of the sidecar are one documented list', () => {
  const kinds = JSON.parse(readFileSync(new URL('../../ai/levuvo_ai/error_kinds.json', import.meta.url), 'utf8'));
  assert.ok(kinds.sidecar.includes('unavailable') && kinds.sidecar.includes('unsupported'));
  const sidecar = readFileSync(new URL('../src/ai-sidecar.mjs', import.meta.url), 'utf8');
  const service = readFileSync(new URL('../src/ai-service.mjs', import.meta.url), 'utf8');
  const raised = new Set([...(sidecar + service).matchAll(/SidecarError\('([a-z_]+)'/g)].map(m => m[1]));
  for (const kind of raised) assert.ok(kinds.server.includes(kind), `${kind} missing in error_kinds.json`);
});

test('REL-LEV-004: timed-out requests that would fill every worker restart the sidecar', async () => {
  const { fileURLToPath } = await import('node:url');
  const { createSidecar } = await import('../src/ai-sidecar.mjs');
  const fake = fileURLToPath(new URL('./fixtures/fake-sidecar.mjs', import.meta.url));
  let spawned = 0;
  const logs = [];
  const sidecar = createSidecar({
    resolve: () => {
      spawned++;
      return { command: process.execPath, args: [fake], cwd: process.cwd(), pythonPath: '' };
    },
    env: { PATH: process.env.PATH },
    timeoutMs: 150,
    logger: m => logs.push(m)
  });
  try {
    // A late answer frees its worker: three slow-but-finishing requests never trigger a restart.
    for (let i = 0; i < 3; i++) await assert.rejects(sidecar.call('delay', { ms: 200 }), err => err.kind === 'timeout');
    await new Promise(resolve => setTimeout(resolve, 150));
    await assert.rejects(sidecar.call('delay', { ms: 200 }), err => err.kind === 'timeout');
    assert.equal(spawned, 1, 'answered late: no restart');
    // Four requests that never come back occupy every Python worker: the process is replaced.
    await Promise.all(
      Array.from({ length: 4 }, () => assert.rejects(sidecar.call('slow'), err => err.kind === 'timeout'))
    );
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(logs.some(m => /restarting/.test(m)));
    assert.equal((await sidecar.call('again')).method, 'again');
    assert.equal(spawned, 2, 'a fresh process takes new work');
  } finally {
    await sidecar.stop();
  }
});

test('PERF-LEV-007: messages for an AI function load a few at a time, in order', async () => {
  const { mapLimit } = await import('../src/routes-ai.mjs');
  let active = 0;
  let peak = 0;
  const out = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8], 3, async n => {
    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 10 - n));
    active--;
    return n * 10;
  });
  assert.deepEqual(out, [10, 20, 30, 40, 50, 60, 70, 80]);
  assert.equal(peak, 3);
  await assert.rejects(
    mapLimit([1, 2], 3, async n => {
      if (n === 2) throw new Error('imap');
      return n;
    }),
    /imap/
  );
});
