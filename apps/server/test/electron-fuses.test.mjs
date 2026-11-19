import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FUSE_INDEX,
  REQUIRED_FUSES,
  configProblems,
  configuredFuses,
  executablePath,
  wireProblems
} from '../../../scripts/verify-fuses.mjs';

const ENABLE = 49;
const DISABLE = 48;

test('SEC-LEV-003: the build configuration hardens the Electron fuses', () => {
  const fuses = configuredFuses();
  assert.deepEqual(configProblems(fuses), []);
  assert.equal(fuses.runAsNode, false, 'ELECTRON_RUN_AS_NODE must not turn Levuvo into a plain Node runtime');
  assert.equal(fuses.enableNodeOptionsEnvironmentVariable, false, 'NODE_OPTIONS=--require must be ignored');
  assert.equal(fuses.enableNodeCliInspectArguments, false, '--inspect must be ignored');
  assert.equal(fuses.onlyLoadAppFromAsar, true);
  assert.equal(fuses.enableEmbeddedAsarIntegrityValidation, true);
});

test('SEC-LEV-003: a weakened or missing fuse in the configuration is reported', () => {
  assert.equal(configProblems({}).length, Object.keys(REQUIRED_FUSES).length);
  const weakened = { ...REQUIRED_FUSES, runAsNode: true };
  assert.deepEqual(configProblems(weakened), ['build.electronFuses.runAsNode must be false (is true)']);
});

test('SEC-LEV-003: fuse wire of the binary is compared with the configuration', () => {
  const wire = { version: '1' };
  for (const [name, value] of Object.entries(REQUIRED_FUSES)) wire[FUSE_INDEX[name]] = value ? ENABLE : DISABLE;
  assert.deepEqual(wireProblems(wire, REQUIRED_FUSES), []);
  // An Electron binary that was not flipped keeps RunAsNode enabled.
  const unflipped = { ...wire, [FUSE_INDEX.runAsNode]: ENABLE };
  assert.deepEqual(wireProblems(unflipped, REQUIRED_FUSES), ['runAsNode: expected disabled, binary has enabled']);
  const short = { version: '1', 0: DISABLE };
  assert.match(wireProblems(short, REQUIRED_FUSES).join('\n'), /no such fuse/);
  assert.deepEqual(wireProblems(wire, { notAFuse: true }), ['unknown fuse notAFuse']);
});

test('SEC-LEV-003: every desktop build verifies the fuses of the packaged binary', () => {
  const workflow = readFileSync(new URL('../../../.github/workflows/build-desktop.yml', import.meta.url), 'utf8');
  assert.match(workflow, /node scripts\/verify-fuses\.mjs \$\{\{ matrix\.os \}\} \$\{\{ matrix\.arch \}\}/);
  assert.match(executablePath('mac', 'arm64', '/r'), /mac-arm64[\\/]Levuvo Mail\.app$/);
  assert.match(executablePath('win', 'x64', '/r'), /win-unpacked[\\/]Levuvo Mail\.exe$/);
});
