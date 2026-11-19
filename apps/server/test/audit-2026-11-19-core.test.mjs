// Regression tests for the mail core findings of the audit of 2026-11-19 (second round).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPgp } from '../src/pgp.mjs';
import { chainTrusted } from '../src/smime.mjs';
import { composeRawEmail } from '../src/send-service.mjs';

function memory() {
  let state = {};
  const m = new Map();
  return {
    meta: {
      get: () => state,
      save: async o => {
        state = o;
      }
    },
    vault: {
      get: (i, k) => m.get(`${i}:${k}`) || '',
      set: (i, k, v) => m.set(`${i}:${k}`, v),
      delete: (i, k) => m.delete(`${i}:${k}`)
    }
  };
}

test('SEC-LEV-002: a PGP signature is bound to the From address; keys from mails must carry the sender', async () => {
  const peter = createPgp(memory());
  const anna = createPgp(memory());
  const own = await peter.generate({ name: 'Peter', email: 'peter@example.org', passphrase: 'geheim-1234' });
  await peter.unlock(own.fingerprint, 'geheim-1234');
  await anna.importKey(peter.exportPublic(own.fingerprint));
  const raw = await composeRawEmail(
    { name: 'Peter', address: 'peter@example.org' },
    { to: ['anna@example.org'], cc: [], bcc: [], subject: 'Zahlung', text: 'Bitte überweisen.', attachments: [] }
  );
  const signed = await peter.protect(raw, { sign: true, from: 'peter@example.org', recipients: [] });
  const genuine = await anna.open(signed, 'peter@example.org');
  assert.deepEqual([genuine.signatures[0].valid, genuine.signatures[0].matchesSender], [true, true]);
  // Same valid signature, but the mail claims to come from the boss: no green seal.
  const forged = await anna.open(signed, 'chef@firma.example');
  assert.deepEqual([forged.signatures[0].valid, forged.signatures[0].matchesSender], [true, false]);
  // A key attached to a mail is only taken over when it belongs to that mail's sender.
  await assert.rejects(anna.importKey(peter.exportPublic(own.fingerprint), '', { onlyFor: 'chef@firma.example' }), {
    code: 'pgp_key_sender'
  });
  const ok = await anna.importKey(peter.exportPublic(own.fingerprint), '', { onlyFor: 'Peter@Example.org' });
  assert.equal(ok.fingerprint, own.fingerprint);
});

test('SEC-LEV-005: S/MIME chains need real CAs, path length and emailProtection', () => {
  const pem = readFileSync(new URL('./fixtures/smime-chains.pem', import.meta.url), 'utf8');
  const [root, inter, inter0, sub, noca, leafInter, leafNoca, leafSub, leafWeb] = pem
    .match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)
    .map(b => Buffer.from(b.replace(/-----[^-]+-----|\s/g, ''), 'base64'));
  const trust = [root];
  assert.equal(chainTrusted(leafInter, [inter], trust), true, 'regular chain');
  assert.equal(chainTrusted(leafNoca, [noca], trust), false, 'a user certificate is no CA');
  assert.equal(chainTrusted(leafSub, [sub, inter0], trust), false, 'pathlen 0 forbids a sub CA');
  assert.equal(chainTrusted(leafWeb, [inter], trust), false, 'leaf without emailProtection');
  assert.equal(chainTrusted(leafInter, [inter], []), false, 'untrusted root');
});

test('REL-LEV-014: a watcher stopped during the token refresh or connect leaves no connection open', async () => {
  const { EventEmitter } = await import('node:events');
  const { createWatcherPool } = await import('../src/inbox-watcher.mjs');
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const made = [];
  let releaseConnect;
  const factory = () => {
    const c = new EventEmitter();
    c.closed = false;
    c.mailbox = { exists: 0, uidValidity: 1, uidNext: 1 };
    c.connect = () => new Promise(r => (releaseConnect = r));
    c.mailboxOpen = async () => {};
    c.getMailboxLock = async () => ({ release() {} });
    c.fetch = async function* () {};
    c.search = async () => [];
    c.logout = async () => c.close();
    c.close = () => {
      c.closed = true;
      c.emit('close');
    };
    made.push(c);
    return c;
  };
  const account = { id: 'a', imap: { configured: true, host: 'h', port: 993, user: 'a@x.at', password: 'p' } };
  // Stopped while the OAuth token is refreshed: no connection is made at all.
  let releaseToken;
  const pool = createWatcherPool({
    clientFactory: factory,
    prepare: () => new Promise(r => (releaseToken = () => r(account.imap)))
  });
  pool.sync([account]);
  await wait(10);
  pool.stopAll();
  releaseToken();
  await wait(20);
  assert.equal(made.length, 0);
  // Stopped while connecting: the new connection is closed right after it is up.
  const pool2 = createWatcherPool({ clientFactory: factory });
  pool2.sync([account]);
  await wait(10);
  pool2.stopAll();
  releaseConnect();
  await wait(20);
  assert.equal(made.length, 1);
  assert.equal(made[0].closed, true);
});

test('REL-LEV-012: an account added during the login test of another account is not overwritten', async () => {
  const { mkdtemp, readFile } = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const { createAccountManager } = await import('../src/managed-accounts.mjs');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'levuvo-rel012-'));
  const filename = path.join(dir, 'accounts.json');
  const secrets = new Map();
  const vault = {
    available: true,
    set: (i, k, v) => secrets.set(`${i}:${k}`, v),
    get: (i, k) => secrets.get(`${i}:${k}`) || '',
    delete: (i, k) => secrets.delete(`${i}:${k}`)
  };
  let release;
  const gate = new Promise(r => (release = r));
  const verify = async config => {
    if (config.imap.password === 'slow-new-password') await gate;
  };
  const manager = await createAccountManager({ env: {}, filename, vault, verify });
  const base = { imapHost: 'mail.example.org', smtpHost: 'mail.example.org', imapPort: 993, smtpPort: 587 };
  const first = await manager.create({ ...base, label: 'A', user: 'a@example.org', password: 'secret-a-1' });
  const updating = manager.update(first.id, {
    ...base,
    label: 'A',
    user: 'a@example.org',
    password: 'slow-new-password'
  });
  await new Promise(r => setTimeout(r, 10));
  const second = await manager.create({ ...base, label: 'B', user: 'b@example.org', password: 'secret-b-1' });
  release();
  await updating;
  const stored = JSON.parse(await readFile(filename, 'utf8'))
    .accounts.map(a => a.id)
    .sort();
  assert.deepEqual(stored, [first.id, second.id].sort());
  // An update of an account that was removed meanwhile does not bring it back.
  let release2;
  const gate2 = new Promise(r => (release2 = r));
  const verify2 = async config => {
    if (config.imap.password === 'slow-new-password') await gate2;
  };
  const m2 = await createAccountManager({ env: {}, filename, vault, verify: verify2 });
  const pending = m2.update(second.id, { ...base, label: 'B', user: 'b@example.org', password: 'slow-new-password' });
  await new Promise(r => setTimeout(r, 10));
  await m2.remove(second.id);
  release2();
  await assert.rejects(pending, /inzwischen entfernt/);
  assert.equal(
    m2.all().some(a => a.id === second.id),
    false
  );
});

test('PERF-LEV-003: the first index build continues in short batches instead of every 15 minutes', async () => {
  const { createIndexRunner } = await import('../src/index-runner.mjs');
  const pending = [];
  const timers = {
    setTimeout: (fn, ms) => {
      const h = { fn, ms };
      pending.push(h);
      return h;
    },
    clearTimeout: h => pending.splice(pending.indexOf(h), 1)
  };
  let left = 3;
  const budgets = [];
  const runner = createIndexRunner({
    accounts: () => [{ id: 'a', imap: { configured: true } }],
    enabled: () => true,
    withImap: fn => fn({ list: async () => [] }),
    localIndex: {
      sync: async (_c, _id, _f, { budget }) => {
        budgets.push(budget);
        left--;
        return { enabled: true, complete: left <= 0 };
      }
    },
    diagnostics: { record() {} },
    timers
  });
  // Not started: a manual run does not schedule catch-up batches.
  assert.deepEqual(await runner.run(), { ran: true, incomplete: true });
  assert.equal(pending.length, 0);
  left = 3;
  runner.start();
  await runner.run();
  assert.equal(pending.length, 1);
  assert.ok(pending[0].ms <= 60_000, 'catch-up follows within a minute');
  pending.shift().fn();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.length, 1, 'still incomplete: another batch is scheduled');
  pending.shift().fn();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.length, 0, 'complete: no more catch-up');
  // stop() cancels a pending catch-up.
  left = 5;
  await runner.run();
  assert.equal(pending.length, 1);
  runner.stop();
  assert.equal(pending.length, 0);
  assert.deepEqual([...new Set(budgets)], [1500]);
});

test('QA-LEV-004 (SEC-03): a PGP message that unpacks to more than 16 MiB is refused, a normal one opens', async () => {
  const openpgp = await import('openpgp');
  const anna = createPgp(memory());
  const own = await anna.generate({ name: 'Anna', email: 'anna@example.org', passphrase: 'geheim-1234' });
  await anna.unlock(own.fingerprint, 'geheim-1234');
  const encryptionKeys = await openpgp.readKey({ armoredKey: anna.exportPublic(own.fingerprint) });
  const config = { preferredCompressionAlgorithm: openpgp.enums.compression.zlib };
  const seal = async text =>
    openpgp.encrypt({ message: await openpgp.createMessage({ text }), encryptionKeys, config });
  const bomb = await seal('A'.repeat(17 * 1024 * 1024));
  assert.ok(bomb.length < 1024 * 1024, 'the message itself is small');
  const refused = await anna.openInline(bomb);
  assert.equal(refused.text, undefined);
  assert.match(refused.error, /nicht entschlüsselt/);
  const fine = await anna.openInline(await seal('Hallo Anna'));
  assert.equal(fine.text, 'Hallo Anna');
});
