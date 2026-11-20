import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { folderBytes, registerStorageRoutes, storageFolders } from '../src/routes-storage.mjs';

function fakeApi() {
  const routes = {};
  return {
    routes,
    get: (p, h) => (routes[`GET ${p}`] = h),
    post: (p, _o, h) => (routes[`POST ${p}`] = h)
  };
}
const reply = () => {
  const r = { statusCode: 200, body: null };
  r.code = c => ((r.statusCode = c), r);
  r.send = b => ((r.body = b), r);
  return r;
};

test('storage: lists the data folders with their sizes and opens only known folders', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'lv-store-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'ollama', 'models', 'blobs'), { recursive: true });
  writeFileSync(join(dir, 'ollama', 'models', 'blobs', 'a'), Buffer.alloc(1500));
  writeFileSync(join(dir, 'ai.json'), '{}');
  assert.equal(await folderBytes(join(dir, 'ollama', 'models')), 1500);
  assert.equal(await folderBytes(join(dir, 'missing')), null);
  assert.deepEqual(
    storageFolders(dir).map(f => f.id),
    ['data', 'models', 'index', 'spaces', 'restore']
  );

  const api = fakeApi();
  const opened = [];
  registerStorageRoutes({ api, requireAction: () => true }, { dir, openFolder: async p => opened.push(p) });
  const list = await api.routes['GET /api/storage']();
  assert.equal(list.canOpen, true);
  const models = list.folders.find(f => f.id === 'models');
  assert.equal(models.bytes, 1500);
  assert.equal(list.folders.find(f => f.id === 'data').bytes, 1502);
  assert.equal(list.folders.find(f => f.id === 'index').exists, false);

  await api.routes['POST /api/storage/open']({ body: { id: 'models' } }, reply());
  // A missing folder opens the data folder instead; unknown ids and paths are refused.
  await api.routes['POST /api/storage/open']({ body: { id: 'index' } }, reply());
  const bad = reply();
  await api.routes['POST /api/storage/open']({ body: { id: '/etc' } }, bad);
  assert.equal(bad.statusCode, 404);
  assert.deepEqual(opened, [join(dir, 'ollama', 'models'), dir]);

  const browser = fakeApi();
  registerStorageRoutes({ api: browser, requireAction: () => true }, { dir });
  const r = reply();
  await browser.routes['POST /api/storage/open']({ body: { id: 'data' } }, r);
  assert.equal(r.statusCode, 409);
});
