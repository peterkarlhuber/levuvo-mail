#!/usr/bin/env node
// Licence policy check (docs/compliance/LICENSING.md) for everything that ships in the installers.
//   node scripts/check-licenses.mjs                 npm packages (production + bundled UI)
//   node scripts/check-licenses.mjs --python <file> rows "name version: licence" of the AI runtime
// Exit code 1 when a component has a licence outside the policy and no documented exception.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { shippedNpmPackages } from './lib/shipped-packages.mjs';

const root = resolve(import.meta.dirname, '..');
export const POLICY = JSON.parse(readFileSync(join(root, 'scripts', 'license-policy.json'), 'utf8'));

const norm = s => {
  let t = s.trim();
  while (t.startsWith('(') && t.endsWith(')')) t = t.slice(1, -1).trim();
  return t;
};

/** 'allowed' | 'review' | 'denied' for one licence expression. */
export function licenseVerdict(expression, policy = POLICY) {
  const expr = norm(String(expression || ''));
  if (!expr || /^see package$/i.test(expr) || /^UNLICENSED$/i.test(expr)) return 'denied';
  const one = term => {
    const t = norm(term);
    if (policy.allowed.includes(t)) return 'allowed';
    if (policy.review.includes(t)) return 'review';
    return 'denied';
  };
  const rank = { allowed: 0, review: 1, denied: 2 };
  // Classifier lists ("MIT License, BSD License") and AND need every part; OR needs one.
  if (/\s+OR\s+/i.test(expr))
    return expr
      .split(/\s+OR\s+/i)
      .map(p => licenseVerdict(p, policy))
      .sort((a, b) => rank[a] - rank[b])[0];
  if (/\s+AND\s+|,\s*/i.test(expr))
    return expr
      .split(/\s+AND\s+|,\s*/i)
      .map(p => licenseVerdict(p, policy))
      .sort((a, b) => rank[b] - rank[a])[0];
  return one(expr);
}

/** Problems for a list of {name, version, license}. */
export function licenseProblems(components, policy = POLICY) {
  const problems = [];
  for (const c of components) {
    const verdict = licenseVerdict(c.license, policy);
    if (verdict === 'allowed') continue;
    if (policy.exceptions[c.name]) continue;
    problems.push(
      `${c.name} ${c.version}: "${c.license}" is ${verdict === 'review' ? 'allowed only with a documented exception' : 'not allowed'}`
    );
  }
  return problems;
}

/** Parses THIRD-PARTY-PYTHON.txt / the NOTICES output of scripts/build-ai-runtime.mjs. */
export function parsePythonNotices(text) {
  return text
    .split('\n')
    .map(line => /^(\S+) (\S+): (.+)$/.exec(line.trim()))
    .filter(Boolean)
    .filter(m => m[1] !== 'Python')
    .map(m => ({ name: m[1].toLowerCase().replace(/[._]+/g, '-'), version: m[2], license: m[3] }));
}

if (/check-licenses\.mjs$/.test(process.argv[1] || '')) {
  const i = process.argv.indexOf('--python');
  const components =
    i > 0 ? parsePythonNotices(readFileSync(resolve(process.argv[i + 1]), 'utf8')) : shippedNpmPackages(root);
  const problems = licenseProblems(components);
  if (problems.length) {
    console.error(`✗ Licence policy (scripts/license-policy.json):\n${problems.map(p => ` - ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`✓ ${components.length} components within the licence policy`);
}
