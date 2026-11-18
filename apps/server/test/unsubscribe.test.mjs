import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseUnsubscribe,
  publicUnsubscribe,
  oneClickUnsubscribe,
  parseMailto,
  privateAddress
} from '../src/unsubscribe.mjs';

const h = (list, post) => [
  { key: 'list-unsubscribe', value: list },
  ...(post ? [{ key: 'list-unsubscribe-post', value: post }] : [])
];

test('Unsubscribe: List-Unsubscribe is parsed safely (https, mailto, one-click)', () => {
  const both = parseUnsubscribe(
    h('<mailto:leave@news.test?subject=stop>, <https://news.test/u/123>', 'List-Unsubscribe=One-Click')
  );
  assert.deepEqual(both, {
    http: 'https://news.test/u/123',
    mailto: { to: 'leave@news.test', subject: 'stop', body: 'unsubscribe' },
    oneClick: true
  });
  assert.deepEqual(publicUnsubscribe(both), {
    method: 'one-click',
    host: 'news.test',
    mailto: 'leave@news.test',
    url: null
  });
  // http (not https) and javascript links are ignored; without POST header no one-click.
  assert.equal(parseUnsubscribe(h('<http://news.test/u>, <javascript:alert(1)>')), null);
  const web = parseUnsubscribe(h('<https://news.test/manage>'));
  assert.equal(web.oneClick, false);
  assert.deepEqual(publicUnsubscribe(web), {
    method: 'web',
    host: 'news.test',
    mailto: null,
    url: 'https://news.test/manage'
  });
  assert.equal(publicUnsubscribe(parseUnsubscribe(h('<mailto:a@b.test>'))).method, 'mail');
  assert.equal(parseUnsubscribe([]), null);
  assert.equal(parseMailto('mailto:a@b.test,c@d.test'), null, 'only one recipient');
  assert.equal(parseMailto('mailto:x@y.test?subject=a%0D%0ABcc:%20z@z.test').subject.includes('\n'), false);
});

test('Unsubscribe: one-click POST without cookies, no internal addresses, clear errors', async () => {
  const seen = [];
  const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), init });
    return new Response('', { status: 200 });
  };
  assert.deepEqual(await oneClickUnsubscribe('https://news.test/u/1', { fetchImpl, lookup }), { ok: true });
  assert.equal(seen[0].init.method, 'POST');
  assert.equal(seen[0].init.body, 'List-Unsubscribe=One-Click');
  assert.equal(seen[0].init.redirect, 'manual');
  assert.equal(seen[0].init.headers.Cookie, undefined);
  for (const bad of [
    'https://127.0.0.1/u',
    'https://localhost/u',
    'https://192.168.1.1/u',
    'https://[::1]/u',
    'https://10.0.0.8/u',
    'https://[::ffff:127.0.0.1]/u',
    'https://[::ffff:7f00:1]/u',
    'https://[fe80::1]/u',
    'https://224.0.0.1/u',
    'https://user:pw@news.test/u',
    'http://news.test/u'
  ])
    await assert.rejects(oneClickUnsubscribe(bad, { fetchImpl, lookup }), { code: 'unsubscribe_blocked' }, bad);
  await assert.rejects(
    oneClickUnsubscribe('https://news.test/u', { lookup, fetchImpl: async () => new Response('', { status: 410 }) }),
    { code: 'unsubscribe_rejected' }
  );
  await assert.rejects(
    oneClickUnsubscribe('https://news.test/u', {
      lookup,
      fetchImpl: async () => {
        throw new Error('down');
      }
    }),
    { code: 'unsubscribe_unreachable' }
  );
});

test('Unsubscribe: a public host name that resolves to an internal address is refused (AUD-013)', async () => {
  let posted = 0;
  const fetchImpl = async () => {
    posted++;
    return new Response('', { status: 200 });
  };
  for (const internal of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '::1', 'fd00::5', '::ffff:192.168.0.1'])
    await assert.rejects(
      oneClickUnsubscribe('https://rebind.test/u', {
        fetchImpl,
        lookup: async () => [
          { address: '93.184.216.34', family: 4 },
          { address: internal, family: internal.includes(':') ? 6 : 4 }
        ]
      }),
      { code: 'unsubscribe_blocked' },
      internal
    );
  assert.equal(posted, 0, 'no request was sent');
  await assert.rejects(
    oneClickUnsubscribe('https://missing.test/u', {
      fetchImpl,
      lookup: async () => {
        throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
      }
    }),
    { code: 'unsubscribe_unreachable' }
  );
  for (const ok of ['93.184.216.34', '2a01:4f8::1']) assert.equal(privateAddress(ok), false, ok);
});
