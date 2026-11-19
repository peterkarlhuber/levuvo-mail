// Unit tests of "Mein Tag" and the meeting preparation helpers (no browser needed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRanking, dayKey, greetingFor, localDay, shouldAutoOpen } from '../src/day-utils.ts';

test('Mein Tag: local day bounds and key', () => {
  const now = new Date(2026, 10, 20, 7, 30);
  const d = localDay(now);
  assert.equal(d.key, '2026-11-20');
  assert.equal(new Date(d.from).getTime(), new Date(2026, 10, 20).getTime());
  assert.equal(new Date(d.to).getTime(), new Date(2026, 10, 21).getTime());
  assert.equal(dayKey(new Date(2026, 0, 5)), '2026-01-05');
});

test('Mein Tag: greeting by time of day', () => {
  assert.equal(greetingFor(new Date(2026, 10, 20, 7)), 'Guten Morgen');
  assert.equal(greetingFor(new Date(2026, 10, 20, 13)), 'Guten Tag');
  assert.equal(greetingFor(new Date(2026, 10, 20, 19)), 'Guten Abend');
});

test('Mein Tag: opens by itself once a day, only when switched on and ready', () => {
  const base = { enabled: true, lastShown: '2026-11-19', today: '2026-11-20', ready: true };
  assert.equal(shouldAutoOpen(base), true);
  assert.equal(shouldAutoOpen({ ...base, lastShown: '2026-11-20' }), false);
  assert.equal(shouldAutoOpen({ ...base, enabled: false }), false);
  assert.equal(shouldAutoOpen({ ...base, ready: false }), false);
  assert.equal(shouldAutoOpen({ ...base, lastShown: null }), true);
});

test('Mein Tag: the AI ranking only reorders, never hides a mail', () => {
  const replies = [
    { accountId: 'a', uid: 1 },
    { accountId: 'a', uid: 2 },
    { accountId: 'a', uid: 3 },
    { accountId: 'b', uid: 1 }
  ];
  const out = applyRanking(replies, [
    { accountId: 'a', uid: 1, priority: 'low', needsReply: false, reason: 'Info' },
    { accountId: 'a', uid: 3, priority: 'normal', needsReply: true, reason: 'Frage an dich' },
    { accountId: 'x', uid: 9, priority: 'high', needsReply: true, reason: 'unknown' }
  ]);
  assert.deepEqual(
    out.map(r => `${r.accountId}${r.uid}`),
    ['a3', 'a2', 'b1', 'a1']
  );
  assert.equal(out[0].ai.reason, 'Frage an dich');
  assert.equal(out[1].ai, null);
});

test('Versprechen: reminder the morning after the promised day, never in the past', async () => {
  const { reminderFor } = await import('../src/day-utils.ts');
  const now = new Date(2026, 10, 19, 20, 0);
  assert.equal(reminderFor('2026-11-21', now).getTime(), new Date(2026, 10, 22, 9, 0).getTime());
  assert.equal(reminderFor(null, now).getTime(), new Date(2026, 10, 22, 9, 0).getTime());
  assert.equal(reminderFor('2026-11-10', now).getTime(), new Date(2026, 10, 20, 9, 0).getTime());
  assert.equal(reminderFor('kein Datum', now).getTime(), new Date(2026, 10, 22, 9, 0).getTime());
});
