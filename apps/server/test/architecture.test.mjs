// Structural checks of the server modules (ARC-LEV-001 of the internal audit of 19 November 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = resolve(dirname(fileURLToPath(import.meta.url)), '../src');

/** Static relative imports and re-exports of every server module. */
function importGraph() {
  const graph = new Map();
  for (const file of readdirSync(src, { recursive: true }).filter(f => f.endsWith('.mjs'))) {
    const path = join(src, file);
    const code = readFileSync(path, 'utf8');
    const deps = [...code.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+'(\.[^']+)'/gm)].map(m =>
      resolve(dirname(path), m[1])
    );
    graph.set(path, deps);
  }
  return graph;
}

test('server modules have no import cycles', () => {
  const graph = importGraph();
  assert.ok(graph.size > 50);
  const cycles = [];
  const state = new Map();
  const stack = [];
  const visit = node => {
    state.set(node, 'open');
    stack.push(node);
    for (const dep of graph.get(node) || []) {
      if (state.get(dep) === 'open')
        cycles.push([...stack.slice(stack.indexOf(dep)), dep].map(p => p.slice(src.length + 1)).join(' -> '));
      else if (!state.has(dep)) visit(dep);
    }
    stack.pop();
    state.set(node, 'done');
  };
  for (const node of graph.keys()) if (!state.has(node)) visit(node);
  assert.deepEqual(cycles, []);
});

test('the AI/agent payload mappers depend on no route or protocol module', () => {
  const deps = importGraph().get(join(src, 'ai-payloads.mjs'));
  assert.deepEqual(
    deps.map(d => d.slice(src.length + 1)),
    ['html-mail.mjs']
  );
});

test('ARC-LEV-009: background jobs run only after start, never overlap and stop with close', async () => {
  const { createBackgroundJobs } = await import('../src/background-jobs.mjs');
  const logs = [];
  const jobs = createBackgroundJobs({ logger: m => logs.push(m) });
  let runs = 0;
  let release;
  jobs.register(
    'slow',
    () =>
      new Promise(resolve => {
        runs++;
        release = resolve;
      }),
    { every: 10, firstDelay: 5 }
  );
  jobs.register(
    'broken',
    () => {
      throw new Error('boom');
    },
    { every: 1000, firstDelay: 1 }
  );
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(runs, 0, 'registering starts nothing');
  jobs.start();
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(runs, 1, 'a busy job skips its turns');
  assert.ok(
    logs.some(m => /broken failed: boom/.test(m)),
    'a failing job is logged, not thrown'
  );
  release();
  jobs.stop();
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(runs, 1, 'nothing runs after stop');
  assert.deepEqual(jobs.names, ['slow', 'broken']);
});

test('ARC-LEV-009: the AI routes register their timers with the app instead of starting them', () => {
  const routes = readFileSync(join(src, 'routes-ai.mjs'), 'utf8');
  const service = readFileSync(join(src, 'ai-service.mjs'), 'utf8');
  assert.doesNotMatch(routes, /setInterval|setTimeout\(\(\) => void syncAll/);
  assert.doesNotMatch(service, /setInterval/);
  assert.match(routes, /ctx\.jobs\?\.register\('semantic-index'/);
});
