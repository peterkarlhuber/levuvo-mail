import test from 'node:test';
import assert from 'node:assert/strict';
import { htmlToText, stripTags, replaceUntilStable } from '../src/html-mail.mjs';
import { splitVcards } from '../src/vcard.mjs';
import { accountFingerprint } from '../src/inbox-watcher.mjs';

test('stripTags entfernt auch verschachtelte Tag-Konstrukte vollständig', () => {
  for (const input of ['<scr<b>ipt>alert(1)</scr</b>ipt>', '<<x>script>boom', '<<<a>b>c>d']) {
    const out = stripTags(input);
    assert.ok(!out.includes('<'), `${input} -> ${out}`);
    assert.ok(!/<\s*script/i.test(out));
  }
  assert.equal(stripTags('a <b>fett</b> b'), 'a fett b');
});
test('replaceUntilStable wiederholt bis zum stabilen Ergebnis (verschachtelte Muster)', () => {
  assert.equal(replaceUntilStable('<<b>b>text', /<b>/g, ''), 'text');
  assert.equal(replaceUntilStable('a<b>c', /<b>/g, ''), 'ac');
});
test(out), out);
});
test('htmlToText: kein Tag-Rest aus verschachtelten Mustern, Links bleiben lesbar', () => {
  const text = htmlToText('<p>Hallo <scr<b>ipt>x</b></p><a href="https://example.org/">Link</a>');
  assert.ok(!/<script/i.test(text), text);
  assert.match(text, /Link/);
});
test('splitVcards: korrekt, ohne Backtracking bei vielen BEGIN ohne END', () => {
  const two = 'BEGIN:VCARD\nFN:A\nEND:VCARD\nbegin:vcard\nFN:B\nend:vcard\n';
  assert.equal(splitVcards(two).length, 2);
  assert.equal(splitVcards('BEGIN:VCARD\nFN:ohne Ende').length, 0);
  const evil = 'BEGIN:VCARD\n'.repeat(200_000);
  const t0 = Date.now();
  assert.equal(splitVcards(evil).length, 0);
  assert.ok(Date.now() - t0 < 1000, 'muss linear laufen');
});
test('Account-Fingerprint: ändert sich bei Passwort-, Host- oder Benutzeränderung', () => {
  const acc = pw => ({ imap: { host: 'h', port: 993, user: 'u', password: pw } });
  assert.equal(accountFingerprint(acc('a')), accountFingerprint(acc('a')));
  assert.notEqual(accountFingerprint(acc('a')), accountFingerprint(acc('b')));
  assert.notEqual(
    accountFingerprint(acc('a')),
    accountFingerprint({ imap: { host: 'x', port: 993, user: 'u', password: 'a' } })
  );
});
