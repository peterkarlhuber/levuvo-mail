#!/usr/bin/env node
// Checks the GitHub workflows for minimum standards: top-level permissions,
// SHA-pinned third-party actions, no pull_request_target, no secrets output.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = '.github/workflows';
const problems = [];
for (const name of readdirSync(dir).filter(n => /\.ya?ml$/.test(n))) {
  const text = readFileSync(join(dir, name), 'utf8');
  if (!/^permissions:/m.test(text))
    problems.push(`${name}: top-level \`permissions:\` missing (default: contents: read)`);
  if (/^\s*on:\s*[\s\S]*?pull_request_target/m.test(text)) problems.push(`${name}: pull_request_target is not allowed`);
  if (/permissions:\s*write-all/.test(text)) problems.push(`${name}: write-all is not allowed`);
  text.split('\n').forEach((line, i) => {
    const m = /^\s*(?:-\s+)?uses:\s*([^\s#]+)/.exec(line);
    if (!m) return;
    const ref = m[1];
    if (ref.startsWith('./')) return;
    if (!/@[0-9a-f]{40}$/.test(ref)) problems.push(`${name}:${i + 1}: action not pinned to a commit SHA: ${ref}`);
    if (!/#\s*v?\d/.test(line)) problems.push(`${name}:${i + 1}: SHA pin without version comment: ${ref}`);
  });
  if (/echo\s+.*\$\{\{\s*secrets\./.test(text)) problems.push(`${name}: secret is printed via echo`);
}
if (problems.length) {
  console.error('✗ Workflow check failed:\n' + problems.map(p => ' - ' + p).join('\n'));
  process.exit(1);
}
console.log('✓ Workflows: permissions, SHA pins and triggers meet the requirements.');
