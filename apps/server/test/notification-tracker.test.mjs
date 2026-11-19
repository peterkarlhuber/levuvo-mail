import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
// Imported unconditionally: a missing module must fail the run, never skip the tests (QA-LEV-012).
const ts = await import('typescript');
const source = await readFile(new URL('../../web/src/notification-tracker.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
}).outputText;
const tracker = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const snapshot = (highestUid, messages = [], uidValidity = '10') => ({ highestUid, uidValidity, messages });
const cursor = (lastUid, uidValidity = '10', accountKey = 'primary:k') => ({
  version: 1,
  lastUid,
  uidValidity,
  accountKey,
  updatedAt: 1
});

test('First call builds the baseline without retroactive notifications', () => {
  const result = tracker.detectArrivals('primary:k', snapshot(20, [{ uid: 20, unread: true }]), null, 123);
  assert.equal(result.reason, 'baseline');
  assert.equal(result.newCount, 0);
  assert.equal(result.next.lastUid, 20);
});
test('New email that is already read is still detected', () => {
  const result = tracker.detectArrivals(
    'primary:k',
    snapshot(23, [
      { uid: 21, unread: false },
      { uid: 22, unread: true },
      { uid: 23, unread: false }
    ]),
    cursor(20),
    123
  );
  assert.equal(result.reason, 'new');
  assert.equal(result.newCount, 3);
});
test('Repeated query of the same UID produces no second notification', () => {
  const first = tracker.detectArrivals('primary:k', snapshot(25, [{ uid: 25, unread: true }]), cursor(20), 123);
  const second = tracker.detectArrivals('primary:k', snapshot(25, [{ uid: 25, unread: true }]), first.next, 124);
  assert.equal(first.newCount, 1);
  assert.equal(second.reason, 'unchanged');
  assert.equal(second.newCount, 0);
});
test('UIDVALIDITY change resets the baseline without a false alarm', () => {
  const result = tracker.detectArrivals(
    'primary:k',
    snapshot(400, [{ uid: 400, unread: true }], '11'),
    cursor(20),
    123
  );
  assert.equal(result.reason, 'uidvalidity-reset');
  assert.equal(result.newCount, 0);
});
test('Account switch is not mixed with an old cursor', () => {
  const result = tracker.detectArrivals('office:x', snapshot(400, [{ uid: 400, unread: true }]), cursor(20), 123);
  assert.equal(result.reason, 'baseline');
  assert.notEqual(
    tracker.accountMarkerKey('primary', 'peter@levuvo.at'),
    tracker.accountMarkerKey('account2', 'office@levuvo.at')
  );
});
test('UIDNEXT progress without an existing new message is no false alarm', () => {
  const result = tracker.detectArrivals('primary:k', snapshot(40, [{ uid: 19, unread: false }]), cursor(20), 123);
  assert.equal(result.reason, 'outside-window');
  assert.equal(result.newCount, 0);
  assert.equal(result.next.lastUid, 40);
});
test('Regressed or invalid status triggers no notification', () => {
  const result = tracker.detectArrivals('primary:k', snapshot(10, [{ uid: 10, unread: true }]), cursor(20), 123);
  assert.equal(result.reason, 'uid-regression');
  assert.equal(result.newCount, 0);
  assert.throws(() => tracker.detectArrivals('primary:k', snapshot(-1), cursor(20), 123), /ungültig/);
});
