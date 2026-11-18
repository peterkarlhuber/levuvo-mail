// End-to-end cryptography for shared spaces.
//
// Every Levuvo installation has one space identity: an Ed25519 key pair for signatures and an
// X25519 key pair for receiving keys. Space content is encrypted with a symmetric space key
// (AES-256-GCM) that changes ("epoch") whenever a member is removed. Space keys reach members
// wrapped for their X25519 key (ephemeral ECDH + HKDF-SHA256 + AES-256-GCM). Mail providers on
// the way only ever see ciphertext.
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  sign as edSign,
  verify as edVerify
} from 'node:crypto';

const bad = message => new Error(message);
const b64u = buf => Buffer.from(buf).toString('base64url');
const unb64u = text => Buffer.from(String(text || ''), 'base64url');
const WRAP_INFO = Buffer.from('levuvo-spaces-wrap-v1');

/** Stable JSON: object keys sorted, so a signature covers exactly one byte sequence. */
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const keys = Object.keys(value)
    .filter(k => value[k] !== undefined)
    .sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}

const rawPublic = (key, kty) => {
  const jwk = key.export({ format: 'jwk' });
  if (jwk.kty !== 'OKP' || jwk.crv !== kty) throw bad('unexpected key type');
  return jwk.x;
};
const publicFrom = (x, crv) => createPublicKey({ key: { kty: 'OKP', crv, x }, format: 'jwk' });

/** Member ID: first 16 bytes of SHA-256 over both public keys, hex. */
export function memberIdOf(signPub, boxPub) {
  return createHash('sha256').update(`${signPub}.${boxPub}`).digest('hex').slice(0, 32);
}

/** Human-comparable safety code (like Signal's safety numbers), 6 groups of 4 digits. */
export function safetyCode(signPub, boxPub) {
  const digest = createHash('sha256').update(`levuvo-safety.${signPub}.${boxPub}`).digest();
  const groups = [];
  for (let i = 0; i < 6; i++) groups.push(String(digest.readUInt32BE(i * 4) % 10000).padStart(4, '0'));
  return groups.join(' ');
}

export function createIdentity() {
  const sign = generateKeyPairSync('ed25519');
  const box = generateKeyPairSync('x25519');
  return {
    v: 1,
    signPub: rawPublic(sign.publicKey, 'Ed25519'),
    signPriv: sign.privateKey.export({ format: 'jwk' }).d,
    boxPub: rawPublic(box.publicKey, 'X25519'),
    boxPriv: box.privateKey.export({ format: 'jwk' }).d,
    createdAt: new Date().toISOString()
  };
}

export function validIdentity(identity) {
  return (
    identity?.v === 1 &&
    ['signPub', 'signPriv', 'boxPub', 'boxPriv'].every(k => /^[A-Za-z0-9_-]{43}$/.test(identity[k] || ''))
  );
}

/** Wraps a raw identity (from the keychain) with the operations the space code needs. */
export function identityKeys(identity) {
  if (!validIdentity(identity)) throw bad('invalid space identity');
  const signKey = createPrivateKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: identity.signPub, d: identity.signPriv },
    format: 'jwk'
  });
  const boxKey = createPrivateKey({
    key: { kty: 'OKP', crv: 'X25519', x: identity.boxPub, d: identity.boxPriv },
    format: 'jwk'
  });
  const id = memberIdOf(identity.signPub, identity.boxPub);
  return {
    id,
    signPub: identity.signPub,
    boxPub: identity.boxPub,
    safetyCode: safetyCode(identity.signPub, identity.boxPub),
    sign: data => b64u(edSign(null, Buffer.from(canonical(data)), signKey)),
    unwrap: wrapped => unwrapKey(wrapped, boxKey, identity.boxPub)
  };
}

export function verifySignature(data, signature, signPub) {
  try {
    return edVerify(null, Buffer.from(canonical(data)), publicFrom(signPub, 'Ed25519'), unb64u(signature));
  } catch {
    return false;
  }
}

/** Signs `body` (without `sig`) and returns a copy with the signature attached. */
export function signed(keys, body) {
  const rest = { ...body };
  delete rest.sig;
  return { ...rest, sig: keys.sign(rest) };
}
export function signatureValid(body, signPub) {
  if (!body || typeof body.sig !== 'string') return false;
  const { sig, ...rest } = body;
  return verifySignature(rest, sig, signPub);
}

export const newSymmetricKey = () => randomBytes(32);

/** AES-256-GCM; `aad` binds the ciphertext to its context (space, epoch, purpose). */
export function seal(key, plaintext, aad = '') {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([
    cipher.update(Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext)),
    cipher.final()
  ]);
  return { iv: b64u(iv), tag: b64u(cipher.getAuthTag()), data: b64u(data) };
}
export function open(key, box, aad = '') {
  const decipher = createDecipheriv('aes-256-gcm', key, unb64u(box.iv));
  if (aad) decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(unb64u(box.tag));
  return Buffer.concat([decipher.update(unb64u(box.data)), decipher.final()]);
}

/** Encrypts `key` (32 bytes) so only the owner of `boxPub` can read it. */
export function wrapKey(key, boxPub, context = '') {
  const eph = generateKeyPairSync('x25519');
  const ephPub = rawPublic(eph.publicKey, 'X25519');
  const shared = diffieHellman({ privateKey: eph.privateKey, publicKey: publicFrom(boxPub, 'X25519') });
  const kek = Buffer.from(hkdfSync('sha256', shared, Buffer.from(`${ephPub}.${boxPub}`), WRAP_INFO, 32));
  return { eph: ephPub, ctx: context, ...seal(kek, key, `wrap.${context}`) };
}
function unwrapKey(wrapped, boxKey, boxPub) {
  const shared = diffieHellman({ privateKey: boxKey, publicKey: publicFrom(wrapped.eph, 'X25519') });
  const kek = Buffer.from(hkdfSync('sha256', shared, Buffer.from(`${wrapped.eph}.${boxPub}`), WRAP_INFO, 32));
  return open(kek, wrapped, `wrap.${wrapped.ctx || ''}`);
}

export const sha256 = buf => createHash('sha256').update(buf).digest('hex');
export const randomId = (bytes = 16) => randomBytes(bytes).toString('hex');
export { b64u, unb64u };
