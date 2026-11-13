import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyExternalUrl } from '../../desktop/links.mjs';
import { filterContacts } from '../src/contacts.mjs';
import { createLru } from '../src/memory-cache.mjs';
import { inlineCidImages, hasRemoteContent } from '../src/message-utils.mjs';

test('Only http(s) and mailto are handed to the operating system', () => {
  assert.equal(classifyExternalUrl('javascript:alert(1)'), null);
  assert.equal(classifyExternalUrl('file:///etc/passwd'), null);
  assert.equal(classifyExternalUrl('smb://server/share'), null);
  assert.equal(classifyExternalUrl('nonsense'), null);
  const web = classifyExternalUrl('https://bank.example@evil.example/login');
  assert.equal(web.host, 'evil.example', 'user info part does not fake a host');
  assert.ok(!web.url.includes('bank.example@'));
  assert.equal(web.trusted, false);
  assert.equal(classifyExternalUrl('https://levuvo.at/').trusted, true);
  assert.equal(classifyExternalUrl('http://levuvo.at/').trusted, false);
  assert.equal(classifyExternalUrl('mailto:anna@kunde.at').kind, 'mailto');
});

test('Contact suggestions: prefix before partial match, limited', () => {
  const list = [
    { email: 'max@partner.de', name: 'Max Huber', score: 9 },
    { email: 'anna@kunde.at', name: 'Anna Berger', score: 5 },
    { email: 'hannah@x.at', name: '', score: 1 }
  ];
  assert.deepEqual(
    filterContacts(list, 'an').map(c => c.email),
    ['anna@kunde.at', 'hannah@x.at']
  );
  assert.deepEqual(
    filterContacts(list, 'hub').map(c => c.email),
    ['max@partner.de']
  );
  assert.deepEqual(filterContacts(list, ''), []);
});

test('LRU evicts the oldest entries', () => {
  const lru = createLru(2);
  lru.set('a', 1);
  lru.set('b', 2);
  lru.get('a');
  lru.set('c', 3);
  assert.equal(lru.get('b'), undefined);
  assert.equal(lru.get('a'), 1);
  lru.deleteWhere(k => k === 'a');
  assert.equal(lru.size, 1);
});

test('Embedded images are shown inline, SVG never', () => {
  const atts = [
    { contentId: '<logo@x>', mimeType: 'image/png', content: new Uint8Array([1, 2, 3]) },
    { contentId: '<vec@x>', mimeType: 'image/svg+xml', content: new Uint8Array([60]) }
  ];
  const { html, inlined } = inlineCidImages('<img src="cid:logo@x"><img src=\'cid:vec@x\'>', atts);
  assert.match(html, /src="data:image\/png;base64,AQID"/);
  assert.match(html, /cid:vec@x/);
  assert.deepEqual([...inlined], [0]);
  assert.equal(hasRemoteContent('<div style="background:url(https://t.example/p.gif)">'), true);
  assert.equal(hasRemoteContent('<img src="data:image/png;base64,AA">'), false);
});
