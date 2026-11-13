// End-to-end test against a REAL IMAP/SMTP server. Opt-in only, because it writes
// test messages into the mailbox. Use a dedicated test mailbox, never a real one.
//
//   LEVUVO_IT_USER=test@example.org LEVUVO_IT_PASSWORD=… LEVUVO_IT_IMAP_HOST=… \
//   LEVUVO_IT_SMTP_HOST=… LEVUVO_IT_SMTP_PORT=587 LEVUVO_IT_ALLOW_WRITES=1 npm run test:integration
//
// For a self-signed test server additionally set NODE_EXTRA_CA_CERTS=/path/to/ca.crt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import imapflow from 'imapflow';
import { createMailServer } from '../../src/app.mjs';

const env = process.env;
const enabled =
  env.LEVUVO_IT_ALLOW_WRITES === '1' && env.LEVUVO_IT_USER && env.LEVUVO_IT_PASSWORD && env.LEVUVO_IT_IMAP_HOST;
const SECRET = 'a1'.repeat(32);
const wait = ms => new Promise(r => setTimeout(r, ms));

test(
  'Echter Mailserver: Einrichtung, Liste, Paging, Push, Versand',
  { skip: !enabled && 'LEVUVO_IT_* not set', timeout: 90_000 },
  async t => {
    const dir = mkdtempSync(join(tmpdir(), 'lv-it-'));
    const store = new Map();
    const vault = {
      available: true,
      get: (i, k) => store.get(`${i}:${k}`) || '',
      set: (i, k, v) => store.set(`${i}:${k}`, v),
      delete: (i, k) => store.delete(`${i}:${k}`)
    };
    const s = await createMailServer({
      desktop: true,
      sessionSecret: SECRET,
      env: {},
      vault,
      accountsFile: join(dir, 'a.json')
    });
    s.setPortForTesting(4999);
    t.after(async () => {
      await s.close();
      rmSync(dir, { recursive: true, force: true });
    });
    const H = { host: '127.0.0.1:4999', cookie: `levuvo_desktop_session=${SECRET}` };
    const P = { ...H, origin: 'http://127.0.0.1:4999', 'content-type': 'application/json' };
    const account = {
      label: 'IT',
      user: env.LEVUVO_IT_USER,
      password: env.LEVUVO_IT_PASSWORD,
      imapHost: env.LEVUVO_IT_IMAP_HOST,
      smtpHost: env.LEVUVO_IT_SMTP_HOST || env.LEVUVO_IT_IMAP_HOST,
      smtpPort: Number(env.LEVUVO_IT_SMTP_PORT || 587)
    };

    const wrong = await s.api.inject({
      method: 'POST',
      url: '/api/accounts/create',
      headers: { ...P, 'x-levuvo-action': 'accounts-v1' },
      payload: { ...account, password: 'definitiv-falsch' }
    });
    assert.equal(wrong.statusCode, 422);
    const created = await s.api.inject({
      method: 'POST',
      url: '/api/accounts/create',
      headers: { ...P, 'x-levuvo-action': 'accounts-v1' },
      payload: account
    });
    assert.equal(created.statusCode, 201, created.body);
    const id = created.json().account.id;

    const list = (await s.api.inject({ method: 'GET', url: `/api/messages?account=${id}&limit=5`, headers: H })).json();
    assert.ok(Array.isArray(list.messages));
    if (list.hasMore) {
      const next = (
        await s.api.inject({
          method: 'GET',
          url: `/api/messages?account=${id}&limit=5&beforeUid=${list.nextBeforeUid}`,
          headers: H
        })
      ).json();
      assert.ok(next.messages.every(m => m.uid < list.nextBeforeUid));
    }

    await wait(2500);
    const before = (await s.api.inject({ method: 'GET', url: `/api/inbox/monitor?account=${id}`, headers: H })).json();
    const client = new imapflow.ImapFlow({
      host: account.imapHost,
      port: 993,
      secure: true,
      auth: { user: account.user, pass: account.password },
      logger: false
    });
    await client.connect();
    await client.append(
      'INBOX',
      `From: it@example.org\r\nTo: ${account.user}\r\nSubject: Levuvo IT ${Date.now()}\r\n\r\nPush\r\n`
    );
    await client.logout();
    let pushed = false;
    for (let i = 0; i < 40 && !pushed; i++) {
      await wait(250);
      const now = (await s.api.inject({ method: 'GET', url: `/api/inbox/monitor?account=${id}`, headers: H })).json();
      pushed = now.highestUid > before.highestUid;
    }
    assert.ok(pushed, 'new message arrives via IDLE within 10 s');

    const sent = await s.api.inject({
      method: 'POST',
      url: `/api/messages/send?account=${id}`,
      headers: { ...P, 'x-levuvo-action': 'send-v1' },
      payload: {
        requestId: crypto.randomUUID(),
        confirm: 'SEND',
        to: [account.user],
        cc: [],
        bcc: [],
        subject: 'Levuvo IT Versand',
        text: 'Hallo **Test**',
        attachments: []
      }
    });
    assert.equal(sent.statusCode, 200, sent.body);
    assert.equal(sent.json().sent, true);
  }
);
