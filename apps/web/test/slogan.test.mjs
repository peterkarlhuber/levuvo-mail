// "Less effort. More impact." is Levuvo's slogan: it stays in English in every UI language and
// in both editions of the manual, never translated.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const SLOGAN = 'Less effort. More impact.';
const read = p => readFileSync(join(root, p), 'utf8');

test('slogan: shown as the English original, never passed through t() or a dictionary', () => {
  for (const file of ['apps/web/src/App.tsx', 'apps/web/src/Settings.tsx', 'apps/web/src/mail/MailSidebar.tsx']) {
    const src = read(file);
    assert.ok(src.includes(`>${SLOGAN}<`), `${file} shows the slogan as plain text`);
    assert.ok(!src.includes(`t('${SLOGAN}')`), `${file} does not translate the slogan`);
  }
  for (const f of readdirSync(join(root, 'apps/web/src')).filter(f => /^i18n.*\.ts$/.test(f))) {
    const dict = read(`apps/web/src/${f}`);
    assert.ok(!dict.includes(SLOGAN), `${f} has no entry for the slogan`);
    assert.doesNotMatch(dict, /Weniger Aufwand|Mehr Wirkung/i, `${f} has no translated slogan`);
  }
  assert.ok(read('apps/desktop/main.mjs').includes(`'${SLOGAN}'`));
  assert.ok(read('docs/manual/template/levuvo.typ').includes(`"${SLOGAN}"`), 'manual cover and back cover');
});
