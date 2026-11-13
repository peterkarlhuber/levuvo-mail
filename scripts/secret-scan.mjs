#!/usr/bin/env node
// Simple, transparent secret scan over all tracked files (git ls-files).
// Finds private keys, known token formats and .env/certificate files.
// Known, worthless test fixtures are listed in ALLOWED_FILES (with justification).
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const ALLOWED_FILES = new Map([
  ['apps/server/test/fixtures/peter.p12', 'worthless test key (see fixtures/README.txt)']
]);
const FORBIDDEN_NAMES = [/(^|\/)\.env(\..+)?$/, /\.(pfx|p12|pem|key|keychain|jks)$/i, /(^|\/)accounts\.json$/];
const PATTERNS = [
  ['Private key', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['GitHub fine-grained token', /\bgithub_pat_[A-Za-z0-9_]{50,}\b/],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Slack token', /\bxox[abprs]-[0-9A-Za-z-]{10,}\b/],
  ['Anthropic/OpenAI key', /\bsk-(?:ant-)?[A-Za-z0-9_-]{32,}\b/],
  ['Apple app password', /\b[a-z]{4}-[a-z]{4}-[a-z]{4}-[a-z]{4}\b(?=.*(?:APPLE|apple))/],
  ['Credentials in URL', /\bhttps?:\/\/[^\s/:@]+:[^\s/@]{3,}@(?!localhost|127\.0\.0\.1)[\w.-]+/]
];
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const findings = [];
for (const file of files) {
  if (ALLOWED_FILES.has(file)) continue;
  if (FORBIDDEN_NAMES.some(rx => rx.test(file))) findings.push(`${file}: forbidden file type/name`);
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
console.log(`Secret scan: ${files.length} tracked files checked, ${ALLOWED_FILES.size} documented exception(s).`);
if (findings.length) {
  console.error('✗ Possible secrets found:\n' + findings.map(f => ' - ' + f).join('\n'));
  process.exit(1);
}
console.log('✓ No secrets found.');
