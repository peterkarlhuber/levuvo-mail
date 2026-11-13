import test from 'node:test';
import assert from 'node:assert/strict';
import {
  imapWriteEnabled,
  selectableFolders,
  findSpecialFolder,
  archiveCreationPath,
  validateActionInput,
  validateBatchInput,
  performMessageAction,
  createArchiveFolder
} from '../src/mail-actions.mjs';

const sampleFolders = [
  { path: 'INBOX', specialUse: '\\Inbox', delimiter: '.' },
  { path: 'INBOX.Sent', specialUse: '\\Sent', delimiter: '.' },
  { path: 'INBOX.Trash', specialUse: '\\Trash', delimiter: '.' },
  { path: 'INBOX.Drafts', specialUse: '\\Drafts', delimiter: '.' },
  { path: 'INBOX.spambucket', specialUse: '\\Junk', delimiter: '.' }
];

function fakeClient(opts = {}) {
  const calls = [];
  const client = {
    calls,
    mailbox: { readOnly: false },
    capabilities: new Map([['MOVE', true]]),
    list: async () => opts.folders || sampleFolders,
    getMailboxLock: async path => {
      calls.push(['lock', path]);
      return { release: () => calls.push(['unlock']) };
    },
    async *fetch(set, query, options) {
      calls.push(['fetch', set, options]);
      if (opts.missing) return;
      for (const uid of String(set).split(',')) if (!(opts.gone || []).includes(uid)) yield { uid: Number(uid) };
    },
    messageFlagsAdd: async (uid, flags, options) => {
      calls.push(['add', uid, flags, options]);
      return opts.flagResult ?? true;
    },
    messageFlagsRemove: async (uid, flags, options) => {
      calls.push(['remove', uid, flags, options]);
      return opts.flagResult ?? true;
    },
    messageMove: async (uid, path, options) => {
      calls.push(['move', uid, path, options]);
      return opts.moveResult ?? { destination: path };
    },
    mailboxCreate: async path => {
      calls.push(['create', path]);
      return opts.createResult ?? { path };
    }
  };
  if (opts.moveSupported === false) client.capabilities.clear();
  if (opts.readOnly) client.mailbox.readOnly = true;
  return client;
}

const act = (action, folder = 'INBOX', destination = null) => ({
  uid: '123',
  uids: ['123'],
  folder,
  action,
  destination
});

test('Write functions disabled by default; only exactly true enables them', () => {
  assert.equal(imapWriteEnabled({}), false);
  assert.equal(imapWriteEnabled({ ENABLE_IMAP_WRITE: 'TRUE' }), false);
  assert.equal(imapWriteEnabled({ ENABLE_IMAP_WRITE: 'true' }), true);
});

test('IMAP list discards unselectable and invalid folders', () => {
  assert.deepEqual(
    selectableFolders([
      ...sampleFolders,
      { path: 'Nicht wählen', flags: new Set(['\\Noselect']) },
      { path: '\nUnsauber' }
    ]).map(f => f.path),
    sampleFolders.map(f => f.path)
  );
});

test('Hetzner Trash found via special-use and German name', () => {
  assert.equal(findSpecialFolder(sampleFolders, '\\Trash').path, 'INBOX.Trash');
  assert.equal(findSpecialFolder([{ path: 'INBOX.Papierkorb' }], '\\Trash').path, 'INBOX.Papierkorb');
});

test('Archive name is derived from the actual INBOX hierarchy', () => {
  assert.equal(archiveCreationPath(sampleFolders), 'INBOX.Archive');
  assert.equal(archiveCreationPath([{ path: 'INBOX', delimiter: '/' }, { path: 'INBOX/Sent' }]), 'INBOX/Archive');
  assert.equal(archiveCreationPath([...sampleFolders, { path: 'INBOX.Archive' }]), null);
});

test('Unknown delimiter leads to a safe error message', () => {
  assert.throws(() => archiveCreationPath([{ path: 'INBOX' }]), { code: 'delimiter_unknown' });
});

test('Write actions accept only UID, known action type and path', () => {
  assert.deepEqual(validateActionInput('123', { folder: 'INBOX', action: 'markRead' }), act('markRead'));
  assert.throws(() => validateActionInput('0', { folder: 'INBOX', action: 'markRead' }));
  assert.throws(() => validateActionInput('1:*', { folder: 'INBOX', action: 'trash' }));
  assert.throws(() => validateActionInput('1', { folder: '\n', action: 'trash' }));
  assert.throws(() => validateActionInput('1', { folder: 'INBOX', action: 'deleteForever' }));
  assert.throws(() => validateActionInput('1', { folder: 'INBOX', action: 'move' }));
});

test('Mark as read targets exactly one UID, not a sequence range', async () => {
  const client = fakeClient();
  const response = await performMessageAction(client, act('markRead'));
  assert.equal(response.ok, true);
  assert.deepEqual(
    client.calls.find(call => call[0] === 'add'),
    ['add', '123', ['\\Seen'], { uid: true }]
  );
  assert.equal(client.calls.at(-1)[0], 'unlock');
});

test('Mark as unread removes only the Seen flag', async () => {
  const client = fakeClient();
  await performMessageAction(client, act('markUnread'));
  assert.deepEqual(
    client.calls.find(call => call[0] === 'remove'),
    ['remove', '123', ['\\Seen'], { uid: true }]
  );
});

test('Trash moves to the correct INBOX.Trash, never deletes permanently', async () => {
  const client = fakeClient();
  const result = await performMessageAction(client, act('trash'));
  assert.equal(result.destination, 'INBOX.Trash');
  assert.deepEqual(
    client.calls.find(c => c[0] === 'move'),
    ['move', '123', 'INBOX.Trash', { uid: true }]
  );
  assert.equal('messageDelete' in client, false);
});

test('Archive without folder refuses the change', async () => {
  const client = fakeClient();
  await assert.rejects(performMessageAction(client, act('archive')), { statusCode: 409, code: 'archive_missing' });
  assert.deepEqual(client.calls, []);
});

test('Archive with an existing folder moves reliably', async () => {
  const client = fakeClient({ folders: [...sampleFolders, { path: 'INBOX.Archive', specialUse: '\\Archive' }] });
  const result = await performMessageAction(client, act('archive'));
  assert.equal(result.destination, 'INBOX.Archive');
});

test('Move refuses an invalid target and an identical source', async () => {
  const client = fakeClient();
  await assert.rejects(performMessageAction(client, act('move', 'INBOX', 'FAKE')), { code: 'destination_missing' });
  await assert.rejects(performMessageAction(client, act('move', 'INBOX', 'INBOX')), { code: 'same_folder' });
  assert.equal(client.calls.length, 0);
});

test('Without IMAP MOVE no COPY-EXPUNGE fallback is started', async () => {
  const client = fakeClient({ moveSupported: false });
  await assert.rejects(performMessageAction(client, act('trash')), { code: 'move_unsupported' });
  assert.equal(
    client.calls.some(c => c[0] === 'move'),
    false
  );
  assert.equal(client.calls.at(-1)[0], 'unlock');
});

test('Non-existent UID changes no flags and does not move', async () => {
  const client = fakeClient({ missing: true });
  await assert.rejects(performMessageAction(client, act('markRead')), { code: 'message_missing' });
  assert.equal(
    client.calls.some(c => c[0] === 'add'),
    false
  );
  assert.equal(client.calls.at(-1)[0], 'unlock');
});

test('Read-only folder allows no mutations', async () => {
  const client = fakeClient({ readOnly: true });
  await assert.rejects(performMessageAction(client, act('trash')), { code: 'mailbox_readonly' });
  assert.equal(client.calls.at(-1)[0], 'unlock');
});

test('Server rejection is reported and the lock is released', async () => {
  const client = fakeClient({ flagResult: false });
  await assert.rejects(performMessageAction(client, act('markRead')), { code: 'flags_rejected' });
  assert.equal(client.calls.at(-1)[0], 'unlock');
});

test('Archive folder is created only deliberately and once', async () => {
  const client = fakeClient();
  assert.deepEqual(await createArchiveFolder(client), { created: true, folder: 'INBOX.Archive' });
  assert.deepEqual(client.calls, [['create', 'INBOX.Archive']]);
  const client2 = fakeClient({ folders: [...sampleFolders, { path: 'INBOX.Archive', specialUse: '\\Archive' }] });
  assert.deepEqual(await createArchiveFolder(client2), { created: false, folder: 'INBOX.Archive' });
  assert.deepEqual(client2.calls, []);
});

test('Bulk action: one command with a UID set, only UIDs that still exist', async () => {
  const input = validateBatchInput({ folder: 'INBOX', action: 'trash', uids: ['5', '7', '9', '7'] });
  assert.deepEqual(input.uids, ['5', '7', '9']);
  const client = fakeClient({ gone: ['7'] });
  const result = await performMessageAction(client, input);
  assert.equal(result.count, 2);
  assert.deepEqual(
    client.calls.find(c => c[0] === 'move'),
    ['move', '5,9', 'INBOX.Trash', { uid: true }]
  );
  assert.throws(() => validateBatchInput({ folder: 'INBOX', action: 'trash', uids: [] }));
  assert.throws(() =>
    validateBatchInput({ folder: 'INBOX', action: 'trash', uids: Array.from({ length: 501 }, (_, i) => String(i + 1)) })
  );
  assert.throws(() => validateBatchInput({ folder: 'INBOX', action: 'trash', uids: ['1:*'] }));
});

test('Flagging sets or removes only \\Flagged', async () => {
  const client = fakeClient();
  await performMessageAction(client, act('flag'));
  await performMessageAction(client, act('unflag'));
  assert.deepEqual(
    client.calls.filter(c => c[0] === 'add' || c[0] === 'remove').map(c => [c[0], c[2][0]]),
    [
      ['add', '\\Flagged'],
      ['remove', '\\Flagged']
    ]
  );
});

test('Spam moves to the Junk folder, "Not spam" back to the inbox', async () => {
  const client = fakeClient();
  const spam = await performMessageAction(client, act('spam'));
  assert.equal(spam.destination, 'INBOX.spambucket');
  const back = await performMessageAction(fakeClient(), act('notSpam', 'INBOX.spambucket'));
  assert.equal(back.destination, 'INBOX');
  const noJunk = fakeClient({ folders: sampleFolders.filter(f => f.specialUse !== '\\Junk') });
  await assert.rejects(performMessageAction(noJunk, act('spam')), { code: 'junk_missing' });
});

test('Undo: move returns new UIDs (COPYUID), flags return the inverse action', async () => {
  const moved = await performMessageAction(
    fakeClient({ moveResult: { destination: 'Trash', uidMap: new Map([[123, 980]]) } }),
    act('trash')
  );
  assert.deepEqual(moved.undo, { folder: 'INBOX.Trash', action: 'move', destination: 'INBOX', uids: ['980'] });
  const spam = await performMessageAction(
    fakeClient({ moveResult: { destination: 'Junk', uidMap: new Map([[123, 7]]) } }),
    act('spam')
  );
  assert.equal(spam.undo.action, 'notSpam');
  const noMap = await performMessageAction(fakeClient(), act('trash'));
  assert.equal(noMap.undo, null, 'no safe undo without UIDPLUS');
  const flagged = await performMessageAction(fakeClient(), act('flag'));
  assert.deepEqual(flagged.undo, { folder: 'INBOX', action: 'unflag', uids: ['123'] });
});
