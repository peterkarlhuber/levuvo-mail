import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createLocalIndex, encrypt, decrypt, normalize } from '../src/local-index.mjs';

function mailbox(messages) {
  return {
    mailbox: { exists: messages.length, uidValidity: 7 },
    getMailboxLock: async () => ({ release() {} }),
    search: async () => messages.map(m => m.uid),
    async *fetch(uids, query) {
      for (const uid of uids) {
        const m = messages.find(x => x.uid === uid);
        if (!m) continue;
        if (query.bodyParts) yield { uid, bodyParts: new Map([['1', Buffer.from(m.text)]]) };
        else
          yield {
            uid,
            envelope: { subject: m.subject, from: [{ name: m.from, address: `${m.from.toLowerCase()}@x.at` }], to: [] },
            internalDate: new Date(m.date),
            flags: new Set(),
            bodyStructure: { type: 'text/plain' }
          };
      }
    }
  };
}

test('Index is encrypted, matches without umlauts/case, removes deleted messages', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lv-index-'));
  try {
    const key = randomBytes(32);
    const index = createLocalIndex({ dir, getKey: async () => key });
    const msgs = [
      { uid: 1, subject: 'Angebot für Müller', from: 'Anna', text: 'Die Preise für Olivenöl', date: '2026-10-01' },
      { uid: 2, subject: 'Rechnung', from: 'Max', text: 'Zahlbar bis Freitag', date: '2026-10-02' }
    ];
    await index.sync(mailbox(msgs), 'acc', [
      { path: 'INBOX', flags: new Set() },
      { path: 'INBOX.Trash', specialUse: '\\Trash', flags: new Set() }
    ]);
    const file = readdirSync(dir).find(f => f.endsWith('.lvx'));
    const bytes = readFileSync(join(dir, file));
    assert.ok(
      !bytes.includes(Buffer.from('Olivenöl')) && !bytes.includes(Buffer.from('Rechnung')),
      'plain text not in the file'
    );
    assert.deepEqual(
      (await index.search(['acc'], 'MULLER olivenol')).map(h => h.uid),
      [1]
    );
    assert.deepEqual(
      (await index.search(['acc'], 'rechnung')).map(h => h.uid),
      [2]
    );
    const reopened = createLocalIndex({ dir, getKey: async () => key });
    assert.equal((await reopened.status('acc')).messages, 2);
    await reopened.sync(mailbox(msgs.slice(0, 1)), 'acc', [{ path: 'INBOX', flags: new Set() }]);
    assert.deepEqual(await reopened.search(['acc'], 'rechnung'), []);
    const wrongKey = createLocalIndex({ dir, getKey: async () => randomBytes(32) });
    assert.equal((await wrongKey.status('acc')).messages, 0, 'wrong key → empty index');
    assert.equal((await createLocalIndex({ dir, getKey: async () => null }).status('acc')).enabled, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Encryption detects tampering; normalization', () => {
  const key = randomBytes(32);
  const blob = encrypt(key, { a: 1 });
  assert.deepEqual(decrypt(key, blob), { a: 1 });
  blob[blob.length - 1] ^= 1;
  assert.throws(() => decrypt(key, blob));
  assert.equal(normalize('Größe Ärger'), 'grosse arger');
});

test('Index file is only rewritten when something changed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lv-index-'));
  try {
    const key = randomBytes(32);
    const index = createLocalIndex({ dir, getKey: async () => key });
    const msgs = [{ uid: 1, subject: 'Hallo', from: 'Anna', text: 'Text', date: '2026-10-01' }];
    const folders = [{ path: 'INBOX', flags: new Set() }];
    await index.sync(mailbox(msgs), 'acc', folders);
    const file = join(
      dir,
      readdirSync(dir).find(f => f.endsWith('.lvx'))
    );
    const first = readFileSync(file);
    await index.sync(mailbox(msgs), 'acc', folders);
    assert.ok(readFileSync(file).equals(first), 'unchanged index is not re-encrypted and rewritten');
    await index.sync(
      mailbox([...msgs, { uid: 2, subject: 'Neu', from: 'Max', text: 'x', date: '2026-10-02' }]),
      'acc',
      folders
    );
    assert.ok(!readFileSync(file).equals(first), 'a new message is saved');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
