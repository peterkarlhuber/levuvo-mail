// S/MIME (RFC 8551) with PKI.js for ASN.1/CMS and Node crypto for RSA/AES.
// Own certificate + private key imported from PKCS#12 (.p12/.pfx); the key is kept only
// in the OS keychain. Signing: CMS SignedData (SHA-256, detached, multipart/signed).
// Encryption: CMS EnvelopedData, AES-256-CBC, RSA key transport (PKCS#1 v1.5 for the
// widest compatibility; RSA-OAEP is accepted on decryption).
import * as pkijs from 'pkijs';
import * as asn1js from 'asn1js';
import tls from 'node:tls';
import {
  webcrypto,
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  privateDecrypt,
  publicEncrypt,
  createPrivateKey,
  createPublicKey,
  X509Certificate,
  constants
} from 'node:crypto';
import {
  innerAndOuter,
  multipartSigned,
  smimeEnveloped,
  multipartParts,
  contentTypeOf,
  decodePartBody,
  joinMessage,
  splitMessage,
  toCrlf
} from './mime-crypto.mjs';

pkijs.setEngine('node', new pkijs.CryptoEngine({ name: 'node', crypto: webcrypto }));

const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });
const OID = {
  data: '1.2.840.113549.1.7.1',
  signedData: '1.2.840.113549.1.7.2',
  envelopedData: '1.2.840.113549.1.7.3',
  rsa: '1.2.840.113549.1.1.1',
  oaep: '1.2.840.113549.1.1.7',
  aes128: '2.16.840.1.101.3.4.1.2',
  aes192: '2.16.840.1.101.3.4.1.22',
  aes256: '2.16.840.1.101.3.4.1.42',
  des3: '1.2.840.113549.3.7',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingTime: '1.2.840.113549.1.9.5',
  keyBag: '1.2.840.113549.1.12.10.1.2',
  certBag: '1.2.840.113549.1.12.10.1.3',
  email: '1.2.840.113549.1.9.1'
};
const CIPHERS = {
  [OID.aes128]: 'aes-128-cbc',
  [OID.aes192]: 'aes-192-cbc',
  [OID.aes256]: 'aes-256-cbc',
  [OID.des3]: 'des-ede3-cbc'
};
const ab = buf => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const certFromDer = der => pkijs.Certificate.fromBER(ab(Buffer.from(der)));
const derOf = cert => Buffer.from(cert.toSchema(true).toBER(false));

function describeCert(der) {
  const x = new X509Certificate(Buffer.from(der));
  const emails = new Set();
  for (const m of String(x.subjectAltName || '').matchAll(/email:([^,\s]+)/gi)) emails.add(m[1].toLowerCase());
  for (const m of String(x.subject).matchAll(/emailAddress=([^\n,]+)/gi)) emails.add(m[1].trim().toLowerCase());
  return {
    id: createHash('sha256').update(Buffer.from(der)).digest('hex').slice(0, 40).toUpperCase(),
    subject: /CN=([^\n]+)/.exec(x.subject)?.[1] || x.subject,
    issuer: /CN=([^\n]+)/.exec(x.issuer)?.[1] || x.issuer,
    emails: [...emails],
    notBefore: new Date(x.validFrom).toISOString(),
    notAfter: new Date(x.validTo).toISOString(),
    serial: x.serialNumber
  };
}

const MOZILLA_ROOTS = (() => {
  try {
    return tls.rootCertificates.map(pem => new X509Certificate(pem));
  } catch {
    return [];
  }
})();
/** Chain validation against Mozilla roots + user-trusted certificates (no network, no OCSP). */
function chainTrusted(leafDer, chainDers, trustedDers) {
  try {
    const leaf = new X509Certificate(Buffer.from(leafDer));
    const pool = [...chainDers.map(d => new X509Certificate(Buffer.from(d)))];
    const anchors = [...MOZILLA_ROOTS, ...trustedDers.map(d => new X509Certificate(Buffer.from(d)))];
    if (anchors.some(a => a.fingerprint256 === leaf.fingerprint256)) return true;
    let current = leaf;
    for (let depth = 0; depth < 8; depth++) {
      const now = Date.now();
      if (Date.parse(current.validTo) < now || Date.parse(current.validFrom) > now) return false;
      const anchor = anchors.find(a => current.checkIssued(a) && current.verify(a.publicKey));
      if (anchor) return true;
      const issuer = pool.find(c => c !== current && current.checkIssued(c) && current.verify(c.publicKey));
      if (!issuer) return false;
      current = issuer;
    }
  } catch {
    /* invalid */
  }
  return false;
}

async function parseP12(buffer, password) {
  let pfx;
  try {
    pfx = pkijs.PFX.fromBER(ab(buffer));
  } catch {
    throw fail('Keine gültige .p12/.pfx-Datei.', 'smime_p12_invalid');
  }
  const pass = new TextEncoder().encode(password).buffer;
  try {
    await pfx.parseInternalValues({ password: pass, checkIntegrity: true });
    const safe = pfx.parsedValue.authenticatedSafe;
    await safe.parseInternalValues({ safeContents: safe.safeContents.map(() => ({ password: pass })) });
    const bags = safe.parsedValue.safeContents.flatMap(c => c.value.safeBags);
    const keyBag = bags.find(b => b.bagId === OID.keyBag);
    if (!keyBag) throw fail('Die Datei enthält keinen privaten Schlüssel.', 'smime_p12_no_key');
    await keyBag.bagValue.parseInternalValues({ password: pass });
    const pkcs8 = Buffer.from(keyBag.bagValue.parsedValue.toSchema().toBER(false));
    const certs = bags.filter(b => b.bagId === OID.certBag).map(b => derOf(b.bagValue.parsedValue));
    return { pkcs8, certs };
  } catch (err) {
    if (err.code) throw err;
    if (/contentEncryptionAlgorithm|Unknown/i.test(String(err.message))) {
      throw fail(
        'Dieses .p12-Format (RC2/„legacy“) wird nicht unterstützt. Bitte das Zertifikat mit AES-Verschlüsselung exportieren.',
        'smime_p12_legacy'
      );
    }
    throw fail('Passwort falsch oder Datei beschädigt.', 'smime_p12_password', 422);
  }
}

export function createSmime({ meta, vault }) {
  const data = () => meta.get().smime || { own: [], public: [], trusted: [] };
  const save = async smime => meta.save({ ...meta.get(), smime });
  const secret = id => {
    try {
      return vault.get('crypto', `smime:${id}`) || '';
    } catch {
      return '';
    }
  };

  function ownFor(email) {
    const e = String(email || '').toLowerCase();
    return data().own.find(c => c.emails.includes(e) && Date.parse(c.notAfter) > Date.now());
  }
  function certFor(email) {
    const e = String(email || '').toLowerCase();
    const all = [...data().own, ...data().public].filter(
      c => c.emails.includes(e) && Date.parse(c.notAfter) > Date.now()
    );
    return all.sort((a, b) => b.notAfter.localeCompare(a.notAfter))[0] || null;
  }
  async function rememberPublic(der) {
    const info = describeCert(der);
    const d = data();
    if (d.own.some(c => c.id === info.id) || d.public.some(c => c.id === info.id)) return info;
    await save({ ...d, public: [...d.public, { ...info, der: Buffer.from(der).toString('base64') }].slice(-500) });
    return info;
  }

  async function signCms(inner, own) {
    const pkcs8 = Buffer.from(secret(own.id), 'base64');
    if (!pkcs8.length) throw fail('Privater S/MIME-Schlüssel fehlt im Schlüsselbund.', 'smime_key_missing', 404);
    const key = await webcrypto.subtle.importKey(
      'pkcs8',
      pkcs8,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const cert = certFromDer(Buffer.from(own.der, 'base64'));
    const chain = (own.chain || []).map(c => certFromDer(Buffer.from(c, 'base64')));
    const data = Buffer.from(toCrlf(inner).replace(/\r\n$/, ''), 'binary');
    const digest = createHash('sha256').update(data).digest();
    const signed = new pkijs.SignedData({
      version: 1,
      encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: OID.data }),
      signerInfos: [
        new pkijs.SignerInfo({
          version: 1,
          sid: new pkijs.IssuerAndSerialNumber({ issuer: cert.issuer, serialNumber: cert.serialNumber }),
          signedAttrs: new pkijs.SignedAndUnsignedAttributes({
            type: 0,
            attributes: [
              new pkijs.Attribute({
                type: OID.contentType,
                values: [new asn1js.ObjectIdentifier({ value: OID.data })]
              }),
              new pkijs.Attribute({ type: OID.signingTime, values: [new asn1js.UTCTime({ valueDate: new Date() })] }),
              new pkijs.Attribute({
                type: OID.messageDigest,
                values: [new asn1js.OctetString({ valueHex: ab(digest) })]
              })
            ]
          })
        })
      ],
      certificates: [cert, ...chain]
    });
    await signed.sign(key, 0, 'SHA-256', ab(data));
    return Buffer.from(
      new pkijs.ContentInfo({ contentType: OID.signedData, content: signed.toSchema(true) }).toSchema().toBER(false)
    );
  }

  function encryptCms(content, recipientDers) {
    const cek = randomBytes(32);
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-cbc', cek, iv);
    const encrypted = Buffer.concat([cipher.update(Buffer.from(content, 'binary')), cipher.final()]);
    const recipientInfos = recipientDers.map(der => {
      const cert = certFromDer(der);
      const encryptedKey = publicEncrypt(
        { key: new X509Certificate(Buffer.from(der)).publicKey, padding: constants.RSA_PKCS1_PADDING },
        cek
      );
      return new pkijs.RecipientInfo({
        variant: 1,
        value: new pkijs.KeyTransRecipientInfo({
          version: 0,
          rid: new pkijs.IssuerAndSerialNumber({ issuer: cert.issuer, serialNumber: cert.serialNumber }),
          keyEncryptionAlgorithm: new pkijs.AlgorithmIdentifier({
            algorithmId: OID.rsa,
            algorithmParams: new asn1js.Null()
          }),
          encryptedKey: new asn1js.OctetString({ valueHex: ab(encryptedKey) })
        })
      });
    });
    const enveloped = new pkijs.EnvelopedData({
      version: 0,
      recipientInfos,
      encryptedContentInfo: new pkijs.EncryptedContentInfo({
        contentType: OID.data,
        contentEncryptionAlgorithm: new pkijs.AlgorithmIdentifier({
          algorithmId: OID.aes256,
          algorithmParams: new asn1js.OctetString({ valueHex: ab(iv) })
        }),
        encryptedContent: new asn1js.OctetString({ valueHex: ab(encrypted) })
      })
    });
    return Buffer.from(
      new pkijs.ContentInfo({ contentType: OID.envelopedData, content: enveloped.toSchema() }).toSchema().toBER(false)
    );
  }

  function decrypt(der) {
    const info = pkijs.ContentInfo.fromBER(ab(der));
    if (info.contentType !== OID.envelopedData) throw fail('Kein S/MIME-verschlüsselter Inhalt.', 'smime_invalid');
    const env = new pkijs.EnvelopedData({ schema: info.content });
    for (const own of data().own) {
      const cert = certFromDer(Buffer.from(own.der, 'base64'));
      for (const ri of env.recipientInfos) {
        const ktri = ri.value;
        if (ri.variant !== 1 || !ktri.rid?.issuer) continue;
        if (!ktri.rid.issuer.isEqual(cert.issuer) || !ktri.rid.serialNumber.isEqual(cert.serialNumber)) continue;
        const key = createPrivateKey({ key: Buffer.from(secret(own.id), 'base64'), format: 'der', type: 'pkcs8' });
        const alg = ktri.keyEncryptionAlgorithm.algorithmId;
        const encryptedKey = Buffer.from(ktri.encryptedKey.valueBlock.valueHexView);
        const cek = privateDecrypt(
          { key, padding: alg === OID.oaep ? constants.RSA_PKCS1_OAEP_PADDING : constants.RSA_PKCS1_PADDING },
          encryptedKey
        );
        const eci = env.encryptedContentInfo;
        const cipherName = CIPHERS[eci.contentEncryptionAlgorithm.algorithmId];
        if (!cipherName) throw fail('Verschlüsselungsverfahren wird nicht unterstützt.', 'smime_unsupported');
        const iv = Buffer.from(eci.contentEncryptionAlgorithm.algorithmParams.valueBlock.valueHexView);
        const content = eci.encryptedContent;
        const bytes = content.idBlock.isConstructed
          ? Buffer.concat(content.valueBlock.value.map(v => Buffer.from(v.valueBlock.valueHexView)))
          : Buffer.from(content.valueBlock.valueHexView);
        const decipher = createDecipheriv(cipherName, cek, iv);
        return Buffer.concat([decipher.update(bytes), decipher.final()]);
      }
    }
    throw fail('Kein passender privater S/MIME-Schlüssel.', 'smime_no_key', 422);
  }

  async function verify(signatureDer, signedBytes, fromEmail) {
    const info = pkijs.ContentInfo.fromBER(ab(signatureDer));
    const signed = new pkijs.SignedData({ schema: info.content });
    const encapsulated = signed.encapContentInfo.eContent;
    const contentBytes =
      signedBytes ??
      (encapsulated
        ? Buffer.concat(
            encapsulated.idBlock.isConstructed
              ? encapsulated.valueBlock.value.map(v => Buffer.from(v.valueBlock.valueHexView))
              : [Buffer.from(encapsulated.valueBlock.valueHexView)]
          )
        : Buffer.alloc(0));
    let valid;
    let signer = null;
    try {
      const result = await signed.verify({ signer: 0, data: ab(contentBytes), checkChain: false, extendedMode: true });
      valid = result.signatureVerified === true;
      signer = result.signerCertificate || null;
    } catch {
      valid = false;
    }
    const certs = (signed.certificates || []).filter(c => c instanceof pkijs.Certificate).map(derOf);
    const signerDer = signer ? derOf(signer) : null;
    const cert = signerDer ? describeCert(signerDer) : null;
    if (signerDer && valid) await rememberPublic(signerDer);
    const trusted = signerDer
      ? chainTrusted(
          signerDer,
          certs,
          (data().trusted || []).map(t => Buffer.from(t, 'base64'))
        )
      : false;
    return {
      content: contentBytes,
      signature: {
        valid,
        trusted,
        signer: cert?.emails?.[0] || cert?.subject || null,
        issuer: cert?.issuer || null,
        matchesSender: Boolean(cert && fromEmail && cert.emails.includes(String(fromEmail).toLowerCase()))
      }
    };
  }

  return {
    list() {
      const d = data();
      return {
        own: d.own.map(({ der: _d, chain: _c, ...c }) => ({ ...c, hasSecret: Boolean(secret(c.id)) })),
        public: d.public.map(({ der: _d, ...c }) => c),
        trusted: (d.trusted || []).map(t => describeCert(Buffer.from(t, 'base64')))
      };
    },
    async importP12(buffer, password) {
      const { pkcs8, certs } = await parseP12(buffer, password);
      const keyPublic = createPublicKey(createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' })).export({
        format: 'der',
        type: 'spki'
      });
      const leaf = certs.find(c =>
        Buffer.from(new X509Certificate(c).publicKey.export({ format: 'der', type: 'spki' })).equals(keyPublic)
      );
      if (!leaf) throw fail('Zertifikat und privater Schlüssel passen nicht zusammen.', 'smime_p12_mismatch');
      if (new X509Certificate(leaf).publicKey.asymmetricKeyType !== 'rsa')
        throw fail('Derzeit werden nur RSA-Zertifikate unterstützt.', 'smime_unsupported');
      const info = describeCert(leaf);
      if (!info.emails.length) throw fail('Das Zertifikat enthält keine E-Mail-Adresse.', 'smime_no_email');
      vault.set('crypto', `smime:${info.id}`, pkcs8.toString('base64'));
      const d = data();
      const own = [
        ...d.own.filter(c => c.id !== info.id),
        { ...info, der: leaf.toString('base64'), chain: certs.filter(c => c !== leaf).map(c => c.toString('base64')) }
      ];
      await save({ ...d, own });
      return info;
    },
    async importCertificate(pemOrDer, { trust = false } = {}) {
      let der;
      try {
        der = new X509Certificate(pemOrDer).raw;
      } catch {
        throw fail('Kein gültiges Zertifikat.', 'smime_cert_invalid');
      }
      if (trust) {
        const d = data();
        await save({ ...d, trusted: [...new Set([...(d.trusted || []), der.toString('base64')])] });
        return describeCert(der);
      }
      return rememberPublic(der);
    },
    async remove(id) {
      const d = data();
      try {
        vault.delete('crypto', `smime:${id}`);
      } catch {
        /* not stored */
      }
      await save({ ...d, own: d.own.filter(c => c.id !== id), public: d.public.filter(c => c.id !== id) });
    },
    missingCertificates(emails) {
      return emails.filter(e => !certFor(e));
    },
    hasOwn(email) {
      return Boolean(ownFor(email));
    },

    async protect(raw, { sign, encrypt: doEncrypt, from, recipients }) {
      const { inner, outer } = innerAndOuter(raw);
      let entity = inner;
      if (sign) {
        const own = ownFor(from);
        if (!own) throw fail(`Kein gültiges eigenes S/MIME-Zertifikat für ${from}.`, 'smime_no_own_cert', 409);
        const signature = await signCms(inner, own);
        const signedMessage = multipartSigned([], inner, signature, {
          protocol: 'application/pkcs7-signature',
          micalg: 'sha-256',
          signatureType: 'application/pkcs7-signature',
          signatureName: 'smime.p7s',
          base64: true
        });
        if (!doEncrypt) return Buffer.concat([Buffer.from(`${outer.join('\r\n')}\r\n`, 'binary'), signedMessage]);
        entity = signedMessage.toString('binary').replace(/^MIME-Version: 1\.0\r\n/, '');
      }
      const all = [...new Set([...recipients.map(r => r.toLowerCase()), String(from).toLowerCase()])];
      const missing = all.filter(e => !certFor(e));
      if (missing.length)
        throw fail(`Kein S/MIME-Zertifikat für: ${missing.join(', ')}`, 'smime_recipient_cert_missing', 409);
      const der = encryptCms(
        toCrlf(entity),
        all.map(e => Buffer.from(certFor(e).der, 'base64'))
      );
      return smimeEnveloped(outer, der);
    },

    async open(raw, fromEmail) {
      const ct = contentTypeOf(raw);
      const { headers } = splitMessage(raw);
      const outer = headers.filter(h => !/^(content-|mime-version)/i.test(h.name)).map(h => h.raw);
      if (ct.type === 'multipart/signed' && /pkcs7-signature/i.test(ct.param('protocol'))) {
        const parts = multipartParts(raw);
        if (parts.length < 2) return null;
        const result = await verify(decodePartBody(parts[1]), Buffer.from(parts[0], 'binary'), fromEmail).catch(
          () => null
        );
        return {
          encrypted: false,
          method: 'smime',
          raw: joinMessage(outer, parts[0]),
          signatures: [result ? result.signature : { valid: false, trusted: false }]
        };
      }
      if (/^application\/(x-)?pkcs7-mime$/.test(ct.type)) {
        const { body } = splitMessage(raw);
        const der = Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');
        const smimeType = ct.param('smime-type').toLowerCase();
        if (smimeType === 'signed-data') {
          const result = await verify(der, null, fromEmail);
          return {
            encrypted: false,
            method: 'smime',
            raw: joinMessage(outer, result.content.toString('binary')),
            signatures: [result.signature]
          };
        }
        let plain;
        try {
          plain = decrypt(der);
        } catch (err) {
          return {
            encrypted: true,
            method: 'smime',
            error:
              err.code === 'smime_no_key'
                ? 'Kein passender privater S/MIME-Schlüssel.'
                : 'Die Nachricht konnte nicht entschlüsselt werden.',
            signatures: []
          };
        }
        let inner = joinMessage(outer, plain.toString('binary'));
        let signatures = [];
        const nested = await this.open(inner, fromEmail);
        if (nested?.raw) {
          inner = nested.raw;
          signatures = nested.signatures;
        }
        return { encrypted: true, method: 'smime', raw: inner, signatures };
      }
      return null;
    }
  };
}
