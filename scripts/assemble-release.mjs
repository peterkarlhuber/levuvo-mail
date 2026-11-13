#!/usr/bin/env node
// Führt die Build-Artefakte der drei Plattformen zu einem Release-Verzeichnis zusammen:
// prüft Vollständigkeit, berechnet SHA-256 aus den tatsächlichen Dateien, schreibt
// SHA256SUMS.txt, release-manifest.json und RELEASE_NOTES.md.
//   node scripts/assemble-release.mjs --in <artefakt-ordner> --out <release-ordner>
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

const EXPECTED = [
  { file: `Levuvo-Mail-${v}-arm64.dmg`, platform: 'macos', architecture: 'arm64', label: 'macOS (Apple Silicon)' },
  { file: `Levuvo-Mail-Setup-${v}-arm64.exe`, platform: 'windows', architecture: 'arm64', label: 'Windows ARM64' },
  { file: `Levuvo-Mail-Setup-${v}-x64.exe`, platform: 'windows', architecture: 'x64', label: 'Windows x64' }
];
// Zusätzliche Dateien, die nur signierte Builds mit Update-Feed erzeugen
const EXTRA = new RegExp(
  `^(?:Levuvo-Mail-${v.replace(/\./g, '\\.')}-arm64\\.zip(?:\\.blockmap)?|.*\\.exe\\.blockmap|.*\\.dmg\\.blockmap|latest(?:-mac)?\\.yml)$`
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
    problems.push(matches.length ? `MEHRFACH: ${item.file}` : `FEHLT: ${item.file}`);
    continue;
  }
  const src = matches[0];
  if (statSync(src).size < 10_000_000) problems.push(`VERDÄCHTIG KLEIN (<10 MB): ${item.file}`);
  copyFileSync(src, join(outDir, item.file));
  artifacts.push({
    file: item.file,
    platform: item.platform,
    architecture: item.architecture,
    bytes: statSync(src).size,
    sha256: sha256(join(outDir, item.file)),
    signedForDistribution: signed,
    signingStatus: signed
      ? 'signiert (Signatur im Build-Job geprüft)'
      : 'unsigned – interne Testversion, nicht für die Verteilung',
    notarized: false
  });
}
// Plattform-Manifeste gegen die tatsächlichen Dateien abgleichen
for (const mf of all.filter(f => basename(f) === 'release-manifest.json')) {
  const m = JSON.parse(readFileSync(mf, 'utf8'));
  if (m.version !== v) problems.push(`Manifest ${mf}: Version ${m.version} ≠ ${v}`);
  if (m.commit && commit !== 'unknown' && m.commit !== commit)
    problems.push(`Manifest ${mf}: Commit ${m.commit} ≠ ${commit}`);
  for (const a of m.artifacts || []) {
    const mine = artifacts.find(x => x.file === a.file);
    if (mine && mine.sha256 !== a.sha256)
      problems.push(`SHA-256-Abweichung zwischen Build-Job und Zusammenführung: ${a.file}`);
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
  console.error('✗ Release unvollständig oder inkonsistent:\n' + problems.map(p => ' - ' + p).join('\n'));
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

// Release Notes: CHANGELOG-Abschnitt der Version + feste Hinweise
let changes = '_Kein CHANGELOG-Eintrag für diese Version gefunden._';
if (existsSync('CHANGELOG.md')) {
  const text = readFileSync('CHANGELOG.md', 'utf8');
  const m = new RegExp(`^## \\[?${v.replace(/\./g, '\\.')}\\]?[^\\n]*\\n([\\s\\S]*?)(?=^## |\\Z)`, 'm').exec(text);
  if (m) changes = m[1].trim();
}
const rows = artifacts
  .map(a => `| ${EXPECTED.find(e => e.file === a.file).label} | \`${a.file}\` | \`${a.sha256}\` |`)
  .join('\n');
const notes = `# Levuvo Mail ${v}

${signed ? '' : '> ⚠️ **Unsignierte interne Testversion.** Nicht öffentlich verteilen. Gatekeeper (macOS) und SmartScreen (Windows) warnen; automatische Updates sind in diesen Builds deaktiviert.\n'}
## Änderungen

${changes}

## Downloads

| Plattform | Datei | SHA-256 |
|---|---|---|
${rows}

Prüfsummen: \`SHA256SUMS.txt\` (\`shasum -a 256 -c SHA256SUMS.txt\` bzw. \`Get-FileHash\`). Maschinenlesbar: \`release-manifest.json\`.

## Installation

- **macOS (Apple Silicon):** DMG öffnen, „Levuvo Mail“ in „Programme“ ziehen. ${signed ? '' : 'Unsigniert: Rechtsklick → „Öffnen“ bzw. Systemeinstellungen → Datenschutz & Sicherheit → „Trotzdem öffnen“.'}
- **Windows (ARM64 bzw. x64):** passenden Installer wählen und ausführen (pro Benutzer, ohne Administratorrechte). ${signed ? '' : 'Unsigniert: SmartScreen → „Weitere Informationen“ → „Trotzdem ausführen“.'}

## Signierung & Prüfstatus

- Signierung: ${signed ? '**signiert** (Signatur im Build geprüft)' : '**nicht signiert**, macOS nicht notarisiert'}
- Build-Verifikation: Tests, Typecheck, Build, Architekturprüfung der Binärdateien (PE/Mach-O) und Start-Test des entpackten Programms in GitHub Actions.
- **Nicht** enthalten: echte Plattform-Abnahme auf Zielgeräten (siehe \`RELEASE-CHECKLIST.md\`) und Tests mit echten Postfächern.

## Herkunft

- Commit: \`${commit}\`
${runUrl ? `- Build-Lauf: ${runUrl}\n` : ''}- Zusammengestellt: ${builtAt}
${complete ? '' : `\n> ❌ **Unvollständig:** ${problems.join('; ')}\n`}`;
writeFileSync(join(outDir, 'RELEASE_NOTES.md'), notes);
console.log(
  `Release-Verzeichnis ${outDir}: ${artifacts.length}/${EXPECTED.length} Installer, ${extras.length} Zusatzdateien${complete ? '' : ' – UNVOLLSTÄNDIG'}`
);
for (const a of artifacts) console.log(`- ${a.file}  ${a.sha256}`);
