#!/usr/bin/env node
// Einfacher, transparenter Secret-Scan über alle versionierten Dateien (git ls-files).
// Findet private Schlüssel, bekannte Token-Formate und .env-/Zertifikatsdateien.
// Bekannte, wertlose Test-Fixtures stehen in ALLOWED_FILES (mit Begründung).
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const ALLOWED_FILES = new Map([
  ['apps/server/test/fixtures/peter.p12', 'wertloser Test-Schlüssel (siehe fixtures/README.txt)']
]);
const FORBIDDEN_NAMES = [/(^|\/)\.env(\..+)?$/, /\.(pfx|p12|pem|key|keychain|jks)$/i, /(^|\/)accounts\.json$/];
const PATTERNS = [
  ['Privater Schlüssel', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/],
  ['GitHub-Token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['GitHub-Fine-Grained-Token', /\bgithub_pat_[A-Za-z0-9_]{50,}\b/],
  ['AWS-Access-Key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['Google-API-Key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Slack-Token', /\bxox[abprs]-[0-9A-Za-z-]{10,}\b/],
  ['Anthropic/OpenAI-Key', /\bsk-(?:ant-)?[A-Za-z0-9_-]{32,}\b/],
  ['Apple-App-Passwort', /\b[a-z]{4}-[a-z]{4}-[a-z]{4}-[a-z]{4}\b(?=.*(?:APPLE|apple))/],
  ['Zugangsdaten in URL', /\bhttps?:\/\/[^\s/:@]+:[^\s/@]{3,}@(?!localhost|127\.0\.0\.1)[\w.-]+/]
];
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const findings = [];
for (const file of files) {
  if (ALLOWED_FILES.has(file)) continue;
  if (FORBIDDEN_NAMES.some(rx => rx.test(file))) findings.push(`${file}: verbotener Dateityp/-name`);
  let st;
  try {
    st = statSync(file);
  } catch {
    continue;
  }
  if (!st.isFile() || st.size > 2_000_000) continue;
  const buf = readFileSync(file);
  if (buf.includes(0)) continue;
  const text = buf.toString('utf8');
  for (const [name, rx] of PATTERNS) {
    const m = rx.exec(text);
    if (m) findings.push(`${file}: ${name} (${m[0].slice(0, 6)}…)`);
  }
}
console.log(
  `Secret-Scan: ${files.length} versionierte Dateien geprüft, ${ALLOWED_FILES.size} dokumentierte Ausnahme(n).`
);
if (findings.length) {
  console.error('✗ Mögliche Geheimnisse gefunden:\n' + findings.map(f => ' - ' + f).join('\n'));
  process.exit(1);
}
console.log('✓ Keine Geheimnisse gefunden.');
