import test from 'node:test';
import assert from 'node:assert/strict';
import { textToHtml, textForPlainPart } from '../src/compose-format.mjs';

test('Formatting is translated into safe HTML', () => {
  const html = textToHtml(
    'Hallo **Max**,\n\n- eins\n- _zwei_\n\n1. erstens\n\nSiehe https://levuvo.at/a?b=1&c=2 und [Doku](https://levuvo.at/doku).\n\n> Zitat'
  );
  assert.match(html, /<strong>Max<\/strong>/);
  assert.match(html, /<ul[^>]*><li>eins<\/li><li><em>zwei<\/em><\/li><\/ul>/);
  assert.match(html, /<ol[^>]*><li>erstens<\/li><\/ol>/);
  assert.match(html, /<a href="https:\/\/levuvo.at\/a\?b=1&amp;c=2">/);
  assert.match(html, /<a href="https:\/\/levuvo.at\/doku">Doku<\/a>/);
  assert.match(html, /<blockquote[^>]*><p[^>]*>Zitat<\/p><\/blockquote>/);
});

test('Inputs cannot inject HTML or script', () => {
  const html = textToHtml('<script>alert(1)</script> <img src=x onerror=alert(1)> [x](javascript:alert(1)) "quote"');
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('href="javascript'));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&quot;quote&quot;/);
});

test('Text version removes only formatting characters', () => {
  assert.equal(textForPlainPart('**fett** und [Link](https://a.at)'), 'fett und Link <https://a.at>');
});
