import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectArchitectures } from '../../../scripts/verify-app-arch.mjs';

function pe(machine) {
  const b = Buffer.alloc(256);
  b.writeUInt16LE(0x5a4d, 0);
  b.writeUInt32LE(0x80, 0x3c);
  b.write('PE\0\0', 0x80, 'latin1');
  b.writeUInt16LE(machine, 0x84);
  return b;
}
test('PE/Mach-O/ELF architecture detection distinguishes x64, arm64 and ia32', () => {
  const dir = mkdtempSync(join(tmpdir(), 'arch-'));
  try {
    const f = (name, buf) => {
      writeFileSync(join(dir, name), buf);
      return join(dir, name);
    };
    assert.deepEqual(detectArchitectures(f('a.exe', pe(0x8664))), ['x64']);
    assert.deepEqual(detectArchitectures(f('b.exe', pe(0xaa64))), ['arm64']);
    assert.deepEqual(detectArchitectures(f('c.exe', pe(0x14c))), ['ia32']);
    const m = Buffer.alloc(32);
    m.writeUInt32LE(0xfeedfacf, 0);
    m.writeUInt32LE(0x0100000c, 4);
    assert.deepEqual(detectArchitectures(f('d', m)), ['arm64']);
    const elf = machine => {
      const b = Buffer.alloc(64);
      b.writeUInt32BE(0x7f454c46, 0);
      b[4] = 2;
      b[5] = 1;
      b.writeUInt16LE(machine, 18);
      return b;
    };
    assert.deepEqual(detectArchitectures(f('g', elf(0x3e))), ['x64']);
    assert.deepEqual(detectArchitectures(f('h', elf(0xb7))), ['arm64']);
    assert.deepEqual(detectArchitectures(f('e.txt', Buffer.from('hello world, no binary'))), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Release gate: only successful CI and CodeQL push runs of exactly this SHA on master count', async () => {
  const { evaluateRuns, waitForGate } = await import('../../../scripts/release-gate.mjs');
  const sha = 'a'.repeat(40);
  const run = (name, extra = {}) => ({
    id: Math.random(),
    name,
    head_sha: sha,
    head_branch: 'master',
    event: 'push',
    status: 'completed',
    conclusion: 'success',
    created_at: '2026-11-19T10:00:00Z',
    ...extra
  });
  const opts = { sha, branches: ['master'] };
  assert.equal(evaluateRuns([run('CI'), run('CodeQL')], opts).state, 'ok');
  // Missing CodeQL, PR runs, other SHAs and other branches do not count.
  assert.equal(evaluateRuns([run('CI')], opts).state, 'wait');
  assert.equal(evaluateRuns([run('CI'), run('CodeQL', { event: 'pull_request' })], opts).state, 'wait');
  assert.equal(evaluateRuns([run('CI'), run('CodeQL', { head_sha: 'b'.repeat(40) })], opts).state, 'wait');
  assert.equal(evaluateRuns([run('CI'), run('CodeQL', { head_branch: 'feature' })], opts).state, 'wait');
  // Running → wait; failed or cancelled → fail; the newest run decides (re-run after a failure).
  assert.equal(
    evaluateRuns([run('CI', { status: 'in_progress', conclusion: null }), run('CodeQL')], opts).state,
    'wait'
  );
  assert.equal(evaluateRuns([run('CI', { conclusion: 'failure' }), run('CodeQL')], opts).state, 'fail');
  assert.equal(evaluateRuns([run('CI', { conclusion: 'cancelled' }), run('CodeQL')], opts).state, 'fail');
  const rerun = [
    run('CI', { conclusion: 'failure', created_at: '2026-11-19T10:00:00Z' }),
    run('CI', { created_at: '2026-11-19T11:00:00Z' }),
    run('CodeQL')
  ];
  assert.equal(evaluateRuns(rerun, opts).state, 'ok');
  // Waiting: polls until success, gives up when no run appears in time, rejects a short SHA.
  let clock = 0;
  const base = { repo: 'o/r', sha, token: 't', log: () => {}, sleep: async ms => (clock += ms), now: () => clock };
  const answers = [[run('CI', { status: 'queued', conclusion: null })], [run('CI'), run('CodeQL')]];
  const ok = await waitForGate({ ...base, getRuns: async () => answers.shift() });
  assert.equal(ok.state, 'ok');
  clock = 0;
  const none = await waitForGate({ ...base, missingMs: 60_000, intervalMs: 30_000, getRuns: async () => [] });
  assert.equal(none.state, 'fail');
  assert.match(none.details.at(-1), /timed out/);
  await assert.rejects(waitForGate({ ...base, sha: 'abc', getRuns: async () => [] }), /full commit SHA/);
});
