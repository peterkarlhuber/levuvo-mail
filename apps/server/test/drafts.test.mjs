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

test('Entwurfsspeicherung ist standardmäßig ausgeschaltet', { skip }, () => {
  assert.equal(drafts.draftEnabled({}), false);
  assert.equal(drafts.draftEnabled({ ENABLE_DRAFTS: 'true' }), true);
  assert.equal(drafts.findDraftFolder(folders).path, 'INBOX.Drafts');
});
test('MIME eines Entwurfs enthält gespeicherte Kennung und Flag', { skip }, async () => {
  const raw = await drafts.composeDraft('peter@example.at', fresh());
  assert.equal(drafts.parseDraftId(raw), uuid);
  assert.match(raw.toString(), /Levuvo Entwurf/);
});
test('Erster Entwurf wird angehängt ohne andere Nachricht zu löschen', { skip }, async () => {
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
test('Entwurfsrevision ist APPEND vor UID-MOVE in den Papierkorb', { skip }, async () => {
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
test('Alte UID oder UIDVALIDITY-Kollision stoppt alle Schreibaktionen', { skip }, async () => {
  const c = client();
  await assert.rejects(drafts.saveDraft(c, 'peter@example.at', { ...fresh(), previousUid: '23', uidValidity: '999' }), {
    code: 'draft_conflict'
  });
  assert.equal(
    c.calls.some(x => x[0] === 'append'),
    false
  );
});
test('UIDPLUS ist erforderlich, nichts wird geschrieben, falls nicht vorhanden', { skip }, async () => {
  const c = client({ noUidplus: true });
  await assert.rejects(drafts.saveDraft(c, 'peter@example.at', fresh()), { code: 'uidplus_required' });
  assert.equal(c.calls.length, 0);
});
test('Nach unklarem APPEND wird niemals der alte Entwurf gelöscht', { skip }, async () => {
  const c = client({ appendResult: false });
  await assert.rejects(drafts.saveDraft(c, 'peter@example.at', { ...fresh(), previousUid: '23', uidValidity: '100' }), {
    code: 'draft_save_uncertain'
  });
  assert.equal(
    c.calls.some(x => x[0] === 'move'),
    false
  );
});
test('Unbekannter oder größerer Entwurf wird nicht überschrieben', { skip }, async () => {
  const c = client({ previousMissing: true });
  await assert.rejects(drafts.saveDraft(c, 'peter@example.at', { ...fresh(), previousUid: '23', uidValidity: '100' }), {
    code: 'draft_conflict'
  });
  assert.equal(
    c.calls.some(x => x[0] === 'append'),
    false
  );
});
test('Invalide Payload und Anhänge werden blockiert', { skip }, () => {
  assert.throws(() => drafts.validateDraft({ ...fresh(), to: ['header\r\n@example.org'] }));
  assert.throws(() => drafts.validateDraft({ ...fresh(), attachments: [{ name: 'bad' }] }), /ungültig/i);
  assert.throws(() => drafts.validateDraft({ ...fresh(), previousUid: '0', uidValidity: '100' }));
});
