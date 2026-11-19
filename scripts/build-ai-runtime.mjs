#!/usr/bin/env node
// Builds the Python runtime of the AI sidecar that the desktop installers ship under
// resources/ai-runtime. It must run on the target platform (native CI runner), because the
// interpreter and the wheels are platform specific.
//   node scripts/build-ai-runtime.mjs [--arch arm64|x64] [--out build/ai-runtime]
//
// Supply chain: the interpreter comes from python-build-standalone via `uv python install`
// (uv checks its SHA-256). Third-party packages come only as wheels with the hashes from
// apps/ai/requirements-lock.txt (--require-hashes). Tabrion and Orkexa are installed from exact
// git commits without dependencies, and the sidecar itself from apps/ai. These three are built from
// source without build isolation, against the hashed build backends in apps/ai/requirements-backends.txt
// (never a backend freshly resolved from PyPI); the backends are removed from the runtime afterwards.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { detectArchitectures } from './verify-app-arch.mjs';
import { licenseProblems, parsePythonNotices } from './check-licenses.mjs';

export const PYTHON_VERSION = '3.13.18';
const root = resolve(import.meta.dirname, '..');

function parseArgs(argv) {
  const out = { arch: process.arch, out: join(root, 'build', 'ai-runtime') };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--arch') out.arch = argv[++i];
    else if (argv[i] === '--out') out.out = resolve(argv[++i]);
  }
  if (!['arm64', 'x64'].includes(out.arch)) throw new Error(`unsupported arch ${out.arch}`);
  return out;
}

/** uv's key of the python-build-standalone build for this platform and architecture. */
export function pythonKey(platform, arch, version = PYTHON_VERSION) {
  const os = { darwin: 'macos', win32: 'windows', linux: 'linux' }[platform];
  if (!os) throw new Error(`unsupported platform ${platform}`);
  const cpu = arch === 'arm64' ? 'aarch64' : 'x86_64';
  return `cpython-${version}-${os}-${cpu}-${platform === 'linux' ? 'gnu' : 'none'}`;
}

export const pythonExe = (dir, platform = process.platform) =>
  platform === 'win32' ? join(dir, 'python.exe') : join(dir, 'bin', 'python3');

function run(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (res.status !== 0) throw new Error(`${cmd} failed (${res.status ?? res.signal})`);
  return res;
}

/** Git requirements (Tabrion, Orkexa) from apps/ai/requirements.txt; they must be pinned to a full commit. */
export function gitRequirements(text) {
  const reqs = text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));
  for (const r of reqs)
    if (!/ @ git\+https:\/\/github\.com\/[\w.-]+\/[\w.-]+\.git@[0-9a-f]{40}$/.test(r))
      throw new Error(`requirement not pinned to a commit: ${r}`);
  return reqs;
}

const requirementNames = text =>
  text
    .split('\n')
    .map(l => /^([A-Za-z0-9][A-Za-z0-9._-]*)==/.exec(l.trim())?.[1]?.toLowerCase().replace(/[._]+/g, '-'))
    .filter(Boolean);

/**
 * The uv commands that fill the runtime, in order. Every install either takes only hashed wheels
 * (--require-hashes --only-binary) or builds from source without isolation against those wheels.
 */
export function installSteps(python, dir = root, read = file => readFileSync(file, 'utf8')) {
  const ai = join(dir, 'apps', 'ai');
  const pip = ['pip', 'install', '--python', python, '--no-cache', '--compile-bytecode'];
  const hashed = file => [...pip, '--require-hashes', '--only-binary', ':all:', '-r', join(ai, file)];
  const gits = gitRequirements(read(join(ai, 'requirements.txt'))).map(r => r.replace(/\[[^\]]*\]/, ''));
  const runtime = new Set(requirementNames(read(join(ai, 'requirements-lock.txt'))));
  const backends = requirementNames(read(join(ai, 'requirements-backends.txt'))).filter(n => !runtime.has(n));
  return [
    hashed('requirements-lock.txt'),
    hashed('requirements-backends.txt'),
    [...pip, '--no-deps', '--no-build-isolation', ...gits, ai],
    ['pip', 'uninstall', '--python', python, ...backends],
    // The full set must be consistent: every dependency of Orkexa and Tabrion comes from the lock.
    ['pip', 'check', '--python', python]
  ];
}

/** Standard library folders the sidecar never needs (tests, IDLE, Tk). Packages are left alone. */
const PRUNE = new Set(['test', 'idlelib', 'tkinter', 'turtledemo', 'ensurepip', 'tcl', 'tcl8.6', 'tk8.6']);
function prune(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'site-packages') continue;
    const full = join(dir, entry.name);
    if (PRUNE.has(entry.name)) rmSync(full, { recursive: true });
    else prune(full);
  }
}

/**
 * Windows: drop the test and Tk extension modules, and on ARM64 the x64-only vcruntime140_1.dll that
 * python-build-standalone ships (ARM64 has no __CxxFrameHandler4 runtime split; nothing loads it there).
 */
function pruneWindows(target, arch) {
  if (process.platform !== 'win32') return;
  const dlls = join(target, 'DLLs');
  for (const name of readdirSync(dlls))
    if (/^_test.*\.pyd$|^_tkinter\.pyd$|^t(cl|k)\d+t\.dll$/i.test(name)) rmSync(join(dlls, name));
  const extra = join(target, 'vcruntime140_1.dll');
  if (arch === 'arm64' && existsSync(extra) && !detectArchitectures(extra).includes('arm64')) rmSync(extra);
}

/** Starts the sidecar once with the bundled interpreter, exactly as the app does, and asks for its status. */
export function smokeTest(python, cwd) {
  const res = spawnSync(python, ['-I', '-m', 'levuvo_ai'], {
    cwd,
    input: `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'status', params: {} })}\n`,
    encoding: 'utf8',
    timeout: 60_000,
    env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, PYTHONUTF8: '1' }
  });
  const line = (res.stdout || '').split('\n').find(l => l.includes('"id":1') || l.includes('"id": 1'));
  const reply = line ? JSON.parse(line) : null;
  if (!reply?.result?.version || !reply.result.orkexa)
    throw new Error(`sidecar smoke test failed:\n${res.stdout}\n${res.stderr}`);
  return reply.result;
}

const NOTICES = `
import importlib.metadata as m, sys
rows = []
for d in sorted(m.distributions(), key=lambda d: d.metadata["Name"].lower()):
    md = d.metadata
    lic = md.get("License-Expression") or md.get("License") or ""
    if not lic or len(lic) > 80:
        lic = ", ".join(c.split("::")[-1].strip() for c in md.get_all("Classifier") or [] if c.startswith("License ::")) or "see package"
    rows.append(f"{md['Name']} {md['Version']}: {lic}")
print("Python " + sys.version.split()[0] + ": PSF-2.0 (python-build-standalone)")
print("\\n".join(rows))
`;

async function main() {
  const { arch, out } = parseArgs(process.argv.slice(2));
  const key = pythonKey(process.platform, arch);
  const work = mkdtempSync(join(tmpdir(), 'lv-ai-runtime-'));
  try {
    const installDir = join(work, 'pythons');
    const env = { ...process.env, UV_PYTHON_INSTALL_DIR: installDir, UV_NO_CONFIG: '1' };
    run('uv', ['python', 'install', '--no-bin', key], { env });
    const found = readdirSync(installDir).find(n => n.startsWith(key));
    if (!found) throw new Error(`uv did not install ${key}`);

    rmSync(join(out, 'python'), { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    const target = join(out, 'python');
    cpSync(join(installDir, found), target, { recursive: true, verbatimSymlinks: true });
    // uv marks its interpreters as externally managed; this copy belongs to the app alone.
    for (const lib of [
      join(target, 'lib', `python${PYTHON_VERSION.split('.').slice(0, 2).join('.')}`),
      join(target, 'Lib')
    ])
      rmSync(join(lib, 'EXTERNALLY-MANAGED'), { force: true });

    const python = pythonExe(target);
    for (const args of installSteps(python)) run('uv', args, { env });

    prune(target);
    pruneWindows(target, arch);
    const smoke = smokeTest(python, out);
    const notices = spawnSync(python, ['-I', '-c', NOTICES], { encoding: 'utf8' });
    if (notices.status !== 0) throw new Error(notices.stderr);
    // Licence policy (docs/compliance/LICENSING.md) for every Python package that ships.
    const licenseIssues = licenseProblems(parsePythonNotices(notices.stdout));
    if (licenseIssues.length) throw new Error(`licence policy:\n${licenseIssues.join('\n')}`);
    writeFileSync(
      join(out, 'THIRD-PARTY-PYTHON.txt'),
      `Components of the bundled AI runtime (resources/ai-runtime) and their licenses.\n` +
        `Full license texts are in each package's *.dist-info folder and in python/LICENSE*.\n\n${notices.stdout}`
    );
    writeFileSync(
      join(out, 'runtime.json'),
      `${JSON.stringify({ python: PYTHON_VERSION, key, sidecar: smoke.version, orkexa: smoke.orkexa }, null, 2)}\n`
    );
    console.log(`✓ AI runtime ${key} in ${out} (sidecar ${smoke.version}, Orkexa ${smoke.orkexa})`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (/build-ai-runtime\.mjs$/.test(process.argv[1] || '')) {
  main().catch(err => {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  });
}
