// Send later: persistent send state, multi-device claim, crash recovery and idempotent
// scheduling (audit AUD-001, AUD-002, AUD-004, AUD-008).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMailStore } from './helpers/fake-mailstore.mjs';
import {
  CLAIM_LEASE_MS,
  CLAIM_OTHER_FLAG,
  CLAIM_OWNER_FLAG,
  FAILED_FLAG,
  SENDING_FLAG,
  SENT_FLAG,
  TAKEOVER_GRACE_MS,
  findScheduled,
  listScheduled,
  scheduleMessage,
  sendDue
} from '../src/scheduled.mjs';

const OWNER = 'a'.repeat(32);
const OTHER = 'b'.repeat(32);
const DUE = '2026-11-18T10:00:00.000Z';
const NOW = Date.parse(DUE) + TAKEOVER_GRACE_MS + 1000;

function scheduledSource({ owner = OWNER, draftId = '11111111-2222-3333-4444-555555555555', id = 1 } = {}) {
  return [
    'From: me@example.test',
    'To: customer@example.test',
    'Bcc: hidden@example.test',
    `Subject: Offer ${id}`,
    `Message-ID: <offer-${id}@example.test>`,
    `X-Levuvo-Send-At: ${DUE}`,
    `X-Levuvo-Draft-ID: ${draftId}`,
    ...(owner ? [`X-Levuvo-Scheduler: ${owner}`] : []),
    '',
    'Hello',
    ''
  ].join('\r\n');
}

function device(store, instanceId, { submits, gate, claims = new Map(), submit } = {}) {
  const client = store.client({ name: instanceId, gate });
  return {
    client,
    run: (now = NOW, extra = {}) =>
      sendDue(client, {
        now,
        instanceId,
        claims,
        pollMs: 1,
        submit: submit || (async (rcpt, raw) => submits.push({ by: instanceId, rcpt, raw: raw.toString() })),
        saveSent: async () => {},
        ...extra
      })
  };
}

test('Send later: owner and second device running at the same moment send exactly once (AUD-001)', async () => {
  // Worst case for a check-then-set claim: both devices read the flags before either writes.
  for (const order of ['owner-first', 'other-first', 'lockstep']) {
    const store = createMailStore();
    const uid = store.add('Drafts', scheduledSource(), ['\\Draft', '$LevuvoScheduled']);
    const submits = [];
    let waiting = [];
    const barrier = async (op, who) => {
      if (op !== 'store' || order !== 'lockstep') return;
      // Hold the first store of each device until both devices reach it.
      if (waiting.length < 2) {
        await new Promise(resolve => {
          waiting.push(resolve);
          if (waiting.length === 2) waiting.forEach(r => r());
        });
      }
      void who;
    };
    const a = device(store, OWNER, { submits, gate: barrier });
    const b = device(store, OTHER, { submits, gate: barrier });
    if (order === 'owner-first') await Promise.all([a.run(), b.run()]);
    else await Promise.all([b.run(), a.run()]);
    // Later runs (both devices, several times) never send it again.
    for (let i = 0; i < 3; i++) await Promise.all([a.run(), b.run()]);
    assert.ok(submits.length <= 1, `${order}: at most one SMTP submission (${submits.length})`);
    // Someone sent it, or it is still claimable in the next run: never lost.
    if (!submits.length) {
      await a.run();
      assert.equal(submits.length, 1, `${order}: sent in a later run`);
    }
    assert.equal(store.messages('Drafts').length, 0, `${order}: moved to Trash after sending`);
    assert.ok(store.messages('Trash')[0].flags.has(SENT_FLAG));
    assert.equal(submits[0].rcpt.join(','), 'customer@example.test,hidden@example.test');
    assert.doesNotMatch(submits[0].raw, /Bcc|X-Levuvo/i);
    void uid;
  }
});

test('Send later: many random interleavings of two devices never submit twice (AUD-001)', async () => {
  let seed = 42;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  for (let round = 0; round < 40; round++) {
    const store = createMailStore();
    store.add('Drafts', scheduledSource(), ['\\Draft']);
    const submits = [];
    const jitter = async () => {
      for (let i = Math.floor(random() * 4); i > 0; i--) await new Promise(r => setImmediate(r));
    };
    const a = device(store, OWNER, { submits, gate: jitter });
    const b = device(store, OTHER, { submits, gate: jitter });
    for (let i = 0; i < 4 && store.messages('Drafts').length; i++) await Promise.all([a.run(), b.run()]);
    assert.equal(submits.length, 1, `round ${round}`);
  }
});

test('Send later: a second device waits for the owner, then takes over', async () => {
  const store = createMailStore();
  store.add('Drafts', scheduledSource(), ['\\Draft']);
  const submits = [];
  const b = device(store, OTHER, { submits });
  await b.run(Date.parse(DUE) + 30_000); // owner's turn
  assert.equal(submits.length, 0);
  await b.run(NOW); // owner did not send it within the grace period
  assert.equal(submits.length, 1);
  assert.equal(submits[0].by, OTHER);
});

test('Send later: crash after the claim but before SMTP is recovered, never stuck (AUD-002)', async () => {
  // The owner set its claim and died: on restart it continues with its own claim.
  const store = createMailStore();
  const uid = store.add('Drafts', scheduledSource(), ['\\Draft', CLAIM_OWNER_FLAG]);
  const submits = [];
  assert.equal((await listScheduled(store.client())).items[0].state, 'claimed');
  await device(store, OWNER, { submits }).run();
  assert.equal(submits.length, 1);

  // A non-owner's claim left behind: the owner waits for the lease, then the message goes out.
  const store2 = createMailStore();
  store2.add('Drafts', scheduledSource(), ['\\Draft', CLAIM_OTHER_FLAG]);
  const submits2 = [];
  const owner = device(store2, OWNER, { submits: submits2 });
  await owner.run(NOW);
  assert.equal(submits2.length, 0, 'claim is young: may belong to a running device');
  await owner.run(NOW + CLAIM_LEASE_MS + 1); // lease expired: claim released
  await owner.run(NOW + CLAIM_LEASE_MS + 30_000);
  assert.equal(submits2.length, 1);
  void uid;
});

test('Send later: crash after SMTP started stays visible as unconfirmed and is not resent (AUD-002)', async () => {
  const store = createMailStore();
  const uid = store.add('Drafts', scheduledSource(), ['\\Draft', CLAIM_OWNER_FLAG, SENDING_FLAG]);
  const submits = [];
  const owner = device(store, OWNER, { submits });
  for (let i = 0; i < 3; i++) await owner.run(NOW + i * 60_000);
  assert.equal(submits.length, 0, 'never retried automatically');
  const { items } = await listScheduled(store.client());
  assert.equal(items[0].state, 'uncertain');
  // A copy in "Sent" settles it: marked sent and removed from Drafts.
  const settled = await owner.run(NOW, { wasSent: async id => id === '<offer-1@example.test>' });
  assert.deepEqual(settled.results, [{ uid, sent: true, confirmed: true, subject: 'Offer 1' }]);
  assert.equal(store.messages('Drafts').length, 0);
  assert.equal(submits.length, 0);
});

test('Send later: SMTP errors are classified – before DATA retry or failed, during DATA unconfirmed', async () => {
  const cases = [
    [{ command: 'CONN', code: 'ECONNECTION' }, 'retry', []],
    [{ command: 'RCPT TO', responseCode: 550 }, 'failed', [FAILED_FLAG]],
    [{ command: 'DATA', code: 'ETIMEDOUT' }, 'uncertain', [SENDING_FLAG]],
    [{ code: 'ECONNRESET' }, 'uncertain', [SENDING_FLAG]]
  ];
  for (const [error, expected, flags] of cases) {
    const store = createMailStore();
    const uid = store.add('Drafts', scheduledSource(), ['\\Draft']);
    const result = await device(store, OWNER, {
      submit: async () => Promise.reject(Object.assign(new Error('smtp'), error))
    }).run();
    const r = result.results[0];
    assert.equal(r.retry ? 'retry' : r.uncertain ? 'uncertain' : 'failed', expected, JSON.stringify(error));
    const left = store.flagsOf('Drafts', uid);
    for (const f of flags) assert.ok(left.has(f), `${expected}: ${f}`);
    if (expected === 'retry') assert.equal(left.has(SENDING_FLAG), false);
    if (expected === 'failed') assert.equal(left.has(SENDING_FLAG), false);
  }
});

test('Send later: a message already sent but not cleaned up is only cleaned up', async () => {
  const store = createMailStore();
  store.add('Drafts', scheduledSource(), ['\\Draft', SENDING_FLAG, SENT_FLAG]);
  const submits = [];
  await device(store, OWNER, { submits }).run();
  assert.equal(submits.length, 0);
  assert.equal(store.messages('Drafts').length, 0);
});

test('Schedule: lost APPEND answer never stores a second copy (AUD-004)', async () => {
  const store = createMailStore();
  const draftId = '99999999-2222-3333-4444-555555555555';
  const raw = Buffer.from(scheduledSource({ draftId }));
  // Stored by the server, but the answer is lost.
  const flaky = store.client({ failAppend: () => 'after' });
  await assert.rejects(scheduleMessage(flaky, raw, '', { draftId }), err => err.uncertain === true);
  assert.equal(store.messages('Drafts').length, 1, 'no blind second APPEND');
  assert.deepEqual(await findScheduled(store.client(), draftId), { folder: 'Drafts', uid: 1 });
  // A definite refusal of the keyword: stored once without it.
  const store2 = createMailStore();
  const picky = store2.client({ failAppend: flags => (flags.includes('$LevuvoScheduled') ? 'refuse' : null) });
  const stored = await scheduleMessage(picky, raw, '', { draftId });
  assert.equal(stored.uid, 1);
  assert.equal(store2.messages('Drafts').length, 1);
  // Connection lost before the server stored anything: reported as unconfirmed, nothing stored.
  const store3 = createMailStore();
  await assert.rejects(
    scheduleMessage(store3.client({ failAppend: () => 'before' }), raw, '', { draftId }),
    err => err.code === 'schedule_unconfirmed'
  );
  assert.equal(await findScheduled(store3.client(), draftId), null);
});

test('Schedule: the same request ID creates one scheduled message (AUD-008)', async () => {
  const store = createMailStore();
  const draftId = '77777777-2222-3333-4444-555555555555';
  const raw = Buffer.from(scheduledSource({ draftId }));
  const first = await scheduleMessage(store.client(), raw, '', { draftId });
  const second = await scheduleMessage(store.client(), raw, '', { draftId });
  assert.equal(second.uid, first.uid);
  assert.equal(second.existing, true);
  assert.equal(store.messages('Drafts').length, 1);
  // A normal draft with the same ID (no send time) is not mistaken for the scheduled one.
  const store2 = createMailStore();
  store2.add('Drafts', `From: me@example.test\r\nX-Levuvo-Draft-ID: ${draftId}\r\nSubject: x\r\n\r\nx\r\n`, [
    '\\Draft'
  ]);
  const created = await scheduleMessage(store2.client(), raw, '', { draftId });
  assert.equal(created.existing, undefined);
  assert.equal(store2.messages('Drafts').length, 2);
});

test('Schedule: refused on servers that cannot store the send state', async () => {
  const store = createMailStore({ permanentFlags: ['\\Seen', '\\Draft', '\\Deleted'] });
  await assert.rejects(scheduleMessage(store.client(), Buffer.from(scheduledSource()), ''), {
    code: 'schedule_unsupported'
  });
  assert.equal(store.messages('Drafts').length, 0);
});

test('Send later: messages scheduled by version 2.2.2 (no owner) are still sent once', async () => {
  const store = createMailStore();
  store.add('Drafts', scheduledSource({ owner: null }), ['\\Draft']);
  const submits = [];
  await device(store, OTHER, { submits }).run(Date.parse(DUE) + 1000);
  assert.equal(submits.length, 1);
  // An old "$LevuvoSending" without anything else is shown as unconfirmed, not hidden.
  const store2 = createMailStore();
  store2.add('Drafts', scheduledSource({ owner: null }), ['\\Draft', SENDING_FLAG]);
  assert.equal((await listScheduled(store2.client())).items[0].state, 'uncertain');
});
