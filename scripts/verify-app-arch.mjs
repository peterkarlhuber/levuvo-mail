#!/usr/bin/env node
// Checks the actual CPU architecture of the unpacked app directory (main executable and
// all native *.node modules) using the PE or Mach-O headers. Prevents a renamed package
// of the wrong architecture from being shipped as an installer.
//   node scripts/verify-app-arch.mjs <win|mac> <arm64|x64>
import { closeSync, openSync, readSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PE = { 0x8664: 'x64', 0xaa64: 'arm64', 0x14c: 'ia32' };
const MACHO = { 0x0100000c: 'arm64', 0x01000007: 'x64' };

function readBytes(file, length, position = 0) {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(length);
    const n = readSync(fd, buf, 0, length, position);
    return buf.subarray(0, n);
  } finally {
    closeSync(fd);
  }
}
/** @returns {string[]} Architectures of the file (empty = unknown format) */
export function detectArchitectures(file) {
  const head = readBytes(file, 4096);
  if (head.length >= 64 && head.readUInt16LE(0) === 0x5a4d) {
    const peOffset = head.readUInt32LE(0x3c);
    const pe = readBytes(file, 6, peOffset);
    if (pe.length === 6 && pe.toString('latin1', 0, 4) === 'PE\0\0') return [PE[pe.readUInt16LE(4)] || 'unknown'];
    return [];
  }
  if (head.length >= 8) {
    const beMagic = head.readUInt32BE(0);
    if (beMagic === 0xcafebabe) {
      const count = head.readUInt32BE(4);
      return Array.from({ length: Math.min(count, 8) }, (_, i) => MACHO[head.readUInt32BE(8 + i * 20)] || 'unknown');
    }
    if (head.readUInt32LE(0) === 0xfeedfacf) return [MACHO[head.readUInt32LE(4)] || 'unknown'];
  }
  return [];
}
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

if (/verify-app-arch\.mjs$/.test(process.argv[1] || '')) {
  const [platform, arch] = process.argv.slice(2);
  if (!['win', 'mac'].includes(platform) || !['arm64', 'x64'].includes(arch)) {
    console.error('Usage: node scripts/verify-app-arch.mjs <win|mac> <arm64|x64>');
    process.exit(2);
  }
  const release = resolve('release');
  const candidates =
    platform === 'win'
      ? [arch === 'arm64' ? 'win-arm64-unpacked' : 'win-unpacked']
      : [arch === 'arm64' ? 'mac-arm64' : 'mac'];
  const root = candidates.map(name => join(release, name)).find(dir => existsSync(dir) && statSync(dir).isDirectory());
  if (!root) {
    console.error(`✗ Unpacked app directory not found (${candidates.join(' / ')}) in ${release}`);
    process.exit(1);
  }
  const files = walk(root);
  const main =
    platform === 'win'
      ? files.find(f => f.endsWith(join('', 'Levuvo Mail.exe')))
      : files.find(f => f.endsWith(join('Contents', 'MacOS', 'Levuvo Mail')));
  const natives = files.filter(f => f.endsWith('.node'));
  const targets = [main, ...natives].filter(Boolean);
  let failed = !main;
  if (!main) console.error('✗ Main executable “Levuvo Mail” not found');
  if (!natives.length) {
    console.error('✗ No native .node module (keychain) found');
    failed = true;
  }
  for (const file of targets) {
    const found = detectArchitectures(file);
    const ok = found.length > 0 && found.every(a => a === arch);
    console.log(
      `${ok ? '✓' : '✗'} ${file.slice(root.length + 1)} → ${found.join(',') || 'unknown'} (expected ${arch})`
    );
    if (!ok) failed = true;
  }
  if (failed) process.exit(1);
  console.log(`Architecture ${platform}/${arch} verified (${targets.length} binaries).`);
}
