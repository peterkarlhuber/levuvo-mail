// "Update now" in Settings → Search & offline: the time shown is the last successful check (also
// when nothing was new), and the outcome of the last pass is reported per account.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createIndexRunner } from '../src/index-runner.mjs';

test('index runner reports running, the number of passes and the outcome per account', async () => {
  let release;
  const gate = new Promise(r => (release = r));
  const runner = createIndexRunner({
    accounts: () => [
      { id: 'a', imap: { configured: true } },
      { id: 'b', imap: { configured: true } }
    ],
    enabled: () => true,
    withImap: async (fn, account) => {
      if (account.id === 'b') throw Object.assign(new Error('mail text never kept'), { code: 'imap_auth' });
      return fn({ list: async () => [] });
    },
    localIndex: {
      sync: async () => {
        await gate;
        return { enabled: true, added: 0, removed: 0, complete: true };
      }
    },
    diagnostics: { record() {} }
  });
  assert.deepEqual(runner.status(), { running: false, runs: 0, accounts: {} });
  const pass = runner.run(true);
  assert.equal(runner.status().running, true);
  release();
  await pass;
  const s = runner.status();
  assert.equal(s.running, false);
  assert.equal(s.runs, 1);
  assert.equal(s.accounts.a.added, 0);
  assert.equal(s.accounts.a.error, null);
  assert.equal(s.accounts.b.error, 'imap_auth');
  assert.ok(!JSON.stringify(s).includes('mail text'));
});

test('local index: a check without changes still moves checkedAt, updatedAt stays', async t => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createLocalIndex } = await import('../src/local-index.mjs');
  const { syntheticMailbox } = await import('./helpers/synthetic-mailbox.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'lv-idx-'));
  const index = createLocalIndex({ dir, getKey: async () => Buffer.alloc(32, 7) });
  t.after(() => {
    index.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const box = syntheticMailbox(5, { textChars: 20 });
  const folders = [{ path: 'INBOX', flags: new Set() }];
  await index.sync(box, 'acc', folders);
  const first = await index.status('acc');
  assert.ok(first.checkedAt && first.updatedAt);
  await new Promise(r => setTimeout(r, 5));
  await index.sync(box, 'acc', folders);
  const second = await index.status('acc');
  assert.equal(second.updatedAt, first.updatedAt, 'nothing new: last change stays');
  assert.ok(second.checkedAt > first.checkedAt, 'but the check time moves');
});
