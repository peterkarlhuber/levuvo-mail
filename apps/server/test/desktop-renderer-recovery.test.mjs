import test from 'node:test';
import assert from 'node:assert/strict';
import { createRendererRecovery } from '../../desktop/renderer-recovery.mjs';

test('A crashed renderer is reloaded instead of leaving a black window, with a loop guard', () => {
  let t = 0;
  const r = createRendererRecovery({ limit: 3, windowMs: 60_000, now: () => t });
  assert.equal(r.shouldReload('clean-exit'), false, 'a normal end (quit) is not a crash');
  assert.equal(r.shouldReload(undefined), false);
  assert.equal(r.shouldReload('crashed'), true);
  t += 1000;
  assert.equal(r.shouldReload('oom'), true);
  t += 1000;
  assert.equal(r.shouldReload('killed'), true);
  t += 1000;
  assert.equal(r.shouldReload('crashed'), false, 'a fourth crash within a minute stops reloading');
  t += 60_000;
  assert.equal(r.shouldReload('abnormal-exit'), true, 'after a quiet minute it reloads again');
});
