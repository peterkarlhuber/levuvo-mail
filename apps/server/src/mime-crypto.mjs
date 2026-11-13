// MIME helpers shared by PGP/MIME (RFC 3156) and S/MIME (RFC 8551):
// split a message into outer headers and the inner entity, build multipart/signed
// and multipart/encrypted containers, and extract the exact signed bytes.
import { randomBytes } from 'node:crypto';

const CONTENT_HEADERS = new Set([
  'content-type',
  'content-transfer-encoding',
  'content-disposition',
  'content-id',
  'content-description'
]);

export function toCrlf(text) {
  return String(text).replace(/\r?\n/g, '\r\n');
}

/** Splits raw RFC 5322 bytes at the first empty line; returns unfolded header list. */
export function splitMessage(raw) {
  const text = Buffer.isBuffer(raw) ? raw.toString('binary') : String(raw);
  const idx = text.search(/\r?\n\r?\n/);
  const head = idx < 0 ? text : text.slice(0, idx);
  const body = idx < 0 ? '' : text.slice(idx).replace(/^\r?\n\r?\n/, '');
  const headers = [];
  for (const line of head.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && headers.length) headers[headers.length - 1].raw += `\r\n${line}`;
    else if (line.includes(':')) headers.push({ name: line.slice(0, line.indexOf(':')).trim(), raw: line });
  }
  return { headers, body: toCrlf(body) };
}

/** Inner entity = content headers + body; outer = all other headers. */
export function innerAndOuter(raw) {
  const { headers, body } = splitMessage(raw);
  const inner = headers.filter(h => CONTENT_HEADERS.has(h.name.toLowerCase())).map(h => h.raw);
  const outer = headers
    .filter(h => !CONTENT_HEADERS.has(h.name.toLowerCase()) && h.name.toLowerCase() !== 'mime-version')
    .map(h => h.raw);
  return { inner: `${inner.join('\r\n')}\r\n\r\n${body}`, outer };
}

export const boundary = prefix => `----=_${prefix}_${randomBytes(12).toString('hex')}`;
const base64Lines = buf =>
  Buffer.from(buf)
    .toString('base64')
    .replace(/.{1,76}/g, '$&\r\n');

export function multipartSigned(
  outer,
  inner,
  signature,
  { protocol, micalg, signatureType, signatureName, base64 = false }
) {
  const b = boundary('signed');
  return Buffer.from(
    [
      ...outer,
      'MIME-Version: 1.0',
      `Content-Type: multipart/signed; protocol="${protocol}"; micalg=${micalg}; boundary="${b}"`,
      '',
      'This is a cryptographically signed message in MIME format.',
      '',
      `--${b}`,
      inner.replace(/\r\n$/, ''),
      `--${b}`,
      `Content-Type: ${signatureType}; name="${signatureName}"`,
      `Content-Disposition: attachment; filename="${signatureName}"`,
      ...(base64
        ? ['Content-Transfer-Encoding: base64', '', base64Lines(signature).replace(/\r\n$/, '')]
        : ['', String(signature).replace(/\r?\n/g, '\r\n').replace(/\r\n$/, '')]),
      `--${b}--`,
      ''
    ].join('\r\n'),
    'binary'
  );
}

/** PGP/MIME encrypted container (RFC 3156 §4). */
export function multipartPgpEncrypted(outer, armored) {
  const b = boundary('enc');
  return Buffer.from(
    [
      ...outer,
      'MIME-Version: 1.0',
      `Content-Type: multipart/encrypted; protocol="application/pgp-encrypted"; boundary="${b}"`,
      '',
      'This is an OpenPGP/MIME encrypted message (RFC 3156).',
      '',
      `--${b}`,
      'Content-Type: application/pgp-encrypted',
      'Content-Description: PGP/MIME version identification',
      '',
      'Version: 1',
      '',
      `--${b}`,
      'Content-Type: application/octet-stream; name="encrypted.asc"',
      'Content-Disposition: inline; filename="encrypted.asc"',
      '',
      toCrlf(armored).replace(/\r\n$/, ''),
      `--${b}--`,
      ''
    ].join('\r\n'),
    'binary'
  );
}

/** S/MIME enveloped-data (RFC 8551 §3.3). */
export function smimeEnveloped(outer, der) {
  return Buffer.from(
    [
      ...outer,
      'MIME-Version: 1.0',
      'Content-Type: application/pkcs7-mime; smime-type=enveloped-data; name="smime.p7m"',
      'Content-Transfer-Encoding: base64',
      'Content-Disposition: attachment; filename="smime.p7m"',
      '',
      base64Lines(der).replace(/\r\n$/, ''),
      ''
    ].join('\r\n'),
    'binary'
  );
}

function headerParam(value, name) {
  const m = new RegExp(`${name}\\s*=\\s*(?:"([^"]+)"|([^;\\s]+))`, 'i').exec(value || '');
  return m ? m[1] || m[2] : '';
}
export function contentTypeOf(rawOrHeaders) {
  const { headers } = Array.isArray(rawOrHeaders) ? { headers: rawOrHeaders } : splitMessage(rawOrHeaders);
  const h = headers.find(x => x.name.toLowerCase() === 'content-type');
  const value = h
    ? h.raw
        .slice(h.raw.indexOf(':') + 1)
        .replace(/\r\n[ \t]+/g, ' ')
        .trim()
    : 'text/plain';
  return { type: value.split(';')[0].trim().toLowerCase(), value, param: name => headerParam(value, name) };
}

/** Exact bytes of the parts of a top-level multipart body (signed content must stay byte-identical). */
export function multipartParts(raw) {
  const ct = contentTypeOf(raw);
  const b = ct.param('boundary');
  if (!b) return [];
  const { body } = splitMessage(raw);
  const delimiter = `--${b}`;
  const parts = [];
  let pos = body.indexOf(delimiter);
  while (pos >= 0) {
    const lineEnd = body.indexOf('\r\n', pos);
    if (lineEnd < 0 || body.slice(pos, pos + delimiter.length + 2) === `${delimiter}--`) break;
    const next = body.indexOf(`\r\n${delimiter}`, lineEnd);
    if (next < 0) break;
    parts.push(body.slice(lineEnd + 2, next));
    pos = next + 2;
  }
  return parts;
}

export function decodePartBody(part) {
  const { headers, body } = splitMessage(part);
  const cte = headers
    .find(h => h.name.toLowerCase() === 'content-transfer-encoding')
    ?.raw.split(':')[1]
    ?.trim()
    .toLowerCase();
  if (cte === 'base64') return Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');
  return Buffer.from(body, 'binary');
}

/** Rebuilds a full message from outer headers and decrypted/unwrapped inner entity. */
export function joinMessage(outerHeaders, inner) {
  return Buffer.concat([
    Buffer.from(`${outerHeaders.join('\r\n')}\r\nMIME-Version: 1.0\r\n`, 'binary'),
    Buffer.from(toCrlf(inner), 'binary')
  ]);
}
