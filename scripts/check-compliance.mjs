#!/usr/bin/env node
// Compliance gate (part of npm run release:check and CI): the support period is set and long
// enough (CRA Art. 13(8)), and the documents the compliance file relies on exist
// (docs/compliance/README.md). Not a legal check – it keeps the engineering side from drifting.
//   node scripts/check-compliance.mjs
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

export const REQUIRED_DOCS = [
  'SECURITY.md',
  'PRIVACY.md',
  'THIRD-PARTY-NOTICES.txt',
  'docs/compliance/README.md',
  'docs/compliance/CRA.md',
  'docs/compliance/AI-ACT.md',
  'docs/compliance/GDPR.md',
  'docs/compliance/ACCESSIBILITY.md',
  'docs/compliance/OTHER-REGULATIONS.md',
  'docs/compliance/LICENSING.md',
  'docs/compliance/USER-INFORMATION.md',
  'docs/compliance/OPEN-ITEMS.md',
  'docs/compliance/cra/VULNERABILITY-HANDLING.md',
  'docs/compliance/cra/INCIDENT-REPORTING.md',
  'docs/compliance/cra/SUPPORT-PERIOD.md',
  'docs/compliance/cra/SECURITY-UPDATES.md',
  'docs/compliance/cra/RISK-ASSESSMENT.md',
  'docs/compliance/cra/TECHNICAL-DOCUMENTATION.md',
  'docs/compliance/cra/EU-DECLARATION-OF-CONFORMITY.md',
  'docs/compliance/cra/CONFORMITY-ASSESSMENT.md',
  'docs/compliance/gdpr/RECORD-OF-PROCESSING.md',
  'docs/compliance/gdpr/DPIA-TEMPLATE.md',
  'docs/compliance/gdpr/BREACH-RESPONSE.md',
  'docs/compliance/gdpr/PROCESSOR-CHECKLIST.md',
  'docs/compliance/gdpr/THIRD-PARTY-DATA-CLOUD-AI.md',
  'docs/compliance/ai-act/AI-SYSTEM-INVENTORY.md',
  'docs/ai/AI-LITERACY.md',
  'docs/ai/USAGE-POLICY.md',
  'docs/ai/PROCESSING-RECORD.md',
  'docs/ai/SECURITY-CONCEPT.md'
];

const MONTHS = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11
};

/** Date of the first release of a major version from a CHANGELOG ("## 2.0.0 – 13 November 2026"). */
export function firstReleaseOfMajor(changelog, major) {
  let first = null;
  for (const m of changelog.matchAll(/^## (\d+)\.(\d+)\.(\d+)\s+[–-]\s+(\d{1,2}) (\w+) (\d{4})/gm)) {
    if (Number(m[1]) !== major) continue;
    const month = MONTHS[m[5].toLowerCase()];
    if (month === undefined) continue;
    const date = new Date(Date.UTC(Number(m[6]), month, Number(m[4])));
    if (!first || date < first) first = date;
  }
  return first;
}

/** Problems with the support period; `today` and `changelog` are injectable for tests. */
export function supportProblems({ version, supportUntil, changelog, today = new Date() }) {
  const problems = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(supportUntil || '')) {
    problems.push(
      'package.json levuvo.supportUntil (YYYY-MM-DD) is missing – see docs/compliance/cra/SUPPORT-PERIOD.md'
    );
    return problems;
  }
  const until = new Date(`${supportUntil}T23:59:59Z`);
  if (until < today)
    problems.push(`end of support ${supportUntil} is in the past: version ${version} would ship without support`);
  const first = firstReleaseOfMajor(changelog, Number(String(version).split('.')[0]));
  if (first) {
    const minimum = new Date(first);
    minimum.setUTCFullYear(minimum.getUTCFullYear() + 5);
    if (until < minimum)
      problems.push(
        `end of support ${supportUntil} is less than five years after the first ${String(version).split('.')[0]}.x release (${first.toISOString().slice(0, 10)}); CRA Art. 13(8) needs a documented reason in docs/compliance/cra/SUPPORT-PERIOD.md`
      );
  }
  return problems;
}

export function complianceProblems(dir = root) {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const changelog = existsSync(join(dir, 'CHANGELOG.md')) ? readFileSync(join(dir, 'CHANGELOG.md'), 'utf8') : '';
  const problems = supportProblems({ version: pkg.version, supportUntil: pkg.levuvo?.supportUntil, changelog });
  for (const file of REQUIRED_DOCS) if (!existsSync(join(dir, file))) problems.push(`missing ${file}`);
  const support = existsSync(join(dir, 'docs/compliance/cra/SUPPORT-PERIOD.md'))
    ? readFileSync(join(dir, 'docs/compliance/cra/SUPPORT-PERIOD.md'), 'utf8')
    : '';
  if (pkg.levuvo?.supportUntil && support && !support.includes(pkg.levuvo.supportUntil))
    problems.push(
      `docs/compliance/cra/SUPPORT-PERIOD.md does not mention the end of support ${pkg.levuvo.supportUntil}`
    );
  return problems;
}

if (/check-compliance\.mjs$/.test(process.argv[1] || '')) {
  const problems = complianceProblems();
  if (problems.length) {
    console.error(`✗ Compliance:\n${problems.map(p => ` - ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`✓ Compliance: support period and ${REQUIRED_DOCS.length} documents in place`);
}
