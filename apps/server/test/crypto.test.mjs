import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPgp } from '../src/pgp.mjs';
import { createSmime } from '../src/smime.mjs';
import { composeRawEmail } from '../src/send-service.mjs';
import { innerAndOuter, multipartParts, contentTypeOf, splitMessage } from '../src/mime-crypto.mjs';

const fixture = name => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
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
const message = () =>
  composeRawEmail(
    { name: 'Peter', address: 'peter@example.org' },
    {
      to: ['anna@example.org'],
      cc: [],
      bcc: [],
      subject: 'Vertraulich',
      text: 'Hallo Anna – äöü\nZeile 2',
      html: '<p>Hallo <b>Anna</b></p>',
      attachments: [{ filename: 'a.txt', content: Buffer.from('Anhang') }]
    }
  );

test('MIME: content and outer headers are cleanly separated', async () => {
  const { inner, outer } = innerAndOuter(await message());
  assert.match(inner, /^Content-Type: multipart\/mixed/);
  assert.ok(outer.some(h => h.startsWith('Subject:')));
  assert.ok(!outer.some(h => /^content-type/i.test(h)));
});

test('OpenPGP: generate keys, sign, encrypt, open, detect tampering', async () => {
  const { meta, vault } = memory();
  const peter = createPgp({ meta, vault });
  await assert.rejects(peter.generate({ name: 'P', email: 'peter@example.org', passphrase: 'kurz' }), {
    code: 'pgp_passphrase_weak'
  });
  const own = await peter.generate({ name: 'Peter', email: 'peter@example.org', passphrase: 'geheim-1234' });
  assert.match(vault.get('crypto', `pgp:${own.fingerprint}`), /ENCRYPTED|PRIVATE KEY/);
  const annaStore = memory();
  const anna = createPgp(annaStore);
  const annaKey = await anna.generate({ name: 'Anna', email: 'anna@example.org', passphrase: 'geheim-5678' });
  await peter.importKey(anna.exportPublic(annaKey.fingerprint));
  await anna.importKey(peter.exportPublic(own.fingerprint));
  const raw = await message();
  await assert.rejects(
    peter.protect(raw, { sign: true, from: 'peter@example.org', recipients: ['anna@example.org'] }),
    { code: 'pgp_locked' }
  );
  await assert.rejects(peter.unlock(own.fingerprint, 'falsch'), { code: 'pgp_passphrase_wrong' });
  await peter.unlock(own.fingerprint, 'geheim-1234');
  const signed = await peter.protect(raw, {
    sign: true,
    encrypt: false,
    from: 'peter@example.org',
    recipients: ['anna@example.org']
  });
  assert.equal(contentTypeOf(signed).type, 'multipart/signed');
  const verified = await anna.open(signed);
  assert.equal(verified.signatures[0].valid, true);
  assert.equal(verified.signatures[0].signer, 'peter@example.org');
  const tampered = Buffer.from(signed.toString('binary').replace('text/html', 'text/htmx'), 'binary');
  assert.equal((await anna.open(tampered)).signatures[0].valid, false);
  const encrypted = await peter.protect(raw, {
    sign: true,
    encrypt: true,
    from: 'peter@example.org',
    recipients: ['anna@example.org']
  });
  assert.equal(contentTypeOf(encrypted).type, 'multipart/encrypted');
  assert.ok(!encrypted.toString().includes('Hallo Anna'));
  assert.equal((await anna.open(encrypted)).locked, true);
  await anna.unlock(annaKey.fingerprint, 'geheim-5678');
  const opened = await anna.open(encrypted);
  assert.equal(opened.encrypted, true);
  assert.equal(opened.signatures[0].valid, true);
  assert.match(opened.raw.toString('utf8'), /multipart\/alternative/);
  await assert.rejects(
    peter.protect(raw, { encrypt: true, from: 'peter@example.org', recipients: ['fremd@example.org'] }),
    { code: 'pgp_recipient_key_missing' }
  );
});

test('S/MIME: certificates from signed mail are only collected when trusted and matching the sender', async () => {
  const { meta, vault } = memory();
  const smime = createSmime({ meta, vault });
  // Untrusted chain: valid signature, but the certificate is not stored for encryption.
  const untrusted = await smime.open(fixture('openssl-signed.eml'), 'anna@example.org');
  assert.deepEqual([untrusted.signatures[0].valid, untrusted.signatures[0].trusted], [true, false]);
  assert.deepEqual(smime.missingCertificates(['anna@example.org']), ['anna@example.org']);
  await smime.importCertificate(fixture('ca.crt').toString(), { trust: true });
  // Trusted chain, but the From address does not match the certificate.
  await smime.open(fixture('openssl-signed.eml'), 'someone-else@example.org');
  assert.deepEqual(smime.missingCertificates(['anna@example.org']), ['anna@example.org']);
  // Trusted and matching: collected.
  await smime.open(fixture('openssl-signed.eml'), 'anna@example.org');
  assert.deepEqual(smime.missingCertificates(['anna@example.org']), []);
});

test('S/MIME: .p12 import, signing and encryption, reading OpenSSL messages', async () => {
  const { meta, vault } = memory();
  const smime = createSmime({ meta, vault });
  await assert.rejects(smime.importP12(fixture('peter.p12'), 'falsch'), { code: 'smime_p12_password' });
  const own = await smime.importP12(fixture('peter.p12'), 'test-only');
  assert.deepEqual(own.emails, ['peter@example.org']);
  await smime.importCertificate(fixture('anna.crt').toString());
  await smime.importCertificate(fixture('ca.crt').toString(), { trust: true });
  const raw = await message();
  const signed = await smime.protect(raw, {
    sign: true,
    encrypt: false,
    from: 'peter@example.org',
    recipients: ['anna@example.org']
  });
  const v = await smime.open(signed, 'peter@example.org');
  assert.deepEqual([v.signatures[0].valid, v.signatures[0].trusted, v.signatures[0].matchesSender], [true, true, true]);
  const parts = multipartParts(signed);
  assert.equal(parts.length, 2);
  const tampered = Buffer.from(signed.toString('binary').replace('text/html', 'text/htmx'), 'binary');
  assert.equal((await smime.open(tampered, 'peter@example.org')).signatures[0].valid, false);
  const enc = await smime.protect(raw, {
    sign: true,
    encrypt: true,
    from: 'peter@example.org',
    recipients: ['anna@example.org']
  });
  assert.match(contentTypeOf(enc).value, /enveloped-data/);
  const back = await smime.open(enc, 'peter@example.org');
  assert.equal(back.encrypted, true);
  assert.equal(back.signatures[0].valid, true);
  const fromOpenssl = await smime.open(fixture('openssl-signed-encrypted.eml'), 'anna@example.org');
  assert.equal(fromOpenssl.encrypted, true);
  assert.equal(fromOpenssl.signatures[0].valid, true);
  assert.match(fromOpenssl.raw.toString('utf8'), /Hallo von OpenSSL/);
  const signedByOpenssl = await smime.open(fixture('openssl-signed.eml'), 'anna@example.org');
  assert.deepEqual([signedByOpenssl.signatures[0].valid, signedByOpenssl.signatures[0].trusted], [true, true]);
  await assert.rejects(
    smime.protect(raw, { encrypt: true, from: 'peter@example.org', recipients: ['fremd@example.org'] }),
    { code: 'smime_recipient_cert_missing' }
  );
  assert.ok(splitMessage(enc).headers.some(h => /^Subject/i.test(h.name)));
});
