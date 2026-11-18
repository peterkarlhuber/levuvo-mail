// Unsubscribing from newsletters via List-Unsubscribe (RFC 2369) and one-click
// List-Unsubscribe-Post (RFC 8058). The one-click POST carries no cookies or other context.
import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });

/** Methods offered by the sender. Only https links are used; mailto targets are validated. */
export function parseUnsubscribe(headers = []) {
  const value = name =>
    headers
      .filter(h => String(h.key || '').toLowerCase() === name)
      .map(h => String(h.value || ''))
      .join(',');
  const list = value('list-unsubscribe');
  if (!list) return null;
  const targets = [...list.matchAll(/<\s*([^>\s]+)\s*>/g)].map(m => m[1].trim());
  let http = null;
  let mailto = null;
  for (const target of targets) {
    if (!http && /^https:\/\//i.test(target)) {
      try {
        const url = new URL(target);
        if (url.protocol === 'https:' && url.toString().length <= 2048) http = url.toString();
      } catch {
        /* ignore broken link */
      }
    }
    if (!mailto && /^mailto:/i.test(target)) mailto = parseMailto(target);
  }
  if (!http && !mailto) return null;
  const oneClick = Boolean(http) && /List-Unsubscribe\s*=\s*One-Click/i.test(value('list-unsubscribe-post'));
  return { http, mailto, oneClick };
}

export function parseMailto(target) {
  try {
    const url = new URL(target);
    const to = decodeURIComponent(url.pathname).trim().toLowerCase();
    if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(to) || to.length > 254) return null;
    const subject = (url.searchParams.get('subject') || 'unsubscribe').replace(/[\r\n]/g, ' ').slice(0, 200);
    const body = (url.searchParams.get('body') || 'unsubscribe').slice(0, 2000);
    return { to, subject, body };
  } catch {
    return null;
  }
}

/** The UI only learns what is possible; the targets stay on the server except the web page link. */
export function publicUnsubscribe(info) {
  if (!info) return null;
  return {
    method: info.oneClick ? 'one-click' : info.mailto ? 'mail' : 'web',
    host: info.http ? new URL(info.http).hostname : null,
    mailto: info.mailto?.to || null,
    url: !info.oneClick && !info.mailto ? info.http : null
  };
}

/** True for every address that is not a public unicast address (IPv4 and IPv6). */
export function privateAddress(address) {
  const ip = String(address || '')
    .replace(/^\[|\]$/g, '')
    .toLowerCase();
  const kind = isIP(ip);
  if (kind === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 || // multicast, reserved, broadcast
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (kind === 6) {
    // IPv4-mapped/compatible forms (::ffff:127.0.0.1, ::ffff:7f00:1) are checked as IPv4.
    const mapped = /^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
    if (mapped) return privateAddress(mapped[1]);
    const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
    if (hex) {
      const n = (parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16);
      return privateAddress([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'));
    }
    return (
      ip === '::' ||
      ip === '::1' ||
      /^f[cd]/.test(ip) || // unique local
      /^fe[89ab]/.test(ip) || // link local
      /^ff/.test(ip) || // multicast
      ip.startsWith('64:ff9b:') || // NAT64
      ip.startsWith('2001:db8') ||
      ip.startsWith('::ffff:')
    );
  }
  return true; // not an IP address at all
}

function privateHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal'))
    return true;
  return isIP(host) ? privateAddress(host) : false;
}

const blocked = () => fail('Diese Abmeldeadresse wird aus Sicherheitsgründen nicht aufgerufen.', 'unsubscribe_blocked');
const unreachable = () =>
  fail('Der Absender ist gerade nicht erreichbar. Bitte später erneut versuchen.', 'unsubscribe_unreachable', 502);

/** Resolves the host once and accepts it only when every address is public. */
async function publicAddress(hostname, lookup) {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return { address: host, family: isIP(host) };
  let found;
  try {
    found = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw unreachable();
  }
  const list = Array.isArray(found) ? found : [found];
  if (!list.length) throw unreachable();
  // DNS rebinding: a host that resolves to an internal address (also only some of the time)
  // is refused; the connection below then goes to exactly the address checked here.
  if (list.some(a => privateAddress(a?.address))) throw blocked();
  return list[0];
}

/** HTTPS POST that connects only to `pinned`; TLS still verifies the certificate for the host name. */
function pinnedPost(target, pinned, { headers, body, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      target,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
        lookup: (_host, options, callback) =>
          options?.all
            ? callback(null, [{ address: pinned.address, family: pinned.family }])
            : callback(null, pinned.address, pinned.family),
        timeout: timeoutMs
      },
      res => {
        res.resume(); // the body is not needed; redirects are not followed
        resolve({ status: res.statusCode || 0 });
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(body);
  });
}

/**
 * RFC 8058 one-click: POST "List-Unsubscribe=One-Click" without cookies; redirects are not
 * followed. `fetchImpl` replaces the pinned HTTPS request (tests); the address check runs
 * in both cases.
 */
export async function oneClickUnsubscribe(url, { fetchImpl = null, lookup = dnsLookup, timeoutMs = 10_000 } = {}) {
  const target = new URL(url);
  if (target.protocol !== 'https:' || target.username || target.password || privateHost(target.hostname))
    throw blocked();
  const pinned = await publicAddress(target.hostname, lookup);
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Levuvo Mail' };
  const body = 'List-Unsubscribe=One-Click';
  let response;
  try {
    response = fetchImpl
      ? await fetchImpl(target, {
          method: 'POST',
          headers,
          body,
          redirect: 'manual',
          credentials: 'omit',
          signal: AbortSignal.timeout(timeoutMs)
        })
      : await pinnedPost(target, pinned, { headers, body, timeoutMs });
  } catch {
    throw unreachable();
  }
  if (response.status >= 400)
    throw fail(`Der Absender hat die Abmeldung abgelehnt (HTTP ${response.status}).`, 'unsubscribe_rejected', 502);
  return { ok: true };
}
