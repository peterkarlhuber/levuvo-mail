import test from 'node:test';
import assert from 'node:assert/strict';
import { checkInput, createScreeningStore, knownSenders, normalizeEmail, unknownSenders } from '../src/screening.mjs';

function memoryFile(initial) {
  let value = initial;
  return {
    get: () => value,
    async save(next) {
      value = JSON.parse(JSON.stringify(next));
    }
  };
}

test('screening store: start once, decide, reset, per account', async () => {
  const store = createScreeningStore(memoryFile({ accounts: {} }));
  assert.deepEqual(store.get('a'), { since: null, allowed: [], blocked: [] });
  const started = await store.start('a', new Date('2026-11-18T20:00:00Z'));
  assert.equal(started.since, '2026-11-18T20:00:00.000Z');
  assert.equal((await store.start('a', new Date('2026-12-01T00:00:00Z'))).since, '2026-11-18T20:00:00.000Z');
  await store.decide('a', ' Anna@Example.TEST ', 'allow');
  let entry = await store.decide('a', 'spam@bad.test', 'block');
  assert.deepEqual(entry.allowed, ['anna@example.test']);
  assert.deepEqual(entry.blocked, ['spam@bad.test']);
  // Blocking an accepted sender moves it, reset removes it from both lists.
  entry = await store.decide('a', 'anna@example.test', 'block');
  assert.deepEqual(entry.allowed, []);
  assert.deepEqual(entry.blocked, ['spam@bad.test', 'anna@example.test']);
  entry = await store.decide('a', 'anna@example.test', 'reset');
  assert.deepEqual(entry.blocked, ['spam@bad.test']);
  assert.deepEqual(store.get('b'), { since: null, allowed: [], blocked: [] });
  await assert.rejects(store.decide('a', 'nobody', 'allow'), /E-Mail-Adresse/);
  await assert.rejects(store.decide('a', 'x@y.test', 'maybe'), /Entscheidung/);
  await store.clear('a');
  assert.equal(store.get('a').since, null);
});

test('checkInput and unknownSenders', () => {
  assert.equal(normalizeEmail('A@B.test'), 'a@b.test');
  assert.deepEqual(checkInput({ emails: ['A@x.test', 'a@x.test', 'kaputt', 7] }), ['a@x.test']);
  assert.throws(() => checkInput({}), /Ungültige Anfrage/);
  const emails = ['me@own.test', 'ok@x.test', 'no@x.test', 'friend@x.test', 'new@x.test'];
  assert.deepEqual(
    unknownSenders(emails, {
      own: ['Me@own.test'],
      allowed: ['ok@x.test'],
      blocked: ['no@x.test'],
      known: new Set(['friend@x.test'])
    }),
    ['new@x.test']
  );
  // Without the mailbox history nobody is screened: no mail may disappear by mistake.
  assert.deepEqual(unknownSenders(emails, { known: null }), []);
});

test('knownSenders: recipients of sent mail and inbox senders before the start', async () => {
  const boxes = {
    Sent: [{ uid: 1, envelope: { to: [{ address: 'Anna@x.test' }], cc: [{ address: 'bob@x.test' }] } }],
    INBOX: [
      { uid: 5, envelope: { from: [{ address: 'old@x.test' }] } },
      { uid: 9, envelope: { from: [{ address: 'new@x.test' }] } }
    ]
  };
  let selected = null;
  const searches = [];
  const client = {
    mailbox: null,
    async getMailboxLock(path, options) {
      assert.equal(options.readOnly, true);
      selected = path;
      this.mailbox = { exists: boxes[path].length };
      return { release() {} };
    },
    async search(criteria) {
      searches.push(criteria);
      return [5];
    },
    async *fetch(range) {
      const wanted = String(range);
      for (const m of boxes[selected]) if (wanted.includes(':') || wanted.split(',').includes(String(m.uid))) yield m;
      yield { uid: 99, flags: new Set() };
    }
  };
  const known = await knownSenders(client, { sentFolder: 'Sent', since: '2026-11-18T20:00:00Z' });
  assert.deepEqual([...known].sort(), ['anna@x.test', 'bob@x.test', 'old@x.test']);
  assert.ok(searches[0].before instanceof Date);
});
