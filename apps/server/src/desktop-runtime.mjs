import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';

export const DESKTOP_COOKIE = 'levuvo_desktop_session';

// Content-Security-Policy for the app document. The mail viewer is an srcdoc iframe
// that inherits this policy and adds its own, stricter one (no scripts, images only
// as data: unless the user explicitly loads external images for one message).
export const APP_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-src 'self' blob:",
  "child-src 'self'",
  "worker-src 'none'",
  "object-src 'none'",
  "manifest-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ');

export function validDesktopCookie(header, secret) {
  if (typeof secret !== 'string' || secret.length < 32 || typeof header !== 'string') return false;
  const entries = header.split(';').map(x => x.trim());
  const cookies = entries.filter(x => x.startsWith(`${DESKTOP_COOKIE}=`));
  if (cookies.length !== 1) return false;
  const actual = cookies[0].slice(DESKTOP_COOKIE.length + 1);
  // Hex session token created by Electron, not a public API credential.
  if (!/^[a-f0-9]{64}$/.test(secret) || !/^[a-f0-9]{64}$/.test(actual)) return false;
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(secret, 'hex'));
}

export function safeStaticFile(root, requestedUrl) {
  if (typeof requestedUrl !== 'string' || requestedUrl.length > 512) return null;
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(requestedUrl, 'http://127.0.0.1').pathname);
  } catch {
    return null;
  }
  if (pathname.startsWith('/api/') || pathname.includes('\\') || pathname.includes('\0')) return null;
  const parts = pathname.split('/').filter(Boolean);
  if (parts.some(part => part === '..' || part === '.')) return null;
  const allowed = /^\/(?:assets\/[A-Za-z0-9_.-]+\.(?:js|css|png|svg|woff2?)|(?:favicon|levuvo-header-logo)\.png)$/;
  if (!allowed.test(pathname)) return null;
  const resolved = path.resolve(root, ...parts);
  if (!resolved.startsWith(path.resolve(root) + path.sep)) return null;
  return resolved;
}

export function contentTypeForAsset(filename) {
  switch (path.extname(filename).toLowerCase()) {
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.png':
      return 'image/png';
    case '.svg':
      return 'image/svg+xml';
    case '.woff':
      return 'font/woff';
    case '.woff2':
      return 'font/woff2';
    default:
      return 'application/octet-stream';
  }
}
