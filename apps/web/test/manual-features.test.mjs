// The manual keeps up with the app: every user-visible feature has a section in the German and the
// English manual (docs/manual/features.json), the menu paths the manual quotes are real UI texts,
// every screenshot exists in both languages, and every new CHANGELOG entry names its manual section.
// Fix a failure with: node scripts/manual/features.mjs (lists all problems) and --missing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  changelogProblems,
  discoverFeatures,
  findSection,
  imageProblems,
  labelProblems,
  manualSections,
  registryProblems
} from '../../../scripts/manual/features.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const report = problems => `\n  ${problems.join('\n  ')}\n(node scripts/manual/features.mjs)`;

test('manual features: the UI code is scanned for settings, tabs, commands and shortcuts', () => {
  const kinds = new Set(discoverFeatures(root).map(f => f.kind));
  for (const k of ['settings-tab', 'settings-section', 'space-tab', 'command', 'shortcut'])
    assert.ok(kinds.has(k), `no ${k} found: the scanner no longer matches the code`);
  const ids = discoverFeatures(root).map(f => f.id);
  for (const id of [
    'settings-tab:ai',
    'settings-section:Abwesenheitsnotiz',
    'space-tab:chat',
    'command:compose',
    'shortcut:N'
  ])
    assert.ok(ids.includes(id), id);
});

test('manual features: every feature has a section in both languages that names it', () => {
  const problems = registryProblems(root);
  assert.deepEqual(problems, [], report(problems));
});

test('manual features: menu paths in the manual are real UI texts', () => {
  const problems = labelProblems(root);
  assert.deepEqual(problems, [], report(problems));
});

test('manual features: every screenshot exists in both languages', () => {
  const problems = imageProblems(root);
  assert.deepEqual(problems, [], report(problems));
});

test('manual features: every new CHANGELOG entry names its manual section', () => {
  const problems = changelogProblems(root);
  assert.deepEqual(problems, [], report(problems));
});

test('manual features: sections are found with their subsections', () => {
  const s = findSection(manualSections(root, 'en'), '02-email.md#Write and reply');
  assert.ok(s && s.text.includes('### Undo send'));
  assert.equal(findSection(manualSections(root, 'de'), '02-mail.md#Gibt es nicht'), null);
});
