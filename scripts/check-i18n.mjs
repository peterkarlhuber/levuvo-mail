// Finds UI texts without English translation: t('…') literals in apps/web/src and
// literal (German) server messages that reach the UI. Usage: node scripts/check-i18n.mjs [list]
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const unquote = raw => Function(`return '${raw}'`)();

export function collectTexts(root) {
  const ui = new Set();
  const server = new Set();
  for (const f of readdirSync(join(root, 'apps/web/src'))) {
    if (!/\.tsx?$/.test(f) || f.startsWith('i18n')) continue;
    const s = readFileSync(join(root, 'apps/web/src', f), 'utf8');
    for (const m of s.matchAll(/\bt\(\s*'((?:[^'\\\n]|\\.)*)'/g)) ui.add(unquote(m[1]));
    for (const m of s.matchAll(/(?:parse<T>\(res, |new Error\()'((?:[^'\\\n]|\\.)*)'/g)) ui.add(unquote(m[1]));
    for (const m of s.matchAll(/hint: '((?:[^'\\\n]|\\.)*)'/g)) ui.add(unquote(m[1]));
  }
  for (const f of readdirSync(join(root, 'apps/server/src'))) {
    if (!f.endsWith('.mjs')) continue;
    const s = readFileSync(join(root, 'apps/server/src', f), 'utf8');
    for (const m of s.matchAll(/(?:fail|invalid|problem|err|failure|unavailable|httpError)\(\s*'((?:[^'\\\n]|\\.)*)'/g))
      server.add(unquote(m[1]));
    for (const m of s.matchAll(/error: '((?:[^'\\\n]|\\.)*)'/g)) server.add(unquote(m[1]));
    for (const m of s.matchAll(/new Error\('((?:[^'\\\n]|\\.)*)'\)/g)) server.add(unquote(m[1]));
  }
  return { ui, server };
}

export function loadDictionary(root) {
  const src = readFileSync(join(root, 'apps/web/src/i18n-en.ts'), 'utf8');
  return Function(`return (${src.slice(src.indexOf('{', src.indexOf('EN')), src.lastIndexOf('}') + 1)})`)();
}

export function missingTranslations(root) {
  const { ui, server } = collectTexts(root);
  const en = loadDictionary(root);
  return [...new Set([...ui, ...server])].filter(
    k => !(k in en) && /[a-zäöüß]/i.test(k) && !['timeout', 'closed'].includes(k)
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const missing = missingTranslations(root);
  console.log(`${missing.length} texts without English translation`);
  for (const k of missing) console.log(JSON.stringify(k));
  process.exitCode = missing.length ? 1 : 0;
}
