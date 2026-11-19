import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createInternalApi, internalApi } from '../src/internal-api.mjs';

test('internal api: named operations build the URL, method and action header (ARC-LEV-002)', async () => {
  const calls = [];
  const api = createInternalApi(async (...args) => {
    calls.push(args);
    return { ok: true };
  });
  await api.messages('a b', { folder: 'INBOX/Sub', limit: 5 });
  await api.message('acc', 'INBOX', '42x');
  await api.searchLocal('x&y');
  await api.send('acc', { to: 'z' });
  await api.saveEvent({ title: 't' });
  assert.deepEqual(calls[0], ['GET', '/api/messages?folder=INBOX%2FSub&limit=5&account=a%20b']);
  assert.equal(calls[1][1], '/api/messages/NaN?folder=INBOX&account=acc');
  assert.deepEqual(calls[2], ['GET', '/api/search/local?q=x%26y']);
  assert.deepEqual(calls[3], ['POST', '/api/messages/send?account=acc', { to: 'z' }, 'send-v1']);
  assert.deepEqual(calls[4], ['POST', '/api/calendar/events/save', { title: 't' }, 'calendar-v1']);
});

test('internal api: one instance per app, created lazily from ctx.internalRequest', async () => {
  const seen = [];
  const ctx = { internalRequest: async (m, u) => seen.push([m, u]) };
  assert.equal(internalApi(ctx), internalApi(ctx));
  await internalApi(ctx).calendars();
  assert.deepEqual(seen, [['GET', '/api/calendar/calendars']]);
});

test('internal api: AI routes and MCP tools no longer build API URLs themselves', () => {
  for (const file of ['mcp-server.mjs', 'routes-ai.mjs']) {
    const src = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(
      src,
      /(internalRequest|\bcall)\(\s*['`](GET|POST)/,
      `${file} still builds an API request itself`
    );
  }
});
