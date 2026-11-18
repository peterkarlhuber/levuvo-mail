import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFollowupStore,
  findSnoozeFolder,
  locateSnoozed,
  messageIdOf,
  snoozeMessages,
  validateWhen,
  wakeMessage
} from '../src/followups.mjs';
import { parseIds, threadFolders } from '../src/thread.mjs';
import { createMailStore } from './helpers/fake-mailstore.mjs';

const memoryFile = init => {
  let v = init;
  return {
    get: () => v,
    save: async next => {
      v = next;
    }
  };
};
const folders = [
  { path: 'INBOX', delimiter: '.', specialUse: '\\Inbox' },
  { path: 'INBOX.Sent', delimiter: '.', specialUse: '\\Sent' },
  { path: 'INBOX.Archiv', delimiter: '.', specialUse: '\\Archive' },
  { path: 'INBOX.Projekte', delimiter: '.' }
];

test('Times: in the future, at most one year', () => {
  const now = Date.parse('2026-11-13T10:00:00Z');
  assert.equal(validateWhen('2026-11-14T08:00:00Z', now), '2026-11-14T08:00:00.000Z');
  assert.throws(() => validateWhen('2026-11-13T10:00:30Z', now), /Zukunft/);
  assert.throws(() => validateWhen('2028-01-01T00:00:00Z', now), /ein Jahr/);
  assert.throws(() => validateWhen('morgen', now), /Ungültiger/);
});

test('Message-ID from the sent message, identifiers from References', () => {
  const raw = Buffer.from(
    'From: a@b.at\r\nMessage-ID: <abc.123@levuvo.test>\r\nSubject: x\r\n\r\nMessage-ID: <falsch@body>'
  );
  assert.equal(messageIdOf(raw), '<abc.123@levuvo.test>');
  assert.deepEqual(parseIds('<a@x> <b@y>\r\n <a@x>'), ['<a@x>', '<b@y>']);
});

test('Conversation searches the current folder, inbox, Sent and Archive', () => {
  assert.deepEqual(
    threadFolders(folders, 'INBOX.Projekte').map(f => f.path),
    ['INBOX.Projekte', 'INBOX', 'INBOX.Sent', 'INBOX.Archiv']
  );
  assert.equal(
    findSnoozeFolder([...folders, { path: 'INBOX.Zurückgestellt', delimiter: '.' }]).path,
    'INBOX.Zurückgestellt'
  );
});

function fakeImap() {
  const calls = [];
  const boxes = {
    INBOX: [{ uid: 5, envelope: { messageId: '<m5@x>', subject: 'Angebot', from: [{ address: 'kunde@x.at' }] } }],
    'INBOX.Sent': [],
    'INBOX.Zurückgestellt': []
  };
  let selected = 'INBOX';
  return {
    calls,
    boxes,
    capabilities: new Map([['MOVE', true]]),
    mailbox: { uidValidity: 77n },
    list: async () =>
      Object.keys(boxes).map(path => ({ path, delimiter: '.', specialUse: path === 'INBOX' ? '\\Inbox' : null })),
    mailboxCreate: async path => {
      boxes[path] = [];
      calls.push(['create', path]);
    },
    getMailboxLock: async path => {
      selected = path;
      return { release() {} };
    },
    async *fetch(set) {
      for (const m of boxes[selected]) if (String(set).split(',').includes(String(m.uid))) yield m;
    },
    search: async q => boxes[selected].filter(m => m.envelope.messageId === q.header['message-id']).map(m => m.uid),
    messageFlagsRemove: async (uid, flags) => {
      calls.push(['unseen', uid, flags]);
      return true;
    },
    messageMove: async (set, target) => {
      const uids = String(set).split(',').map(Number);
      const moving = boxes[selected].filter(m => uids.includes(m.uid));
      boxes[selected] = boxes[selected].filter(m => !uids.includes(m.uid));
      const map = new Map();
      for (const m of moving) {
        const uid = 900 + m.uid;
        map.set(m.uid, uid);
        boxes[target].push({ ...m, uid });
      }
      calls.push(['move', set, target]);
      return { destination: target, uidMap: map, uidValidity: 77n };
    }
  };
}

test('Snooze: folder is created when needed, message comes back unread', async () => {
  const client = fakeImap();
  delete client.boxes['INBOX.Zurückgestellt'];
  const result = await snoozeMessages(client, { folder: 'INBOX', uids: ['5'] });
  assert.equal(result.folder, 'INBOX.Zurückgestellt');
  assert.deepEqual(result.items[0], {
    uid: '5',
    messageId: '<m5@x>',
    subject: 'Angebot',
    from: 'kunde@x.at',
    print: null,
    snoozeUid: '905'
  });
  const store = createFollowupStore(memoryFile({ snoozed: [], followups: [] }));
  const [entry] = await store.addSnoozed('acc', 'INBOX', result, '2026-11-14T08:00:00.000Z');
  assert.equal(store.snoozed('acc').length, 1);
  const woke = await wakeMessage(client, entry);
  assert.deepEqual(woke, { woke: true, folder: 'INBOX' });
  assert.ok(client.calls.some(c => c[0] === 'unseen'));
  assert.equal(client.boxes.INBOX.length, 1);
  await store.removeSnoozed(entry.id);
  assert.equal(store.snoozed().length, 0);
});

test('Follow-up: create entries, mark due, delete when the account is removed', async () => {
  const store = createFollowupStore(memoryFile({}));
  const f = await store.addFollowup({
    accountId: 'a',
    messageId: '<x@y>',
    subject: 'Angebot',
    to: ['k@x.at'],
    due: '2026-11-16T09:00:00.000Z'
  });
  assert.equal(f.state, 'waiting');
  await store.updateFollowup(f.id, { state: 'due' });
  assert.equal(store.followups('a')[0].state, 'due');
  await store.forgetAccount('a');
  assert.deepEqual(store.followups(), []);
});

const plainMail = subject => `From: Kunde <kunde@x.at>\r\nTo: me@x.at\r\nSubject: ${subject}\r\n\r\nText\r\n`;

test('Snooze: without COPYUID and Message-ID the message still comes back (AUD-005)', async () => {
  const mail = createMailStore({ folders: ['INBOX', 'Trash'] });
  mail.add('INBOX', plainMail('Ohne Kennung'));
  const client = mail.client({ capabilities: ['MOVE'] }); // no UIDPLUS: MOVE reports no new UID
  const result = await snoozeMessages(client, { folder: 'INBOX', uids: ['1'] });
  assert.equal(result.items[0].snoozeUid, null);
  assert.equal(result.items[0].messageId, null);
  const store = createFollowupStore(memoryFile({ snoozed: [], followups: [] }));
  const [entry] = await store.addSnoozed('acc', 'INBOX', result, '2026-11-14T08:00:00.000Z');
  // Another message lands in the snooze folder meanwhile.
  mail.add(result.folder, plainMail('Etwas anderes'));
  assert.deepEqual(await wakeMessage(client, entry), { woke: true, folder: 'INBOX' });
  assert.equal(mail.messages('INBOX')[0].source.toString().includes('Ohne Kennung'), true);
  // Two indistinguishable candidates: reported as missing instead of guessing.
  const twin = createMailStore({ folders: ['INBOX', 'Zurückgestellt'] });
  twin.add('INBOX', plainMail('Gleich'));
  const c2 = twin.client({ capabilities: ['MOVE'] });
  const r2 = await snoozeMessages(c2, { folder: 'INBOX', uids: ['1'] });
  twin.add('Zurückgestellt', plainMail('Gleich'));
  const [e2] = await store.addSnoozed('acc', 'INBOX', r2, '2026-11-14T08:00:00.000Z');
  assert.deepEqual(await wakeMessage(c2, e2), { woke: false, reason: 'message_missing' });
  assert.equal(twin.messages('Zurückgestellt').length, 2, 'nothing was moved by guessing');
});

test('Snooze: tracking is written before the MOVE and a crash in between is recoverable (AUD-006)', async () => {
  const mail = createMailStore({ folders: ['INBOX', 'Zurückgestellt'] });
  mail.add('INBOX', plainMail('Wichtig'));
  const client = mail.client();
  const store = createFollowupStore(memoryFile({ snoozed: [], followups: [] }));
  let pending;
  const result = await snoozeMessages(client, {
    folder: 'INBOX',
    uids: ['1'],
    beforeMove: async plan => {
      assert.equal(mail.messages('INBOX').length, 1, 'journal entry comes first');
      pending = await store.addSnoozed('acc', 'INBOX', plan, '2026-11-20T08:00:00.000Z', { state: 'pending' });
    }
  });
  // Crash here: the MOVE happened, finishSnoozed() never ran.
  assert.equal(store.snoozed('acc')[0].state, 'pending');
  const found = await locateSnoozed(client, store.snoozed('acc')[0]);
  assert.equal(found.where, 'snoozed');
  await store.updateSnoozed(pending[0].id, { state: 'snoozed', snoozeUid: found.uid, uidValidity: found.uidValidity });
  assert.deepEqual(await wakeMessage(client, store.snoozed('acc')[0]), { woke: true, folder: 'INBOX' });
  assert.equal(result.items.length, 1);

  // Crash before the MOVE: the message is still in its folder and the entry can be dropped.
  const mail2 = createMailStore({ folders: ['INBOX', 'Zurückgestellt'] });
  mail2.add('INBOX', plainMail('Nie verschoben'));
  const c2 = mail2.client();
  const store2 = createFollowupStore(memoryFile({ snoozed: [], followups: [] }));
  await assert.rejects(
    snoozeMessages(c2, {
      folder: 'INBOX',
      uids: ['1'],
      beforeMove: async plan => {
        await store2.addSnoozed('acc', 'INBOX', plan, '2026-11-20T08:00:00.000Z', { state: 'pending' });
        throw new Error('process killed');
      }
    })
  );
  assert.equal((await locateSnoozed(c2, store2.snoozed('acc')[0])).where, 'original');
  // A failed journal write stops the MOVE: nothing leaves the inbox untracked.
  await assert.rejects(
    snoozeMessages(c2, {
      folder: 'INBOX',
      uids: ['1'],
      beforeMove: async () => {
        throw Object.assign(new Error('EIO'), { code: 'EIO' });
      }
    }),
    { code: 'EIO' }
  );
  assert.equal(mail2.messages('INBOX').length, 1);
});
