import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeOutgoingHtml, htmlToText } from '../src/html-mail.mjs';
import { readBody } from '../src/message-body.mjs';
import { validateSendPayload } from '../src/send-utils.mjs';
import {
  analyzeMessage,
  findDeceptiveLinks,
  parseAuthenticationResults,
  baseDomain
} from '../src/security-analysis.mjs';
import { stripHeaders, validateSendAt, sendDue } from '../src/scheduled.mjs';
import { newFolderPath, manageFolder, validFolderName } from '../src/folders.mjs';
import { validateSieveConfig, buildSieveScript, parseLevuvoScript } from '../src/sieve.mjs';
import { createOAuthManager, emailFromIdToken, oauthConfigFrom } from '../src/oauth.mjs';

test('Ausgehendes HTML: nur sichere Elemente, Bilder als data/cid, kein Skript', () => {
  const html = sanitizeOutgoingHtml(
    '<p style="color:red;position:fixed" onclick="x()">Hi <b>du</b><script>alert(1)</script><a href="javascript:alert(1)">x</a><a href="https://levuvo.at">L</a><img src="data:image/png;base64,AAAA"><img src="data:image/svg+xml;base64,AAAA"><iframe src="https://x"></iframe></p>'
  );
  assert.doesNotMatch(html, /script|onclick|javascript|iframe|position|svg\+xml/);
  assert.match(html, /style="color:red"/);
  assert.match(html, /<a href="https:\/\/levuvo.at" rel="noopener">L<\/a>/);
  assert.match(html, /data:image\/png/);
});

test('Textversion aus HTML: Absätze, Listen, Zitate und Links', () => {
  const text = htmlToText(
    '<p>Hallo <b>Max</b>,</p><ul><li>eins</li><li>zwei</li></ul><blockquote><p>Zitat</p></blockquote><p><a href="https://levuvo.at">Webseite</a> &amp; mehr</p>'
  );
  assert.match(text, /Hallo Max,/);
  assert.match(text, /- eins\n- zwei/);
  assert.match(text, /> Zitat/);
  assert.match(text, /Webseite <https:\/\/levuvo.at> & mehr/);
});

test('Nachrichtentext: HTML-Modus, Textmodus, leere Nachricht', () => {
  assert.equal(readBody({ html: '<p>Hi</p>' }).text, 'Hi');
  assert.match(readBody({ html: '<p>Hi</p>' }).html, /<!doctype html>/);
  assert.equal(readBody({ text: 'Nur Text' }).html, null);
  assert.throws(() => readBody({ html: '<p> </p>' }), /fehlt/);
  assert.doesNotThrow(() => readBody({ html: '<img src="data:image/png;base64,AAAA">' }));
  assert.equal(readBody({ text: '' }, { allowEmpty: true }).text, '');
});

test('Versanddaten: Absender-Alias und Verschlüsselungswahl werden geprüft', () => {
  const base = {
    requestId: '11111111-1111-4111-8111-111111111111',
    confirm: 'SEND',
    to: ['a@b.at'],
    cc: [],
    bcc: [],
    subject: 'x',
    html: '<p>x</p>',
    attachments: []
  };
  const v = validateSendPayload({ ...base, from: 'Office@Levuvo.at', security: { method: 'pgp', sign: true } });
  assert.equal(v.from, 'office@levuvo.at');
  assert.deepEqual(v.security, { method: 'pgp', sign: true, encrypt: false });
  assert.throws(() => validateSendPayload({ ...base, security: { sign: true } }), /PGP oder S\/MIME/);
  assert.deepEqual(validateSendPayload(base).security, { method: null, sign: false, encrypt: false });
});

test('Phishing-Erkennung', () => {
  assert.deepEqual(
    parseAuthenticationResults('mx.example; spf=pass smtp.mailfrom=x; dkim=fail; dmarc=fail header.from=paypal.com'),
    { spf: 'pass', dkim: 'fail', dmarc: 'fail' }
  );
  assert.equal(baseDomain('mail.kunde.co.at'), 'kunde.co.at');
  const fake = analyzeMessage(
    {
      from: { name: 'PayPal service@paypal.com', address: 'x@evil.example' },
      replyTo: [{ address: 'collect@other.example' }],
      headers: [{ key: 'authentication-results', value: 'mx; dmarc=fail' }],
      html: '<a href="https://evil.example/login">https://www.paypal.com/signin</a>',
      attachments: [{ filename: 'Rechnung.pdf.exe' }, { filename: 'Tabelle.xlsm' }]
    },
    { knownSender: false }
  );
  assert.equal(fake.level, 'danger');
  const codes = fake.checks.map(c => c.code);
  for (const c of [
    'dmarc_fail',
    'display_name_spoof',
    'reply_to_differs',
    'deceptive_link',
    'dangerous_attachment',
    'macro_attachment',
    'first_contact'
  ])
    assert.ok(codes.includes(c), c);
  const ok = analyzeMessage({
    from: { address: 'news@levuvo.at' },
    headers: [{ key: 'authentication-results', value: 'mx; spf=pass; dkim=pass; dmarc=pass' }],
    html: '<a href="https://levuvo.at/x">levuvo.at</a>'
  });
  assert.equal(ok.level, 'ok');
  assert.deepEqual(findDeceptiveLinks('<a href="https://1.2.3.4/x">Bank</a>'), [{ shown: 'Bank', actual: '1.2.3.4' }]);
});

test('Später senden: Zeitpunkt, Kopfzeilen entfernen, genau einmal senden', async () => {
  assert.throws(() => validateSendAt(new Date(Date.now() - 1000).toISOString()), /Zukunft/);
  assert.throws(() => validateSendAt('kein Datum'), /Ungültig/);
  const raw = Buffer.from(
    'From: a@b.at\r\nBcc: geheim@x.at,\r\n  zweiter@x.at\r\nX-Levuvo-Send-At: 2026-01-01T00:00:00Z\r\nSubject: Hi\r\n\r\nText\r\n'
  );
  const stripped = stripHeaders(raw, ['bcc', 'x-levuvo-*']).toString();
  assert.doesNotMatch(stripped, /geheim|zweiter|X-Levuvo/i);
  assert.match(stripped, /Subject: Hi\r\n\r\nText/);

  const flags = new Map([
    [5, new Set(['\\Draft', '$LevuvoScheduled'])],
    [6, new Set(['\\Draft', '$LevuvoScheduled'])]
  ]);
  const source = (uid, at) =>
    Buffer.from(
      `From: a@b.at\r\nTo: x@y.at\r\nBcc: z@y.at\r\nX-Levuvo-Send-At: ${at}\r\nSubject: S${uid}\r\n\r\nHallo\r\n`
    );
  const sources = { 5: source(5, '2020-01-01T00:00:00Z'), 6: source(6, '2099-01-01T00:00:00Z') };
  const moved = [];
  const client = {
    capabilities: new Set(['MOVE']),
    list: async () => [
      { path: 'INBOX.Drafts', specialUse: '\\Drafts', flags: new Set() },
      { path: 'INBOX.Trash', specialUse: '\\Trash', flags: new Set() }
    ],
    getMailboxLock: async () => ({ release() {} }),
    search: async () => [5, 6],
    async *fetch(uids) {
      for (const uid of uids)
        yield {
          uid,
          envelope: { subject: `S${uid}`, to: [{ address: 'x@y.at' }] },
          flags: flags.get(uid),
          headers: Buffer.from(
            sources[uid]
              .toString()
              .split('\r\n')
              .find(l => l.startsWith('X-Levuvo'))
          )
        };
    },
    fetchOne: async uid => ({ uid: Number(uid), flags: flags.get(Number(uid)), source: sources[uid] }),
    messageFlagsAdd: async (uid, f) => {
      f.forEach(x => flags.get(Number(uid)).add(x));
      return true;
    },
    messageMove: async (uid, path) => {
      moved.push([uid, path]);
      return true;
    }
  };
  const submitted = [];
  const result = await sendDue(client, {
    submit: async (rcpt, data) => submitted.push([rcpt, data.toString()]),
    saveSent: async () => {}
  });
  assert.equal(submitted.length, 1);
  assert.deepEqual(submitted[0][0], ['x@y.at', 'z@y.at']);
  assert.doesNotMatch(submitted[0][1], /Bcc|X-Levuvo/i);
  assert.deepEqual(moved, [['5', 'INBOX.Trash']]);
  assert.equal(result.next, '2099-01-01T00:00:00.000Z');
  // A message already claimed by another instance is never sent again.
  flags.get(6).add('$LevuvoSending');
  sources[6] = source(6, '2020-01-01T00:00:00Z');
  const again = await sendDue(client, { submit: async () => submitted.push('dup'), saveSent: async () => {} });
  assert.equal(submitted.length, 1);
  assert.equal(again.results.length, 0);
});

test('Ordner: Namen, Pfade unter INBOX, Schutz der Systemordner, nur leere löschen', async () => {
  const folders = [
    { path: 'INBOX', delimiter: '.', flags: new Set() },
    { path: 'INBOX.Sent', specialUse: '\\Sent', delimiter: '.', flags: new Set() },
    { path: 'INBOX.Projekte', delimiter: '.', flags: new Set() }
  ];
  assert.equal(newFolderPath(folders, 'Kunden'), 'INBOX.Kunden');
  assert.equal(newFolderPath(folders, 'Levuvo', 'INBOX.Projekte'), 'INBOX.Projekte.Levuvo');
  assert.throws(() => newFolderPath(folders, 'projekte'), /existiert/);
  assert.equal(validFolderName('a/b'), false);
  assert.equal(validFolderName('Rechnungen 2026'), true);
  const calls = [];
  const client = {
    list: async () => folders,
    status: async () => ({ messages: 3 }),
    mailboxDelete: async p => calls.push(p),
    mailboxRename: async () => true
  };
  await assert.rejects(manageFolder(client, { op: 'delete', path: 'INBOX.Sent' }), { code: 'folder_protected' });
  await assert.rejects(manageFolder(client, { op: 'delete', path: 'INBOX.Projekte' }), { code: 'folder_not_empty' });
  assert.deepEqual(calls, []);
  assert.deepEqual(await manageFolder(client, { op: 'rename', path: 'INBOX.Projekte', name: 'Archiv alt' }), {
    ok: true,
    op: 'rename',
    path: 'INBOX.Archiv alt'
  });
});

test('Filterregeln: Prüfung, Skript mit eingebettetem Modell', () => {
  const config = validateSieveConfig(
    {
      rules: [
        {
          name: 'Rechnungen',
          conditions: [{ field: 'subject', op: 'contains', value: 'Rechnung "2026"' }],
          actions: [{ type: 'markRead' }, { type: 'move', folder: 'INBOX.Rechnungen' }]
        }
      ],
      vacation: {
        enabled: true,
        subject: 'Abwesend',
        body: 'Bis 6.1.',
        days: 3,
        start: '2026-12-20',
        end: '2027-01-06'
      }
    },
    { folderExists: p => p === 'INBOX.Rechnungen' }
  );
  const script = buildSieveScript(config, { trashFolder: 'INBOX.Trash' });
  assert.match(script, /require \["fileinto", "imap4flags", "vacation", "date", "relational"\];/);
  assert.match(script, /header :contains "subject" "Rechnung \\"2026\\""/);
  assert.ok(script.indexOf('addflag') < script.indexOf('fileinto "'), 'Markierung vor dem Verschieben');
  assert.match(script, /currentdate :value "ge" "date" "2026-12-20"/);
  assert.deepEqual(parseLevuvoScript(script), config);
  assert.throws(
    () =>
      validateSieveConfig(
        {
          rules: [
            {
              conditions: [{ field: 'subject', op: 'contains', value: 'x' }],
              actions: [{ type: 'move', folder: 'Fehlt' }]
            }
          ]
        },
        { folderExists: () => false }
      ),
    /Zielordner/
  );
  assert.throws(() => validateSieveConfig({ rules: [], vacation: { enabled: true, body: '' } }), /Text/);
});

test('OAuth: PKCE-Start, einmalige Rückmeldung, Token-Erneuerung mit Rotation', async () => {
  const requests = [];
  const fetchImpl = async (url, init) => {
    const body = Object.fromEntries(new URLSearchParams(String(init.body)));
    requests.push(body);
    if (body.grant_type === 'authorization_code') {
      const idToken = `x.${Buffer.from(JSON.stringify({ email: 'Peter@Firma.onmicrosoft.com' })).toString('base64url')}.y`;
      return new Response(
        JSON.stringify({ access_token: 'at-1', refresh_token: 'rt-1', id_token: idToken, expires_in: 3600 }),
        { status: 200 }
      );
    }
    if (body.refresh_token === 'rt-1')
      return new Response(JSON.stringify({ access_token: 'at-2', refresh_token: 'rt-2', expires_in: 3600 }), {
        status: 200
      });
    return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
  };
  const oauth = createOAuthManager({ config: { microsoft: { clientId: 'cid' }, google: { clientId: '' } }, fetchImpl });
  assert.deepEqual(
    oauth.providers().map(p => p.id),
    ['microsoft']
  );
  assert.throws(() => oauth.start('google', 'http://127.0.0.1:1/oauth/callback'), { code: 'oauth_not_configured' });
  const { state, authUrl } = oauth.start('microsoft', 'http://127.0.0.1:1/oauth/callback');
  const url = new URL(authUrl);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('state'), state);
  const done = await oauth.complete(state, 'code-123');
  assert.equal(done.email, 'peter@firma.onmicrosoft.com');
  assert.ok(requests[0].code_verifier.length >= 43);
  await assert.rejects(oauth.complete(state, 'code-123'), { code: 'oauth_state_invalid' });
  let rotated = null;
  assert.equal(
    await oauth.accessToken('acc', 'microsoft', 'rt-1', t => {
      rotated = t;
    }),
    'at-2'
  );
  assert.equal(rotated, 'rt-2');
  assert.equal(await oauth.accessToken('acc', 'microsoft', 'rt-2'), 'at-2', 'gecacht');
  oauth.forget('acc');
  await assert.rejects(oauth.accessToken('acc', 'microsoft', 'rt-old'), { code: 'oauth_reauth_required' });
  assert.equal(emailFromIdToken('kaputt'), '');
  assert.equal(
    oauthConfigFrom({ levuvo: { oauth: { google: { clientId: 'g' } } } }, { LEVUVO_OAUTH_MICROSOFT_CLIENT_ID: 'm' })
      .microsoft.clientId,
    'm'
  );
});

test('Anhänge erhalten den passenden Inhaltstyp (Vorschau beim Empfänger)', async () => {
  const { attachmentType } = await import('../src/send-utils.mjs');
  assert.equal(attachmentType('Rechnung.PDF'), 'application/pdf');
  assert.equal(attachmentType('foto.jpeg'), 'image/jpeg');
  assert.equal(
    attachmentType('angebot.docx'),
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );
  assert.equal(attachmentType('setup.exe'), 'application/octet-stream');
  assert.equal(attachmentType('ohne-endung'), 'application/octet-stream');
});
