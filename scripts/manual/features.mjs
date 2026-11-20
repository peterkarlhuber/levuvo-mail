// The feature registry: every user-visible feature of Levuvo Mail points to the manual section that
// explains it, in German and English (docs/manual/features.json). This module finds the features in
// the UI code, reads the manual's sections and checks both against each other. Used by
// apps/web/test/manual-features.test.mjs (fails CI) and on the command line:
//   node scripts/manual/features.mjs            lists every problem (exit code 1 if there are any)
//   node scripts/manual/features.mjs --missing  prints registry entries to fill in for new features
//
// What counts as a feature (found automatically, so a new one cannot be forgotten):
//   - settings tabs and the tabs of a space (`const tabs` in Settings.tsx and Spaces.tsx)
//   - settings sections (`<Section title={t('…')}>` or `title="…"` in any component)
//   - commands in the command palette (CommandPalette.tsx, fixed `id: '…'` entries)
//   - keyboard shortcuts (the shortcut overview in Panels.tsx)
// Anything else a change adds (a new view, a button with its own workflow) is caught by the
// CHANGELOG rule: every bullet under "Unreleased" names its manual section, see changelogProblems().
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadDictionary } from '../check-i18n.mjs';

export const LANGS = ['de', 'en'];
const WEB = 'apps/web/src';
const unquote = raw => Function(`return '${raw}'`)();

/** All user-visible features found in the UI code: [{ id, kind, label (German UI text), file }]. */
export function discoverFeatures(root) {
  const read = f => readFileSync(join(root, WEB, f), 'utf8');
  const out = new Map();
  const add = (kind, key, label, file) => {
    const id = `${kind}:${key}`;
    if (!out.has(id)) out.set(id, { id, kind, label, file });
  };
  for (const [kind, file] of [
    ['settings-tab', 'Settings.tsx'],
    ['space-tab', 'Spaces.tsx']
  ]) {
    const src = read(file);
    const at = src.indexOf('const tabs:');
    for (const m of src
      .slice(at, src.indexOf('];', at))
      .matchAll(/\bid: '([\w-]+)',\s*label: t\('((?:[^'\\]|\\.)*)'\)/g))
      add(kind, m[1], unquote(m[2]), file);
  }
  for (const f of readdirSync(join(root, WEB), { recursive: true })) {
    if (!/\.tsx$/.test(f)) continue;
    for (const m of read(f).matchAll(/<Section\b[^>]*?\btitle=(?:\{t\('((?:[^'\\]|\\.)*)'\)\}|"([^"]+)")/g)) {
      const label = m[1] !== undefined ? unquote(m[1]) : m[2];
      add('settings-section', label, label, f);
    }
  }
  const palette = read('CommandPalette.tsx');
  for (const m of palette.matchAll(/\bid: '([\w:-]+)',(?:\s*group: \w+,)?\s*label: t\('((?:[^'\\]|\\.)*)'\)/g))
    add('command', m[1], unquote(m[2]), 'CommandPalette.tsx');
  const panels = read('Panels.tsx');
  const rows = panels.slice(panels.indexOf('function ShortcutsDialog'));
  for (const m of rows.matchAll(/\[\[([^\]]+)\], t\('((?:[^'\\]|\\.)*)'\)\]/g)) {
    const keys = [...m[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map(k => unquote(k[1])).join('+');
    add('shortcut', keys, unquote(m[2]), 'Panels.tsx');
  }
  return [...out.values()];
}

/** The manual of one language as sections: [{ file, heading, level, text }] (text without the heading). */
export function manualSections(root, lang) {
  const dir = join(root, 'docs/manual', lang);
  const out = [];
  for (const file of readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .sort()) {
    let current = null;
    for (const line of readFileSync(join(dir, file), 'utf8').split(/\r?\n/)) {
      const h = /^(#{1,3}) (.+)$/.exec(line);
      if (h) out.push((current = { file, heading: h[2].trim(), level: h[1].length, text: '' }));
      else if (current) current.text += line + '\n';
    }
  }
  return out;
}

/** "file.md#Heading" → the section plus its subsections (up to the next heading of the same level). */
export function findSection(sections, ref) {
  const [file, heading] = String(ref).split('#');
  const i = sections.findIndex(s => s.file === file && s.heading === heading);
  if (i < 0) return null;
  let text = sections[i].text;
  for (let j = i + 1; j < sections.length && sections[j].file === file && sections[j].level > sections[i].level; j++)
    text += `${'#'.repeat(sections[j].level)} ${sections[j].heading}\n${sections[j].text}`;
  return { ...sections[i], text: `${heading}\n${text}` };
}

export function loadRegistry(root) {
  return JSON.parse(readFileSync(join(root, 'docs/manual/features.json'), 'utf8'));
}

const normal = s =>
  String(s)
    .replace(/[*`_„“”"]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();

/** How the feature's label appears in the manual of a language (the English UI text for "en"). */
function labelIn(lang, feature, en) {
  if (lang === 'de') return feature.label;
  return en[feature.label] ?? feature.label;
}

/** The keys of a shortcut as the manual writes them: "Strg/⌘+K" → Strg, K ("Ctrl" in English). */
function shortcutKeys(id, lang, en) {
  return id
    .slice('shortcut:'.length)
    .split('+')
    .flatMap(k => (lang === 'en' ? (en[k] ?? k) : k).split(' · '))
    .map(k => (k.length > 1 ? k.split('/')[0] : k).trim());
}

/** Problems between the UI code, the registry and the manual. Empty when everything is covered. */
export function registryProblems(root) {
  const problems = [];
  const features = discoverFeatures(root);
  const { features: registry } = loadRegistry(root);
  const en = loadDictionary(root);
  const sections = Object.fromEntries(LANGS.map(l => [l, manualSections(root, l)]));
  const found = new Set(features.map(f => f.id));
  for (const f of features)
    if (!registry[f.id])
      problems.push(
        `${f.id} („${f.label}“, ${f.file}) has no entry in docs/manual/features.json: describe it in the manual (de + en) and add the sections`
      );
  for (const id of Object.keys(registry))
    if (!found.has(id)) problems.push(`${id} is in docs/manual/features.json but no longer in the app: remove it`);
  for (const f of features) {
    const entry = registry[f.id];
    if (!entry) continue;
    for (const lang of LANGS) {
      if (!entry[lang]) {
        problems.push(`${f.id}: no ${lang} section in docs/manual/features.json`);
        continue;
      }
      const section = findSection(sections[lang], entry[lang]);
      if (!section) {
        problems.push(`${f.id}: section "${entry[lang]}" does not exist in docs/manual/${lang}`);
        continue;
      }
      if (f.kind === 'shortcut') {
        // A shortcut is described in the manual's own words, but its keys must be there.
        for (const key of shortcutKeys(f.id, lang, en))
          if (!section.text.includes(`\`${key}\``))
            problems.push(`${f.id}: docs/manual/${lang}/${entry[lang]} does not show the key \`${key}\``);
      } else if (entry.mentions !== false) {
        // The section names the feature as the app shows it, so readers recognise it on screen.
        const label = labelIn(lang, f, en);
        if (!normal(section.text).includes(normal(label)))
          problems.push(`${f.id}: docs/manual/${lang}/${entry[lang]} does not mention „${label}“`);
      } else if (!entry.why) problems.push(`${f.id}: "mentions": false needs a "why"`);
      if (entry.image) {
        if (!existsSync(join(root, 'docs/manual/img', lang, entry.image)))
          problems.push(`${f.id}: screenshot docs/manual/img/${lang}/${entry.image} is missing`);
        else if (!section.text.includes(`](${entry.image})`))
          problems.push(`${f.id}: ${lang}/${entry[lang]} does not show its screenshot ${entry.image}`);
      }
    }
  }
  return problems;
}

/**
 * UI labels the manual quotes must exist in the app: every bold menu path that starts with the
 * settings ("**Einstellungen → KI & Agenten → …**", "**Settings → AI & agents → …**") is checked
 * against the German UI texts and their English translations.
 */
export function labelProblems(root) {
  const en = loadDictionary(root);
  const german = new Set(Object.keys(en));
  const english = new Set(Object.values(en));
  const problems = [];
  for (const lang of LANGS) {
    const known = lang === 'de' ? german : english;
    const start = lang === 'de' ? 'Einstellungen' : 'Settings';
    for (const s of manualSections(root, lang))
      for (const m of s.text.matchAll(/\*\*([^*]*→[^*]*)\*\*/g)) {
        const parts = m[1].split('→').map(p => p.trim());
        if (parts[0] !== start) continue;
        for (const p of parts)
          if (!known.has(p))
            problems.push(
              `${lang}/${s.file} „${m[1]}“: „${p}“ is not a ${lang === 'de' ? 'German' : 'English'} UI text`
            );
      }
  }
  return problems;
}

/** Every screenshot the manual shows exists in both languages, and every chapter's screenshots are in both. */
export function imageProblems(root) {
  const problems = [];
  const used = {};
  for (const lang of LANGS) {
    used[lang] = new Set();
    for (const s of manualSections(root, lang))
      for (const m of s.text.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
        used[lang].add(m[1]);
        if (!existsSync(join(root, 'docs/manual/img', lang, m[1])))
          problems.push(`${lang}/${s.file}: screenshot img/${lang}/${m[1]} is missing (npm run manual:screenshots)`);
      }
  }
  for (const f of used.de) if (!used.en.has(f)) problems.push(`en: screenshot ${f} is shown in German only`);
  for (const f of used.en) if (!used.de.has(f)) problems.push(`de: screenshot ${f} is shown in English only`);
  return problems;
}

// Changes that need no manual section: fixes, security, internal work.
const EXEMPT = /^(Fixes|Fixed|Security|Internal|Build|Dependencies|Documentation|Accessibility fixes|Performance)\b/i;

/**
 * Every bullet under "## Unreleased" in CHANGELOG.md (outside the exempt sections) ends with
 * "(Manual: <English section heading>)" (several separated by "; ", or "none" for a change nobody
 * sees in the app), and that section exists in the English manual (the German
 * manual has the same structure, enforced by apps/server/test/manual.test.mjs).
 */
export function changelogProblems(root) {
  const text = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  const start = text.indexOf('\n## Unreleased');
  if (start < 0) return [];
  const end = text.indexOf('\n## ', start + 5);
  const lines = text.slice(start, end < 0 ? undefined : end).split(/\r?\n/);
  const headings = new Set(manualSections(root, 'en').map(s => s.heading));
  const problems = [];
  let section = '';
  for (const line of lines) {
    const h = /^### (.+)$/.exec(line);
    if (h) section = h[1].trim();
    if (!line.startsWith('- ') || EXEMPT.test(section)) continue;
    const refs = [...line.matchAll(/\(Manual: ([^)]+)\)/g)].flatMap(m => m[1].split(/;\s*/));
    // "(Manual: none)" marks a change nobody sees in the app (documents, policies, build).
    if (refs.length === 1 && refs[0] === 'none') continue;
    if (!refs.length) {
      problems.push(
        `CHANGELOG "${section}": "${line.slice(2, 70)}…" names no manual section, add "(Manual: <heading>)"`
      );
      continue;
    }
    for (const r of refs)
      if (!headings.has(r.trim()))
        problems.push(`CHANGELOG "${section}": manual section "${r}" does not exist in docs/manual/en`);
  }
  return problems;
}

export function allProblems(root) {
  return [...registryProblems(root), ...labelProblems(root), ...imageProblems(root), ...changelogProblems(root)];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
  if (process.argv.includes('--missing')) {
    const { features: registry } = loadRegistry(root);
    const missing = Object.fromEntries(
      discoverFeatures(root)
        .filter(f => !registry[f.id])
        .map(f => [f.id, { de: '0X-file.md#Heading', en: '0X-file.md#Heading' }])
    );
    console.log(JSON.stringify(missing, null, 2));
  } else {
    const problems = allProblems(root);
    for (const p of problems) console.log(`✗ ${p}`);
    console.log(problems.length ? `${problems.length} problems` : '✓ Manual covers every feature');
    process.exitCode = problems.length ? 1 : 0;
  }
}
