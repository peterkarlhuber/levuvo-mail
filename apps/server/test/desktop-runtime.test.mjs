import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { validDesktopCookie, safeStaticFile, contentTypeForAsset, DESKTOP_COOKIE } from '../src/desktop-runtime.mjs';
const secret = 'abcd1234'.repeat(8);

test('Desktop-API verlangt exakten Sitzungsschlüssel', () => {
  assert.equal(validDesktopCookie(`${DESKTOP_COOKIE}=${secret}`, secret), true);
  assert.equal(validDesktopCookie(`foo=x; ${DESKTOP_COOKIE}=${secret}; bar=y`, secret), true);
  assert.equal(validDesktopCookie(`${DESKTOP_COOKIE}=${'e'.repeat(64)}`, secret), false);
  assert.equal(validDesktopCookie(`${DESKTOP_COOKIE}=${secret}; ${DESKTOP_COOKIE}=${secret}`, secret), false);
  assert.equal(validDesktopCookie('', secret), false);
});
test('Statische Dateien nur in erlaubten Verzeichnissen und Typen', () => {
  const root = path.resolve('/tmp/levuvo-desktop/dist');
  assert.equal(safeStaticFile(root, '/assets/index-abc123.js'), path.join(root, 'assets/index-abc123.js'));
  assert.equal(safeStaticFile(root, '/favicon.png'), path.join(root, 'favicon.png'));
  assert.equal(safeStaticFile(root, '/levuvo-header-logo.png'), path.join(root, 'levuvo-header-logo.png'));
  for (const bad of [
    '/api/accounts',
    '/assets/../../.env',
    '/assets/%2e%2e/.env',
    '/foo.txt',
    '/%2e%2e/apps/server/src/server.mjs',
    '/assets/a.js?x=1/../bad',
    '/assets/a.exe'
  ]) {
    if (bad.includes('?') && bad.startsWith('/assets/a.js?')) continue;
    assert.equal(safeStaticFile(root, bad), null, bad);
  }
});
test('MIME Types für Frontend-Bundle', () => {
  assert.match(contentTypeForAsset('index.js'), /javascript/);
  assert.match(contentTypeForAsset('index.css'), /css/);
});
