#!/usr/bin/env node
// Software bill of materials (CRA Annex I Part II (1)) in CycloneDX 1.6 JSON for everything that
// ships in the installers: the npm packages (production and bundled UI), Electron, the AI sidecar
// with its hashed Python lock and pinned git packages, the bundled CPython and the bundled Ollama.
// The output is deterministic for a commit (timestamp from SOURCE_DATE_EPOCH or the commit time).
//   node scripts/sbom.mjs [--out <file>] [--commit <sha>]
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { shippedNpmPackages } from './lib/shipped-packages.mjs';
import { PYTHON_VERSION, gitRequirements } from './build-ai-runtime.mjs';

const root = resolve(import.meta.dirname, '..');
const read = file => readFileSync(join(root, file), 'utf8');

/** "sha512-<base64>" (npm integrity) → CycloneDX hash. */
export function integrityHash(integrity) {
  const m = /^(sha512|sha384|sha256|sha1)-([A-Za-z0-9+/=]+)$/.exec(integrity || '');
  if (!m) return null;
  const alg = { sha512: 'SHA-512', sha384: 'SHA-384', sha256: 'SHA-256', sha1: 'SHA-1' }[m[1]];
  return { alg, content: Buffer.from(m[2], 'base64').toString('hex') };
}

/** CycloneDX "licenses": a single SPDX id, an expression, or a name. */
export function cdxLicenses(license) {
  let value = String(license || '').trim();
  if (!value || /^see package$/i.test(value)) return undefined;
  if (/\s(OR|AND|WITH)\s/.test(value)) return [{ expression: value.replace(/^\((.*)\)$/, '$1') }];
  value = value.replace(/^((?:L|A)?GPL-\d\.\d)\+$/, '$1-or-later');
  if (/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(value) && /\d|^(MIT|ISC|Unlicense)$/.test(value))
    return [{ license: { id: value } }];
  return [{ license: { name: value } }];
}

/** name==version and their sha256 hashes from a uv/pip-compile lock. */
export function parsePythonLock(text) {
  const out = [];
  let current = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)==([^\s;\\]+)/.exec(line);
    if (m) {
      current = { name: m[1].toLowerCase().replace(/[._]+/g, '-'), version: m[2], hashes: [] };
      out.push(current);
      continue;
    }
    const h = /--hash=sha256:([0-9a-f]{64})/.exec(line);
    if (h && current) current.hashes.push(h[1]);
    else if (!line.startsWith('--hash') && !line.startsWith('#') && line) current = null;
  }
  return out;
}

const uuidFrom = text => {
  const h = createHash('sha256').update(text).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

function commitInfo(explicit) {
  try {
    const sha = explicit || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const time = execFileSync('git', ['show', '-s', '--format=%cI', sha], { cwd: root, encoding: 'utf8' }).trim();
    return { sha, time };
  } catch {
    return { sha: explicit || 'unknown', time: '' };
  }
}

export function buildSbom({ commit } = {}) {
  const pkg = JSON.parse(read('package.json'));
  const info = commitInfo(commit);
  const epoch = Number(process.env.SOURCE_DATE_EPOCH);
  const timestamp = Number.isFinite(epoch) && epoch > 0 ? new Date(epoch * 1000).toISOString() : info.time || undefined;
  const components = [];
  const prop = (name, value) => ({ name, value: String(value) });

  for (const p of shippedNpmPackages(root)) {
    const hash = integrityHash(p.integrity);
    components.push({
      type: 'library',
      'bom-ref': `pkg:npm/${p.name}@${p.version}`,
      name: p.name,
      version: p.version,
      purl: `pkg:npm/${p.name.startsWith('@') ? `%40${p.name.slice(1)}` : p.name}@${p.version}`,
      licenses: cdxLicenses(p.license),
      hashes: hash ? [hash] : undefined,
      externalReferences: p.homepage ? [{ type: 'website', url: p.homepage.replace(/^git\+/, '') }] : undefined,
      properties: [prop('levuvo:part', p.bundled ? 'user interface bundle' : 'app (asar)')]
    });
  }

  const electron = JSON.parse(read('node_modules/electron/package.json'));
  components.push({
    type: 'framework',
    'bom-ref': `pkg:npm/electron@${electron.version}`,
    name: 'electron',
    version: electron.version,
    description: 'Application runtime (Chromium, Node.js, V8)',
    purl: `pkg:npm/electron@${electron.version}`,
    licenses: [{ license: { id: 'MIT' } }],
    externalReferences: [{ type: 'website', url: 'https://www.electronjs.org' }],
    properties: [prop('levuvo:part', 'runtime'), prop('levuvo:notices', 'LICENSES.chromium.html in the installer')]
  });

  const ai = 'apps/ai';
  const aiVersion = /^version\s*=\s*"([^"]+)"/m.exec(read(`${ai}/pyproject.toml`))?.[1] || '0.0.0';
  components.push({
    type: 'application',
    'bom-ref': `pkg:pypi/levuvo-ai@${aiVersion}`,
    name: 'levuvo-ai',
    version: aiVersion,
    description: 'AI sidecar of Levuvo Mail',
    purl: `pkg:pypi/levuvo-ai@${aiVersion}`,
    licenses: [{ license: { name: 'LicenseRef-Proprietary' } }],
    properties: [prop('levuvo:part', 'AI runtime (resources/ai-runtime)')]
  });
  for (const req of gitRequirements(read(`${ai}/requirements.txt`))) {
    const m = /^([\w.-]+)(?:\[[^\]]*\])? @ git\+https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\.git@([0-9a-f]{40})$/.exec(
      req
    );
    if (!m) continue;
    components.push({
      type: 'library',
      'bom-ref': `pkg:github/${m[2]}/${m[3]}@${m[4]}`,
      name: m[1],
      version: m[4],
      purl: `pkg:github/${m[2]}/${m[3]}@${m[4]}`,
      licenses: [{ license: { name: 'LicenseRef-Proprietary' } }],
      externalReferences: [{ type: 'vcs', url: `https://github.com/${m[2]}/${m[3]}` }],
      properties: [prop('levuvo:part', 'AI runtime (resources/ai-runtime)')]
    });
  }
  for (const p of parsePythonLock(read(`${ai}/requirements-lock.txt`))) {
    components.push({
      type: 'library',
      'bom-ref': `pkg:pypi/${p.name}@${p.version}`,
      name: p.name,
      version: p.version,
      purl: `pkg:pypi/${p.name}@${p.version}`,
      properties: [
        prop('levuvo:part', 'AI runtime (resources/ai-runtime)'),
        ...p.hashes.map(h => prop('levuvo:wheel-sha256', h))
      ]
    });
  }
  components.push({
    type: 'framework',
    'bom-ref': `pkg:generic/cpython@${PYTHON_VERSION}`,
    name: 'cpython',
    version: PYTHON_VERSION,
    description: 'Python interpreter of the AI runtime (python-build-standalone)',
    purl: `pkg:generic/cpython@${PYTHON_VERSION}`,
    licenses: [{ license: { id: 'PSF-2.0' } }],
    externalReferences: [{ type: 'website', url: 'https://github.com/astral-sh/python-build-standalone' }],
    properties: [prop('levuvo:part', 'AI runtime (resources/ai-runtime/python)')]
  });

  const ollama = JSON.parse(read('scripts/ollama/ollama-lock.json'));
  components.push({
    type: 'application',
    'bom-ref': `pkg:github/ollama/ollama@v${ollama.version}`,
    name: 'ollama',
    version: ollama.version,
    description: 'Local model runtime (bundled, isolated instance)',
    purl: `pkg:github/ollama/ollama@v${ollama.version}`,
    licenses: [{ license: { id: ollama.license || 'MIT' } }],
    externalReferences: [{ type: 'distribution', url: ollama.source }],
    properties: [
      prop('levuvo:part', 'resources/ollama'),
      ...Object.entries(ollama.assets || {}).map(([key, a]) => prop(`levuvo:asset-sha256:${key}`, a.sha256))
    ]
  });

  const appRef = `levuvo-mail@${pkg.version}`;
  const clean = value => JSON.parse(JSON.stringify(value));
  return clean({
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    serialNumber: `urn:uuid:${uuidFrom(`${pkg.version}:${info.sha}`)}`,
    version: 1,
    metadata: {
      timestamp,
      lifecycles: [{ phase: 'build' }],
      tools: { components: [{ type: 'application', name: 'levuvo-mail scripts/sbom.mjs', version: pkg.version }] },
      component: {
        type: 'application',
        'bom-ref': appRef,
        name: pkg.productName || 'Levuvo Mail',
        version: pkg.version,
        supplier: { name: 'Levuvo', url: ['https://levuvo.at'] },
        licenses: [{ license: { name: 'LicenseRef-Proprietary' } }],
        properties: [prop('levuvo:commit', info.sha), prop('levuvo:supportUntil', pkg.levuvo?.supportUntil || '')]
      },
      manufacturer: { name: 'Levuvo', url: ['https://levuvo.at'] }
    },
    components,
    dependencies: [{ ref: appRef, dependsOn: components.map(c => c['bom-ref']) }]
  });
}

/** Structural checks the release relies on; returns a list of problems. */
export function sbomProblems(bom) {
  const problems = [];
  if (bom.bomFormat !== 'CycloneDX' || bom.specVersion !== '1.6') problems.push('not CycloneDX 1.6');
  if (!/^urn:uuid:[0-9a-f-]{36}$/.test(bom.serialNumber || '')) problems.push('serialNumber missing');
  if (!bom.metadata?.component?.version) problems.push('metadata.component.version missing');
  const refs = new Set();
  for (const c of bom.components || []) {
    if (!c.name || !c.version || !c.purl)
      problems.push(`component without name/version/purl: ${JSON.stringify(c).slice(0, 80)}`);
    if (refs.has(c['bom-ref'])) problems.push(`duplicate bom-ref ${c['bom-ref']}`);
    refs.add(c['bom-ref']);
  }
  for (const name of ['electron', 'ollama', 'cpython', 'orkexa', 'levuvo-ai'])
    if (!(bom.components || []).some(c => c.name === name)) problems.push(`component ${name} missing`);
  return problems;
}

if (/sbom\.mjs$/.test(process.argv[1] || '')) {
  const args = process.argv.slice(2);
  const opt = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const bom = buildSbom({ commit: opt('--commit') });
  const problems = sbomProblems(bom);
  if (problems.length) {
    console.error(`✗ SBOM:\n${problems.map(p => ` - ${p}`).join('\n')}`);
    process.exit(1);
  }
  const out = resolve(opt('--out') || `levuvo-mail-${bom.metadata.component.version}.cdx.json`);
  writeFileSync(out, `${JSON.stringify(bom, null, 2)}\n`);
  console.log(`✓ SBOM ${out}: ${bom.components.length} components (CycloneDX 1.6)`);
}
