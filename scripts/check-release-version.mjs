#!/usr/bin/env node
// Release gate for the version number (part of npm run release:check): the CHANGELOG must have a
// section for the version in package.json, and no "Unreleased" section may still hold entries.
// Otherwise a build carries the version of an earlier release while containing other changes.
//   node scripts/check-release-version.mjs
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

/** Sections of a Keep-a-Changelog style file: [{ title, body }]. */
export function changelogSections(text) {
  const sections = [];
  for (const line of text.split('\n')) {
    const m = /^## (.+)$/.exec(line);
    if (m) sections.push({ title: m[1].trim(), body: '' });
    else if (sections.length) sections.at(-1).body += `${line}\n`;
  }
  return sections;
}

export function releaseVersionProblems(version, changelog) {
  const problems = [];
  if (!/^\d+\.\d+\.\d+$/.test(version)) problems.push(`package.json version "${version}" is not X.Y.Z`);
  const sections = changelogSections(changelog);
  const unreleased = sections.find(s => /^unreleased\b/i.test(s.title));
  if (unreleased && /^\s*[-*]\s+\S/m.test(unreleased.body))
    problems.push('CHANGELOG.md has entries under "Unreleased": bump the version and date the section first');
  const own = sections.findIndex(s => s.title === version || s.title.startsWith(`${version} `));
  if (own === -1) problems.push(`CHANGELOG.md has no section "## ${version} – <date>"`);
  else if (sections.findIndex(s => !/^unreleased\b/i.test(s.title)) !== own)
    problems.push(`the section for ${version} is not the newest release section in CHANGELOG.md`);
  return problems;
}

if (/check-release-version\.mjs$/.test(process.argv[1] || '')) {
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const problems = releaseVersionProblems(version, readFileSync(join(root, 'CHANGELOG.md'), 'utf8'));
  if (problems.length) {
    console.error(`✗ Release version ${version}:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`✓ Release version ${version} matches the newest CHANGELOG section; nothing is left under "Unreleased".`);
}
