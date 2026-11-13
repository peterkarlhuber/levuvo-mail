// Writes THIRD-PARTY-NOTICES.txt: name, version, license and license text of every
// package that ships inside the app (production dependencies incl. transitive ones,
// plus the libraries bundled into the user interface).
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const tree = JSON.parse(
  execFileSync(npm, ['ls', '--all', '--omit=dev', '--json'], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    maxBuffer: 64 * 1024 * 1024
  })
);
// Bundled into apps/web/dist although declared as devDependencies (build-time only for npm).
const BUNDLED = [
  'react',
  'react-dom',
  'scheduler',
  'dompurify',
  'lucide-react',
  '@tiptap/react',
  '@tiptap/starter-kit',
  '@tiptap/pm',
  '@tiptap/extension-image',
  '@tiptap/core'
];

const found = new Map();
function walk(deps) {
  for (const [name, info] of Object.entries(deps || {})) {
    if (!info?.version || found.has(`${name}@${info.version}`)) continue;
    found.set(`${name}@${info.version}`, { name, version: info.version });
    walk(info.dependencies);
  }
}
walk(tree.dependencies);
// Bundled UI libraries and everything they pull in (resolved from node_modules).
const addBundled = name => {
  const pkgFile = join(root, 'node_modules', name, 'package.json');
  if (!existsSync(pkgFile)) return;
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
  const key = `${name}@${pkg.version}`;
  if (found.has(key)) return;
  found.set(key, { name, version: pkg.version });
  for (const dep of Object.keys(pkg.dependencies || {})) addBundled(dep);
};
for (const name of BUNDLED) addBundled(name);

const out = [
  'Levuvo Mail – Third-party software notices',
  '',
  'Levuvo Mail includes the following open-source components. Each is used under the license shown.',
  ''
];
const summary = {};
for (const { name, version } of [...found.values()].sort((a, b) => a.name.localeCompare(b.name))) {
  const dir = join(root, 'node_modules', name);
  if (!existsSync(dir)) continue;
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const license =
    typeof pkg.license === 'string'
      ? pkg.license
      : pkg.license?.type || (pkg.licenses || []).map(l => l.type).join(' OR ') || 'see package';
  summary[license] = (summary[license] || 0) + 1;
  const file = readdirSync(dir).find(f => /^(licen[cs]e|copying)(\.|$)/i.test(f));
  out.push(
    '='.repeat(78),
    `${name} ${version} — ${license}`,
    pkg.homepage || (typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url) || '',
    ''
  );
  if (file) out.push(readFileSync(join(dir, file), 'utf8').trim(), '');
}
writeFileSync(join(root, 'THIRD-PARTY-NOTICES.txt'), `${out.join('\n')}\n`);
console.log(
  `THIRD-PARTY-NOTICES.txt: ${found.size} packages · ${Object.entries(summary)
    .map(([l, n]) => `${l} ${n}`)
    .join(', ')}`
);
