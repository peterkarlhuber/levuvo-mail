// OpenPGP (openpgp.js): own keys (private part only in the OS keychain, passphrase-
// protected), public keys of contacts (crypto.json), PGP/MIME sign/encrypt and
// decrypt/verify including inline PGP.
import * as openpgp from 'openpgp';
import {
  innerAndOuter,
  multipartSigned,
  multipartPgpEncrypted,
  multipartParts,
  contentTypeOf,
  decodePartBody,
  joinMessage,
  toCrlf
} from './mime-crypto.mjs';

const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });
const UNLOCK_MS = 30 * 60 * 1000;

const emailsOf = key => [
  ...new Set(
    key
      .getUserIDs()
      .map(u => /<([^>]+)>/.exec(u)?.[1] || (u.includes('@') ? u : ''))
      .filter(Boolean)
      .map(e => e.toLowerCase())
  )
];

async function describe(key) {
  let expires = null;
  try {
    const e = await key.getExpirationTime();
    expires = e instanceof Date ? e.toISOString() : null;
  } catch {
    /* none */
  }
  return {
    fingerprint: key.getFingerprint().toUpperCase(),
    userIds: key.getUserIDs(),
    emails: emailsOf(key),
    created: key.getCreationTime().toISOString(),
    expires,
    algorithm: key.getAlgorithmInfo().algorithm,
    private: key.isPrivate()
  };
}

/**
 * @param {{ meta: { get():object, save(o):Promise }, vault }} store
 */
export function createPgp({ meta, vault }) {
  const unlocked = new Map(); // fingerprint -> { key, until }
  const data = () => meta.get().pgp || { own: [], public: [] };
  const save = async pgp => meta.save({ ...meta.get(), pgp });
  const secret = fp => {
    try {
      return vault.get('crypto', `pgp:${fp}`) || '';
    } catch {
      return '';
    }
  };

  async function readPublic(armored) {
    try {
      return await openpgp.readKey({ armoredKey: armored });
    } catch {
      throw fail('Kein gültiger OpenPGP-Schlüssel.', 'pgp_key_invalid');
    }
  }
  async function storeOwn(privateKey) {
    const info = await describe(privateKey);
    vault.set('crypto', `pgp:${info.fingerprint}`, privateKey.armor());
    const d = data();
    const own = d.own.filter(k => k.fingerprint !== info.fingerprint);
    own.push({ ...info, publicArmored: privateKey.toPublic().armor() });
    await save({ ...d, own });
    return info;
  }

  function unlockedKeys() {
    const now = Date.now();
    for (const [fp, e] of unlocked) if (e.until < now) unlocked.delete(fp);
    return [...unlocked.values()].map(e => e.key);
  }
  async function publicKeysFor(emails) {
    const d = data();
    const keys = [];
    const missing = [];
    for (const email of emails.map(e => e.toLowerCase())) {
      const hit = d.public.find(k => k.emails.includes(email)) || d.own.find(k => k.emails.includes(email));
      if (hit) keys.push(await readPublic(hit.armored || hit.publicArmored));
      else missing.push(email);
    }
    return { keys, missing };
  }
  async function signingKey(email) {
    const own = data().own.find(k => k.emails.includes(String(email).toLowerCase()));
    if (!own) throw fail(`Kein eigener OpenPGP-Schlüssel für ${email}.`, 'pgp_no_own_key');
    const entry = unlocked.get(own.fingerprint);
    if (!entry || entry.until < Date.now())
      throw fail('Bitte zuerst den OpenPGP-Schlüssel entsperren.', 'pgp_locked', 423);
    return entry.key;
  }
  async function verifications(signatures, extraKeys = []) {
    const d = data();
    const known = await Promise.all(
      [...d.public.map(k => k.armored), ...d.own.map(k => k.publicArmored)].map(a =>
        openpgp.readKey({ armoredKey: a }).catch(() => null)
      )
    );
    const keys = [...known.filter(Boolean), ...extraKeys];
    const out = [];
    for (const sig of signatures || []) {
      let valid;
      try {
        await sig.verified;
        valid = true;
      } catch {
        valid = false;
      }
      const keyId = sig.keyID.toHex().toUpperCase();
      const key = keys.find(k => k.getKeys(sig.keyID).length);
      out.push({
        valid: valid && Boolean(key),
        keyId,
        known: Boolean(key),
        signer: key ? emailsOf(key)[0] || key.getUserIDs()[0] : null,
        fingerprint: key ? key.getFingerprint().toUpperCase() : null
      });
    }
    return out;
  }
  async function verificationKeys() {
    const d = data();
    return (
      await Promise.all(
        [...d.public.map(k => k.armored), ...d.own.map(k => k.publicArmored)].map(a =>
          openpgp.readKey({ armoredKey: a }).catch(() => null)
        )
      )
    ).filter(Boolean);
  }

  return {
    list() {
      const d = data();
      return {
        own: d.own.map(({ publicArmored: _p, ...k }) => ({
          ...k,
          unlocked: (unlocked.get(k.fingerprint)?.until || 0) > Date.now(),
          hasSecret: Boolean(secret(k.fingerprint))
        })),
        public: d.public.map(({ armored: _a, ...k }) => k)
      };
    },
    async generate({ name, email, passphrase }) {
      if (typeof passphrase !== 'string' || passphrase.length < 8)
        throw fail('Die Passphrase muss mindestens 8 Zeichen haben.', 'pgp_passphrase_weak');
      const { privateKey } = await openpgp.generateKey({
        type: 'ecc',
        curve: 'curve25519',
        userIDs: [{ name: String(name || '').slice(0, 120), email }],
        passphrase,
        format: 'object'
      });
      return storeOwn(privateKey);
    },
    /** Imports a public or private key. Unprotected private keys are protected with `passphrase`. */
    async importKey(armored, passphrase = '') {
      if (typeof armored !== 'string' || armored.length > 200_000)
        throw fail('Kein gültiger OpenPGP-Schlüssel.', 'pgp_key_invalid');
      if (armored.includes('PRIVATE KEY BLOCK')) {
        let key;
        try {
          key = await openpgp.readPrivateKey({ armoredKey: armored });
        } catch {
          throw fail('Kein gültiger privater Schlüssel.', 'pgp_key_invalid');
        }
        if (!key.isDecrypted()) {
          try {
            await openpgp.decryptKey({ privateKey: key, passphrase });
          } catch {
            throw fail('Passphrase ist falsch.', 'pgp_passphrase_wrong', 422);
          }
          return storeOwn(key);
        }
        if (typeof passphrase !== 'string' || passphrase.length < 8)
          throw fail(
            'Bitte eine Passphrase (mind. 8 Zeichen) zum Schutz des Schlüssels angeben.',
            'pgp_passphrase_weak'
          );
        return storeOwn(await openpgp.encryptKey({ privateKey: key, passphrase }));
      }
      const key = await readPublic(armored);
      const info = await describe(key);
      const d = data();
      await save({
        ...d,
        public: [...d.public.filter(k => k.fingerprint !== info.fingerprint), { ...info, armored: key.armor() }]
      });
      return info;
    },
    exportPublic(fingerprint) {
      const d = data();
      const k = d.own.find(x => x.fingerprint === fingerprint) || d.public.find(x => x.fingerprint === fingerprint);
      if (!k) throw fail('Schlüssel nicht gefunden.', 'pgp_key_missing', 404);
      return k.publicArmored || k.armored;
    },
    async remove(fingerprint) {
      const d = data();
      unlocked.delete(fingerprint);
      try {
        vault.delete('crypto', `pgp:${fingerprint}`);
      } catch {
        /* not stored */
      }
      await save({
        own: d.own.filter(k => k.fingerprint !== fingerprint),
        public: d.public.filter(k => k.fingerprint !== fingerprint)
      });
    },
    async unlock(fingerprint, passphrase) {
      const armored = secret(fingerprint);
      if (!armored) throw fail('Privater Schlüssel nicht im Schlüsselbund.', 'pgp_key_missing', 404);
      let key;
      try {
        key = await openpgp.decryptKey({
          privateKey: await openpgp.readPrivateKey({ armoredKey: armored }),
          passphrase
        });
      } catch {
        throw fail('Passphrase ist falsch.', 'pgp_passphrase_wrong', 422);
      }
      unlocked.set(fingerprint, { key, until: Date.now() + UNLOCK_MS });
      return { unlockedUntil: new Date(Date.now() + UNLOCK_MS).toISOString() };
    },
    lock() {
      unlocked.clear();
    },
    async missingKeys(emails) {
      return (await publicKeysFor(emails)).missing;
    },

    /** Signs and/or encrypts a complete RFC 5322 message (CRLF). */
    async protect(raw, { sign, encrypt, from, recipients }) {
      const { inner, outer } = innerAndOuter(raw);
      const signingKeys = sign ? [await signingKey(from)] : [];
      if (encrypt) {
        const { keys, missing } = await publicKeysFor([...new Set([...recipients, from])]);
        if (missing.length)
          throw fail(
            `Kein öffentlicher OpenPGP-Schlüssel für: ${missing.join(', ')}`,
            'pgp_recipient_key_missing',
            409
          );
        const message = await openpgp.createMessage({ text: toCrlf(inner), format: 'binary' });
        const armored = await openpgp.encrypt({ message, encryptionKeys: keys, signingKeys, format: 'armored' });
        return multipartPgpEncrypted(outer, armored);
      }
      const message = await openpgp.createMessage({ text: toCrlf(inner).replace(/\r\n$/, ''), format: 'text' });
      const signature = await openpgp.sign({ message, signingKeys, detached: true, format: 'armored' });
      return multipartSigned(outer, inner, signature, {
        protocol: 'application/pgp-signature',
        micalg: 'pgp-sha512',
        signatureType: 'application/pgp-signature',
        signatureName: 'signature.asc'
      });
    },

    /**
     * Unwraps an incoming PGP message. Returns null if the message is not PGP-protected.
     * { raw (decrypted/unwrapped message), encrypted, signatures[], error? }
     */
    async open(raw) {
      const ct = contentTypeOf(raw);
      const { headers } = (await import('./mime-crypto.mjs')).splitMessage(raw);
      const outer = headers.filter(h => !/^(content-|mime-version)/i.test(h.name)).map(h => h.raw);
      if (ct.type === 'multipart/encrypted' && /pgp-encrypted/i.test(ct.param('protocol'))) {
        const parts = multipartParts(raw);
        const armored = parts[1] ? decodePartBody(parts[1]).toString('utf8') : '';
        const keys = unlockedKeys();
        if (!keys.length) return { encrypted: true, locked: true, method: 'pgp', signatures: [] };
        try {
          const message = await openpgp.readMessage({ armoredMessage: armored });
          const { data: inner, signatures } = await openpgp.decrypt({
            message,
            decryptionKeys: keys,
            verificationKeys: await verificationKeys(),
            format: 'binary',
            expectSigned: false
          });
          const innerText = Buffer.from(inner).toString('binary');
          const nested = contentTypeOf(innerText);
          let sigs = await verifications(signatures);
          let rawInner = joinMessage(outer, innerText);
          if (nested.type === 'multipart/signed') {
            const unwrapped = await this.open(rawInner);
            if (unwrapped?.raw) {
              rawInner = unwrapped.raw;
              sigs = [...sigs, ...unwrapped.signatures];
            }
          }
          return { encrypted: true, method: 'pgp', raw: rawInner, signatures: sigs };
        } catch {
          return {
            encrypted: true,
            method: 'pgp',
            error: 'Die Nachricht konnte nicht entschlüsselt werden (falscher oder fehlender Schlüssel).',
            signatures: []
          };
        }
      }
      if (ct.type === 'multipart/signed' && /pgp-signature/i.test(ct.param('protocol'))) {
        const parts = multipartParts(raw);
        if (parts.length < 2) return null;
        try {
          const signature = await openpgp.readSignature({
            armoredSignature: decodePartBody(parts[1]).toString('utf8')
          });
          const message = await openpgp.createMessage({ binary: Buffer.from(parts[0], 'binary') });
          const result = await openpgp.verify({
            message,
            signature,
            verificationKeys: await verificationKeys(),
            expectSigned: false
          });
          return {
            encrypted: false,
            method: 'pgp',
            raw: joinMessage(outer, parts[0]),
            signatures: await verifications(result.signatures)
          };
        } catch {
          return {
            encrypted: false,
            method: 'pgp',
            raw: joinMessage(outer, parts[0]),
            signatures: [{ valid: false, known: false }]
          };
        }
      }
      return null;
    },

    /** Inline PGP in a text body. */
    async openInline(text) {
      if (text.includes('-----BEGIN PGP MESSAGE-----')) {
        const armored = text.slice(
          text.indexOf('-----BEGIN PGP MESSAGE-----'),
          text.indexOf('-----END PGP MESSAGE-----') + 25
        );
        const keys = unlockedKeys();
        if (!keys.length) return { encrypted: true, locked: true, method: 'pgp', signatures: [] };
        try {
          const { data: plain, signatures } = await openpgp.decrypt({
            message: await openpgp.readMessage({ armoredMessage: armored }),
            decryptionKeys: keys,
            verificationKeys: await verificationKeys()
          });
          return { encrypted: true, method: 'pgp', text: plain, signatures: await verifications(signatures) };
        } catch {
          return {
            encrypted: true,
            method: 'pgp',
            error: 'Die Nachricht konnte nicht entschlüsselt werden.',
            signatures: []
          };
        }
      }
      if (text.includes('-----BEGIN PGP SIGNED MESSAGE-----')) {
        try {
          const message = await openpgp.readCleartextMessage({
            cleartextMessage: text.slice(text.indexOf('-----BEGIN PGP SIGNED MESSAGE-----'))
          });
          const result = await openpgp.verify({
            message,
            verificationKeys: await verificationKeys(),
            expectSigned: false
          });
          return {
            encrypted: false,
            method: 'pgp',
            text: message.getText(),
            signatures: await verifications(result.signatures)
          };
        } catch {
          return null;
        }
      }
      return null;
    }
  };
}
