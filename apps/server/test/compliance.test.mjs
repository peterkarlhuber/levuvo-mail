import { test } from 'node:test';
import assert from 'node:assert/strict';
import { licenseProblems, licenseVerdict, parsePythonNotices } from '../../../scripts/check-licenses.mjs';
import { buildSbom, cdxLicenses, integrityHash, parsePythonLock, sbomProblems } from '../../../scripts/sbom.mjs';
import { complianceProblems, firstReleaseOfMajor, supportProblems } from '../../../scripts/check-compliance.mjs';

test('licence verdicts follow the policy', () => {
  assert.equal(licenseVerdict('MIT'), 'allowed');
  assert.equal(licenseVerdict('(MIT OR EUPL-1.1+)'), 'allowed');
  assert.equal(licenseVerdict('MPL-2.0 OR Apache-2.0'), 'allowed');
  assert.equal(licenseVerdict('MIT AND GPL-3.0'), 'denied');
  assert.equal(licenseVerdict('GPL-3.0-only'), 'denied');
  assert.equal(licenseVerdict('AGPL-3.0'), 'denied');
  assert.equal(licenseVerdict('LGPL-3.0+'), 'review');
  assert.equal(licenseVerdict('see package'), 'denied');
  assert.equal(licenseVerdict('MIT License, BSD License'), 'allowed');
  assert.equal(licenseVerdict('Mozilla Public License 2.0 (MPL 2.0)'), 'allowed');
});

test('review licences pass only with a documented exception', () => {
  const policy = { allowed: ['MIT'], review: ['LGPL-3.0+'], exceptions: { known: 'reason' } };
  assert.deepEqual(
    licenseProblems(
      [
        { name: 'known', version: '1', license: 'LGPL-3.0+' },
        { name: 'other', version: '2', license: 'LGPL-3.0+' },
        { name: 'bad', version: '3', license: 'SSPL-1.0' }
      ],
      policy
    ).map(p => p.split(' ')[0]),
    ['other', 'bad']
  );
});

test('python notices are parsed with normalized names', () => {
  const rows = parsePythonNotices(
    'Python 3.13.18: PSF-2.0 (x)\npydantic_core 2.50.4: MIT\nlevuvo-ai 0.1.0: LicenseRef-Proprietary\n'
  );
  assert.deepEqual(rows, [
    { name: 'pydantic-core', version: '2.50.4', license: 'MIT' },
    { name: 'levuvo-ai', version: '0.1.0', license: 'LicenseRef-Proprietary' }
  ]);
  assert.deepEqual(licenseProblems(rows), []);
});

test('sbom helpers', () => {
  assert.deepEqual(integrityHash('sha512-AAEC'), { alg: 'SHA-512', content: '000102' });
  assert.equal(integrityHash(''), null);
  assert.deepEqual(cdxLicenses('MIT'), [{ license: { id: 'MIT' } }]);
  assert.deepEqual(cdxLicenses('LGPL-3.0+'), [{ license: { id: 'LGPL-3.0-or-later' } }]);
  assert.deepEqual(cdxLicenses('(MIT OR EUPL-1.1+)'), [{ expression: 'MIT OR EUPL-1.1+' }]);
  assert.deepEqual(cdxLicenses('BSD License'), [{ license: { name: 'BSD License' } }]);
  assert.equal(cdxLicenses('see package'), undefined);
  const lock = parsePythonLock(
    'a-b==1.0 \\\n    --hash=sha256:' +
      'a'.repeat(64) +
      '\n    # via x\nh11==0.16.0 ; sys_platform != "x" \\\n    --hash=sha256:' +
      'b'.repeat(64) +
      '\n'
  );
  assert.deepEqual(lock, [
    { name: 'a-b', version: '1.0', hashes: ['a'.repeat(64)] },
    { name: 'h11', version: '0.16.0', hashes: ['b'.repeat(64)] }
  ]);
});

test('the SBOM of this checkout is complete CycloneDX 1.6 and deterministic', () => {
  const a = buildSbom({ commit: 'test' });
  const b = buildSbom({ commit: 'test' });
  assert.deepEqual(sbomProblems(a), []);
  assert.deepEqual(a, b);
  const names = new Set(a.components.map(c => c.name));
  for (const name of ['electron', 'fastify', 'react', 'openpgp', 'ollama', 'cpython', 'orkexa', 'pydantic'])
    assert.ok(names.has(name), name);
  assert.equal(a.metadata.component.name, 'Levuvo Mail');
});

test('support period rules', () => {
  const changelog = '## 2.1.0 – 13 November 2026\n## 2.0.0 – 13 November 2026\n## 1.2.0 – 1 March 2025\n';
  assert.deepEqual(firstReleaseOfMajor(changelog, 2), new Date(Date.UTC(2026, 10, 13)));
  const today = new Date('2026-11-19T00:00:00Z');
  assert.deepEqual(supportProblems({ version: '2.5.0', supportUntil: '2031-11-30', changelog, today }), []);
  assert.match(supportProblems({ version: '2.5.0', supportUntil: '', changelog, today })[0], /missing/);
  assert.match(supportProblems({ version: '2.5.0', supportUntil: '2028-01-01', changelog, today })[0], /five years/);
  assert.match(supportProblems({ version: '2.5.0', supportUntil: '2026-01-01', changelog, today })[0], /past/);
});

test('the compliance file of this repository is complete', () => {
  assert.deepEqual(complianceProblems(), []);
});
