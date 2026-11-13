// Browser regression test for the live inbox against a REAL IMAP server (opt-in).
// Reproduces "new mail arrives, user opens it" (the flow in which an empty, undeletable
// "phantom" row used to appear) and checks that the list never shows extra, duplicate or
// empty rows and that opened/deleted messages behave.
//   npm run build
//   LEVUVO_IT_ALLOW_WRITES=1 LEVUVO_IT_IMAP_HOST=… LEVUVO_IT_USER=… LEVUVO_IT_PASSWORD=… \
//     [LEVUVO_IT_SMTP_HOST=… LEVUVO_IT_SMTP_PORT=465] node --test test/e2e/inbox-live.e2e.mjs
// Tested against Dovecot 2.3 (the server Hetzner uses). Test mails are tagged and removed afterwards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ImapFlow } from 'imapflow';
import { createMailServer } from '../../apps/server/src/app.mjs';

const env = process.env;
const enabled = env.LEVUVO_IT_ALLOW_WRITES === '1' && env.LEVUVO_IT_IMAP_HOST && env.LEVUVO_IT_USER;
let playwright = null;
try {
  playwright = await import('playwright');
} catch {
  if (env.LEVUVO_PLAYWRIGHT)
    playwright = await import(pathToFileURL(join(env.LEVUVO_PLAYWRIGHT, 'index.mjs')).href).catch(() => null);
}
const SECRET = 'e3'.repeat(32);
const TAG = `lv-live-${Date.now().toString(36)}`;
const ROUNDS = 4;

function memoryVault() {
  const m = new Map();
  return {
    available: true,
    get: (i, k) => m.get(`${i}:${k}`) || '',
    set: (i, k, v) => m.set(`${i}:${k}`, v),
    delete: (i, k) => m.delete(`${i}:${k}`)
  };
}

/** A second IMAP client, like a phone or the provider's webmail: delivers mail and changes flags. */
function otherClient() {
  return new ImapFlow({
    host: env.LEVUVO_IT_IMAP_HOST,
    port: 993,
    secure: true,
    auth: { user: env.LEVUVO_IT_USER, pass: env.LEVUVO_IT_PASSWORD },
    logger: false
  });
}

const deliver = (client, subject) =>
  client.append(
    'INBOX',
    [
      'From: Live Test <live-test@example.org>',
      `To: ${env.LEVUVO_IT_USER}`,
      `Subject: ${subject}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${subject.replace(/\W+/g, '-')}@levuvo.test>`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      `Body of ${subject}`,
      ''
    ].join('\r\n')
  );

async function cleanup(client) {
  for (const box of await client.list()) {
    if (box.flags?.has('\\Noselect')) continue;
    const lock = await client.getMailboxLock(box.path).catch(() => null);
    if (!lock) continue;
    try {
      const uids = await client.search({ header: { 'message-id': TAG } }, { uid: true }).catch(() => []);
      if (uids?.length) await client.messageDelete(uids, { uid: true }).catch(() => {});
    } finally {
      lock.release();
    }
  }
}

/** Rows as plain text, one string per row. */
const rowTexts = async page =>
  (await page.locator('.message-row').allInnerTexts()).map(r => r.replace(/\s+/g, ' ').trim());

const isEmptyRow = row => /\((Ohne Betreff|No subject)\)|Unbekannt|Unknown/.test(row);

function assertCleanList(rows, label, emptyBefore) {
  const dup = rows.length - new Set(rows).size;
  assert.equal(dup, 0, `${label}: duplicate rows ${JSON.stringify(rows)}`);
  const empty = rows.filter(isEmptyRow).length;
  assert.ok(
    empty <= emptyBefore,
    `${label}: ${empty - emptyBefore} new empty row(s) ${JSON.stringify(rows.slice(0, 6))}`
  );
}

test(
  'live inbox: new mail arrives and is opened, read and deleted without phantom rows',
  { skip: (!enabled && 'LEVUVO_IT_* not set') || (!playwright && 'Playwright missing'), timeout: 300_000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lv-live-'));
    const server = await createMailServer({
      desktop: true,
      sessionSecret: SECRET,
      env: {},
      vault: memoryVault(),
      accountsFile: join(dir, 'accounts.json'),
      background: true
    });
    const { address, port } = await server.listen();
    const origin = new URL(address).origin;
    const other = otherClient();
    await other.connect();
    let browser = null;
    try {
      const created = await server.api.inject({
        method: 'POST',
        url: '/api/accounts/create',
        headers: {
          host: `127.0.0.1:${port}`,
          cookie: `levuvo_desktop_session=${SECRET}`,
          origin,
          'content-type': 'application/json',
          'x-levuvo-action': 'accounts-v1'
        },
        payload: {
          label: 'Live',
          user: env.LEVUVO_IT_USER,
          password: env.LEVUVO_IT_PASSWORD,
          imapHost: env.LEVUVO_IT_IMAP_HOST,
          smtpHost: env.LEVUVO_IT_SMTP_HOST || env.LEVUVO_IT_IMAP_HOST,
          smtpPort: Number(env.LEVUVO_IT_SMTP_PORT || 587),
          displayName: 'Live'
        }
      });
      assert.equal(created.statusCode, 201, created.body);

      browser = await playwright.chromium.launch();
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'de-AT' });
      await context.addCookies([
        {
          name: 'levuvo_desktop_session',
          value: SECRET,
          domain: '127.0.0.1',
          path: '/',
          httpOnly: true,
          sameSite: 'Strict'
        }
      ]);
      const page = await context.newPage();
      const failures = [];
      page.on('response', r => {
        if (r.url().includes('/api/') && r.status() >= 400)
          failures.push(`${r.status()} ${r.request().method()} ${r.url()}`);
      });
      await page.goto(`${origin}/`);
      await page.locator('.message-row').first().waitFor({ timeout: 60_000 });
      const initial = await rowTexts(page);
      const baseline = initial.length;
      const emptyBefore = initial.filter(isEmptyRow).length;

      for (let round = 1; round <= ROUNDS; round++) {
        const subject = `${TAG} round ${round}`;
        await deliver(other, subject);
        const row = page.locator('.message-row', { hasText: subject });
        await row.first().waitFor({ timeout: 30_000 });
        // Open right away, while the app is still refreshing after the arrival.
        await row.first().click();
        await page.locator('.reader-content', { hasText: subject }).first().waitFor({ timeout: 15_000 });
        // Another client changes flags at the same time (phone, webmail).
        if (round % 2 === 0) {
          const lock = await other.getMailboxLock('INBOX');
          try {
            const older = await other.search({ seen: true }, { uid: true });
            if (older?.length) await other.messageFlagsAdd(String(older.at(-1)), ['\\Flagged'], { uid: true });
          } finally {
            lock.release();
          }
        }
        // Several poll and push cycles: the list must stay clean the whole time.
        for (let sample = 0; sample < 16; sample++) {
          await page.waitForTimeout(500);
          const rows = await rowTexts(page);
          assertCleanList(rows, `round ${round}, sample ${sample}`, emptyBefore);
          assert.ok(
            rows.length <= baseline + round,
            `round ${round}: ${rows.length} rows, expected at most ${baseline + round}: ${JSON.stringify(rows.slice(0, 6))}`
          );
        }
        assert.equal(await row.count(), 1, `round ${round}: exactly one row for the new mail`);
        assert.ok(!(await row.first().getAttribute('class')).includes('unread'), `round ${round}: marked read`);
      }

      // Delete the newest test mail; it must disappear for good and without an error.
      const last = `${TAG} round ${ROUNDS}`;
      await page.locator('.message-row', { hasText: last }).first().click();
      await page.locator('.reader-toolbar').getByRole('button', { name: 'In den Papierkorb' }).click();
      await page.locator('.message-row', { hasText: last }).first().waitFor({ state: 'detached', timeout: 10_000 });
      await deliver(other, `${TAG} after delete`);
      await page
        .locator('.message-row', { hasText: `${TAG} after delete` })
        .first()
        .waitFor({ timeout: 30_000 });
      for (let sample = 0; sample < 12; sample++) {
        await page.waitForTimeout(500);
        assertCleanList(await rowTexts(page), `after delete, sample ${sample}`, emptyBefore);
        assert.equal(await page.locator('.message-row', { hasText: last }).count(), 0, 'deleted mail stays gone');
      }
      assert.equal(await page.locator('.error-banner').count(), 0, 'no error shown');
      assert.deepEqual(failures, [], 'no failed API calls');
    } finally {
      await browser?.close().catch(() => {});
      await cleanup(other).catch(() => {});
      await other.logout().catch(() => {});
      await server.close().catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    }
  }
);
