#!/usr/bin/env node
// Fetches the pinned Ollama release (scripts/ollama/ollama-lock.json) that the desktop installers
// ship under resources/ollama, Levuvo's own private Ollama. It must run on the target platform,
// because it checks the code signature with the platform's own tools.
//   node scripts/fetch-ollama.mjs [--arch arm64|x64] [--out build/ollama-runtime] [--inspect]
//
// Supply chain: the archive comes from the official GitHub release of ollama/ollama and must match
// the pinned SHA-256 and size before it is unpacked. The main binary must have the target
// architecture, a valid code signature (macOS: codesign, Windows: Authenticode) and report the
// pinned version. scripts/ollama/check-ollama-runtime.mjs looks for advisories and newer releases.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { detectArchitectures } from './verify-app-arch.mjs';

const root = resolve(import.meta.dirname, '..');
export const LOCK = JSON.parse(readFileSync(join(root, 'scripts', 'ollama', 'ollama-lock.json'), 'utf8'));

export const assetKey = (platform, arch) => `${platform}-${arch}`;

export function assetFor(platform, arch, lock = LOCK) {
  const asset = lock.assets[assetKey(platform, arch)];
  if (!asset) throw new Error(`no pinned Ollama build for ${platform}/${arch}`);
  if (!/^[0-9a-f]{64}$/.test(asset.sha256)) throw new Error(`${asset.file}: invalid sha256 pin`);
  return { ...asset, url: `https://github.com/ollama/ollama/releases/download/v${lock.version}/${asset.file}` };
}

/** Where the server binary sits inside the unpacked archive (layouts differ by platform). */
export function binaryIn(dir, platform = process.platform) {
  const names = platform === 'win32' ? ['ollama.exe'] : ['ollama', join('bin', 'ollama')];
  return names.map(n => join(dir, n)).find(p => existsSync(p)) || null;
}

/** Child environment for running the bundled binary in checks: nothing from the user's setup. */
export const isolatedEnv = (home, extra = {}) => ({
  PATH: process.env.PATH,
  SYSTEMROOT: process.env.SYSTEMROOT,
  HOME: home,
  USERPROFILE: home,
  OLLAMA_NO_CLOUD: '1',
  ...extra
});

export async function download(url, file, { expectSha256, expectSize, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status} ${url}`);
  const hash = createHash('sha256');
  let size = 0;
  const tap = new TransformStream({
    transform(chunk, controller) {
      hash.update(chunk);
      size += chunk.byteLength;
      controller.enqueue(chunk);
    }
  });
  await pipeline(Readable.fromWeb(res.body.pipeThrough(tap)), createWriteStream(file));
  const sha256 = hash.digest('hex');
  if (expectSize !== undefined && size !== expectSize) throw new Error(`size mismatch: ${size}, pinned ${expectSize}`);
  if (expectSha256 && sha256 !== expectSha256) throw new Error(`sha256 mismatch: ${sha256}, pinned ${expectSha256}`);
  return { sha256, size };
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${res.stderr || res.stdout || res.error}`);
  return res.stdout;
}

function extract(archive, dir) {
  mkdirSync(dir, { recursive: true });
  if (archive.endsWith('.tar.zst')) run('tar', ['--zstd', '-xf', archive, '-C', dir]);
  else if (archive.endsWith('.tgz')) run('tar', ['-xzf', archive, '-C', dir]);
  else if (archive.endsWith('.zip')) {
    if (process.platform === 'win32') run('tar', ['-xf', archive, '-C', dir]);
    else if (process.platform === 'darwin') run('ditto', ['-x', '-k', archive, dir]);
    else run('unzip', ['-q', archive, '-d', dir]);
  } else throw new Error(`unknown archive type ${archive}`);
}

/** Verifies the code signature with the platform tools; returns the signer for the log. */
export function verifySignature(binary, platform = process.platform, signers = LOCK.signers) {
  if (platform === 'darwin') {
    run('codesign', ['--verify', '--strict', '--verbose=2', binary]);
    const info = spawnSync('codesign', ['-dv', '--verbose=2', binary], { encoding: 'utf8' }).stderr;
    const team = /TeamIdentifier=(\S+)/.exec(info)?.[1];
    if (team !== signers.darwin) throw new Error(`Ollama binary signed by team ${team || 'none'}, expected ${signers.darwin}`);
    return `Developer ID team ${team}`;
  }
  if (platform === 'win32') {
    const ps = `$s = Get-AuthenticodeSignature -LiteralPath '${binary.replace(/'/g, "''")}'; [Console]::Out.Write(($s.Status.ToString()) + '|' + $s.SignerCertificate.Subject)`;
    const encoded = Buffer.from(ps, 'utf16le').toString('base64');
    // A PSModulePath inherited from PowerShell 7 breaks module loading in Windows PowerShell 5.1.
    const { PSModulePath: _drop, ...env } = process.env;
    const shell = spawnSync('pwsh', ['-NoProfile', '-Command', '1'], { encoding: 'utf8' }).status === 0 ? 'pwsh' : 'powershell.exe';
    const out = run(shell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      env: shell === 'pwsh' ? process.env : env
    }).trim();
    const [status, subject = ''] = out.split('|');
    if (status !== 'Valid') throw new Error(`Authenticode signature not valid: ${out || '(no output)'}`);
    if (!subject.includes(`O=${signers.win32}`) && !subject.includes(`CN=${signers.win32}`))
      throw new Error(`unexpected signer ${subject}`);
    return subject;
  }
  return 'not checked on this platform (CI test builds only)';
}

function du(dir) {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    n += e.isDirectory() ? du(p) : e.isFile() ? statSync(p).size : 0;
  }
  return n;
}
function listSizes(dir, depth = 0, prefix = '') {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    const size = e.isDirectory() ? du(p) : statSync(p).size;
    console.log(`  ${prefix}${e.name}${e.isDirectory() ? '/' : ''} ${(size / 1e6).toFixed(1)} MB`);
    if (e.isDirectory() && depth < 2) listSizes(p, depth + 1, `${prefix}${e.name}/`);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = { arch: process.arch, out: join(root, 'build', 'ollama-runtime'), inspect: argv.includes('--inspect') };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--arch') opt.arch = argv[++i];
    else if (argv[i] === '--out') opt.out = resolve(argv[++i]);
  }
  const asset = assetFor(process.platform, opt.arch);
  const work = mkdtempSync(join(tmpdir(), 'lv-ollama-'));
  try {
    const archive = join(work, asset.file);
    console.log(`Ollama ${LOCK.version}: ${asset.url}`);
    await download(asset.url, archive, { expectSha256: asset.sha256, expectSize: asset.size });
    console.log(`✓ sha256 ${asset.sha256}`);
    const unpacked = join(work, 'unpacked');
    extract(archive, unpacked);
    for (const rel of asset.prune || []) rmSync(join(unpacked, rel), { recursive: true, force: true });
    if (opt.inspect) listSizes(unpacked);
    const binary = binaryIn(unpacked);
    if (!binary) throw new Error('no ollama binary in the archive');
    const archs = detectArchitectures(binary);
    if (!archs.includes(opt.arch)) throw new Error(`binary is ${archs.join('/') || 'unknown'}, expected ${opt.arch}`);
    const signer = verifySignature(binary);
    console.log(`✓ signature: ${signer}`);
    const home = join(work, 'home');
    mkdirSync(home);
    const version = run(binary, ['--version'], { env: isolatedEnv(home), timeout: 30_000 });
    if (!version.includes(LOCK.version)) throw new Error(`binary reports "${version.trim()}", pinned ${LOCK.version}`);
    rmSync(opt.out, { recursive: true, force: true });
    mkdirSync(opt.out, { recursive: true });
    cpSync(unpacked, opt.out, { recursive: true, verbatimSymlinks: true });
    cpSync(join(root, 'scripts', 'ollama', 'LICENSE-ollama.txt'), join(opt.out, 'LICENSE-ollama.txt'));
    writeFileSync(
      join(opt.out, 'ollama-runtime.json'),
      `${JSON.stringify({ version: LOCK.version, file: asset.file, sha256: asset.sha256, signer, size: du(opt.out) }, null, 2)}\n`
    );
    console.log(`✓ Ollama ${LOCK.version} for ${process.platform}/${opt.arch} in ${opt.out} (${(du(opt.out) / 1e6).toFixed(0)} MB)`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (/fetch-ollama\.mjs$/.test(process.argv[1] || '')) {
  main().catch(err => {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  });
}
