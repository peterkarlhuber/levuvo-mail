import test from 'node:test';
import assert from 'node:assert/strict';
import { htmlToText, stripTags, replaceUntilStable } from '../src/html-mail.mjs';
import { splitVcards } from '../src/vcard.mjs';
import { accountFingerprint } from '../src/inbox-watcher.mjs';

test('stripTags also fully removes nested tag constructs', () => {
  for (const input of ['<scr<b>ipt>alert(1)</scr</b>ipt>', '<<x>script>boom', '<<<a>b>c>d']) {
    const out = stripTags(input);
    assert.ok(!out.includes('<'), `${input} -> ${out}`);
    assert.ok(!/<\s*script/i.test(out));
  }
  assert.equal(stripTags('a <b>fett</b> b'), 'a fett b');
});
test('replaceUntilStable repeats until the result is stable (nested patterns)', () => {
  assert.equal(replaceUntilStable('<<b>b>text', /<b>/g, ''), 'text');
  assert.equal(replaceUntilStable('a<b>c', /<b>/g, ''), 'ac');
});
test('htmlToText: no tag remnants from nested patterns, links stay readable', () => {
  const text = htmlToText('<p>Hallo <scr<b>ipt>x</b></p><a href="https://example.org/">Link</a>');
  assert.ok(!/<script/i.test(text), text);
  assert.match(text, /Link/);
});
test('splitVcards: correct, no backtracking with many BEGIN without END', () => {
  const two = 'BEGIN:VCARD\nFN:A\nEND:VCARD\nbegin:vcard\nFN:B\nend:vcard\n';
  assert.equal(splitVcards(two).length, 2);
  assert.equal(splitVcards('BEGIN:VCARD\nFN:ohne Ende').length, 0);
  const evil = 'BEGIN:VCARD\n'.repeat(200_000);
  const t0 = Date.now();
  assert.equal(splitVcards(evil).length, 0);
  assert.ok(Date.now() - t0 < 1000, 'must run in linear time');
});
test('Account fingerprint: changes when password, host or user changes', () => {
  const acc = pw => ({ imap: { host: 'h', port: 993, user: 'u', password: pw } });
  assert.equal(accountFingerprint(acc('a')), accountFingerprint(acc('a')));
  assert.notEqual(accountFingerprint(acc('a')), accountFingerprint(acc('b')));
  assert.notEqual(
    accountFingerprint(acc('a')),
    accountFingerprint({ imap: { host: 'x', port: 993, user: 'u', password: 'a' } })
  );
});

test('Preview: entities become text, tags are removed', async () => {
  const { decodePreview } = await import('../src/previews.mjs');
  const html = Buffer.from('<p>a &amp; b</p><b>fett</b> &lt;b&gt; 5 &lt; 6 <i>x</i>');
  const out = decodePreview(html, { type: 'text/html', encoding: '7bit', charset: 'utf-8' });
  assert.equal(out, 'a & b fett <b> 5 < 6 x');
});
