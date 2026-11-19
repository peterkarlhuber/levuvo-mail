import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gitRequirements, pythonExe, pythonKey } from '../../../scripts/build-ai-runtime.mjs';

const root = new URL('../../../', import.meta.url);

test('AI runtime: interpreter per target and commit-pinned git requirements', () => {
  assert.equal(pythonKey('darwin', 'arm64', '3.13.14'), 'cpython-3.13.14-macos-aarch64-none');
  assert.equal(pythonKey('win32', 'x64', '3.13.14'), 'cpython-3.13.14-windows-x86_64-none');
  assert.equal(pythonKey('win32', 'arm64', '3.13.14'), 'cpython-3.13.14-windows-aarch64-none');
  assert.match(pythonExe('/r', 'win32'), /python\.exe$/);
  assert.match(pythonExe('/r', 'darwin'), /bin[\\/]python3$/);
  const reqs = gitRequirements(readFileSync(new URL('apps/ai/requirements.txt', root), 'utf8'));
  assert.equal(reqs.length, 2);
  assert.throws(() => gitRequirements('orkexa @ git+https://github.com/x/orkexa.git@main'), /not pinned/);
  assert.throws(() => gitRequirements('requests==2.0'), /not pinned/);
});

test('AI runtime: every third-party wheel in the lock carries a hash', () => {
  const lock = readFileSync(new URL('apps/ai/requirements-lock.txt', root), 'utf8');
  const pins = lock.split('\n').filter(l => /^[a-z0-9]/i.test(l));
  assert.ok(pins.length >= 5);
  for (const pin of pins) assert.match(pin, /==/);
  const blocks = lock.split(/\n(?=[a-z0-9])/i).filter(b => /^[a-z0-9]/i.test(b));
  for (const block of blocks) assert.match(block, /--hash=sha256:[0-9a-f]{64}/, block.split('\n')[0]);
  const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  assert.deepEqual(
    pkg.build.extraResources.map(r => r.to),
    ['ai-runtime', 'ollama']
  );
});
