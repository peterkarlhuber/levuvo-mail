import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJsonFile, createMailServer } from '../src/app.mjs';
import { createPrivacyStats, privacyOverview, pruneDays, STATS_DAYS } from '../src/privacy-stats.mjs';

const tmp = t => {
  const dir = mkdtempSync(join(tmpdir(), 'lv-privacy-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('Privacy cockpit: only known counters, per day, 30 days, nothing else is stored', async t => {
  const dir = tmp(t);
  let now = new Date('2026-11-19T10:00:00Z');
  const file = await createJsonFile(join(dir, 'privacy-stats.json'), { days: {} });
  const stats = createPrivacyStats(file, { now: () => now });
  await stats.add({ trackers: 3, remoteImages: 1, subject: 'Geheim', email: 'a@b.test' });
  await stats.add({ trackers: 2, unsubscribeOneClick: 1, trackersHost: 'x' });
  await stats.add({ trackers: -5, remoteImages: 'viel' });
  await stats.add({ trackers: 10_000 });
  const saved = JSON.parse(readFileSync(join(dir, 'privacy-stats.json'), 'utf8'));
  assert.deepEqual(saved, {
    days: { '2026-11-19': { trackers: 505, remoteImages: 1, unsubscribeOneClick: 1 } }
  });
  now = new Date(now.getTime() + STATS_DAYS * 86400_000);
  assert.deepEqual(stats.days(), {}, 'older than 30 days is dropped');
  await stats.sweep();
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'privacy-stats.json'), 'utf8')), { days: {} });
  assert.deepEqual(pruneDays({ 'not-a-day': { trackers: 1 }, '2026-12-19': { other: 4, trackers: 1.5 } }, now), {});
});

test('Privacy cockpit: AI log is grouped by function, local vs cloud, agents and downloads', () => {
  const at = '2026-11-19T09:00:00.000Z';
  const entries = [
    { at, type: 'task', kind: 'digest', provider: 'ollama', source: 'user', ok: true },
    { at, type: 'task', kind: 'digest', provider: 'anthropic', source: 'user', ok: true },
    { at, type: 'task', kind: 'classify', provider: 'ollama', source: 'bundles', ok: true },
    { at, type: 'task', kind: 'dictate', provider: 'local', ok: true },
    { at, type: 'task', kind: 'reply', provider: 'openai', ok: false, error: 'network' },
    { at, type: 'agent', provider: 'ollama', source: 'routine', ok: true },
    { at, type: 'tool', agent: 'Claude Desktop', tool: 'search_mail', ok: true },
    { at, type: 'tool', agent: 'Claude Desktop', tool: 'send_mail', ok: false },
    { at, type: 'index', kind: 'embed', count: 40 },
    { at, type: 'model_download', model: 'qwen3.5:4b' },
    { at, type: 'settings', enabled: true }
  ];
  const o = privacyOverview({ '2026-11-19': { trackers: 4 } }, entries, { now: new Date('2026-11-19T12:00:00Z') });
  assert.equal(o.blocked.trackers, 4);
  assert.equal(o.blocked.perDay.length, STATS_DAYS);
  assert.deepEqual(o.blocked.perDay.at(-1), { day: '2026-11-19', trackers: 4 });
  assert.equal(o.ai.local, 4);
  assert.equal(o.ai.cloud, 1);
  assert.equal(o.ai.failed, 1);
  assert.deepEqual(o.ai.providers, { anthropic: 1 });
  assert.deepEqual(o.ai.kinds.digest, { local: 1, cloud: 1, sources: { user: 2 } });
  assert.equal(o.ai.kinds.dictate.local, 1);
  assert.equal(o.ai.kinds.agent.local, 1);
  assert.equal(o.ai.indexRuns, 1);
  assert.deepEqual(o.agents, [
    { name: 'Claude Desktop', calls: 1, denied: 1, tools: { search_mail: 1, send_mail: 1 }, lastAt: at }
  ]);
  assert.deepEqual(o.downloads, [{ at, kind: 'model', model: 'qwen3.5:4b' }]);
  assert.ok(o.recent.every(r => !('error' in r)));
});

test('Privacy cockpit routes: counters need the action header, overview and clear work', async t => {
  const dir = tmp(t);
  writeFileSync(join(dir, 'accounts.json'), JSON.stringify({ version: 1, accounts: [] }));
  const SECRET = 'f'.repeat(64);
  const HOST = '127.0.0.1:4795';
  const GET = { host: HOST, cookie: `levuvo_desktop_session=${SECRET}` };
  const POST = { ...GET, origin: `http://${HOST}`, 'content-type': 'application/json', 'x-levuvo-action': 'mail-v1' };
  const m = new Map();
  const s = await createMailServer({
    desktop: true,
    sessionSecret: SECRET,
    vault: {
      available: true,
      get: (i, k) => m.get(`${i}:${k}`) || '',
      set: (i, k, v) => m.set(`${i}:${k}`, v),
      delete: (i, k) => m.delete(`${i}:${k}`)
    },
    dataDir: dir,
    accountsFile: join(dir, 'accounts.json'),
    watch: false,
    background: false
  });
  s.setPortForTesting(4795);
  t.after(() => s.close());
  const noAction = await s.api.inject({
    method: 'POST',
    url: '/api/privacy/events',
    headers: { ...POST, 'x-levuvo-action': 'other' },
    payload: { trackers: 2 }
  });
  assert.equal(noAction.statusCode, 403, noAction.body);
  const bad = await s.api.inject({
    method: 'POST',
    url: '/api/privacy/events',
    headers: POST,
    payload: { trackers: 9999 }
  });
  assert.equal(bad.statusCode, 400);
  const ok = await s.api.inject({
    method: 'POST',
    url: '/api/privacy/events',
    headers: POST,
    payload: { trackers: 2, remoteImages: 1 }
  });
  assert.equal(ok.statusCode, 200);
  const overview = (await s.api.inject({ method: 'GET', url: '/api/privacy/overview', headers: GET })).json();
  assert.equal(overview.blocked.trackers, 2);
  assert.equal(overview.remoteImages, 1);
  const cleared = await s.api.inject({ method: 'POST', url: '/api/privacy/clear', headers: POST, payload: {} });
  assert.equal(cleared.statusCode, 200);
  const after = (await s.api.inject({ method: 'GET', url: '/api/privacy/overview', headers: GET })).json();
  assert.equal(after.blocked.trackers, 0);
});
