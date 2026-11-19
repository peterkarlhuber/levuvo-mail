// Writes THIRD-PARTY-NOTICES.txt: name, version, license, license text and NOTICE file of every
// package that ships inside the app (production dependencies incl. transitive ones, plus the
// libraries bundled into the user interface). The AI runtime and Ollama ship their own notices
// (resources/ai-runtime/THIRD-PARTY-PYTHON.txt, resources/ollama/LICENSE-ollama.txt).
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { legalFiles, shippedNpmPackages } from './lib/shipped-packages.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packages = shippedNpmPackages(root);

const out = [
  'Levuvo Mail – Third-party software notices',
  '',
  'Levuvo Mail includes the following open-source components. Each is used under the license shown.',
  ''
];
const summary = {};
for (const { name, version, license, dir, homepage } of packages) {
  summary[license] = (summary[license] || 0) + 1;
  const { license: file, notice } = legalFiles(dir);
  out.push('='.repeat(78), `${name} ${version} — ${license}`, homepage, '');
  if (file) out.push(readFileSync(join(dir, file), 'utf8').trim(), '');
  if (notice) out.push('--- NOTICE ---', readFileSync(join(dir, notice), 'utf8').trim(), '');
}
writeFileSync(join(root, 'THIRD-PARTY-NOTICES.txt'), `${out.join('\n')}\n`);
console.log(
  `THIRD-PARTY-NOTICES.txt: ${packages.length} packages · ${Object.entries(summary)
    .map(([l, n]) => `${l} ${n}`)
    .join(', ')}`
);
