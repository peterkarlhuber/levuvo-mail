#!/usr/bin/env node
// Builds the Python runtime of the AI sidecar that the desktop installers ship under
// resources/ai-runtime. It must run on the target platform (native CI runner), because the
// interpreter and the wheels are platform specific.
//   node scripts/build-ai-runtime.mjs [--arch arm64|x64] [--out build/ai-runtime]
//
// Supply chain: the interpreter comes from python-build-standalone via `uv python install`
// (uv checks its SHA-256). Third-party packages come only as wheels with the hashes from
// apps/ai/requirements-lock.txt (--require-hashes). Tabrion and Orkexa are installed from exact
// git commits without dependencies, and the sidecar itself from apps/ai.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const PYTHON_VERSION = '3.13.14';
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
    const pip = ['pip', 'install', '--python', python, '--no-cache', '--compile-bytecode'];
    run(
      'uv',
      [...pip, '--require-hashes', '--only-binary', ':all:', '-r', join(root, 'apps/ai/requirements-lock.txt')],
      {
        env
      }
    );
    const gits = gitRequirements(readFileSync(join(root, 'apps/ai/requirements.txt'), 'utf8')).map(r =>
      r.replace(/\[[^\]]*\]/, '')
    );
    run('uv', [...pip, '--no-deps', ...gits, join(root, 'apps/ai')], { env });
    // The full set must be consistent: every dependency of Orkexa and Tabrion comes from the lock.
    run('uv', ['pip', 'check', '--python', python], { env });

    prune(target);
    const smoke = smokeTest(python, out);
    const notices = spawnSync(python, ['-I', '-c', NOTICES], { encoding: 'utf8' });
    if (notices.status !== 0) throw new Error(notices.stderr);
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
