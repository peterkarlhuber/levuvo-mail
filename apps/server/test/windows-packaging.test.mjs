import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEVUVO_WINDOWS_APP_ID } from '../../desktop/windows-integration.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
test('NSIS-Installer ist pro Benutzer und legt Startmenü-Shortcut an', () => {
  assert.equal(pkg.build.appId, LEVUVO_WINDOWS_APP_ID);
  assert.equal(pkg.build.win.target[0], 'nsis');
  assert.equal(pkg.build.nsis.oneClick, false);
  assert.equal(pkg.build.nsis.perMachine, false);
  assert.equal(pkg.build.nsis.createStartMenuShortcut, true);
  assert.equal(pkg.build.nsis.allowElevation, false);
});
test('Windows-Installer enthält Levuvo-Icon und eindeutigen Arch-Dateinamen', () => {
  const icon = path.join(root, pkg.build.win.icon);
  assert.ok(statSync(icon).size > 1000);
  assert.match(pkg.build.nsis.artifactName, /\$\{arch\}/);
  assert.match(pkg.build.nsis.artifactName, /\.\$\{ext\}$/);
});
test('Windows-Zugangsdaten bleiben außerhalb der gepackten Anwendung', () => {
  assert.ok(pkg.build.files.includes('!**/.env'));
  assert.ok(pkg.build.asarUnpack.some(entry => entry.includes('*.node')));
  assert.equal(pkg.dependencies['@napi-rs/keyring'], '2.1.2');
});
test('Separate ARM64- und x64-Build-Skripte sind vorhanden', () => {
  assert.match(pkg.scripts['desktop:win:arm64'], /arm64/);
  assert.match(pkg.scripts['desktop:win:x64'], /x64/);
  assert.match(pkg.scripts['desktop:win:check:vault'], /windows-credential-check/);
});
