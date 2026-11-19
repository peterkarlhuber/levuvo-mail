// Regression tests for the spaces sync transport and protocol (internal audit 2026-11-19):
// PERF-LEV-005, REL-LEV-009, REL-LEV-016, API-LEV-001, API-LEV-002, QA-LEV-005.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMailStore } from './helpers/fake-mailstore.mjs';
import { createMailTransport, MAX_SYNC_MAIL_BYTES, SPACES_FOLDER } from '../src/spaces/mail-transport.mjs';
import { openSpaceStore } from '../src/spaces/store.mjs';
import { createSpaceService } from '../src/spaces/service.mjs';
import { identityKeys, seal, signed, unb64u } from '../src/spaces/crypto.mjs';

const HIDDEN = `INBOX/${SPACES_FOLDER}`;

const syncMail = (payload, { version = 'v1', attachment = true } = {}) =>
  [
    'From: b@x.example',
    'To: a@x.example',
    `X-Levuvo-Space: ${version}; sync`,
    'Subject: sync',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary=B',
    '',
    '--B',
    'Content-Type: text/plain',
    '',
    'x',
    ...(attachment
      ? [
          '--B',
          'Content-Type: application/vnd.levuvo.space+json; name=levuvo-space.json',
          'Content-Disposition: attachment; filename=levuvo-space.json',
          '',
          JSON.stringify(payload)
        ]
      : []),
    '--B--',
    ''
  ].join('\r\n');

/** Transport over a fake mail server, with a minimal index store and a log of source downloads. */
function setup({ gate } = {}) {
  const mail = createMailStore({ folders: ['INBOX', 'Junk', HIDDEN] });
  const downloads = [];
  const store = {
    value: {},
    index: () => store.value,
    saveIndex: async v => (store.value = v || store.value),
    updateIndex: async fn => (store.value = fn(store.value)),
    writes: 0
  };
  const saveIndex = store.saveIndex;
  store.saveIndex = async v => (store.writes++, saveIndex(v));
  const updateIndex = store.updateIndex;
  store.updateIndex = async fn => (store.writes++, updateIndex(fn));
  const client = () => {
    const c = mail.client({ gate });
    const fetch = c.fetch.bind(c);
    c.fetch = (spec, query) => {
      if (query.source) downloads.push({ folder: c.mailbox.path, spec: String(spec) });
      return fetch(spec, query);
    };
    return c;
  };
  const ctx = { accounts: () => [{ id: 'a' }], withImap: async fn => fn(client()) };
  return { mail, store, downloads, transport: createMailTransport(ctx, store) };
}

test('QA-LEV-005/SPO-01: an oversized sync mail is never downloaded', async () => {
  const { mail, downloads, transport } = setup();
  const uid = mail.add('INBOX', syncMail({ n: 1 }), [], { size: MAX_SYNC_MAIL_BYTES + 1 });
  const handled = [];
  await transport.receive('a', async env => handled.push(env));
  await transport.receive('a', async env => handled.push(env));
  assert.equal(handled.length, 0);
  assert.ok(!downloads.some(d => d.folder === 'INBOX' && d.spec === String(uid)), 'no source fetch');
  assert.equal(mail.messages('INBOX').length, 1, 'left where it is');
});

test('PERF-LEV-005: mails that are no usable sync mail are downloaded once, not every run', async () => {
  const { mail, store, downloads, transport } = setup();
  mail.add('INBOX', 'From: x@evil.example\r\nX-Levuvo-Space: v1; sync\r\nSubject: hi\r\n\r\nno attachment\r\n');
  mail.add('INBOX', 'From: y@example.org\r\nSubject: normal mail\r\n\r\nhello\r\n');
  for (let i = 0; i < 4; i++) await transport.receive('a', async () => {});
  assert.equal(downloads.filter(d => d.folder === 'INBOX').length, 1);
  assert.equal(mail.messages('INBOX').length, 2, 'both stay in the inbox');
  // Nothing new: the index is not rewritten on every run.
  const writes = store.writes;
  await transport.receive('a', async () => {});
  assert.equal(store.writes, writes);
});

test('PERF-LEV-005: an envelope that fails is retried later with a pause, then given up', async () => {
  const { mail, store, downloads, transport } = setup();
  mail.add('INBOX', syncMail({ n: 7 }));
  let calls = 0;
  const failing = async () => {
    calls++;
    throw new Error('disk full');
  };
  await transport.receive('a', failing);
  await transport.receive('a', failing);
  assert.equal(calls, 1, 'not retried before the pause is over');
  assert.equal(downloads.length, 1);
  // Pause over: tried again, and on success moved out of the inbox.
  for (const r of Object.values(store.value.cursors.a.folders.INBOX.retry)) r.at = 0;
  const handled = [];
  await transport.receive('a', async env => handled.push(env.n));
  assert.deepEqual(handled, [7]);
  assert.equal(mail.messages('INBOX').length, 0);
  // Handled once only, also in the hidden folder (known from the MOVE answer).
  await transport.receive('a', async env => handled.push(env.n));
  assert.deepEqual(handled, [7]);
});

test('REL-LEV-009: mails a second device moves into the hidden folder meanwhile are not skipped', async () => {
  let other = null;
  const { mail, transport } = setup({
    gate: async kind => {
      // While this device moves its inbox mail, the other device moves two of its own.
      if (kind === 'move' && other) {
        other();
        other = null;
      }
    }
  });
  mail.add('INBOX', syncMail({ n: 1 }));
  other = () => {
    mail.add(HIDDEN, syncMail({ n: 2 }));
    mail.add(HIDDEN, syncMail({ n: 3 }));
  };
  const handled = [];
  await transport.receive('a', async env => handled.push(env.n));
  await transport.receive('a', async env => handled.push(env.n));
  assert.deepEqual(handled.sort(), [1, 2, 3]);
});

test('REL-LEV-016: a sync run does not bring back invitations changed while it was busy', async () => {
  const { mail, store, transport } = setup();
  store.value = { invitations: [{ id: 'i1' }, { id: 'i2' }], cursors: {} };
  mail.add('INBOX', syncMail({ n: 1 }));
  await transport.receive('a', async () => {
    // Accepting an invitation replaces the index object while the run is in progress.
    store.value = { ...store.value, invitations: store.value.invitations.filter(i => i.id !== 'i1') };
  });
  assert.deepEqual(
    store.value.invitations.map(i => i.id),
    ['i2']
  );
  assert.ok(store.value.cursors.a.folders.INBOX.seen > 0);
});

test('API-LEV-002: sync mails in a newer format are kept for after an update, not dropped', async () => {
  const { mail, store, transport } = setup();
  mail.add('INBOX', syncMail({ v: 1, n: 1 }, { version: 'v2' }));
  mail.add('INBOX', syncMail({ v: 2, n: 2 }));
  const handled = [];
  await transport.receive('a', async env => handled.push(env.n));
  await transport.receive('a', async env => handled.push(env.n));
  assert.deepEqual(handled, [], 'not handled by this version');
  assert.equal(mail.messages('INBOX').length, 0, 'out of the inbox');
  assert.equal(mail.messages(HIDDEN).length, 2, 'kept in the hidden folder');
  assert.equal(store.value.cursors.a.future.length, 2);
  // Retention never deletes them.
  for (const m of mail.messages(HIDDEN)) m.internalDate = new Date('2020-01-01');
  await transport.receive('a', async () => {});
  assert.equal(mail.messages(HIDDEN).length, 2);
});

// ---------------------------------------------------------------- protocol (API-LEV-001)
const vault = () => {
  const m = new Map();
  return { available: true, get: (i, k) => m.get(`${i}:${k}`) || '', set: (i, k, v) => m.set(`${i}:${k}`, v) };
};
async function person(t, office, email, name) {
  const dir = mkdtempSync(join(tmpdir(), 'lv-spaces-sync-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = await openSpaceStore({ dir, vault: vault() });
  const accountId = `acc-${name}`;
  const service = createSpaceService({
    store,
    transport: { send: async msg => office.push({ ...msg, envelope: structuredClone(msg.envelope) }) },
    accounts: () => [{ id: accountId, address: email, name, addresses: [email] }]
  });
  return { store, service, email, accountId };
}
async function deliver(office, people) {
  for (let i = 0; i < 10; i++) {
    for (const p of people) await p.service.flush();
    const mails = office.splice(0);
    if (!mails.length) return;
    for (const m of mails) {
      const p = people.find(x => x.email === m.to);
      if (p) await p.service.receiveEnvelope(p.accountId, m.envelope, { from: m.from });
    }
  }
}

test('API-LEV-001: an op this version cannot apply closes the gap instead of a need/ops loop', async t => {
  const office = [];
  const anna = await person(t, office, 'anna@x.example', 'Anna');
  const ben = await person(t, office, 'ben@y.example', 'Ben');
  const space = await anna.service.create({ name: 'Projekt', accountId: anna.accountId });
  await anna.service.invite(space.id, { email: ben.email });
  await deliver(office, [anna, ben]);
  await ben.service.acceptInvitation(ben.service.list().invitations[0].id);
  await deliver(office, [anna, ben]);
  assert.equal(ben.service.detail(space.id).status, 'active');

  // Ben's newer version writes an op type Anna's version does not know.
  const benKeys = identityKeys(ben.store.identity);
  const rec = ben.store.get(space.id);
  rec.seq++;
  rec.lc++;
  const future = signed(benKeys, {
    v: 1,
    space: space.id,
    author: benKeys.id,
    seq: rec.seq,
    lc: rec.lc,
    at: new Date().toISOString(),
    type: 'poll.create',
    data: { id: 'a'.repeat(32), question: 'Termin?' },
    id: `${benKeys.id}:${rec.seq}`
  });
  const sealedFor = (inner, sender = benKeys) =>
    signed(sender, {
      v: 1,
      t: 'sealed',
      space: space.id,
      from: sender.id,
      epoch: rec.epoch,
      box: seal(unb64u(rec.keys[rec.epoch]), JSON.stringify(inner), `space.${space.id}.${rec.epoch}`)
    });
  const before = anna.service.detail(space.id);
  assert.equal(
    await anna.service.receiveEnvelope(
      anna.accountId,
      sealedFor({ t: 'ops', ops: [future], vv: { [benKeys.id]: rec.seq } })
    ),
    'ok'
  );
  const annaRec = anna.store.get(space.id);
  assert.ok(
    annaRec.ops.some(o => o.id === future.id),
    'kept, unchanged, to pass on'
  );
  assert.ok(!annaRec.outbox.some(i => i.kind === 'need'), 'nothing to ask for');
  assert.deepEqual(anna.service.detail(space.id).tasks, before.tasks, 'and never applied');

  // Ben's next normal op arrives with no request for the unknown one.
  await ben.service.apply(space.id, 'task.upsert', { id: ben.service.newId(), title: 'Weiter' });
  await deliver(office, [anna, ben]);
  assert.ok(anna.service.detail(space.id).tasks.some(x => x.title === 'Weiter'));

  // A gap nobody can close is asked for once, not on every mail.
  office.splice(0);
  for (let i = 0; i < 3; i++)
    await anna.service.receiveEnvelope(
      anna.accountId,
      sealedFor({ t: 'ops', ops: [], vv: { [benKeys.id]: rec.seq + 50 } })
    );
  await anna.service.flush();
  assert.equal(office.filter(m => m.kind === 'need').length, 1);
});
