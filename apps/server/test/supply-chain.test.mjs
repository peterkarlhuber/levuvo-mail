// Release and supply-chain hardening (audit 2026-11-19): OPS-LEV-001…009, API-LEV-010.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installSteps, pythonExe, pythonKey, PYTHON_VERSION } from '../../../scripts/build-ai-runtime.mjs';
import { newerPatches } from '../../../scripts/check-python-runtime.mjs';
import { electronSupport } from '../../../scripts/check-electron-support.mjs';
import { releaseVersionProblems } from '../../../scripts/check-release-version.mjs';
import { aiRuntimeProblems, builderArgs, publisherNames } from '../../../scripts/release-signed.mjs';

const repo = new URL('../../../', import.meta.url);
// Normalised to LF: Windows checkouts have CRLF line endings.
const read = path => readFileSync(new URL(path, repo), 'utf8').replace(/\r\n/g, '\n');

test('OPS-LEV-001: every install into the AI runtime is hash-locked or built against hashed backends', () => {
  const steps = installSteps('/rt/bin/python3');
  const installs = steps.filter(s => s[1] === 'install');
  assert.equal(installs.length, 3);
  for (const args of installs) {
    const hashed = args.includes('--require-hashes') && args.includes('--only-binary');
    assert.ok(hashed || args.includes('--no-build-isolation'), args.join(' '));
  }
  const [lock, backends, source, uninstall, check] = steps;
  assert.ok(lock.at(-1).endsWith('requirements-lock.txt'));
  assert.ok(backends.at(-1).endsWith('requirements-backends.txt'), 'backends come before the source build');
  assert.ok(source.includes('--no-deps') && source.some(a => /orkexa\.git@[0-9a-f]{40}$/.test(a)));
  assert.ok(source.some(a => /tabrion\.git@[0-9a-f]{40}$/.test(a)));
  // Build backends do not stay in the shipped runtime, runtime packages are never uninstalled.
  assert.equal(uninstall[1], 'uninstall');
  assert.ok(uninstall.includes('hatchling') && uninstall.includes('hatch-fancy-pypi-readme'));
  const runtime = read('apps/ai/requirements-lock.txt');
  for (const name of uninstall.slice(4)) assert.doesNotMatch(runtime, new RegExp(`^${name}==`, 'mi'));
  assert.deepEqual(check.slice(0, 2), ['pip', 'check']);
  // Every backend that Tabrion, Orkexa and levuvo-ai declare is in the hashed lock.
  const locked = read('apps/ai/requirements-backends.txt');
  assert.match(locked, /^hatchling==1\.33\.0 \\$/m);
  assert.match(locked, /^hatch-fancy-pypi-readme==[\d.]+ \\$/m);
  assert.doesNotMatch(locked.replace(/^#.*$/gm, ''), /^[a-z].*==[^\\]*$/m, 'every pin carries hashes');
});

test('OPS-LEV-002: Dependabot and CI cover the Python runtime', () => {
  const dependabot = read('.github/dependabot.yml');
  assert.match(dependabot, /package-ecosystem: pip\n\s+directory: \/apps\/ai/);
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /install --require-hashes -r apps\/ai\/requirements-audit\.txt/);
  assert.match(ci, /requirements-dev-lock\.txt; do/);
  for (const lock of ['requirements-lock.txt', 'requirements-build.txt', 'requirements-backends.txt'])
    assert.ok(ci.includes(lock) && read('.github/workflows/supply-chain.yml').includes(lock), lock);
  assert.match(read('.github/workflows/supply-chain.yml'), /check-python-runtime\.mjs --strict/);
  // The build tool itself must not carry the known uv TLS root issue (PYSEC-2026-4321, fixed in 0.13.4).
  const uv = /^uv==(\d+)\.(\d+)\.(\d+)/m.exec(read('apps/ai/requirements-build.txt'));
  assert.ok(uv && (Number(uv[1]) > 0 || Number(uv[2]) > 13 || (Number(uv[2]) === 13 && Number(uv[3]) >= 4)));
});

test('OPS-LEV-002: newer CPython patch releases of the bundled line are found', () => {
  assert.deepEqual(newerPatches('3.13.14', ['3.13.0', '3.13.18', '3.13.15', '3.14.2', '3.13.14', '3.13.16rc1']), [
    '3.13.15',
    '3.13.18'
  ]);
  assert.deepEqual(newerPatches(PYTHON_VERSION, [PYTHON_VERSION, '3.12.99']), []);
});

test('OPS-LEV-006: Electron leaving its three supported majors is reported', () => {
  assert.equal(electronSupport('45.3.1', '45.4.1').status, 'supported');
  assert.equal(electronSupport('44.0.0', '45.4.1').status, 'supported');
  assert.equal(electronSupport('43.8.0', '45.4.1').status, 'last');
  assert.equal(electronSupport('42.11.0', '45.4.1').status, 'unsupported');
  assert.equal(electronSupport('^45.3.1', '46.0.0').oldest, 44);
  assert.throws(() => electronSupport('latest', '45.0.0'));
  assert.match(read('package.json'), /"release:check": "[^"]*check:electron-support/);
  assert.match(read('.github/workflows/supply-chain.yml'), /check-electron-support\.mjs/);
});

test('OPS-LEV-008: CI also runs the tests in the Node of Electron', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /ELECTRON_RUN_AS_NODE: '1'/);
  assert.match(ci, /node_modules\/electron\/dist\/electron --test apps\/server\/test\/\*\.test\.mjs/);
  assert.match(ci, /needs: \[[^\]]*electron-node[^\]]*\]/);
});

test('OPS-LEV-003: signed builds give each platform only its own certificate', () => {
  const wf = read('.github/workflows/build-desktop.yml');
  for (const name of ['WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD'])
    assert.match(wf, new RegExp(`\\n      ${name}:\\n        required: false`), `${name} declared for workflow_call`);
  assert.match(wf, /CSC_LINK: \$\{\{ matrix\.os == 'mac' && secrets\.CSC_LINK \|\| '' \}\}/);
  assert.match(wf, /WIN_CSC_LINK: \$\{\{ matrix\.os == 'win' && secrets\.WIN_CSC_LINK \|\| '' \}\}/);
  assert.match(wf, /APPLE_ID: \$\{\{ matrix\.os == 'mac' && secrets\.APPLE_ID/);
  assert.doesNotMatch(wf, /CSC_LINK: \$\{\{ secrets\.CSC_LINK \}\}/);
});

test('OPS-LEV-004: the Windows publisher name stays one argument and is checked in app-update.yml', () => {
  const args = builderArgs('win-x64', {
    LEVUVO_UPDATE_URL: 'https://x.test/a&b/',
    LEVUVO_WIN_PUBLISHER: 'Levuvo GmbH'
  });
  assert.ok(args.includes('-c.win.signtoolOptions.publisherName=Levuvo GmbH'));
  assert.ok(args.includes('-c.publish.url=https://x.test/a&b/'));
  assert.ok(args.includes('-c.publish.channel=latest-x64'));
  assert.ok(
    builderArgs('win-arm64', { LEVUVO_UPDATE_URL: 'https://x.test/', LEVUVO_WIN_PUBLISHER: 'A' }).includes('--arm64')
  );
  const source = read('scripts/release-signed.mjs');
  assert.doesNotMatch(source, /shell:/, 'no shell: arguments are never re-split');
  assert.deepEqual(publisherNames('provider: generic\npublisherName:\n  - Levuvo GmbH\nupdaterCacheDirName: x\n'), [
    'Levuvo GmbH'
  ]);
  assert.deepEqual(publisherNames("publisherName: 'Levuvo GmbH'\n"), ['Levuvo GmbH']);
  assert.deepEqual(publisherNames('publisherName:\n  - Levuvo\n  - GmbH\n'), ['Levuvo', 'GmbH']);
  assert.deepEqual(publisherNames('provider: generic\n'), []);
});

test('OPS-LEV-009: a signed build refuses a missing or foreign AI runtime', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lv-rt-'));
  try {
    assert.match(aiRuntimeProblems(dir, 'win32', 'arm64')[0], /runtime\.json missing/);
    const key = pythonKey('win32', 'x64');
    writeFileSync(join(dir, 'runtime.json'), JSON.stringify({ python: PYTHON_VERSION, key }));
    assert.match(aiRuntimeProblems(dir, 'win32', 'arm64').join(), /built for .*x86_64.*needs .*aarch64/);
    assert.match(aiRuntimeProblems(dir, 'win32', 'x64').join(), /interpreter missing/);
    mkdirSync(join(dir, 'python'));
    writeFileSync(pythonExe(join(dir, 'python'), 'win32'), '');
    assert.deepEqual(aiRuntimeProblems(dir, 'win32', 'x64'), []);
    writeFileSync(join(dir, 'runtime.json'), '{');
    assert.match(aiRuntimeProblems(dir, 'win32', 'x64')[0], /not valid JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.match(read('RELEASE-KIT.md'), /npm run ai:runtime -- --arch/);
  assert.doesNotMatch(read('RELEASE-KIT.md'), /`latest\.yml`/);
});

test('API-LEV-010: a release needs its own CHANGELOG section and nothing left under Unreleased', () => {
  const ok = '# Changelog\n\n## Unreleased\n\n## 2.3.1 – 20 November 2026\n- fix\n\n## 2.3.0 – 19 November 2026\n- a\n';
  assert.deepEqual(releaseVersionProblems('2.3.1', ok), []);
  assert.deepEqual(releaseVersionProblems('2.3.1', ok.replace('## Unreleased\n', '')), []);
  const pending = ok.replace('## Unreleased\n', '## Unreleased\n\n### Fixes\n- not released yet\n');
  assert.match(releaseVersionProblems('2.3.1', pending).join(), /entries under "Unreleased"/);
  assert.match(releaseVersionProblems('2.3.2', ok).join(), /no section "## 2\.3\.2/);
  assert.match(releaseVersionProblems('2.3.0', ok).join(), /not the newest release section/);
  assert.match(releaseVersionProblems('2.3', ok).join(), /not X\.Y\.Z/);
  assert.match(read('package.json'), /"release:check": "npm run check:release-version/);
});

test('QA-LEV-010: integration and UI suites run nightly against test servers from the repository', () => {
  const wf = read('.github/workflows/integration.yml');
  assert.match(wf, /schedule:\n\s+- cron:/);
  assert.match(wf, /workflow_call:/);
  for (const cmd of ['test/servers/start.sh', 'npm run test:integration', 'npm run test:e2e', 'npm run test:e2e:live'])
    assert.ok(wf.includes(cmd), cmd);
  const start = read('test/servers/start.sh');
  for (const name of [
    'NODE_EXTRA_CA_CERTS',
    'LEVUVO_IT_ALLOW_WRITES',
    'LEVUVO_IT_USER2',
    'LEVUVO_IT_DAV_URL',
    'LEVUVO_IT_DAV_USER2'
  ])
    assert.ok(start.includes(`${name}=`), name);
  assert.match(read('test/servers/compose.yml'), /ENABLE_MANAGESIEVE: '1'/);
  // Every published port stays on the loopback interface.
  for (const line of read('test/servers/compose.yml').match(/^\s+- [\d.:]+:\d+$/gm) || [])
    assert.match(line, /- 127\.0\.0\.1:/);
  // The 2.3 areas have real-server scenarios.
  const suite = read('apps/server/test/integration/v23.test.mjs');
  for (const area of ['/api/tasks/sync/link', '/api/spaces/create', '/api/backup/restore', 'tools/call'])
    assert.ok(suite.includes(area), area);
});
