// The npm packages that ship inside the installers: production dependencies (incl. transitive
// ones) plus the libraries bundled into the user interface, which npm sees as devDependencies.
// Shared by the licence notices, the licence policy check and the SBOM.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Bundled into apps/web/dist although declared as devDependencies (build-time only for npm).
export const BUNDLED = [
  'react',
  'react-dom',
  'scheduler',
  'dompurify',
  'lucide-react',
  '@tiptap/react',
  '@tiptap/starter-kit',
  '@tiptap/pm',
  '@tiptap/extension-image',
  '@tiptap/core',
  // Dictation (speech worker): the browser parts of transformers.js; its Node-only dependencies
  // (onnxruntime-node, sharp) are not bundled, so the package itself is listed without them.
  '@huggingface/jinja',
  '@huggingface/tokenizers',
  'onnxruntime-web'
];

/** Bundled packages whose own dependencies are not bundled (only the browser build is used). */
export const BUNDLED_WITHOUT_DEPS = ['@huggingface/transformers'];

/** SPDX-ish licence string of a package.json. */
export function licenseOf(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  return pkg.license?.type || (pkg.licenses || []).map(l => l.type).join(' OR ') || 'see package';
}

/**
 * @returns {{name: string, version: string, license: string, dir: string, homepage: string,
 *   integrity: string, bundled: boolean}[]} sorted by name
 */
export function shippedNpmPackages(root) {
  // package-lock.json knows the exact install path of every package, also of nested duplicates
  // (two versions of one package); npm marks build-time-only packages with "dev".
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')).packages || {};
  const selected = new Map();
  for (const [path, info] of Object.entries(lock)) {
    if (!path || info.dev || info.link || !existsSync(join(root, path, 'package.json'))) continue;
    selected.set(path, false);
  }
  // Bundled UI libraries and what they pull in, resolved like Node does (nested first).
  const resolveFrom = (fromPath, name) => {
    let base = fromPath;
    while (true) {
      const candidate = base ? `${base}/node_modules/${name}` : `node_modules/${name}`;
      if (lock[candidate]) return candidate;
      if (!base) return null;
      const i = base.lastIndexOf('/node_modules/');
      base = i >= 0 ? base.slice(0, i) : '';
    }
  };
  const addBundled = path => {
    if (!path || selected.has(path) || !existsSync(join(root, path, 'package.json'))) return;
    selected.set(path, true);
    for (const dep of Object.keys(lock[path].dependencies || {})) addBundled(resolveFrom(path, dep));
  };
  for (const name of BUNDLED) addBundled(`node_modules/${name}`);
  for (const name of BUNDLED_WITHOUT_DEPS)
    if (lock[`node_modules/${name}`] && existsSync(join(root, 'node_modules', name, 'package.json')))
      selected.set(`node_modules/${name}`, true);

  const seen = new Set();
  const out = [];
  for (const [path, bundled] of selected) {
    const dir = join(root, path);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const name = pkg.name || path.slice(path.lastIndexOf('node_modules/') + 13);
    const key = `${name}@${pkg.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const homepage = pkg.homepage || (typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url) || '';
    out.push({
      name,
      version: pkg.version,
      license: licenseOf(pkg),
      dir,
      homepage,
      integrity: lock[path].integrity || '',
      bundled
    });
  }
  return out.sort(
    (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version, 'en', { numeric: true })
  );
}

/** Licence and NOTICE files of a package folder (Apache-2.0 §4(d) requires reproducing NOTICE). */
export function legalFiles(dir) {
  const files = readdirSync(dir);
  return {
    license: files.find(f => /^(licen[cs]e|copying)(\.|$)/i.test(f)),
    notice: files.find(f => /^notice(\.|$)/i.test(f))
  };
}
