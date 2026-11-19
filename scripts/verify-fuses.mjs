#!/usr/bin/env node
// Checks the Electron fuses of the packaged application against build.electronFuses in
// package.json. The fuses close the doors through which another local program could run its
// own code as Levuvo Mail and so reach the keychain entries (ELECTRON_RUN_AS_NODE, NODE_OPTIONS,
// --inspect, a replaced app.asar). electron-builder flips them before signing; this check proves
// that the shipped binary really carries them.
//   node scripts/verify-fuses.mjs <win|mac|linux> <arm64|x64>
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

/** electron-builder option name → index in the fuse wire (@electron/fuses FuseV1Options). */
export const FUSE_INDEX = {
  runAsNode: 0,
  enableCookieEncryption: 1,
  enableNodeOptionsEnvironmentVariable: 2,
  enableNodeCliInspectArguments: 3,
  enableEmbeddedAsarIntegrityValidation: 4,
  onlyLoadAppFromAsar: 5,
  loadBrowserProcessSpecificV8Snapshot: 6,
  grantFileProtocolExtraPrivileges: 7
};

/** Fuses that must always be set this way; a build configuration without them is rejected. */
export const REQUIRED_FUSES = {
  runAsNode: false,
  enableNodeOptionsEnvironmentVariable: false,
  enableNodeCliInspectArguments: false,
  enableEmbeddedAsarIntegrityValidation: true,
  onlyLoadAppFromAsar: true
};

const ENABLE = 49; // '1'
const DISABLE = 48; // '0'

export function configuredFuses(pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))) {
  return pkg.build?.electronFuses || {};
}

/** Problems of a build configuration: missing or weakened required fuses. */
export function configProblems(fuses) {
  return Object.entries(REQUIRED_FUSES)
    .filter(([name, value]) => fuses[name] !== value)
    .map(([name, value]) => `build.electronFuses.${name} must be ${value} (is ${fuses[name]})`);
}

/**
 * Compares a fuse wire as returned by @electron/fuses getCurrentFuseWire (index → FuseState char
 * code) with the expected configuration.
 */
export function wireProblems(wire, expected) {
  const problems = [];
  for (const [name, value] of Object.entries(expected)) {
    const index = FUSE_INDEX[name];
    if (index === undefined) {
      problems.push(`unknown fuse ${name}`);
      continue;
    }
    const state = wire[index];
    const want = value ? ENABLE : DISABLE;
    if (state !== want)
      problems.push(`${name}: expected ${value ? 'enabled' : 'disabled'}, binary has ${describe(state)}`);
  }
  return problems;
}

function describe(state) {
  if (state === ENABLE) return 'enabled';
  if (state === DISABLE) return 'disabled';
  if (state === undefined) return 'no such fuse';
  return `state ${String.fromCharCode(state)}`;
}

export function executablePath(platform, arch, dir = resolve('release')) {
  if (platform === 'win') return join(dir, arch === 'arm64' ? 'win-arm64-unpacked' : 'win-unpacked', 'Levuvo Mail.exe');
  if (platform === 'mac') return join(dir, arch === 'arm64' ? 'mac-arm64' : 'mac', 'Levuvo Mail.app');
  if (platform === 'linux')
    return join(dir, arch === 'arm64' ? 'linux-arm64-unpacked' : 'linux-unpacked', 'levuvo-mail');
  throw new Error(`unknown platform ${platform}`);
}

async function main() {
  const [platform, arch] = process.argv.slice(2);
  const fuses = configuredFuses();
  const config = configProblems(fuses);
  if (config.length) throw new Error(config.join('\n'));
  const target = executablePath(platform, arch);
  if (!existsSync(target)) throw new Error(`program not found: ${target}`);
  const { getCurrentFuseWire } = await import('@electron/fuses');
  const wire = await getCurrentFuseWire(target);
  const problems = wireProblems(wire, fuses);
  if (problems.length) throw new Error(`fuses of ${target}:\n  ${problems.join('\n  ')}`);
  console.log(`✓ ${platform}/${arch}: Electron fuses as configured (${Object.keys(fuses).join(', ')}).`);
}

if (/verify-fuses\.mjs$/.test(process.argv[1] || '')) {
  main().catch(err => {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  });
}
