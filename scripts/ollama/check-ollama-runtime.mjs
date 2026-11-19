#!/usr/bin/env node
// Supply-chain check of the bundled Ollama (scripts/ollama/ollama-lock.json), run weekly in CI:
//  - published security advisories of ollama/ollama (GitHub) and OSV entries for the Go module
//    github.com/ollama/ollama that affect the pinned version fail the check;
//  - a newer stable release is reported (with --strict it fails, like the CPython check).
//   node scripts/ollama/check-ollama-runtime.mjs [--strict]     (GITHUB_TOKEN raises the rate limit)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const LOCK = JSON.parse(readFileSync(join(import.meta.dirname, 'ollama-lock.json'), 'utf8'));

const parts = v =>
  String(v)
    .replace(/^v/, '')
    .split(/[.-]/)
    .slice(0, 3)
    .map(n => Number.parseInt(n, 10) || 0);
export function compareVersions(a, b) {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** True when `version` falls in a GitHub advisory range such as "< 0.40.2" or ">= 0.1.0, < 0.3.4". */
export function inRange(version, range) {
  if (!range) return false;
  return String(range)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .every(cond => {
      const m = /^(<=|>=|<|>|=)?\s*v?([\d.]+)/.exec(cond);
      if (!m) return false;
      const c = compareVersions(version, m[2]);
      return { '<': c < 0, '<=': c <= 0, '>': c > 0, '>=': c >= 0, '=': c === 0, undefined: c === 0 }[m[1]];
    });
}

async function getJson(url, init = {}) {
  const headers = { Accept: 'application/vnd.github+json', ...(init.headers || {}) };
  if (process.env.GITHUB_TOKEN && url.startsWith('https://api.github.com'))
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

export async function findProblems(version = LOCK.version) {
  const problems = [];
  const advisories = await getJson('https://api.github.com/repos/ollama/ollama/security-advisories?per_page=100&state=published');
  for (const a of advisories)
    for (const v of a.vulnerabilities || [])
      if (inRange(version, v.vulnerable_version_range))
        problems.push(`${a.ghsa_id} (${a.severity}): ${a.summary} — fixed in ${v.patched_versions || 'no release yet'}`);
  const osv = await getJson('https://api.osv.dev/v1/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ package: { name: 'github.com/ollama/ollama', ecosystem: 'Go' }, version: `v${version}` })
  });
  for (const v of osv.vulns || []) if (!problems.some(p => (v.aliases || []).some(id => p.startsWith(id))))
    problems.push(`${v.id}: ${v.summary || v.details?.slice(0, 120) || 'see osv.dev'}`);
  return problems;
}

async function main() {
  const strict = process.argv.includes('--strict');
  const problems = await findProblems();
  for (const p of problems) console.error(`✗ Ollama ${LOCK.version}: ${p}`);
  const latest = await getJson('https://api.github.com/repos/ollama/ollama/releases/latest');
  const behind = compareVersions(latest.tag_name, LOCK.version) > 0;
  if (behind) {
    const msg = `Bundled Ollama ${LOCK.version} is behind ${latest.tag_name}: update scripts/ollama/ollama-lock.json.`;
    if (strict) console.error(`✗ ${msg}`);
    else console.log(`::warning::${msg}`);
  }
  if (problems.length || (strict && behind)) process.exit(1);
  console.log(`✓ Bundled Ollama ${LOCK.version}: no known advisories${behind ? '' : ', newest release'}.`);
}

if (/check-ollama-runtime\.mjs$/.test(process.argv[1] || '')) {
  main().catch(err => {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  });
}
