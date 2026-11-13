// End-to-end scenarios against REAL servers (opt-in, writes test data!).
// Needs two test mailboxes on the same server with local delivery, a CalDAV/CardDAV
// server, ManageSieve and optionally an OAuth test provider. See README → Integrationstests.
//
//   LEVUVO_IT_ALLOW_WRITES=1 LEVUVO_IT_IMAP_HOST=… LEVUVO_IT_SMTP_PORT=465
//   LEVUVO_IT_USER=peter@… LEVUVO_IT_PASSWORD=… LEVUVO_IT_USER2=anna@… LEVUVO_IT_PASSWORD2=…
//   LEVUVO_IT_DAV_URL=https://…/ LEVUVO_IT_DAV_USER=peter LEVUVO_IT_DAV_PASSWORD=… LEVUVO_IT_DAV_USER2=anna LEVUVO_IT_DAV_PASSWORD2=…
//   LEVUVO_IT_OAUTH_URL=http://127.0.0.1:9900  (optional)
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMailServer } from '../../src/app.mjs';
import { PROVIDERS } from '../../src/oauth.mjs';

const env = process.env;
const enabled = env.LEVUVO_IT_ALLOW_WRITES === '1' && env.LEVUVO_IT_USER2 && env.LEVUVO_IT_DAV_URL;
const SECRET = 'b2'.repeat(32);
const PORT = 4998;
const wait = ms => new Promise(r => setTimeout(r, ms));
const stamp = Date.now().toString(36);

function memoryVault() {
  const m = new Map();
  return {
    available: true,
    get: (i, k) => m.get(`${i}:${k}`) || '',
    set: (i, k, v) => m.set(`${i}:${k}`, v),
    delete: (i, k) => m.delete(`${i}:${k}`)
  };
}
async function start(t, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'lv-it2-'));
  const s = await createMailServer({
    desktop: true,
    sessionSecret: SECRET,
    env: extra.env || {},
    vault: memoryVault(),
    accountsFile: join(dir, 'accounts.json'),
    background: false,
    ...extra
  });
  s.setPortForTesting(PORT);
  t.after(async () => {
    await s.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const H = { host: `127.0.0.1:${PORT}`, cookie: `levuvo_desktop_session=${SECRET}` };
  const call = async (method, url, payload, action) => {
    const r = await s.api.inject({
      method,
      url,
      headers:
        payload === undefined
          ? H
          : {
              ...H,
              origin: `http://127.0.0.1:${PORT}`,
              'content-type': 'application/json',
              ...(action ? { 'x-levuvo-action': action } : {})
            },
      payload
    });
    let body;
    try {
      body = r.json();
    } catch {
      body = r.body;
    }
    return { status: r.statusCode, body, headers: r.headers };
  };
  return { s, call };
}
const mailAccount = (user, password, label) => ({
  label,
  user,
  password,
  imapHost: env.LEVUVO_IT_IMAP_HOST,
  smtpHost: env.LEVUVO_IT_SMTP_HOST || env.LEVUVO_IT_IMAP_HOST,
  smtpPort: Number(env.LEVUVO_IT_SMTP_PORT || 587),
  displayName: label
});
async function until(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(400);
  }
  return null;
}

test('Complete system against real servers', { skip: !enabled && 'LEVUVO_IT_* not set', timeout: 240_000 }, async t => {
  const { s, call } = await start(t);
  const peter = (
    await call(
      'POST',
      '/api/accounts/create',
      mailAccount(env.LEVUVO_IT_USER, env.LEVUVO_IT_PASSWORD, 'Peter'),
      'accounts-v1'
    )
  ).body.account;
  const anna = (
    await call(
      'POST',
      '/api/accounts/create',
      mailAccount(env.LEVUVO_IT_USER2, env.LEVUVO_IT_PASSWORD2, 'Anna'),
      'accounts-v1'
    )
  ).body.account;
  assert.ok(peter?.id && anna?.id);
  const P = q => `${q}${q.includes('?') ? '&' : '?'}account=${peter.id}`;
  const A = q => `${q}${q.includes('?') ? '&' : '?'}account=${anna.id}`;
  const findIn = async (account, folder, subject) =>
    until(async () => {
      const r = await call(
        'GET',
        `/api/search?account=${account}&folder=${encodeURIComponent(folder)}&q=${encodeURIComponent(subject)}`
      );
      return r.body.messages?.find(m => m.subject.includes(subject));
    });
  const sendAs = (account, payload) =>
    call(
      'POST',
      `/api/messages/send?account=${account}`,
      { requestId: crypto.randomUUID(), confirm: 'SEND', cc: [], bcc: [], attachments: [], ...payload },
      'send-v1'
    );

  await t.test('Create and rename folders, move, flag, spam and delete messages', async () => {
    const created = await call('POST', P('/api/folders/manage'), { op: 'create', name: `Test ${stamp}` }, 'mail-v1');
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const renamed = await call(
      'POST',
      P('/api/folders/manage'),
      { op: 'rename', path: created.body.path, name: `Projekt ${stamp}` },
      'mail-v1'
    );
    assert.equal(renamed.status, 200);
    const sent = await sendAs(peter.id, { to: [env.LEVUVO_IT_USER], subject: `Ordnertest ${stamp}`, text: 'x' });
    assert.equal(sent.body.sent, true);
    const msg = await findIn(peter.id, 'INBOX', `Ordnertest ${stamp}`);
    assert.ok(msg, 'zugestellt');
    for (const action of ['flag', 'markRead'])
      assert.equal(
        (
          await call(
            'POST',
            P('/api/messages/batch-action'),
            { folder: 'INBOX', action, uids: [String(msg.uid)] },
            'mail-v1'
          )
        ).status,
        200
      );
    const list = await call('GET', P('/api/messages?folder=INBOX&limit=5'));
    const item = list.body.messages.find(m => m.uid === msg.uid);
    assert.deepEqual([item.flagged, item.unread], [true, false]);
    const moved = await call(
      'POST',
      P('/api/messages/batch-action'),
      { folder: 'INBOX', action: 'move', destination: renamed.body.path, uids: [String(msg.uid)] },
      'mail-v1'
    );
    assert.equal(moved.body.count, 1);
    assert.equal(
      (await call('POST', P('/api/folders/manage'), { op: 'delete', path: renamed.body.path }, 'mail-v1')).body.code,
      'folder_not_empty'
    );
    const inFolder = await findIn(peter.id, renamed.body.path, `Ordnertest ${stamp}`);
    assert.equal(
      (
        await call(
          'POST',
          P('/api/messages/batch-action'),
          { folder: renamed.body.path, action: 'spam', uids: [String(inFolder.uid)] },
          'mail-v1'
        )
      ).body.destination.includes('Junk'),
      true
    );
    assert.equal(
      (await call('POST', P('/api/folders/manage'), { op: 'delete', path: renamed.body.path }, 'mail-v1')).status,
      200
    );
  });

  await t.test('2.1: Undo, conversation, snooze and follow-up', async () => {
    // Peter writes to Anna with a follow-up reminder; Anna answers in the same conversation.
    const due = new Date(Date.now() + 3 * 86400_000).toISOString();
    const first = await sendAs(peter.id, {
      to: [env.LEVUVO_IT_USER2],
      subject: `Faden ${stamp}`,
      text: 'Frage?',
      followUp: due
    });
    assert.equal(first.body.followUp, true, JSON.stringify(first.body));
    const followups = (await call('GET', '/api/followups')).body.items;
    const fu = followups.find(f => f.subject === `Faden ${stamp}`);
    assert.ok(fu && fu.accountLabel === 'Peter');

    const atAnna = await findIn(anna.id, 'INBOX', `Faden ${stamp}`);
    assert.ok(atAnna?.messageId, 'Message-ID in the list');
    const reply = await sendAs(anna.id, {
      to: [env.LEVUVO_IT_USER],
      subject: `Re: Faden ${stamp}`,
      text: 'Antwort.',
      inReplyTo: atAnna.messageId,
      references: atAnna.messageId
    });
    assert.equal(reply.body.sent, true);
    const answer = await findIn(peter.id, 'INBOX', `Re: Faden ${stamp}`);
    assert.ok(answer);

    // Conversation: Peter's answer in INBOX and his original in Sent appear together.
    const thread = (await call('GET', P(`/api/thread?folder=INBOX&uid=${answer.uid}`))).body;
    assert.ok(thread.messages.length >= 2, JSON.stringify(thread));
    assert.ok(thread.messages.some(m => m.sent && m.subject === `Faden ${stamp}`));

    // The reply ends the follow-up when it is due.
    await s.ctx.followups.updateFollowup(fu.id, { due: new Date(Date.now() - 1000).toISOString() });
    await s.ctx.runFollowups();
    assert.ok(!(await call('GET', '/api/followups')).body.items.some(f => f.id === fu.id), 'beantwortet → erledigt');

    // A follow-up without answer becomes due.
    const lonely = await sendAs(peter.id, {
      to: ['niemand@levuvo.test'],
      subject: `Ohne Antwort ${stamp}`,
      text: 'x',
      followUp: due
    });
    assert.equal(lonely.body.followUp, true);
    const open = (await call('GET', '/api/followups')).body.items.find(f => f.subject === `Ohne Antwort ${stamp}`);
    await s.ctx.followups.updateFollowup(open.id, { due: new Date(Date.now() - 1000).toISOString() });
    await s.ctx.runFollowups();
    assert.equal((await call('GET', '/api/followups')).body.items.find(f => f.id === open.id).state, 'due');
    assert.equal((await call('POST', '/api/followups/dismiss', { id: open.id }, 'mail-v1')).status, 200);

    // Undo: archive → move back with the new UID from the server (UIDPLUS).
    const archived = await call(
      'POST',
      P('/api/messages/batch-action'),
      { folder: 'INBOX', action: 'trash', uids: [String(answer.uid)] },
      'mail-v1'
    );
    assert.equal(archived.status, 200, JSON.stringify(archived.body));
    const undo = archived.body.undo;
    assert.ok(undo?.uids?.length === 1 && undo.destination === 'INBOX', JSON.stringify(archived.body));
    const undone = await call(
      'POST',
      P('/api/messages/batch-action'),
      { folder: undo.folder, action: undo.action, destination: undo.destination, uids: undo.uids },
      'mail-v1'
    );
    assert.equal(undone.body.count, 1, JSON.stringify(undone.body));
    const back = await findIn(peter.id, 'INBOX', `Re: Faden ${stamp}`);
    assert.ok(back, 'back in the inbox');

    // Snooze: leaves the inbox into "Zurückgestellt", comes back unread on wake.
    await call(
      'POST',
      P('/api/messages/batch-action'),
      { folder: 'INBOX', action: 'markRead', uids: [String(back.uid)] },
      'mail-v1'
    );
    const snoozed = await call(
      'POST',
      P('/api/messages/snooze'),
      { folder: 'INBOX', uids: [String(back.uid)], until: new Date(Date.now() + 3600_000).toISOString() },
      'mail-v1'
    );
    assert.equal(snoozed.body.snoozed, 1, JSON.stringify(snoozed.body));
    assert.match(snoozed.body.folder, /Zurückgestellt/);
    const list = (await call('GET', P('/api/messages?folder=INBOX&limit=30'))).body.messages;
    assert.ok(!list.some(m => m.subject === `Re: Faden ${stamp}`), 'gone from the inbox');
    assert.equal((await call('GET', P('/api/snoozed'))).body.items.length >= 1, true);
    const woke = await call('POST', P('/api/snoozed/wake'), { id: snoozed.body.ids[0] }, 'mail-v1');
    assert.equal(woke.body.woke, true, JSON.stringify(woke.body));
    const again = await findIn(peter.id, 'INBOX', `Re: Faden ${stamp}`);
    assert.equal(again.unread, true, 'wieder ungelesen');
    assert.ok(!(await call('GET', P('/api/snoozed'))).body.items.some(i => i.id === snoozed.body.ids[0]));

    // Templates are stored locally and validated.
    const tpl = await call(
      'POST',
      '/api/templates/save',
      { name: `Antwort ${stamp}`, subject: 'Danke', html: '<p>Hallo {Vorname}</p>' },
      'mail-v1'
    );
    assert.equal(tpl.status, 200, JSON.stringify(tpl.body));
    assert.ok((await call('GET', '/api/templates')).body.templates.some(x => x.name === `Antwort ${stamp}`));
  });

  await t.test('2.2: Send a password-protected message, open it at the recipient and in "Sent"', async () => {
    const password = 'Pferd-Batterie-Klammer-7';
    const sent = await sendAs(peter.id, {
      to: [env.LEVUVO_IT_USER2],
      subject: `Zugang ${stamp}`,
      html: '<p>Benutzer: <b>admin</b>, Kennwort: <code>geheim-123</code></p>',
      attachments: [{ name: 'zugang.txt', contentBase64: Buffer.from('VPN: geheim').toString('base64') }],
      security: { method: 'password', password, hint: 'wie am Telefon besprochen' }
    });
    assert.equal(sent.body.sent, true, JSON.stringify(sent.body));
    const msg = await findIn(anna.id, 'INBOX', `Zugang ${stamp}`);
    assert.ok(msg, 'zugestellt');
    const detail = (await call('GET', A(`/api/messages/${msg.uid}?folder=INBOX`))).body;
    assert.deepEqual(detail.protected, { hint: 'wie am Telefon besprochen' });
    assert.doesNotMatch(`${detail.text} ${detail.html}`, /geheim|admin/, 'no plain text in the visible mail');
    const file = detail.attachments.find(a => a.filename === 'Geschuetzte-Nachricht.html');
    assert.ok(file, JSON.stringify(detail.attachments));
    const raw = await call('GET', A(`/api/messages/${msg.uid}/attachments/${file.index}?folder=INBOX`));
    assert.doesNotMatch(String(raw.body), /geheim|admin|zugang\.txt/);
    assert.match(String(raw.body), /levuvo-protected/);

    const open = pw =>
      call('POST', A('/api/messages/protected/open'), { folder: 'INBOX', uid: msg.uid, password: pw }, 'mail-v1');
    const wrong = await open('falsches-passwort');
    assert.equal(wrong.status, 403);
    assert.equal(wrong.body.code, 'protected_wrong_password');
    const ok = await open(password);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.subject, `Zugang ${stamp}`);
    assert.match(ok.body.html, /geheim-123/);
    assert.equal(Buffer.from(ok.body.attachments[0].data, 'base64').toString(), 'VPN: geheim');
    for (let i = 0; i < 5; i++) await open('nochmal-falsch');
    assert.equal((await open(password)).status, 429, 'short lockout after 5 failed attempts');

    // The sender's copy in "Sent" is protected too and opens with the same password.
    const own = await findIn(peter.id, 'INBOX.Sent', `Zugang ${stamp}`);
    assert.ok(own, 'Kopie in Gesendet');
    const mine = await call(
      'POST',
      P('/api/messages/protected/open'),
      { folder: 'INBOX.Sent', uid: own.uid, password },
      'mail-v1'
    );
    assert.match(mine.body.html, /geheim-123/);

    const short = await sendAs(peter.id, {
      to: [env.LEVUVO_IT_USER2],
      subject: 'x',
      text: 'x',
      security: { method: 'password', password: 'kurz' }
    });
    assert.equal(short.status, 400);
  });

  await t.test('Server filter rule sorts incoming mail', async () => {
    const info = await call('GET', P('/api/sieve'));
    assert.equal(info.body.available, true, JSON.stringify(info.body));
    await call('POST', P('/api/folders/manage'), { op: 'create', name: `Rechnungen ${stamp}` }, 'mail-v1');
    const folders = (await call('GET', P('/api/folders'))).body.folders;
    const target = folders.find(f => f.name === `Rechnungen ${stamp}`).path;
    const saved = await call(
      'POST',
      P('/api/sieve'),
      {
        config: {
          rules: [
            {
              name: 'Rechnungen',
              conditions: [{ field: 'subject', op: 'contains', value: `RE-${stamp}` }],
              actions: [{ type: 'move', folder: target }, { type: 'flag' }]
            }
          ],
          vacation: { enabled: false }
        },
        replaceForeign: true
      },
      'mail-v1'
    );
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    await sendAs(anna.id, { to: [env.LEVUVO_IT_USER], subject: `Ihre Rechnung RE-${stamp}`, text: 'Bitte zahlen' });
    const filed = await findIn(peter.id, target, `RE-${stamp}`);
    assert.ok(filed, 'rule moved the message to the target folder');
    assert.equal(filed.flagged, true);
    await call(
      'POST',
      P('/api/sieve'),
      { config: { rules: [], vacation: { enabled: false } }, replaceForeign: true },
      'mail-v1'
    );
  });

  await t.test('HTML mail with alias, embedded image and text version', async () => {
    const aliasAddress = env.LEVUVO_IT_USER.replace('@', '+office@');
    const upd = await call(
      'POST',
      '/api/accounts/update',
      {
        id: peter.id,
        identities: [{ email: aliasAddress, name: 'Levuvo Office' }],
        signatureHtml: '<p>LG <b>Peter</b></p>'
      },
      'accounts-v1'
    );
    assert.equal(upd.status, 200, JSON.stringify(upd.body));
    const status = await call('GET', P('/api/status'));
    assert.equal(status.body.identities.length, 2);
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const r = await sendAs(peter.id, {
      from: aliasAddress,
      to: [env.LEVUVO_IT_USER2],
      subject: `HTML ${stamp}`,
      html: `<p>Hallo <b>Anna</b></p><p><img src="data:image/png;base64,${png}"></p><script>x</script>`
    });
    assert.equal(r.body.sent, true, JSON.stringify(r.body));
    const got = await findIn(anna.id, 'INBOX', `HTML ${stamp}`);
    const detail = (await call('GET', A(`/api/messages/${got.uid}?folder=INBOX`))).body;
    assert.match(detail.from[0].email, /\+office@/);
    assert.equal(detail.from[0].name, 'Levuvo Office');
    assert.match(detail.html, /<b>Anna<\/b>/);
    assert.match(detail.html, /src="data:image\/png;base64/, 'cid image embedded and shown');
    assert.doesNotMatch(detail.html, /<script/);
    assert.match(detail.text, /Hallo Anna/);
    const bad = await sendAs(peter.id, {
      from: 'fremd@example.org',
      to: [env.LEVUVO_IT_USER2],
      subject: 'x',
      text: 'x'
    });
    assert.equal(bad.body.code, 'identity_unknown');
  });

  await t.test('Send later: scheduled, shown, sent exactly once at the scheduled time', async () => {
    const sendAt = new Date(Date.now() + 32_000).toISOString();
    const r = await call(
      'POST',
      P('/api/messages/schedule'),
      {
        requestId: crypto.randomUUID(),
        confirm: 'SEND',
        to: [env.LEVUVO_IT_USER2],
        cc: [],
        bcc: ['geheim@example.org'],
        subject: `Geplant ${stamp}`,
        text: 'Später',
        attachments: [],
        sendAt
      },
      'send-v1'
    );
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const listed = (await call('GET', P('/api/scheduled'))).body.items.find(i => i.subject === `Geplant ${stamp}`);
    assert.equal(listed.state, 'scheduled');
    await s.ctx.runScheduler();
    assert.equal(
      (await call('GET', A(`/api/search?folder=INBOX&q=${encodeURIComponent(`Geplant ${stamp}`)}`))).body.total,
      0,
      'not sent yet'
    );
    await wait(Math.max(0, Date.parse(sendAt) - Date.now()) + 500);
    await s.ctx.runScheduler();
    const arrived = await findIn(anna.id, 'INBOX', `Geplant ${stamp}`);
    assert.ok(arrived);
    const raw = (await call('GET', A(`/api/messages/${arrived.uid}/raw?folder=INBOX`))).body;
    assert.doesNotMatch(String(raw), /^Bcc:|X-Levuvo-Send-At|geheim@/im);
    assert.equal(
      (await call('GET', P('/api/scheduled'))).body.items.filter(i => i.subject === `Geplant ${stamp}`).length,
      0
    );
    await s.ctx.runScheduler();
    const count = (await call('GET', A(`/api/search?folder=INBOX&q=${encodeURIComponent(`Geplant ${stamp}`)}`))).body
      .total;
    assert.equal(count, 1, 'not sent twice');
  });

  await t.test('OpenPGP between two accounts: send encrypted, unlock, read', async () => {
    const pk = await call(
      'POST',
      '/api/crypto/pgp/generate',
      { name: 'Peter', email: env.LEVUVO_IT_USER, passphrase: 'peter-pass-1' },
      'crypto-v1'
    );
    const ak = await call(
      'POST',
      '/api/crypto/pgp/generate',
      { name: 'Anna', email: env.LEVUVO_IT_USER2, passphrase: 'anna-pass-1' },
      'crypto-v1'
    );
    assert.equal(pk.status, 200, JSON.stringify(pk.body));
    await call(
      'POST',
      '/api/crypto/pgp/unlock',
      { fingerprint: pk.body.fingerprint, passphrase: 'peter-pass-1' },
      'crypto-v1'
    );
    const r = await sendAs(peter.id, {
      to: [env.LEVUVO_IT_USER2],
      subject: `PGP ${stamp}`,
      html: '<p>Streng <b>vertraulich</b></p>',
      security: { method: 'pgp', sign: true, encrypt: true }
    });
    assert.equal(r.body.sent, true, JSON.stringify(r.body));
    const got = await findIn(anna.id, 'INBOX', `PGP ${stamp}`);
    await call('POST', '/api/crypto/pgp/lock', {}, 'crypto-v1');
    const locked = (await call('GET', A(`/api/messages/${got.uid}?folder=INBOX`))).body;
    assert.equal(locked.crypto.locked, true);
    assert.doesNotMatch(locked.text + locked.html, /vertraulich/);
    await call(
      'POST',
      '/api/crypto/pgp/unlock',
      { fingerprint: ak.body.fingerprint, passphrase: 'anna-pass-1' },
      'crypto-v1'
    );
    const open = (await call('GET', A(`/api/messages/${got.uid}?folder=INBOX`))).body;
    assert.equal(open.crypto.encrypted, true);
    assert.equal(open.crypto.signatures[0].valid, true);
    assert.match(open.html, /<b>vertraulich<\/b>/);
  });

  await t.test('Calendar: invitation from Peter to Anna, acceptance, status at the organizer', async () => {
    const dp = await call(
      'POST',
      '/api/dav/accounts/create',
      {
        label: 'Peter DAV',
        serverUrl: env.LEVUVO_IT_DAV_URL,
        username: env.LEVUVO_IT_DAV_USER,
        password: env.LEVUVO_IT_DAV_PASSWORD
      },
      'accounts-v1'
    );
    const da = await call(
      'POST',
      '/api/dav/accounts/create',
      {
        label: 'Anna DAV',
        serverUrl: env.LEVUVO_IT_DAV_URL,
        username: env.LEVUVO_IT_DAV_USER2,
        password: env.LEVUVO_IT_DAV_PASSWORD2
      },
      'accounts-v1'
    );
    assert.equal(dp.status, 201, JSON.stringify(dp.body));
    const bad = await call(
      'POST',
      '/api/dav/accounts/create',
      { label: 'x', serverUrl: env.LEVUVO_IT_DAV_URL, username: env.LEVUVO_IT_DAV_USER, password: 'falsch' },
      'accounts-v1'
    );
    assert.equal(bad.body.code, 'dav_auth_failed');
    let cals = (await call('GET', '/api/calendar/calendars')).body.calendars;
    for (const acc of [dp.body.account, da.body.account]) {
      if (!cals.some(c => c.accountId === acc.id))
        await call('POST', '/api/calendar/calendars/create', { accountId: acc.id, name: 'Persönlich' }, 'calendar-v1');
    }
    cals = (await call('GET', '/api/calendar/calendars')).body.calendars;
    const peterCal = cals.find(c => c.accountId === dp.body.account.id);
    const annaCal = cals.find(c => c.accountId === da.body.account.id);
    const event = {
      summary: `Workshop ${stamp}`,
      start: '2027-03-10T10:00',
      end: '2027-03-10T12:00',
      tzid: 'Europe/Vienna',
      location: 'Wien',
      alarms: [30],
      attendees: [{ email: env.LEVUVO_IT_USER2, name: 'Anna' }]
    };
    const saved = await call(
      'POST',
      '/api/calendar/events/save',
      {
        accountId: peterCal.accountId,
        calendarUrl: peterCal.url,
        event,
        notify: true,
        organizer: env.LEVUVO_IT_USER
      },
      'calendar-v1'
    );
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.invited, 1);
    const invite = await findIn(anna.id, 'INBOX', `Workshop ${stamp}`);
    const detail = (await call('GET', A(`/api/messages/${invite.uid}?folder=INBOX`))).body;
    assert.equal(detail.invitation.method, 'REQUEST');
    assert.equal(detail.invitation.myStatus, 'NEEDS-ACTION');
    const answer = await call(
      'POST',
      A('/api/invitations/respond'),
      {
        folder: 'INBOX',
        uid: invite.uid,
        response: 'accept',
        calendar: { accountId: annaCal.accountId, url: annaCal.url }
      },
      'calendar-v1'
    );
    assert.deepEqual(
      [answer.body.partstat, answer.body.stored, answer.body.replied],
      ['ACCEPTED', true, true],
      JSON.stringify(answer.body)
    );
    const annaEvents = (
      await call('GET', '/api/calendar/events?from=2027-03-01T00:00:00Z&to=2027-04-01T00:00:00Z')
    ).body.events.filter(e => e.summary === `Workshop ${stamp}`);
    assert.equal(annaEvents.length, 2, 'entered for Peter and Anna');
    const reply = await findIn(peter.id, 'INBOX', `Workshop ${stamp}`);
    const replyDetail = (await call('GET', P(`/api/messages/${reply.uid}?folder=INBOX`))).body;
    assert.equal(replyDetail.invitation.method, 'REPLY');
    const applied = await call('POST', P('/api/invitations/apply'), { folder: 'INBOX', uid: reply.uid }, 'calendar-v1');
    assert.equal(applied.body.applied, true, JSON.stringify(applied.body));
    const peterEvent = (
      await call('GET', '/api/calendar/events?from=2027-03-01T00:00:00Z&to=2027-04-01T00:00:00Z')
    ).body.events.find(e => e.summary === `Workshop ${stamp}` && e.calendarUrl === peterCal.url);
    assert.equal(peterEvent.attendees.find(a => a.email === env.LEVUVO_IT_USER2).partstat, 'ACCEPTED');
    const alarms = (
      await call(
        'GET',
        `/api/calendar/alarms?from=${encodeURIComponent('2027-03-10T08:20:00Z')}&to=${encodeURIComponent('2027-03-10T08:40:00Z')}`
      )
    ).body.alarms;
    assert.ok(alarms.some(a => a.title === `Workshop ${stamp}`));
    const del = await call(
      'POST',
      '/api/calendar/events/delete',
      { accountId: peterEvent.accountId, url: peterEvent.url, etag: peterEvent.etag, notify: true },
      'calendar-v1'
    );
    assert.equal(del.body.cancelled, 1);
    const cancel = await until(async () => {
      const r = await call('GET', A(`/api/search?folder=INBOX&q=${encodeURIComponent(`Abgesagt: Workshop ${stamp}`)}`));
      return r.body.messages?.[0];
    });
    const applyCancel = await call(
      'POST',
      A('/api/invitations/apply'),
      { folder: 'INBOX', uid: cancel.uid },
      'calendar-v1'
    );
    assert.equal(applyCancel.body.applied, true);
  });

  await t.test('2.1.1: Calendar on this device, moving to a CalDAV calendar, export/import', async () => {
    const cals = (await call('GET', '/api/calendar/calendars')).body.calendars;
    const local = cals.find(c => c.source === 'local');
    const dav = cals.find(c => !c.source && !c.readOnly);
    assert.ok(local && dav, JSON.stringify(cals));
    assert.equal(cals.at(-1).source, 'local', 'device calendar last');
    const event = {
      summary: `Blocker ${stamp}`,
      allDay: false,
      tzid: 'Europe/Vienna',
      start: '2026-12-01T09:00',
      end: '2026-12-01T10:00',
      alarms: [5]
    };
    const saved = await call(
      'POST',
      '/api/calendar/events/save',
      { accountId: 'local', calendarUrl: local.url, event },
      'calendar-v1'
    );
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const range = '/api/calendar/events?from=2026-11-30T00:00:00Z&to=2026-12-03T00:00:00Z';
    let ev = (await call('GET', range)).body.events.find(e => e.summary === `Blocker ${stamp}`);
    assert.equal(ev.accountId, 'local');
    const alarms = (await call('GET', '/api/calendar/alarms?from=2026-12-01T07:50:00Z&to=2026-12-01T07:59:00Z')).body
      .alarms;
    assert.ok(
      alarms.some(a => a.title === `Blocker ${stamp}`),
      JSON.stringify(alarms)
    );
    const exported = await call('GET', `/api/calendar/local/export?url=${encodeURIComponent(local.url)}`);
    assert.match(String(exported.body), new RegExp(`SUMMARY:Blocker ${stamp}`));

    // Move to the CalDAV calendar (event editor: another calendar chosen).
    const moved = await call(
      'POST',
      '/api/calendar/events/save',
      {
        accountId: 'local',
        url: ev.url,
        etag: ev.etag,
        calendarUrl: dav.url,
        targetAccountId: dav.accountId,
        sourceCalendarUrl: local.url,
        event: { ...event, summary: `Blocker ${stamp} (Server)` }
      },
      'calendar-v1'
    );
    assert.equal(moved.body.moved, true, JSON.stringify(moved.body));
    const after = (await call('GET', range)).body.events.filter(e => e.summary.startsWith(`Blocker ${stamp}`));
    assert.equal(after.length, 1);
    assert.equal(after[0].accountId, dav.accountId);
    await call(
      'POST',
      '/api/calendar/events/delete',
      { accountId: dav.accountId, url: after[0].url, etag: after[0].etag },
      'calendar-v1'
    );

    // Import the exported file back into the device calendar.
    const imported = await call(
      'POST',
      '/api/calendar/local/import',
      { url: local.url, ics: String(exported.body) },
      'calendar-v1'
    );
    assert.equal(imported.body.imported, 1, JSON.stringify(imported.body));
    ev = (await call('GET', range)).body.events.find(e => e.summary === `Blocker ${stamp}`);
    assert.equal(ev.accountId, 'local');
    await call('POST', '/api/calendar/events/delete', { accountId: 'local', url: ev.url }, 'calendar-v1');
  });

  await t.test('Contacts: create, find in suggestions, export, delete', async () => {
    const lists = (await call('GET', '/api/contacts/list')).body;
    const book = lists.addressBooks[0];
    const saved = await call(
      'POST',
      '/api/contacts/save',
      {
        accountId: book.accountId,
        addressBookUrl: book.url,
        contact: {
          firstName: 'Zora',
          lastName: `Test${stamp}`,
          emails: [{ value: `zora.${stamp}@example.org`, type: 'work' }]
        }
      },
      'contacts-v1'
    );
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const sugg = (await call('GET', P('/api/contacts?q=zora'))).body.contacts;
    assert.ok(sugg.some(c => c.email === `zora.${stamp}@example.org`));
    const exported = await call('GET', '/api/contacts/export');
    assert.match(String(exported.body), new RegExp(`Test${stamp}`));
    const c = (await call('GET', '/api/contacts/list')).body.contacts.find(x => x.lastName === `Test${stamp}`);
    assert.equal(
      (await call('POST', '/api/contacts/delete', { accountId: c.accountId, url: c.url, etag: c.etag }, 'contacts-v1'))
        .status,
      200
    );
  });

  await t.test('Encrypted local index: offline full-text search across folders and accounts', async () => {
    await s.ctx.runIndexer(true);
    const status = (await call('GET', '/api/index/status')).body;
    assert.ok(status.accounts.every(a => a.messages > 0));
    const hits = (await call('GET', `/api/search/local?q=${encodeURIComponent(`RE-${stamp}`)}`)).body.messages;
    assert.ok(hits.some(h => h.accountId === peter.id && h.folder.includes('Rechnungen')));
  });

  await t.test('Phishing hints appear when reading', async () => {
    await sendAs(anna.id, {
      to: [env.LEVUVO_IT_USER],
      subject: `Konto ${stamp}`,
      html: '<p><a href="https://evil.example/login">https://www.meinebank.at/login</a></p>'
    });
    const msg = await findIn(peter.id, 'INBOX', `Konto ${stamp}`);
    const detail = (await call('GET', P(`/api/messages/${msg.uid}?folder=INBOX`))).body;
    assert.equal(detail.security.level, 'danger');
    assert.ok(detail.security.checks.some(c => c.code === 'deceptive_link'));
  });
});

test(
  'OAuth sign-in with XOAUTH2 for IMAP and SMTP',
  { skip: !(enabled && env.LEVUVO_IT_OAUTH_URL) && 'LEVUVO_IT_OAUTH_URL not set', timeout: 60_000 },
  async t => {
    const base = env.LEVUVO_IT_OAUTH_URL;
    const providers = {
      microsoft: {
        ...PROVIDERS.microsoft,
        authUrl: `${base}/authorize`,
        tokenUrl: `${base}/token`,
        imapHost: env.LEVUVO_IT_IMAP_HOST,
        smtpHost: env.LEVUVO_IT_SMTP_HOST || env.LEVUVO_IT_IMAP_HOST,
        smtpPort: Number(env.LEVUVO_IT_SMTP_PORT || 587)
      }
    };
    const { call } = await start(t, {
      oauthProviders: providers,
      cloudEndpoints: { graph: `${base}/graph/v1.0`, googleCalendar: `${base}/gcal`, googlePeople: `${base}/people` },
      env: { LEVUVO_OAUTH_MICROSOFT_CLIENT_ID: 'levuvo-test' }
    });
    const startRes = await call('POST', '/api/oauth/start', { provider: 'microsoft' }, 'accounts-v1');
    assert.equal(startRes.status, 200, JSON.stringify(startRes.body));
    const authUrl = new URL(startRes.body.authUrl);
    authUrl.searchParams.set('login_hint', env.LEVUVO_IT_USER);
    const redirect = await fetch(authUrl, { redirect: 'manual' });
    const callback = new URL(redirect.headers.get('location'));
    const page = await call('GET', `${callback.pathname}${callback.search}`);
    assert.match(String(page.body), /Anmeldung abgeschlossen/);
    const status = (await call('GET', `/api/oauth/status?state=${startRes.body.state}`)).body;
    assert.equal(status.status, 'done');
    const list = await call('GET', `/api/messages?account=${status.accountId}&folder=INBOX&limit=3`);
    assert.equal(list.status, 200, JSON.stringify(list.body));
    const sent = await call(
      'POST',
      `/api/messages/send?account=${status.accountId}`,
      {
        requestId: crypto.randomUUID(),
        confirm: 'SEND',
        to: [env.LEVUVO_IT_USER],
        cc: [],
        bcc: [],
        subject: 'OAuth Test',
        text: 'per XOAUTH2',
        attachments: []
      },
      'send-v1'
    );
    assert.equal(sent.body.sent, true, JSON.stringify(sent.body));
    const reuse = await call('GET', `${callback.pathname}${callback.search}`);
    assert.match(String(reuse.body), /fehlgeschlagen/);

    // Microsoft 365 calendar and contacts through Graph with the same sign-in.
    const cals = (await call('GET', '/api/calendar/calendars')).body;
    const cal = cals.calendars.find(c => c.accountId === status.accountId);
    assert.ok(cal, JSON.stringify(cals));
    assert.equal(cal.url, 'cloud:CAL-1');
    const saved = await call(
      'POST',
      '/api/calendar/events/save',
      {
        accountId: status.accountId,
        calendarUrl: cal.url,
        notify: true,
        event: {
          summary: 'Graph-Termin',
          allDay: false,
          tzid: 'Europe/Vienna',
          start: '2026-11-20T10:00',
          end: '2026-11-20T11:00',
          attendees: [{ email: 'gast@levuvo.test' }],
          alarms: [15]
        }
      },
      'calendar-v1'
    );
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const range = (await call('GET', '/api/calendar/events?from=2026-11-16T00:00:00Z&to=2026-11-23T00:00:00Z')).body;
    const ev = range.events.find(e => e.summary === 'Graph-Termin');
    assert.ok(ev, JSON.stringify(range));
    assert.equal(ev.start, '2026-11-20T09:00:00.000Z');
    assert.deepEqual(ev.alarms, [15]);
    assert.equal(
      (
        await call(
          'POST',
          '/api/calendar/events/delete',
          { accountId: ev.accountId, calendarUrl: ev.calendarUrl, url: ev.url },
          'calendar-v1'
        )
      ).status,
      200
    );
    const contact = await call(
      'POST',
      '/api/contacts/save',
      {
        accountId: status.accountId,
        addressBookUrl: 'cloud:contacts',
        contact: {
          name: 'Graph Kontakt',
          firstName: 'Graph',
          lastName: 'Kontakt',
          emails: [{ value: 'gk@levuvo.test', type: 'work' }]
        }
      },
      'contacts-v1'
    );
    assert.equal(contact.status, 200, JSON.stringify(contact.body));
    const book = (await call('GET', '/api/contacts/list')).body;
    assert.ok(book.contacts.some(c => c.name === 'Graph Kontakt' && c.url.startsWith('cloud:')));
    assert.ok(book.addressBooks.some(b => b.url === 'cloud:contacts' && b.accountId === status.accountId));

    // Renewing consent keeps the account and replaces its token.
    const relink = await call(
      'POST',
      '/api/oauth/start',
      { provider: 'microsoft', accountId: status.accountId },
      'accounts-v1'
    );
    const relinkUrl = new URL(relink.body.authUrl);
    relinkUrl.searchParams.set('login_hint', env.LEVUVO_IT_USER);
    const back = new URL((await fetch(relinkUrl, { redirect: 'manual' })).headers.get('location'));
    assert.match(String((await call('GET', `${back.pathname}${back.search}`)).body), /freigegeben/);
    assert.equal((await call('GET', `/api/oauth/status?state=${relink.body.state}`)).body.accountId, status.accountId);
    const wrong = await call(
      'POST',
      '/api/oauth/start',
      { provider: 'google', accountId: status.accountId },
      'accounts-v1'
    );
    assert.notEqual(wrong.status, 200);
  }
);
