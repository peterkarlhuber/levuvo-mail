#!/usr/bin/env node
// Synthetic 100k-message benchmark for folder paging, IMAP search and the local index (AUD-011).
// Uses generated test data only. Prints measured values as JSON and exits with 1 when an upper
// bound is exceeded. Bounds are deliberately generous so slow CI runners pass; the transfer
// bounds (UIDs and bytes per page) are exact properties of the algorithm, not timing.
//
//   node scripts/bench-large-mailbox.mjs [--messages 100000] [--index 25000] [--json out.json]
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { listMessages, searchFolder } from '../apps/server/src/mailbox.mjs';
import { createLocalIndex } from '../apps/server/src/local-index.mjs';
import { syntheticMailbox } from '../apps/server/test/helpers/synthetic-mailbox.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const MESSAGES = Number(option('messages', 100_000));
const INDEXED = Number(option('index', 25_000));
const PAGE = 40;

// Upper bounds (ms, counts, bytes). Timings are per operation against an in-process fake server,
// so they measure Levuvo's own CPU work, not network latency.
const BOUNDS = {
  pageMs: 250,
  pageSearchUids: 4 * PAGE,
  pageBytes: 64 * 1024,
  imapSearchNextPageUidsRatio: 1,
  indexFullSyncMs: 60_000,
  indexIdleSyncMs: 2_000,
  indexIdleSearchUids: 0,
  indexSearchMs: 400,
  heapMb: 1_024
};

const time = async fn => {
  const start = performance.now();
  const value = await fn();
  return { value, ms: Math.round((performance.now() - start) * 10) / 10 };
};

const results = { messages: MESSAGES, indexed: INDEXED, page: PAGE, node: process.version };
const failures = [];
const check = (name, value, bound) => {
  results[name] = value;
  if (value > bound) failures.push(`${name}: ${value} > ${bound}`);
};

// ---------------------------------------------------------------- folder paging
const box = syntheticMailbox(MESSAGES, { textChars: 400, gapEvery: 7 });
{
  const first = await time(() => listMessages(box, 'INBOX', { limit: PAGE }));
  results.firstPageMs = first.ms;
  let worstMs = 0;
  let worstUids = 0;
  let worstBytes = 0;
  const cursors = [first.value.nextBeforeUid, Math.floor(box.mailbox.uidNext / 2), 200];
  for (const beforeUid of cursors) {
    box.resetStats();
    const page = await time(() => listMessages(box, 'INBOX', { limit: PAGE, beforeUid }));
    worstMs = Math.max(worstMs, page.ms);
    worstUids = Math.max(worstUids, box.stats.searchUids);
    worstBytes = Math.max(worstBytes, box.stats.bytes);
  }
  // What a page cost before windowing: SEARCH UID 1:cursor-1 returned every older UID.
  box.resetStats();
  await box.search({ uid: `1:${cursors[1] - 1}` });
  results.previousPageSearchUids = box.stats.searchUids;
  check('pageMs', worstMs, BOUNDS.pageMs);
  check('pageSearchUids', worstUids, BOUNDS.pageSearchUids);
  check('pageBytes', worstBytes, BOUNDS.pageBytes);
}

// ---------------------------------------------------------------- IMAP search paging
{
  const first = await time(() => searchFolder(box, 'INBOX', 'Rechnung', { limit: PAGE }));
  results.imapSearchFirstPageMs = first.ms;
  box.resetStats();
  const middle = Math.floor(box.mailbox.uidNext / 2);
  await searchFolder(box, 'INBOX', 'Rechnung', { limit: PAGE, beforeUid: middle });
  const ratio = Math.round((box.stats.searchUids / first.value.total) * 100) / 100;
  check('imapSearchNextPageUidsRatio', ratio, BOUNDS.imapSearchNextPageUidsRatio);
}

// ---------------------------------------------------------------- local index
const dir = mkdtempSync(join(tmpdir(), 'lv-bench-'));
try {
  const key = randomBytes(32);
  const index = createLocalIndex({ dir, getKey: async () => key, maxPerAccount: INDEXED });
  const folders = [{ path: 'INBOX', flags: new Set() }];
  const full = await time(async () => {
    let total;
    for (;;) {
      const run = await index.sync(box, 'bench', folders, { budget: 5_000 });
      total = run.total;
      if (!run.added) break;
    }
    return total;
  });
  results.indexMessages = full.value;
  check('indexFullSyncMs', Math.round(full.ms), BOUNDS.indexFullSyncMs);
  results.indexFileBytes = (await index.status('bench')).bytes;

  box.resetStats();
  const idle = await time(() => index.sync(box, 'bench', folders));
  check('indexIdleSyncMs', idle.ms, BOUNDS.indexIdleSyncMs);
  check('indexIdleSearchUids', box.stats.searchUids, BOUNDS.indexIdleSearchUids);

  // Cold search builds the normalized texts once; later searches reuse them.
  const cold = await time(() => index.searchPage(['bench'], 'rechnung projekt', { limit: PAGE }));
  results.indexSearchColdMs = cold.ms;
  results.indexSearchHits = cold.value.total;
  let worst = 0;
  for (const q of ['rechnung', 'angebot 17', 'absender 12', 'nichtvorhanden']) {
    const run = await time(() => index.searchPage(['bench'], q, { limit: PAGE }));
    worst = Math.max(worst, run.ms);
  }
  const paged = await time(() => index.searchPage(['bench'], 'rechnung', { limit: PAGE, cursor: '400' }));
  worst = Math.max(worst, paged.ms);
  check('indexSearchMs', worst, BOUNDS.indexSearchMs);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

check('heapMb', Math.round(process.memoryUsage().heapUsed / 1024 / 1024), BOUNDS.heapMb);
results.bounds = BOUNDS;
results.ok = failures.length === 0;

const out = option('json', null);
if (out) writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));
if (failures.length) {
  console.error(`Upper bounds exceeded:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
