#!/usr/bin/env node
// Combines the build artifacts of the three platforms into one release directory:
// checks completeness, computes SHA-256 from the actual files, writes
// SHA256SUMS.txt, release-manifest.json and RELEASE_NOTES.md.
//   node scripts/assemble-release.mjs --in <artifact-dir> --out <release-dir>
//        [--signed] [--commit <sha>] [--allow-partial] [--run-url <url>]
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = name => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const inDir = resolve(opt('--in') || 'artifacts');
const outDir = resolve(opt('--out') || 'release-assets');
const signed = args.includes('--signed');
const allowPartial = args.includes('--allow-partial');
const commit = opt('--commit') || process.env.GITHUB_SHA || 'unknown';
const runUrl = opt('--run-url') || '';
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const v = pkg.version;
const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const EXPECTED = [
  { file: `Levuvo-Mail-${v}-arm64.dmg`, platform: 'macos', architecture: 'arm64', label: 'macOS (Apple Silicon)' },
  { file: `Levuvo-Mail-Setup-${v}-arm64.exe`, platform: 'windows', architecture: 'arm64', label: 'Windows ARM64' },
  { file: `Levuvo-Mail-Setup-${v}-x64.exe`, platform: 'windows', architecture: 'x64', label: 'Windows x64' }
];
// Additional files that only signed builds with an update feed produce
const EXTRA = new RegExp(
  `^(?:Levuvo-Mail-${escapeRegExp(v)}-arm64\\.zip(?:\\.blockmap)?|.*\\.exe\\.blockmap|.*\\.dmg\\.blockmap|latest(?:-mac)?\\.yml)$`
);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const f = join(dir, e.name);
    if (e.isDirectory()) walk(f, out);
    else out.push(f);
  }
  return out;
}
const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex');

const all = walk(inDir);
mkdirSync(outDir, { recursive: true });
const problems = [];
const artifacts = [];
for (const item of EXPECTED) {
  const matches = all.filter(f => basename(f) === item.file);
  if (matches.length !== 1) {
    problems.push(matches.length ? `DUPLICATE: ${item.file}` : `MISSING: ${item.file}`);
    continue;
  }
  const src = matches[0];
  if (statSync(src).size < 10_000_000) problems.push(`SUSPICIOUSLY SMALL (<10 MB): ${item.file}`);
  copyFileSync(src, join(outDir, item.file));
  artifacts.push({
    file: item.file,
    platform: item.platform,
    architecture: item.architecture,
    bytes: statSync(src).size,
    sha256: sha256(join(outDir, item.file)),
    signedForDistribution: signed,
    signingStatus: signed
      ? 'signed (signature verified in the build job)'
      : 'unsigned – internal test build, not for distribution',
    notarized: false
  });
}
// Check the platform manifests against the actual files
for (const mf of all.filter(f => basename(f) === 'release-manifest.json')) {
  const m = JSON.parse(readFileSync(mf, 'utf8'));
  if (m.version !== v) problems.push(`Manifest ${mf}: Version ${m.version} ≠ ${v}`);
  if (m.commit && commit !== 'unknown' && m.commit !== commit)
    problems.push(`Manifest ${mf}: Commit ${m.commit} ≠ ${commit}`);
  for (const a of m.artifacts || []) {
    const mine = artifacts.find(x => x.file === a.file);
    if (mine && mine.sha256 !== a.sha256) problems.push(`SHA-256 mismatch between build job and assembly: ${a.file}`);
  }
}
const extras = [];
if (signed) {
  for (const f of all) {
    if (EXTRA.test(basename(f)) && !artifacts.some(a => a.file === basename(f)) && !extras.includes(basename(f))) {
      copyFileSync(f, join(outDir, basename(f)));
      extras.push(basename(f));
    }
  }
}
if (problems.length && !allowPartial) {
  console.error('✗ Release incomplete or inconsistent:\n' + problems.map(p => ' - ' + p).join('\n'));
  process.exit(1);
}
const builtAt = new Date().toISOString();
const files = [...artifacts.map(a => a.file), ...extras].sort();
writeFileSync(join(outDir, 'SHA256SUMS.txt'), files.map(f => `${sha256(join(outDir, f))}  ${f}`).join('\n') + '\n');
const complete = artifacts.length === EXPECTED.length && problems.length === 0;
writeFileSync(
  join(outDir, 'release-manifest.json'),
  JSON.stringify(
    { product: 'Levuvo Mail', version: v, commit, builtAt, complete, signed, problems, artifacts },
    null,
    2
  ) + '\n'
);

// Release notes: CHANGELOG section of the version + fixed notes
let changes = '_No CHANGELOG entry found for this version._';
if (existsSync('CHANGELOG.md')) {
  const text = readFileSync('CHANGELOG.md', 'utf8');
  const m = new RegExp(`^## \\[?${escapeRegExp(v)}\\]?[^\\n]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm').exec(text);
  if (m) changes = m[1].trim();
}
const rows = artifacts
  .map(a => `| ${EXPECTED.find(e => e.file === a.file).label} | \`${a.file}\` | \`${a.sha256}\` |`)
  .join('\n');
const notes = `# Levuvo Mail ${v}

${signed ? '' : '> ⚠️ **Unsigned internal test build.** Do not distribute publicly. Gatekeeper (macOS) and SmartScreen (Windows) will warn; automatic updates are disabled in these builds.\n'}
## Changes

${changes}

## Downloads

| Platform | File | SHA-256 |
|---|---|---|
${rows}

Checksums: \`SHA256SUMS.txt\` (\`shasum -a 256 -c SHA256SUMS.txt\` or \`Get-FileHash\`). Machine-readable: \`release-manifest.json\`.

## Installation

- **macOS (Apple Silicon):** open the DMG and drag “Levuvo Mail” to “Applications”. ${signed ? '' : 'Unsigned: right-click → “Open”, or System Settings → Privacy & Security → “Open Anyway”.'}
- **Windows (ARM64 or x64):** choose and run the matching installer (per user, no administrator rights). ${signed ? '' : 'Unsigned: SmartScreen → “More info” → “Run anyway”.'}

## Signing & verification status

- Signing: ${signed ? '**signed** (signature verified in the build)' : '**not signed**, macOS not notarized'}
- Build verification: tests, typecheck, build, architecture check of the binaries (PE/Mach-O) and startup test of the unpacked program in GitHub Actions.
- **Not** included: real platform acceptance on target devices (see \`RELEASE-CHECKLIST.md\`) and tests with real mailboxes.

## Provenance

- Commit: \`${commit}\`
${runUrl ? `- Build run: ${runUrl}\n` : ''}- Assembled: ${builtAt}
${complete ? '' : `\n> ❌ **Incomplete:** ${problems.join('; ')}\n`}`;
writeFileSync(join(outDir, 'RELEASE_NOTES.md'), notes);
console.log(
  `Release directory ${outDir}: ${artifacts.length}/${EXPECTED.length} installers, ${extras.length} additional files${complete ? '' : ' – INCOMPLETE'}`
);
for (const a of artifacts) console.log(`- ${a.file}  ${a.sha256}`);
