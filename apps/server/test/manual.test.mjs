// The user manual (docs/manual): German and English stay in step, every screenshot exists, and
// the Markdown converts to Typst without errors (scripts/manual/markdown-to-typst.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toTypst, inline, esc } from '../../../scripts/manual/markdown-to-typst.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const dir = lang => join(root, 'docs/manual', lang);
const chapters = lang =>
  readdirSync(dir(lang))
    .filter(f => f.endsWith('.md'))
    .sort()
    .map(f => readFileSync(join(dir(lang), f), 'utf8'));
const shape = md => ({
  h1: (md.match(/^# /gm) || []).length,
  h2: (md.match(/^## /gm) || []).length,
  images: [...md.matchAll(/!\[[^\]]+\]\(([^)]+)\)/g)].map(m => m[1]),
  blocks: [...md.matchAll(/^(\{\{\w+\}\}|:::\w+)$/gm)].map(m => m[1])
});

test('manual: German and English have the same chapters, sections and screenshots', () => {
  const de = chapters('de');
  const en = chapters('en');
  assert.equal(de.length, en.length);
  de.forEach((md, i) => assert.deepEqual(shape(en[i]), shape(md), `chapter ${i}`));
});

test('manual: every screenshot exists in both languages', () => {
  for (const lang of ['de', 'en'])
    for (const md of chapters(lang))
      for (const file of shape(md).images)
        assert.ok(existsSync(join(root, 'docs/manual/img', lang, file)), `${lang}/${file}`);
});

test('manual: the product is always called "Levuvo Mail"', () => {
  for (const lang of ['de', 'en'])
    for (const md of chapters(lang)) {
      const bare = md.match(/Levuvo(?![ -]Mail| Spaces)[^\n]{0,20}/g);
      assert.equal(bare, null, `${lang}: ${bare}`);
    }
});

test('manual: Markdown converts to Typst', () => {
  for (const lang of ['de', 'en'])
    for (const md of chapters(lang)) {
      const out = toTypst(md, { image: f => `/img/${f}`, blocks: { models: '#table()' } });
      assert.ok(out.length > 100);
      assert.doesNotMatch(out, /\{\{|^:::/m);
    }
});

test('manual converter: escaping, keys, links, lists and callouts', () => {
  assert.equal(esc('a*b_c #1 [x] // -- @me'), 'a\\*b\\_c \\#1 \\[x\\] \\/\\/ \\-\\- \\@me');
  assert.equal(inline('Press `Ctrl` + `K`'), 'Press #key[Ctrl] \\+ #key[K]');
  assert.equal(inline('File `Setup-x64.exe`'), 'File #mono[Setup\\-x64.exe]');
  assert.equal(inline('**Bold** and *it*'), '#strong[Bold] and #emph[it]');
  assert.equal(inline('[Site](https://example.org)'), '#link("https://example.org")[Site]');
  assert.throws(() => inline('**open'), /Unclosed/);
  const typ = toTypst('# Chapter\n\n1. One\n   - Sub\n2. Two\n\n> **Tip:** Hello', { image: f => f });
  assert.match(typ, /^= Chapter/m);
  assert.match(typ, /^\+ One\n {2}- Sub\n\+ Two/m);
  assert.match(typ, /#callout\("tip", \[Tip:\], \[Hello\]\)/);
  assert.match(toTypst('> **Wichtig:** x', { image: f => f }), /#callout\("warn"/);
  assert.match(toTypst('# Welcome', { image: f => f }), /numbering: none/);
  assert.throws(() => toTypst('```js', { image: f => f }), /Unsupported/);
  assert.throws(() => toTypst('| a | b |\n| c | d |', { image: f => f }), /separator/);
});
