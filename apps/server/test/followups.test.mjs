import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFollowupStore,
  findSnoozeFolder,
  messageIdOf,
  snoozeMessages,
  validateWhen,
  wakeMessage
} from '../src/followups.mjs';
import { parseIds, threadFolders } from '../src/thread.mjs';

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

test('Zeitpunkte: Zukunft, höchstens ein Jahr', () => {
  const now = Date.parse('2026-11-13T10:00:00Z');
  assert.equal(validateWhen('2026-11-14T08:00:00Z', now), '2026-11-14T08:00:00.000Z');
  assert.throws(() => validateWhen('2026-11-13T10:00:30Z', now), /Zukunft/);
  assert.throws(() => validateWhen('2028-01-01T00:00:00Z', now), /ein Jahr/);
  assert.throws(() => validateWhen('morgen', now), /Ungültiger/);
});

test('Message-ID aus der versendeten Nachricht, Kennungen aus References', () => {
  const raw = Buffer.from(
    'From: a@b.at\r\nMessage-ID: <abc.123@levuvo.test>\r\nSubject: x\r\n\r\nMessage-ID: <falsch@body>'
  );
  assert.equal(messageIdOf(raw), '<abc.123@levuvo.test>');
  assert.deepEqual(parseIds('<a@x> <b@y>\r\n <a@x>'), ['<a@x>', '<b@y>']);
});

test('Konversation sucht im aktuellen Ordner, Posteingang, Gesendet und Archiv', () => {
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

test('Zurückstellen: Ordner wird bei Bedarf angelegt, Nachricht kommt ungelesen zurück', async () => {
  const client = fakeImap();
  delete client.boxes['INBOX.Zurückgestellt'];
  const result = await snoozeMessages(client, { folder: 'INBOX', uids: ['5'] });
  assert.equal(result.folder, 'INBOX.Zurückgestellt');
  assert.deepEqual(result.items[0], {
    uid: '5',
    messageId: '<m5@x>',
    subject: 'Angebot',
    from: 'kunde@x.at',
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

test('Nachfassen: Einträge anlegen, fällig setzen, beim Kontoentfernen löschen', async () => {
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
