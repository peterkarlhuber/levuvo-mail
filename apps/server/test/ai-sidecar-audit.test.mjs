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
