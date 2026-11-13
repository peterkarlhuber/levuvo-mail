import test from 'node:test';
import assert from 'node:assert/strict';
let drafts;
try {
  drafts = await import('../src/drafts.mjs');
} catch (err) {
  if (err.code !== 'ERR_MODULE_NOT_FOUND') throw err;
}

const uuid = '11111111-2222-4222-8222-333333333333';
const fresh = () => ({
  draftId: uuid,
  to: ['peter@example.at'],
  cc: [],
  bcc: [],
  subject: 'Levuvo Entwurf',
  text: 'Hallo',
  previousUid: null,
  uidValidity: null
});
const folders = [
  { path: 'INBOX.Drafts', specialUse: '\\Drafts' },
  { path: 'INBOX.Trash', specialUse: '\\Trash' },
  { path: 'INBOX.Sent', specialUse: '\\Sent' }
];
const skip = !drafts && 'npm install erforderlich (nodemailer)';
function client(opts = {}) {
  const calls = [];
  return {
    calls,
    capabilities: new Map(
      opts.noUidplus
        ? [['MOVE', true]]
        : [
            ['UIDPLUS', true],
            ['MOVE', true]
          ]
    ),
    mailbox: { readOnly: false, uidValidity: 100n },
    list: async () => opts.folders || folders,
    getMailboxLock: async path => {
      calls.push(['lock', path]);
      return { release: () => calls.push(['unlock']) };
    },
    fetchOne: async (_uid, fetch) => {
      calls.push(['fetch', fetch]);
      return opts.previousMissing
        ? false
        : fetch.source
          ? { uid: 23, source: Buffer.from(`X-Levuvo-Draft-ID: ${uuid}\r\nSubject: Test\r\n\r\nHallo`) }
          : { uid: 23, size: 90, flags: new Set(['\\Draft']) };
    },
    append: async (path, raw, flags) => {
      calls.push(['append', path, flags, raw]);
      return opts.appendResult ?? { uid: 24, uidValidity: 100n };
    },
    messageMove: async (uid, target, o) => {
      calls.push(['move', uid, target, o]);
      return opts.moveResult ?? true;
    }
  };
}

test('Draft saving is off by default', { skip }, () => {
  assert.equal(drafts.draftEnabled({}), false);
  assert.equal(drafts.draftEnabled({ ENABLE_DRAFTS: 'true' }), true);
  assert.equal(drafts.findDraftFolder(folders).path, 'INBOX.Drafts');
});
test('MIME of a draft contains the stored identifier and flag', { skip }, async () => {
  const raw = await drafts.composeDraft('peter@example.at', fresh());
  assert.equal(drafts.parseDraftId(raw), uuid);
  assert.match(raw.toString(), /Levuvo Entwurf/);
});
test('First draft is appended without deleting any other message', { skip }, async () => {
  const c = client();
  const result = await drafts.saveDraft(c, 'peter@example.at', fresh());
  assert.equal(result.uid, 24);
  assert.equal(result.uidValidity, '100');
  assert.equal(
    c.calls.some(x => x[0] === 'move'),
    false
  );
  assert.deepEqual(c.calls.find(x => x[0] === 'append').slice(1, 3), ['INBOX.Drafts', ['\\Draft', '\\Seen']]);
  assert.equal(c.calls.at(-1)[0], 'unlock');
});
test('Draft revision is APPEND before UID MOVE to the trash', { skip }, async () => {
  const c = client();
  const result = await drafts.saveDraft(c, 'peter@example.at', { ...fresh(), previousUid: '23', uidValidity: '100' });
  assert.equal(result.previousRemoved, true);
  assert.deepEqual(
    c.calls.filter(x => ['append', 'move'].includes(x[0])).map(x => x[0]),
    ['append', 'move']
  );
  assert.deepEqual(
    c.calls.find(x => x[0] === 'move'),
    ['move', '23', 'INBOX.Trash', { uid: true }]
  );
});
test('Stale UID or UIDVALIDITY collision stops all write actions', { skip }, async () => {
  const c = client();
  await assert.rejects(drafts.saveDraft(c, 'peter@example.at', { ...fresh(), previousUid: '23', uidValidity: '999' }), {
    code: 'draft_conflict'
  });
  assert.equal(
    c.calls.some(x => x[0] === 'append'),
    false
  );
});
test('UIDPLUS is required, nothing is written if it is missing', { skip }, async () => {
  const c = client({ noUidplus: true });
  await assert.rejects(drafts.saveDraft(c, 'peter@example.at', fresh()), { code: 'uidplus_required' });
  assert.equal(c.calls.length, 0);
});
test('After an unclear APPEND the old draft is never deleted', { skip }, async () => {
  const c = client({ appendResult: false });
  await assert.rejects(drafts.saveDraft(c, 'peter@example.at', { ...fresh(), previousUid: '23', uidValidity: '100' }), {
    code: 'draft_save_uncertain'
  });
  assert.equal(
    c.calls.some(x => x[0] === 'move'),
    false
  );
});
test('Unknown or larger draft is not overwritten', { skip }, async () => {
  const c = client({ previousMissing: true });
  await assert.rejects(drafts.saveDraft(c, 'peter@example.at', { ...fresh(), previousUid: '23', uidValidity: '100' }), {
    code: 'draft_conflict'
  });
  assert.equal(
    c.calls.some(x => x[0] === 'append'),
    false
  );
});
test('Invalid payload and attachments are blocked', { skip }, () => {
  assert.throws(() => drafts.validateDraft({ ...fresh(), to: ['header\r\n@example.org'] }));
  assert.throws(() => drafts.validateDraft({ ...fresh(), attachments: [{ name: 'bad' }] }), /ungültig/i);
  assert.throws(() => drafts.validateDraft({ ...fresh(), previousUid: '0', uidValidity: '100' }));
});

test('Without a drafts folder the first save creates one next to the inbox', { skip }, async () => {
  const c = client({
    folders: [
      { path: 'INBOX', delimiter: '.' },
      { path: 'INBOX.Trash', specialUse: '\\Trash' }
    ]
  });
  c.mailboxCreate = async path => {
    c.calls.push(['create', path]);
    return { path, created: true };
  };
  const result = await drafts.saveDraft(c, 'peter@example.at', fresh());
  assert.equal(result.uid, 24);
  assert.deepEqual(c.calls[0], ['create', 'INBOX.Drafts']);
  assert.equal(c.calls.find(x => x[0] === 'append')[1], 'INBOX.Drafts');
});
