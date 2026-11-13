// Unsubscribing from newsletters via List-Unsubscribe (RFC 2369) and one-click
// List-Unsubscribe-Post (RFC 8058). The one-click POST carries no cookies or other context.
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

function privateHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal'))
    return true;
  const kind = isIP(host);
  if (kind === 4) {
    const [a, b] = host.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (kind === 6)
    return host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80') || host === '::';
  return false;
}

/** RFC 8058 one-click: POST "List-Unsubscribe=One-Click" without cookies; redirects are not followed. */
export async function oneClickUnsubscribe(url, { fetchImpl = globalThis.fetch, timeoutMs = 10_000 } = {}) {
  const target = new URL(url);
  if (target.protocol !== 'https:' || privateHost(target.hostname))
    throw fail('Diese Abmeldeadresse wird aus Sicherheitsgründen nicht aufgerufen.', 'unsubscribe_blocked');
  let response;
  try {
    response = await fetchImpl(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Levuvo Mail' },
      body: 'List-Unsubscribe=One-Click',
      redirect: 'manual',
      credentials: 'omit',
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    throw fail(
      'Der Absender ist gerade nicht erreichbar. Bitte später erneut versuchen.',
      'unsubscribe_unreachable',
      502
    );
  }
  if (response.status >= 400)
    throw fail(`Der Absender hat die Abmeldung abgelehnt (HTTP ${response.status}).`, 'unsubscribe_rejected', 502);
  return { ok: true };
}
