// Guards the design-token foundation: outside the token blocks (:root / [data-theme]) the
// stylesheets may not use raw font sizes, font weights, z-index numbers, radii or colours.
// Usage: node scripts/check-design-tokens.mjs   (exit 1 and a list on violations)
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RULES = [
  { prop: /^font-size$/, ok: v => /^(var\(--|inherit|[\d.]+em$|[\d.]+%$|smaller|larger)/.test(v), hint: '--text-*' },
  { prop: /^font-weight$/, ok: v => /^(var\(--|inherit|normal|bold)/.test(v), hint: '--weight-*' },
  { prop: /^z-index$/, ok: v => /^(var\(--|auto|0$|-1$)/.test(v), hint: '--z-*' },
  {
    prop: /^border(-[a-z]+)*-radius$/,
    ok: v => v.split(/\s+/).every(x => /^(var\(--|0$|50%$|inherit|calc\()/.test(x) || /^var\(/.test(x)),
    hint: '--radius-*'
  },
  {
    prop: /^(color|background(-color)?|border(-[a-z]+)?(-color)?|outline(-color)?|fill|stroke|box-shadow|text-decoration-color|caret-color)$/,
    ok: v => !/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(v.replace(/var\([^)]*\)/g, '')),
    hint: 'a colour token'
  },
  {
    prop: /^(padding|margin|gap|row-gap|column-gap)(-[a-z-]+)?$/,
    ok: v => v.split(/\s+/).every(x => !/^-?\d+(\.\d+)?px$/.test(x) || /^-?[01]px$/.test(x)),
    hint: '--space-*'
  }
];

const TOKEN_SELECTOR = /^(:root|\[data-theme=[^\]]+\]|:root:not\([^)]*\)|html)(\s*,\s*(:root|\[data-theme=[^\]]+\]))*$/;

export function cssFiles(root) {
  const dir = join(root, 'apps/web/src');
  return readdirSync(dir, { recursive: true })
    .filter(f => f.endsWith('.css'))
    .map(f => join(dir, f));
}

/** Returns [{file, line, prop, value, hint}] for every raw value outside the token blocks. */
export function findViolations(root) {
  const out = [];
  for (const file of cssFiles(root)) {
    const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
    const stack = [];
    let buf = '';
    let line = 1;
    for (const ch of css) {
      if (ch === '\n') line++;
      if (ch === '{') {
        stack.push(buf.trim());
        buf = '';
      } else if (ch === '}') {
        check(buf, line);
        stack.pop();
        buf = '';
      } else if (ch === ';') {
        check(buf, line);
        buf = '';
      } else buf += ch;
    }
    function check(decl, at) {
      const i = decl.indexOf(':');
      if (i < 0) return;
      const prop = decl.slice(0, i).trim();
      const value = decl
        .slice(i + 1)
        .replace(/!important/, '')
        .trim();
      if (!prop || prop.startsWith('--') || prop.startsWith('@')) return;
      const selector = stack[stack.length - 1] || '';
      if (TOKEN_SELECTOR.test(selector)) return;
      if (stack.some(s => /^@media print/.test(s))) return;
      for (const r of RULES) {
        if (r.prop.test(prop) && !r.ok(value)) {
          out.push({ file: file.slice(root.length + 1), line: at, prop, value, hint: r.hint });
        }
      }
    }
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const v = findViolations(root);
  for (const x of v) console.log(`${x.file}:${x.line}  ${x.prop}: ${x.value}  → use ${x.hint}`);
  if (v.length) {
    console.error(`\n${v.length} raw value(s) outside the design tokens.`);
    process.exit(1);
  }
  console.log('Design tokens: OK');
}
