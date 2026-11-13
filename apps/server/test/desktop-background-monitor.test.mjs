import test from 'node:test';
import assert from 'node:assert/strict';
import { detectNewDesktopMessages, createDesktopInboxMonitor } from '../../desktop/background-monitor.mjs';
const inbox = (uid, ids = [uid], validity = '10') => ({
  uidValidity: validity,
  highestUid: uid,
  messages: ids.map(x => ({ uid: x, unread: false }))
});
test('Start sets the baseline; a repeated check reports nothing', () => {
  const first = detectNewDesktopMessages(inbox(30), null);
  assert.equal(first.count, 0);
  assert.equal(detectNewDesktopMessages(inbox(30), first.next).count, 0);
});
test('New UID is reported regardless of read status', () => {
  const next = detectNewDesktopMessages(inbox(32, [32, 31]), { uidValidity: '10', highestUid: 30 });
  assert.equal(next.count, 2);
  assert.equal(next.reason, 'new');
});
test('UIDVALIDITY change resets the baseline without a false alarm', () => {
  assert.equal(detectNewDesktopMessages(inbox(100, [100], '11'), { uidValidity: '10', highestUid: 32 }).count, 0);
});
test('Gap in the 40-UID window produces no phantom notification', () => {
  assert.equal(detectNewDesktopMessages(inbox(50, [45]), { uidValidity: '10', highestUid: 46 }).count, 0);
});
test('Malformed mailbox status data is rejected', () => {
  assert.throws(() => detectNewDesktopMessages({ uidValidity: '?', highestUid: 0, messages: [] }, null));
});
test('Both accounts are watched separately, no duplicate on a repeated check', async () => {
  let ids = { primary: 4, account2: 9 };
  const events = [];
  const service = createDesktopInboxMonitor({
    listAccounts: async () => [
      { id: 'primary', mailbox: 'p@example.org', configured: true, label: 'Peter' },
      { id: 'account2', mailbox: 'o@example.org', configured: true, label: 'Office' }
    ],
    readInbox: async id => inbox(ids[id]),
    notify: async x => events.push(x)
  });
  await service.check();
  assert.equal(events.length, 0);
  ids = { primary: 5, account2: 10 };
  await service.check();
  await service.check();
  assert.deepEqual(
    events.map(x => x.id),
    ['primary', 'account2']
  );
  service.stop();
});
test('Temporary network error does not lead to a fake UID acknowledgement', async () => {
  let uid = 5,
    fail = false;
  const events = [];
  const service = createDesktopInboxMonitor({
    listAccounts: async () => [{ id: 'primary', mailbox: 'p@example.org', configured: true }],
    readInbox: async () => {
      if (fail) throw Error('private');
      return inbox(uid);
    },
    notify: async x => events.push(x)
  });
  await service.check();
  fail = true;
  uid = 6;
  await service.check();
  assert.equal(service.status().accounts.primary.healthy, false);
  fail = false;
  await service.check();
  assert.equal(events.length, 1);
  service.stop();
});
test('No duplicate notification after a notification error', async () => {
  let uid = 5;
  let calls = 0;
  const service = createDesktopInboxMonitor({
    listAccounts: async () => [{ id: 'primary', mailbox: 'p@example.org', configured: true }],
    readInbox: async () => inbox(uid),
    notify: async () => {
      calls++;
      throw Error('failed');
    }
  });
  await service.check();
  uid = 6;
  await service.check();
  await service.check();
  assert.equal(calls, 1);
  service.stop();
});
