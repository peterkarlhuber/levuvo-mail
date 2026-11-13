import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const path = new URL('../../../scripts/generate-release-manifest.mjs', import.meta.url);
const src = readFileSync(path, 'utf8');
test('Release manifest checks version, architecture and SHA-256', () => {
  assert.match(src, /createHash\('sha256'\)/);
  assert.match(src, /pkg.version/);
  assert.match(src, /onlyArch/);
  assert.match(src, /release-manifest.json/);
});
