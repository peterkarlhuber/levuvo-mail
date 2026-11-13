#!/usr/bin/env node
// Prüft die GitHub-Workflows auf Mindeststandards: Berechtigungen auf Top-Level,
// SHA-gepinnte Third-Party-Actions, kein pull_request_target, keine Secrets-Ausgabe.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = '.github/workflows';
const problems = [];
for (const name of readdirSync(dir).filter(n => /\.ya?ml$/.test(n))) {
  const text = readFileSync(join(dir, name), 'utf8');
  if (!/^permissions:/m.test(text))
    problems.push(`${name}: Top-Level-\`permissions:\` fehlt (Standard: contents: read)`);
  if (/^\s*on:\s*[\s\S]*?pull_request_target/m.test(text))
    problems.push(`${name}: pull_request_target ist nicht erlaubt`);
  if (/permissions:\s*write-all/.test(text)) problems.push(`${name}: write-all ist nicht erlaubt`);
  text.split('\n').forEach((line, i) => {
    const m = /^\s*(?:-\s+)?uses:\s*([^\s#]+)/.exec(line);
    if (!m) return;
    const ref = m[1];
    if (ref.startsWith('./')) return;
    if (!/@[0-9a-f]{40}$/.test(ref)) problems.push(`${name}:${i + 1}: Action nicht per Commit-SHA gepinnt: ${ref}`);
    if (!/#\s*v?\d/.test(line)) problems.push(`${name}:${i + 1}: SHA-Pin ohne Versionskommentar: ${ref}`);
  });
  if (/echo\s+.*\$\{\{\s*secrets\./.test(text)) problems.push(`${name}: Secret wird per echo ausgegeben`);
}
if (problems.length) {
  console.error('✗ Workflow-Prüfung fehlgeschlagen:\n' + problems.map(p => ' - ' + p).join('\n'));
  process.exit(1);
}
console.log('✓ Workflows: Berechtigungen, SHA-Pins und Trigger entsprechen den Vorgaben.');
