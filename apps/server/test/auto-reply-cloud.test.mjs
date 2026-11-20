import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAutoReplyService,
  fromGmail,
  fromGraph,
  toGmail,
  toGraph,
  validateAutoReply
} from '../src/auto-reply-cloud.mjs';
import { PROVIDERS } from '../src/oauth.mjs';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const SIGNATURE = `<p>Peter <i>Beispiel</i></p><img src="data:image/png;base64,${PNG}" alt="Logo">`;
const ENDPOINTS = { graph: 'https://graph.test/v1.0', gmail: 'https://gmail.test/gmail/v1' };
const ms = microsoft => ({ id: 'acc1', auth: 'oauth2', oauthProvider: microsoft ? 'microsoft' : 'google' });
const memoryFile = () => {
  let value = { accounts: {} };
  return { get: () => value, save: async next => void (value = next) };
};

/** Fake provider: keeps what was written and returns it rewritten like the real services do. */
function fakeProvider({ status = 200, body = null } = {}) {
  const calls = [];
  let graph = { status: 'disabled', externalAudience: 'all', internalReplyMessage: '', externalReplyMessage: '' };
  let gmail = { enableAutoReply: false };
  const fetchImpl = async (url, init) => {
    calls.push({
      url,
      method: init.method,
      auth: init.headers.Authorization,
      body: init.body && JSON.parse(init.body)
    });
    if (status !== 200) return new Response(JSON.stringify(body || {}), { status });
    if (url.startsWith(ENDPOINTS.graph)) {
      if (init.method === 'PATCH') {
        const s = JSON.parse(init.body).automaticRepliesSetting;
        // Exchange stores the message as a full HTML document.
        const wrap = h => `<html><head><style>p{margin:0}</style></head><body><div>${h}</div></body></html>`;
        graph = {
          ...s,
          internalReplyMessage: wrap(s.internalReplyMessage),
          externalReplyMessage: wrap(s.externalReplyMessage)
        };
        return new Response(null, { status: 200 });
      }
      return Response.json(graph);
    }
    if (init.method === 'PUT') {
      gmail = JSON.parse(init.body);
      return Response.json(gmail);
    }
    return Response.json(gmail);
  };
  return { calls, fetchImpl };
}
const service = provider =>
  createAutoReplyService({
    token: async () => 'tok',
    fetchImpl: provider.fetchImpl,
    endpoints: ENDPOINTS,
    file: memoryFile()
  });

test('Auto reply: Microsoft 365 keeps text and signature, drops embedded logo, restores the editor', async () => {
  const p = fakeProvider();
  const s = service(p);
  const account = ms(true);
  const reply = {
    enabled: true,
    bodyHtml: `<p>Ich bin <strong>bis Montag</strong> nicht da.</p><img src="data:image/png;base64,${PNG}">`,
    includeSignature: true,
    start: '2026-12-20',
    end: '2027-01-06',
    audience: 'contacts'
  };
  const saved = await s.save(account, reply, { signatureHtml: SIGNATURE });
  assert.deepEqual(saved, { ok: true, removedImages: 2 });
  const patch = p.calls.find(c => c.method === 'PATCH');
  assert.equal(patch.url, 'https://graph.test/v1.0/me/mailboxSettings');
  assert.equal(patch.auth, 'Bearer tok');
  const setting = patch.body.automaticRepliesSetting;
  assert.equal(setting.status, 'scheduled');
  assert.equal(setting.externalAudience, 'contactsOnly');
  assert.match(setting.externalReplyMessage, /<strong>bis Montag<\/strong>/);
  assert.match(setting.externalReplyMessage, /<i>Beispiel<\/i>/);
  assert.doesNotMatch(setting.externalReplyMessage, /data:image/);
  assert.equal(setting.internalReplyMessage, setting.externalReplyMessage);
  assert.equal(setting.scheduledStartDateTime.timeZone, 'UTC');
  assert.equal(Date.parse(`${setting.scheduledStartDateTime.dateTime}Z`), new Date(2026, 11, 20).getTime());
  assert.equal(Date.parse(`${setting.scheduledEndDateTime.dateTime}Z`), new Date(2027, 0, 7).getTime());

  const loaded = await s.load(account);
  assert.equal(loaded.provider, 'microsoft');
  // The provider rewrote the HTML; the editor still gets our own content and choice.
  assert.deepEqual(loaded.reply, { ...reply, subject: '', bodyHtml: reply.bodyHtml.replace('">', '" />') });
});

test('Auto reply: changed in Outlook, the provider version wins', async () => {
  const p = fakeProvider();
  const s = service(p);
  const account = ms(true);
  await s.save(
    account,
    { enabled: true, bodyHtml: '<p>Alt</p>', includeSignature: true },
    { signatureHtml: SIGNATURE }
  );
  // Someone edits the reply in Outlook on the web.
  await p.fetchImpl(`${ENDPOINTS.graph}/me/mailboxSettings`, {
    method: 'PATCH',
    headers: {},
    body: JSON.stringify({
      automaticRepliesSetting: {
        status: 'alwaysEnabled',
        internalReplyMessage: '<p>Neu</p>',
        externalReplyMessage: '<p>Neu</p>'
      }
    })
  });
  const loaded = await s.load(account);
  assert.match(loaded.reply.bodyHtml, /Neu/);
  assert.doesNotMatch(loaded.reply.bodyHtml, /<style|<html/);
  assert.equal(loaded.reply.includeSignature, false);
  assert.equal(loaded.reply.start, '');
});

test('Auto reply: Gmail gets subject, HTML, text, dates and audience', async () => {
  const p = fakeProvider();
  const s = service(p);
  const account = ms(false);
  const reply = {
    enabled: true,
    subject: 'Abwesend',
    bodyHtml: '<p>Bis <em>6.1.</em></p>',
    includeSignature: true,
    start: '2026-12-20',
    end: '',
    audience: 'internal'
  };
  await s.save(account, reply, { signatureHtml: SIGNATURE });
  const put = p.calls.find(c => c.method === 'PUT');
  assert.equal(put.url, 'https://gmail.test/gmail/v1/users/me/settings/vacation');
  assert.equal(put.body.enableAutoReply, true);
  assert.equal(put.body.responseSubject, 'Abwesend');
  assert.match(put.body.responseBodyHtml, /<em>6\.1\.<\/em>.*Peter/s);
  assert.doesNotMatch(put.body.responseBodyHtml, /data:/);
  assert.match(put.body.responseBodyPlainText, /Bis 6\.1\.[\s\S]*Peter Beispiel/);
  assert.equal(put.body.startTime, String(new Date(2026, 11, 20).getTime()));
  assert.equal(put.body.endTime, undefined);
  assert.equal(put.body.restrictToDomain, true);
  const loaded = await s.load(account);
  assert.deepEqual(loaded.reply, reply);
});

test('Auto reply: missing consent and a disabled Gmail API are reported apart', async () => {
  const noConsent = service(fakeProvider({ status: 403, body: { error: { code: 403, status: 'PERMISSION_DENIED' } } }));
  await assert.rejects(noConsent.load(ms(false)), err => {
    assert.equal(err.code, 'autoreply_consent_required');
    assert.equal(err.accountId, 'acc1');
    assert.equal(err.provider, 'google');
    return true;
  });
  const disabled = service(
    fakeProvider({
      status: 403,
      body: { error: { status: 'PERMISSION_DENIED', details: [{ reason: 'SERVICE_DISABLED' }] } }
    })
  );
  await assert.rejects(disabled.load(ms(false)), err => err.code === 'autoreply_api_disabled');
  const s = createAutoReplyService({
    token: async () => {
      throw Object.assign(new Error('x'), { code: 'cloud_consent_required' });
    },
    fetchImpl: fakeProvider().fetchImpl,
    endpoints: ENDPOINTS,
    file: memoryFile()
  });
  await assert.rejects(s.load(ms(true)), err => err.code === 'autoreply_consent_required');
  await assert.rejects(s.load({ id: 'x', auth: 'password' }), err => err.code === 'autoreply_unsupported');
});

test('Auto reply: validation per provider', () => {
  assert.throws(
    () => validateAutoReply({ enabled: true, bodyHtml: '<p>x</p>', start: '2026-12-01' }, 'microsoft'),
    /Start- und Enddatum/
  );
  assert.equal(
    validateAutoReply({ enabled: true, bodyHtml: '<p>x</p>', start: '2026-12-01' }, 'google').start,
    '2026-12-01'
  );
  assert.throws(() => validateAutoReply({ enabled: true, bodyHtml: '' }, 'google'), /Text für die Abwesenheitsnotiz/);
  assert.throws(
    () => validateAutoReply({ enabled: true, bodyHtml: '<p>x</p>', start: '1.12.' }, 'google'),
    /Startdatum/
  );
  assert.throws(() => validateAutoReply({ subject: 'a\r\nBcc: x' }, 'google'), /Betreff/);
  assert.equal(validateAutoReply({ subject: 'Weg', bodyHtml: '' }, 'microsoft').subject, '', 'Graph has no subject');
  assert.equal(
    validateAutoReply({ bodyHtml: '<p onclick="x">a</p><script>1</script>' }, 'google').bodyHtml,
    '<p>a</p>'
  );
  assert.equal(validateAutoReply({ audience: 'everyone' }, 'google').audience, 'all');
});

test('Auto reply: provider settings map both ways', () => {
  const graph = toGraph({ enabled: true, start: '', end: '', audience: 'internal' }, '<p>a</p>');
  assert.equal(graph.automaticRepliesSetting.status, 'alwaysEnabled');
  assert.equal(graph.automaticRepliesSetting.externalAudience, 'none');
  assert.equal(toGraph({ enabled: false, audience: 'all' }, '').automaticRepliesSetting.status, 'disabled');
  // Set in Outlook with an end time of 17:00: the end day stays that day.
  const fromOutlook = fromGraph({
    status: 'scheduled',
    externalAudience: 'all',
    externalReplyMessage: '<p>x</p>',
    scheduledStartDateTime: { dateTime: '2026-12-20T00:00:00.0000000', timeZone: 'UTC' },
    scheduledEndDateTime: { dateTime: '2026-12-23T17:00:00.0000000', timeZone: 'UTC' }
  });
  assert.equal(fromOutlook.enabled, true);
  assert.equal(fromOutlook.end, new Date(Date.parse('2026-12-23T16:59:59.999Z')).toLocaleDateString('sv'));
  assert.equal(fromGraph({ status: 'disabled' }).enabled, false);
  const gmail = toGmail({ enabled: false, subject: '', audience: 'contacts', start: '', end: '' }, '', '');
  assert.equal(gmail.restrictToContacts, true);
  assert.deepEqual(fromGmail({ enableAutoReply: true, responseBodyPlainText: 'a <b>' }).html, '<p>a &lt;b&gt;</p>');
});

test('Auto reply: sign-in asks for the mailbox-settings scopes', () => {
  assert.ok(PROVIDERS.microsoft.scopes.includes('https://graph.microsoft.com/MailboxSettings.ReadWrite'));
  assert.match(PROVIDERS.microsoft.settingsScope, /MailboxSettings\.ReadWrite/);
  assert.ok(PROVIDERS.google.scopes.includes('https://www.googleapis.com/auth/gmail.settings.basic'));
});
