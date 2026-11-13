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

test('Schreibfunktionen standardmäßig deaktiviert; nur exakt true aktiviert', () => {
  assert.equal(imapWriteEnabled({}), false);
  assert.equal(imapWriteEnabled({ ENABLE_IMAP_WRITE: 'TRUE' }), false);
  assert.equal(imapWriteEnabled({ ENABLE_IMAP_WRITE: 'true' }), true);
});

test('IMAP-Liste verwirft unselektierbare und ungültige Ordner', () => {
  assert.deepEqual(
    selectableFolders([
      ...sampleFolders,
      { path: 'Nicht wählen', flags: new Set(['\\Noselect']) },
      { path: '\nUnsauber' }
    ]).map(f => f.path),
    sampleFolders.map(f => f.path)
  );
});

test('Hetzner Trash per Special-Use und deutscher Bezeichnung gefunden', () => {
  assert.equal(findSpecialFolder(sampleFolders, '\\Trash').path, 'INBOX.Trash');
  assert.equal(findSpecialFolder([{ path: 'INBOX.Papierkorb' }], '\\Trash').path, 'INBOX.Papierkorb');
});

test('Archivname wird aus tatsächlicher INBOX-Hierarchie abgeleitet', () => {
  assert.equal(archiveCreationPath(sampleFolders), 'INBOX.Archive');
  assert.equal(archiveCreationPath([{ path: 'INBOX', delimiter: '/' }, { path: 'INBOX/Sent' }]), 'INBOX/Archive');
  assert.equal(archiveCreationPath([...sampleFolders, { path: 'INBOX.Archive' }]), null);
});

test('Unbekanntes Delimiter führt zu einer sicheren Fehlermeldung', () => {
  assert.throws(() => archiveCreationPath([{ path: 'INBOX' }]), { code: 'delimiter_unknown' });
});

test('Schreibaktionen akzeptieren nur UID, bekannten Action-Typ und Pfad', () => {
  assert.deepEqual(validateActionInput('123', { folder: 'INBOX', action: 'markRead' }), act('markRead'));
  assert.throws(() => validateActionInput('0', { folder: 'INBOX', action: 'markRead' }));
  assert.throws(() => validateActionInput('1:*', { folder: 'INBOX', action: 'trash' }));
  assert.throws(() => validateActionInput('1', { folder: '\n', action: 'trash' }));
  assert.throws(() => validateActionInput('1', { folder: 'INBOX', action: 'deleteForever' }));
  assert.throws(() => validateActionInput('1', { folder: 'INBOX', action: 'move' }));
});

test('Gelesen markiert exakt eine UID, nicht einen Sequenzbereich', async () => {
  const client = fakeClient();
  const response = await performMessageAction(client, act('markRead'));
  assert.equal(response.ok, true);
  assert.deepEqual(
    client.calls.find(call => call[0] === 'add'),
    ['add', '123', ['\\Seen'], { uid: true }]
  );
  assert.equal(client.calls.at(-1)[0], 'unlock');
});

test('Ungelesen entfernt nur Seen-Flag', async () => {
  const client = fakeClient();
  await performMessageAction(client, act('markUnread'));
  assert.deepEqual(
    client.calls.find(call => call[0] === 'remove'),
    ['remove', '123', ['\\Seen'], { uid: true }]
  );
});

test('Papierkorb verschiebt in korrektes INBOX.Trash, niemals endgültig löschen', async () => {
  const client = fakeClient();
  const result = await performMessageAction(client, act('trash'));
  assert.equal(result.destination, 'INBOX.Trash');
  assert.deepEqual(
    client.calls.find(c => c[0] === 'move'),
    ['move', '123', 'INBOX.Trash', { uid: true }]
  );
  assert.equal('messageDelete' in client, false);
});

test('Archiv ohne Ordner verweigert Änderung', async () => {
  const client = fakeClient();
  await assert.rejects(performMessageAction(client, act('archive')), { statusCode: 409, code: 'archive_missing' });
  assert.deepEqual(client.calls, []);
});

test('Archiv mit bestehendem Ordner verschiebt zuverlässig', async () => {
  const client = fakeClient({ folders: [...sampleFolders, { path: 'INBOX.Archive', specialUse: '\\Archive' }] });
  const result = await performMessageAction(client, act('archive'));
  assert.equal(result.destination, 'INBOX.Archive');
});

test('Verschieben verweigert ungültiges Ziel und identische Quelle', async () => {
  const client = fakeClient();
  await assert.rejects(performMessageAction(client, act('move', 'INBOX', 'FAKE')), { code: 'destination_missing' });
  await assert.rejects(performMessageAction(client, act('move', 'INBOX', 'INBOX')), { code: 'same_folder' });
  assert.equal(client.calls.length, 0);
});

test('Ohne IMAP MOVE wird keine COPY-EXPUNGE-Fallbackaktion gestartet', async () => {
  const client = fakeClient({ moveSupported: false });
  await assert.rejects(performMessageAction(client, act('trash')), { code: 'move_unsupported' });
  assert.equal(
    client.calls.some(c => c[0] === 'move'),
    false
  );
  assert.equal(client.calls.at(-1)[0], 'unlock');
});

test('Nicht vorhandene UID ändert keine Flags und verschiebt nicht', async () => {
  const client = fakeClient({ missing: true });
  await assert.rejects(performMessageAction(client, act('markRead')), { code: 'message_missing' });
  assert.equal(
    client.calls.some(c => c[0] === 'add'),
    false
  );
  assert.equal(client.calls.at(-1)[0], 'unlock');
});

test('Schreibgeschützter Ordner lässt keine Mutationen zu', async () => {
  const client = fakeClient({ readOnly: true });
  await assert.rejects(performMessageAction(client, act('trash')), { code: 'mailbox_readonly' });
  assert.equal(client.calls.at(-1)[0], 'unlock');
});

test('Ablehnung durch den Server wird gemeldet und Lock freigegeben', async () => {
  const client = fakeClient({ flagResult: false });
  await assert.rejects(performMessageAction(client, act('markRead')), { code: 'flags_rejected' });
  assert.equal(client.calls.at(-1)[0], 'unlock');
});

test('Archivordner wird nur bewusst und einmal erstellt', async () => {
  const client = fakeClient();
  assert.deepEqual(await createArchiveFolder(client), { created: true, folder: 'INBOX.Archive' });
  assert.deepEqual(client.calls, [['create', 'INBOX.Archive']]);
  const client2 = fakeClient({ folders: [...sampleFolders, { path: 'INBOX.Archive', specialUse: '\\Archive' }] });
  assert.deepEqual(await createArchiveFolder(client2), { created: false, folder: 'INBOX.Archive' });
  assert.deepEqual(client2.calls, []);
});

test('Sammelaktion: ein Befehl mit UID-Menge, nur noch vorhandene UIDs', async () => {
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

test('Markieren setzt bzw. entfernt nur \\Flagged', async () => {
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

test('Spam verschiebt in den Junk-Ordner, „Kein Spam“ zurück in den Posteingang', async () => {
  const client = fakeClient();
  const spam = await performMessageAction(client, act('spam'));
  assert.equal(spam.destination, 'INBOX.spambucket');
  const back = await performMessageAction(fakeClient(), act('notSpam', 'INBOX.spambucket'));
  assert.equal(back.destination, 'INBOX');
  const noJunk = fakeClient({ folders: sampleFolders.filter(f => f.specialUse !== '\\Junk') });
  await assert.rejects(performMessageAction(noJunk, act('spam')), { code: 'junk_missing' });
});

test('Rückgängig: Verschieben liefert neue UIDs (COPYUID), Markierungen die Umkehraktion', async () => {
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
  assert.equal(noMap.undo, null, 'ohne UIDPLUS kein sicheres Rückgängig');
  const flagged = await performMessageAction(fakeClient(), act('flag'));
  assert.deepEqual(flagged.undo, { folder: 'INBOX', action: 'unflag', uids: ['123'] });
});
