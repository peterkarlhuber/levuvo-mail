// Browser end-to-end test of the complete UI against REAL servers (opt-in).
// Needs the same environment as apps/server/test/integration/full.test.mjs plus Playwright:
//   npm run build && npx playwright install chromium
//   LEVUVO_IT_ALLOW_WRITES=1 … node --test test/e2e/ui.e2e.mjs
// Screenshots are written to test/e2e/screenshots/ (git-ignored).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createMailServer } from '../../apps/server/src/app.mjs';

const env = process.env;
const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const shots = join(root, 'test/e2e/screenshots');
const enabled = env.LEVUVO_IT_ALLOW_WRITES === '1' && env.LEVUVO_IT_USER2 && env.LEVUVO_IT_DAV_URL;
let playwright = null;
try {
  playwright = await import('playwright');
} catch {
  // Globally installed Playwright: LEVUVO_PLAYWRIGHT=$(npm root -g)/playwright
  if (env.LEVUVO_PLAYWRIGHT)
    playwright = await import(pathToFileURL(join(env.LEVUVO_PLAYWRIGHT, 'index.mjs')).href).catch(() => null);
}
const SECRET = 'e2'.repeat(32);
const stamp = Date.now().toString(36);
// 1×1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
  'base64'
);

function memoryVault() {
  const m = new Map();
  return {
    available: true,
    get: (i, k) => m.get(`${i}:${k}`) || '',
    set: (i, k, v) => m.set(`${i}:${k}`, v),
    delete: (i, k) => m.delete(`${i}:${k}`)
  };
}

test(
  'UI end-to-end (browser, real servers)',
  { skip: (!enabled && 'LEVUVO_IT_* not set') || (!playwright && 'Playwright missing'), timeout: 600_000 },
  async t => {
    mkdirSync(shots, { recursive: true });
    const dir = mkdtempSync(join(tmpdir(), 'lv-e2e-'));
    const server = await createMailServer({
      desktop: true,
      sessionSecret: SECRET,
      env: {},
      vault: memoryVault(),
      accountsFile: join(dir, 'accounts.json'),
      background: false
    });
    const { address, port } = await server.listen();
    const origin = new URL(address).origin;
    const H = {
      host: `127.0.0.1:${port}`,
      cookie: `levuvo_desktop_session=${SECRET}`,
      origin,
      'content-type': 'application/json'
    };
    const call = async (method, url, payload, action) => {
      const r = await server.api.inject({
        method,
        url,
        headers:
          payload === undefined
            ? { host: H.host, cookie: H.cookie }
            : { ...H, ...(action ? { 'x-levuvo-action': action } : {}) },
        payload
      });
      try {
        return { status: r.statusCode, body: r.json() };
      } catch {
        return { status: r.statusCode, body: r.body };
      }
    };
    const account = (user, password, label) => ({
      label,
      user,
      password,
      imapHost: env.LEVUVO_IT_IMAP_HOST,
      smtpHost: env.LEVUVO_IT_SMTP_HOST || env.LEVUVO_IT_IMAP_HOST,
      smtpPort: Number(env.LEVUVO_IT_SMTP_PORT || 587),
      displayName: label
    });
    const peter = (
      await call(
        'POST',
        '/api/accounts/create',
        account(env.LEVUVO_IT_USER, env.LEVUVO_IT_PASSWORD, 'Peter'),
        'accounts-v1'
      )
    ).body.account;
    const anna = (
      await call(
        'POST',
        '/api/accounts/create',
        account(env.LEVUVO_IT_USER2, env.LEVUVO_IT_PASSWORD2, 'Anna'),
        'accounts-v1'
      )
    ).body.account;
    assert.ok(peter?.id && anna?.id, 'Konten angelegt');
    for (const [u, p, l] of [
      [env.LEVUVO_IT_DAV_USER, env.LEVUVO_IT_DAV_PASSWORD, 'DAV Peter'],
      [env.LEVUVO_IT_DAV_USER2, env.LEVUVO_IT_DAV_PASSWORD2, 'DAV Anna']
    ]) {
      const r = await call(
        'POST',
        '/api/dav/accounts/create',
        { serverUrl: env.LEVUVO_IT_DAV_URL, username: u, password: p, label: l },
        'accounts-v1'
      );
      assert.equal(r.status, 201, JSON.stringify(r.body));
    }
    const sendAs = (acc, payload) =>
      call(
        'POST',
        `/api/messages/send?account=${acc}`,
        { requestId: crypto.randomUUID(), confirm: 'SEND', cc: [], bcc: [], attachments: [], ...payload },
        'send-v1'
      );

    const browser = await playwright.chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'de-AT',
      timezoneId: 'Europe/Vienna',
      colorScheme: 'dark'
    });
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
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => {
      if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text());
    });
    t.after(async () => {
      await browser.close();
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    });
    const only = env.E2E_ONLY ? new RegExp(env.E2E_ONLY) : null;
    const step = (name, fn) => t.test(name, { skip: only && !only.test(name) ? 'E2E_ONLY' : false }, fn);
    const shot = name => page.screenshot({ path: join(shots, `${name}.png`) });
    const toast = text => {
      const loc = page.locator('.toast', { hasText: text }).first();
      return {
        getByRole: (...a) => loc.getByRole(...a),
        waitFor: async (o = {}) => {
          try {
            await loc.waitFor({ timeout: 30_000, ...o });
          } catch (err) {
            const all = await page
              .locator('.toast, .compose-error, .error-banner, .modal-error')
              .allInnerTexts()
              .catch(() => []);
            await shot(`fail-${Date.now()}`).catch(() => {});
            throw new Error(`${err.message.split('\n')[0]} · sichtbare Meldungen: ${JSON.stringify(all)}`, {
              cause: err
            });
          }
        }
      };
    };
    const closeComposer = async () => {
      // Esc closes the composer (also while typing in the editor).
      await page.locator('.compose-editor').first().click();
      await page.keyboard.press('Escape');
      const discard = page.locator('.confirm-card').getByRole('button', { name: 'Verwerfen' });
      await discard.click({ timeout: 2000 }).catch(() => {});
      await page
        .locator('.compose-panel')
        .waitFor({ state: 'detached', timeout: 10_000 })
        .catch(async err => {
          await shot('fail-close');
          throw err;
        });
    };
    const switchAccount = async id => {
      await page.locator('.account-picker select').selectOption(id);
      await page.waitForTimeout(400);
    };
    const openFolder = name => page.locator('.folder-item', { hasText: name }).first().click();
    const openMessage = async subject => {
      const row = page.locator('.message-row', { hasText: subject }).first();
      for (let i = 0; i < 20 && !(await row.isVisible()); i++) {
        await page.locator('[aria-label="Aktualisieren"]').first().click();
        await page.waitForTimeout(800);
      }
      await row.locator('.message-item').click();
      await page.locator('.reader-content h2', { hasText: subject }).waitFor();
    };

    await page.goto(`${origin}/`);
    await page.locator('.rail').waitFor();
    await page.locator('.message-title-row h1', { hasText: 'Posteingang' }).waitFor();

    await step('Compose with formatting, undo, send, receive with HTML', async () => {
      await page.getByRole('button', { name: 'Neue Nachricht' }).click();
      await page.locator('.compose-panel').getByLabel('An', { exact: true }).fill(env.LEVUVO_IT_USER2);
      await page.locator('.compose-row', { hasText: 'Betreff' }).locator('input').fill(`UI-Test ${stamp}`);
      const editor = page.locator('.compose-editor').first();
      await editor.click();
      await page.keyboard.type('Hallo Anna, ');
      await page.getByRole('button', { name: 'Fett' }).click();
      await page.keyboard.type('wichtig');
      await page.getByRole('button', { name: 'Fett' }).click();
      await page.keyboard.type(' ist das.');
      await shot('01-composer');
      await page.locator('.compose-controls .btn.primary', { hasText: 'Senden' }).click();
      await toast('Wird in').waitFor();
      await toast('Wird in').getByRole('button', { name: 'Rückgängig' }).click();
      await page.locator('.compose-panel').waitFor();
      assert.match(await page.locator('.compose-editor').first().innerHTML(), /<strong>wichtig<\/strong>/);
      await page.locator('.compose-controls .btn.primary', { hasText: 'Senden' }).click();
      await toast('Nachricht gesendet').waitFor({ timeout: 30_000 });
      await switchAccount(anna.id);
      await openMessage(`UI-Test ${stamp}`);
      const frame = page.frameLocator('.html-mail-frame');
      await frame.locator('strong', { hasText: 'wichtig' }).waitFor();
      await shot('02-reader');
    });

    await step('Reply quotes the message and uses the signature', async () => {
      await call(
        'POST',
        '/api/accounts/update',
        { id: anna.id, signatureHtml: '<p><strong>Anna Test</strong><br>Levuvo</p>' },
        'accounts-v1'
      );
      await page.reload();
      await switchAccount(anna.id);
      await openMessage(`UI-Test ${stamp}`);
      await page.getByRole('button', { name: 'Antworten', exact: false }).first().click();
      const html = await page.locator('.compose-editor').first().innerHTML();
      assert.match(html, /<blockquote>/);
      assert.match(html, /Anna Test/);
      assert.equal(
        await page.locator('.compose-row', { hasText: 'Betreff' }).locator('input').inputValue(),
        `Re: UI-Test ${stamp}`
      );
      await closeComposer();
    });

    await step('Flag, filter, create a folder and move via drag & drop', async () => {
      await openMessage(`UI-Test ${stamp}`);
      await page.locator('.reader-secondary-actions').getByRole('button', { name: 'Markieren', exact: true }).click();
      await page.locator('.filter-chips button', { hasText: 'Markiert' }).click();
      await page.locator('.message-row.flagged', { hasText: `UI-Test ${stamp}` }).waitFor();
      await page.locator('.filter-chips button', { hasText: 'Alle' }).click();
      await page.getByRole('button', { name: 'Neuer Ordner' }).click();
      await page.locator('.dialog-field input').fill(`E2E ${stamp}`);
      await page.locator('.confirm-card button[type=submit]').click();
      await toast('Ordner angelegt').waitFor();
      const target = page.locator('.folder-row', { hasText: `E2E ${stamp}` });
      await page
        .locator('.message-row', { hasText: `UI-Test ${stamp}` })
        .first()
        .dragTo(target);
      await toast('verschoben').waitFor({ timeout: 15_000 });
      await target.locator('.folder-item').click();
      await page.locator('.message-row', { hasText: `UI-Test ${stamp}` }).waitFor();
      await shot('03-folder');
    });

    await step('Phishing warning and attachment preview', async () => {
      const sent = await sendAs(peter.id, {
        to: [env.LEVUVO_IT_USER2],
        subject: `Konto gesperrt ${stamp}`,
        html: '<p>Bitte sofort bestätigen: <a href="https://evil.example/login">https://www.meinebank.at/login</a></p>',
        attachments: [{ name: 'bild.png', contentBase64: PNG.toString('base64') }]
      });
      assert.equal(sent.body.sent, true);
      await openFolder('Posteingang');
      await openMessage(`Konto gesperrt ${stamp}`);
      await page.locator('.security-banner.danger').waitFor();
      assert.match(await page.locator('.security-banner').innerText(), /evil\.example/);
      await page
        .locator('.attachment-item', { hasText: 'bild.png' })
        .waitFor()
        .catch(async e => {
          await shot('fail-attachments');
          console.log(await page.locator('.reader-content').innerText());
          throw e;
        });
      await page.getByRole('button', { name: 'Vorschau: bild.png' }).click();
      await page.locator('.preview-body img').waitFor();
      assert.ok(await page.locator('.preview-body img').evaluate(img => img.naturalWidth === 1));
      await shot('04-phishing-preview');
      await page.keyboard.press('Escape');
    });

    await step('Send later stores the message as scheduled in Drafts', async () => {
      await page.getByRole('button', { name: 'Neue Nachricht' }).click();
      await page.locator('.compose-panel').getByLabel('An', { exact: true }).fill(env.LEVUVO_IT_USER);
      await page.locator('.compose-row', { hasText: 'Betreff' }).locator('input').fill(`Geplant ${stamp}`);
      await page.locator('.compose-editor').first().click();
      await page.keyboard.type('Kommt später.');
      await page.getByRole('button', { name: 'Später senden' }).click();
      await page.getByRole('menuitem', { name: /Morgen früh/ }).click();
      await toast('Geplant für').waitFor({ timeout: 20_000 });
      const scheduled = await call('GET', `/api/scheduled?account=${anna.id}`);
      assert.ok(scheduled.body.items.some(i => i.subject === `Geplant ${stamp}`));
      await openFolder('Entwürfe');
      await openMessage(`Geplant ${stamp}`);
      await page.locator('.reader-security.scheduled').waitFor();
    });

    await step('Calendar: event with invitation, reply from the email', async () => {
      await switchAccount(peter.id);
      await page.getByRole('button', { name: 'Kalender' }).first().click();
      await page.locator('.calendar-toolbar').waitFor();
      await page.locator('.calendar-toolbar').getByRole('radio', { name: 'Woche' }).click();
      await page.getByRole('button', { name: 'Neuer Termin' }).click();
      await page.locator('.event-editor').getByLabel('Titel', { exact: true }).fill(`Planung ${stamp}`);
      await page.locator('.event-editor select').first().selectOption({ index: 0 });
      await page.locator('.event-editor').getByLabel('Teilnehmende (E-Mail-Adressen)').fill(env.LEVUVO_IT_USER2);
      await page.locator('.event-editor').getByLabel('Ort', { exact: true }).fill('Besprechungsraum 1');
      await page.locator('.event-editor button[type=submit]').click();
      await toast('Einladungen gesendet: 1').waitFor({ timeout: 30_000 });
      await page.locator('.event-block', { hasText: `Planung ${stamp}` }).waitFor();
      await shot('05-calendar-week');
      await page.locator('.calendar-toolbar').getByRole('radio', { name: 'Monat' }).click();
      // Month view: today's cell lists the event (or “+n more” when earlier test runs left events).
      await page.locator('.month-cell.today').locator('.event-chip, .more-chip').first().waitFor();
      await page.getByRole('button', { name: 'E-Mail' }).first().click();
      await switchAccount(anna.id);
      await openFolder('Posteingang');
      await openMessage(`Einladung: Planung ${stamp}`);
      await page.locator('.invitation-card').waitFor();
      const calSelect = page.locator('.invitation-actions select');
      await calSelect.selectOption({ label: /DAV Anna/ }).catch(async () => {
        const options = await calSelect.locator('option').allInnerTexts();
        await calSelect.selectOption({
          index: Math.max(
            0,
            options.findIndex(o => o.includes('DAV Anna'))
          )
        });
      });
      await page.locator('.invitation-actions').getByRole('button', { name: 'Zusagen' }).click();
      await toast('Antwort an den Organisator gesendet').waitFor({ timeout: 30_000 });
      await shot('06-invitation');
      await switchAccount(peter.id);
      await openMessage(`Zugesagt: Planung ${stamp}`);
      await page.locator('.invitation-actions').getByRole('button', { name: 'Im Kalender übernehmen' }).click();
      await toast('Kalender aktualisiert').waitFor({ timeout: 20_000 });
    });

    await step('Kontakte: anlegen, suchen, E-Mail schreiben', async () => {
      await page.getByRole('button', { name: 'Kontakte' }).first().click();
      await page.getByRole('button', { name: 'Neuer Kontakt' }).click();
      await page.locator('.contact-form').getByLabel('Vorname').fill('Erika');
      await page.locator('.contact-form').getByLabel('Nachname').fill(`Muster${stamp}`);
      await page.locator('.entry-row input[type=email]').fill('erika@example.at');
      await page.locator('.contact-form button[type=submit]').click();
      await toast('Kontakt gespeichert').waitFor({ timeout: 20_000 });
      await page.getByLabel('Kontakte durchsuchen').fill(`Muster${stamp}`);
      await page.locator('.contact-row', { hasText: `Erika Muster${stamp}` }).click();
      await shot('07-contacts');
      await page.getByRole('button', { name: 'E-Mail schreiben' }).click();
      await page.locator('.compose-panel').waitFor();
      assert.equal(
        await page.locator('.compose-panel').getByLabel('An', { exact: true }).inputValue(),
        'erika@example.at'
      );
      await closeComposer();
    });

    await step('OpenPGP: generate a key, send encrypted to yourself and read', async () => {
      await page.getByRole('button', { name: 'Einstellungen' }).last().click();
      await page.locator('.settings-nav button', { hasText: 'Sicherheit' }).click();
      await page.getByRole('button', { name: 'Schlüssel erzeugen' }).click();
      const prompt = async value => {
        await page.locator('.dialog-field input').fill(value);
        await page.locator('.confirm-card button[type=submit]').click();
      };
      if (
        await page
          .locator('.dialog-field input[type=text]')
          .isVisible()
          .catch(() => false)
      )
        await prompt(env.LEVUVO_IT_USER);
      await prompt('geheim-e2e-123');
      await prompt('geheim-e2e-123');
      await toast('Schlüssel erzeugt').waitFor({ timeout: 30_000 });
      await page
        .locator('.key-row', { hasText: env.LEVUVO_IT_USER })
        .first()
        .getByRole('button', { name: 'Entsperren' })
        .click();
      await prompt('geheim-e2e-123');
      await toast('Entsperrt').waitFor();
      await page.getByRole('button', { name: 'E-Mail' }).first().click();
      await switchAccount(peter.id);
      await page.getByRole('button', { name: 'Neue Nachricht' }).click();
      await page.locator('.compose-panel').getByLabel('An', { exact: true }).fill(env.LEVUVO_IT_USER);
      await page.locator('.compose-row', { hasText: 'Betreff' }).locator('input').fill(`Vertraulich ${stamp}`);
      await page.locator('.compose-editor').first().click();
      await page.keyboard.type('Streng geheim.');
      await page.locator('.compose-panel').getByLabel('Ende-zu-Ende-Schutz').selectOption('pgp');
      await page.locator('.security-options label', { hasText: 'Verschlüsseln' }).locator('input').check();
      await page.waitForTimeout(800);
      assert.equal(await page.locator('.compose-warning').count(), 0, 'no missing key');
      await page.locator('.compose-controls .btn.primary', { hasText: 'Senden' }).click();
      await toast('Nachricht gesendet').waitFor({ timeout: 30_000 });
      await openMessage(`Vertraulich ${stamp}`);
      await page.locator('.crypto-badge', { hasText: 'OpenPGP verschlüsselt' }).waitFor();
      await page.locator('.crypto-badge', { hasText: 'Signiert von' }).waitFor();
      await page.locator('.html-mail-frame, .plain-mail-text').first().waitFor();
      const body = (await page.locator('.plain-mail-text').count())
        ? await page.locator('.plain-mail-text').innerText()
        : await page.frameLocator('.html-mail-frame').locator('body').innerText();
      assert.match(body, /Streng geheim/);
      await shot('08-pgp');
    });

    await step('Filters & vacation reply are saved on the server', async () => {
      await page.getByRole('button', { name: 'Einstellungen' }).last().click();
      await page.locator('.settings-nav button', { hasText: 'Filter & Abwesenheit' }).click();
      await page
        .locator('.settings-inline select')
        .selectOption(peter.id)
        .catch(() => {});
      await page.locator('label.toggle', { hasText: 'Abwesenheitsnotiz aktiv' }).locator('input').check();
      await page.locator('textarea').first().fill('Bin auf Urlaub.');
      await page.getByRole('button', { name: 'Regel hinzufügen' }).click();
      await page.locator('.rule-card').last().getByLabel('Wert').fill(`newsletter-${stamp}@`);
      await page.locator('.rule-card').last().getByLabel('Aktion', { exact: true }).selectOption('markRead');
      await page.getByRole('button', { name: 'Auf dem Server speichern' }).click();
      await toast('auf dem Mailserver aktiv').waitFor({ timeout: 20_000 });
      const sieve = await call('GET', `/api/sieve?account=${peter.id}`);
      assert.equal(sieve.body.config.vacation.enabled, true);
      assert.ok(
        sieve.body.config.rules.some(
          r => r.conditions[0].value === `newsletter-${stamp}@` && r.actions[0].type === 'markRead'
        )
      );
      await shot('09-filters');
    });

    await step('2.1: Conversation, quick action with undo, snooze', async () => {
      await sendAs(anna.id, { to: [env.LEVUVO_IT_USER], subject: `Faden UI ${stamp}`, text: 'Erste Frage?' });
      let first = null;
      for (let i = 0; i < 30 && !first; i++) {
        const r = await call(
          'GET',
          `/api/search?account=${peter.id}&folder=INBOX&q=${encodeURIComponent(`Faden UI ${stamp}`)}`
        );
        first = r.body.messages?.find(m => m.subject === `Faden UI ${stamp}`);
        if (!first) await new Promise(r => setTimeout(r, 500));
      }
      assert.ok(first?.messageId, 'first message arrived');
      await sendAs(peter.id, {
        to: [env.LEVUVO_IT_USER2],
        subject: `Re: Faden UI ${stamp}`,
        text: 'Antwort von Peter.',
        inReplyTo: first.messageId,
        references: first.messageId
      });
      await sendAs(anna.id, {
        to: [env.LEVUVO_IT_USER],
        subject: `Re: Faden UI ${stamp}`,
        text: 'Danke, passt!',
        inReplyTo: first.messageId,
        references: first.messageId
      });
      await page.getByRole('button', { name: 'E-Mail' }).first().click();
      await switchAccount(peter.id);
      await openFolder('Posteingang');
      const replyRow = page.locator('.message-row', { hasText: `Re: Faden UI ${stamp}` }).first();
      for (let i = 0; i < 20 && !(await replyRow.isVisible()); i++) {
        await page.locator('[aria-label="Aktualisieren"]').first().click();
        await page.waitForTimeout(800);
      }
      await replyRow.locator('.message-item').click();
      await page.locator('.thread-panel').waitFor();
      assert.ok((await page.locator('.thread-panel li').count()) >= 3, 'Frage, eigene Antwort, Antwort');
      await page.locator('.thread-panel li.sent .thread-row').first().click();
      await page.locator('.thread-body', { hasText: 'Antwort von Peter.' }).waitFor();
      await shot('13-conversation');

      // Quick action on the row, then undo from the toast.
      const row = page.locator('.message-row', { hasText: `Faden UI ${stamp}` }).last();
      await row.hover();
      await row.locator('.row-actions').getByRole('button', { name: 'In den Papierkorb' }).click();
      await toast('verschoben').getByRole('button', { name: 'Rückgängig' }).click();
      await toast('Rückgängig gemacht').waitFor();
      await page
        .locator('.message-row', { hasText: `Faden UI ${stamp}` })
        .last()
        .waitFor();

      // Snooze from the reader, bring back from the "Zurückgestellt" folder.
      await openMessage(`Re: Faden UI ${stamp}`);
      await page.locator('[data-snooze]').click();
      await page.getByRole('menuitem', { name: /Morgen früh/ }).click();
      await toast('Zurückgestellt bis').waitFor();
      await openFolder('Zurückgestellt');
      await openMessage(`Re: Faden UI ${stamp}`);
      await page.locator('.reader-security.scheduled', { hasText: 'Zurückgestellt bis' }).waitFor();
      await shot('14-snoozed');
      await page.getByRole('button', { name: 'Jetzt zurückholen' }).click();
      await toast('Zurück im Posteingang').waitFor();
      await openFolder('Posteingang');
      await page
        .locator('.message-row.unread', { hasText: `Re: Faden UI ${stamp}` })
        .first()
        .waitFor();
    });

    await step('2.1: Follow-up, templates and command palette', async () => {
      await page.getByRole('button', { name: 'Neue Nachricht' }).click();
      await page.locator('.compose-panel').getByLabel('An', { exact: true }).fill('niemand@levuvo.test');
      await page.locator('.compose-row', { hasText: 'Betreff' }).locator('input').fill(`Angebot ${stamp}`);
      await page.locator('.compose-editor').first().click();
      await page.keyboard.type('Hallo, anbei das Angebot.');
      // Save as template, insert it again later.
      await page.getByRole('button', { name: 'Vorlagen' }).click();
      await page.getByRole('menuitem', { name: 'Aktuelle Nachricht als Vorlage speichern' }).click();
      await page.locator('.dialog-field input').fill(`Angebot-Vorlage ${stamp}`);
      await page.locator('.confirm-card button[type=submit]').click();
      await toast('gespeichert').waitFor();
      await page.getByLabel('Nachfassen').selectOption('3');
      await shot('15-composer-followup');
      await page.locator('.compose-controls .btn.primary', { hasText: 'Senden' }).click();
      await toast('Nachricht gesendet').waitFor({ timeout: 30_000 });
      await page.locator('.folder-item', { hasText: 'Nachfassen' }).click();
      await page.locator('.followup-row', { hasText: `Angebot ${stamp}` }).waitFor();
      await shot('16-followups');

      await page.getByRole('button', { name: 'Neue Nachricht' }).click();
      await page.getByRole('button', { name: 'Vorlagen' }).click();
      await page.getByRole('menuitem', { name: new RegExp(`Angebot-Vorlage ${stamp}`) }).click();
      assert.match(await page.locator('.compose-editor').first().innerText(), /anbei das Angebot/);
      assert.equal(
        await page.locator('.compose-row', { hasText: 'Betreff' }).locator('input').inputValue(),
        `Angebot ${stamp}`
      );
      await closeComposer();

      // Command palette: jump to a folder by typing.
      await page.keyboard.press('Control+k');
      await page.locator('.palette').waitFor();
      await page.keyboard.type('entwür');
      await shot('17-palette');
      await page.keyboard.press('Enter');
      await page.locator('.message-title-row h1', { hasText: 'Entwürfe' }).waitFor();
      await page.keyboard.press('Control+k');
      await page.keyboard.type('kalender');
      await page.keyboard.press('Enter');
      await page
        .locator('.calendar-toolbar')
        .waitFor({ timeout: 15_000 })
        .catch(async err => {
          await shot('fail-palette');
          throw err;
        });
      await page.locator('.mini-month').waitFor();
      await page.keyboard.press('Control+k');
      await page.keyboard.type('posteingang');
      await page.keyboard.press('Enter');
      await page.locator('.message-title-row h1', { hasText: 'Posteingang' }).waitFor();
    });

    await step('2.1: Newsletter abmelden (List-Unsubscribe per E-Mail)', async () => {
      const { ImapFlow } = await import('imapflow');
      const nodemailer = (await import('nodemailer')).default;
      const built = await nodemailer.createTransport({ streamTransport: true, buffer: true }).sendMail({
        from: 'Rundbrief <news@levuvo.test>',
        to: env.LEVUVO_IT_USER,
        subject: `Rundbrief ${stamp}`,
        html: '<p>Neuigkeiten</p>',
        headers: { 'List-Unsubscribe': `<mailto:${env.LEVUVO_IT_USER2}?subject=unsubscribe-${stamp}>` }
      });
      const imap = new ImapFlow({
        host: env.LEVUVO_IT_IMAP_HOST,
        port: 993,
        secure: true,
        auth: { user: env.LEVUVO_IT_USER, pass: env.LEVUVO_IT_PASSWORD },
        logger: false
      });
      await imap.connect();
      await imap.append('INBOX', built.message, []);
      await imap.logout();
      await openMessage(`Rundbrief ${stamp}`);
      await page.locator('.unsubscribe-bar').waitFor();
      await page.locator('.unsubscribe-bar').getByRole('button', { name: 'Abmelden' }).click();
      await page.locator('.confirm-card').getByRole('button', { name: 'Abmelden' }).click();
      await toast('Abgemeldet').waitFor({ timeout: 30_000 });
      await shot('18-unsubscribed');
      let mail = null;
      for (let i = 0; i < 30 && !mail; i++) {
        const r = await call(
          'GET',
          `/api/search?account=${anna.id}&folder=INBOX&q=${encodeURIComponent(`unsubscribe-${stamp}`)}`
        );
        mail = r.body.messages?.find(m => m.subject === `unsubscribe-${stamp}`);
        if (!mail) await new Promise(r => setTimeout(r, 500));
      }
      assert.ok(mail, 'unsubscribe email arrived at the sender');
    });

    await step('2.1.1: Calendar on this device, move an event via drag & drop', async () => {
      await page.getByRole('button', { name: 'Kalender' }).first().click();
      await page.locator('.calendar-toolbar').waitFor();
      await page.locator('.calendar-toolbar').getByRole('radio', { name: 'Woche' }).click();
      await page.getByRole('button', { name: 'Heute' }).click();
      await page.getByRole('button', { name: 'Neuer Termin' }).click();
      await page.locator('.event-editor').getByLabel('Titel', { exact: true }).fill(`Fokus ${stamp}`);
      const select = page.locator('.event-editor select').first();
      const options = await select.locator('option').allInnerTexts();
      const localIndex = options.findIndex(o => o.includes('Auf diesem Gerät'));
      assert.ok(localIndex >= 0, `device calendar selectable: ${options.join(' | ')}`);
      await select.selectOption({ index: localIndex });
      await page.locator('.event-editor button[type=submit]').click();
      await toast('Termin gespeichert').waitFor();
      const block = page.locator('.event-block', { hasText: `Fokus ${stamp}` }).first();
      await block.waitFor();
      const heads = await page
        .locator('.time-grid-head .day-head')
        .evaluateAll(els => els.map(e => e.classList.contains('today')));
      const today = heads.indexOf(true);
      const targetIndex = today === heads.length - 1 ? today - 1 : today + 1;
      const target = page.locator('.time-grid .day-column').nth(targetIndex);
      const box = await block.boundingBox();
      const col = await target.boundingBox();
      await block.dragTo(target, { targetPosition: { x: col.width / 2, y: box.y - col.y + 5 } });
      await toast('verschoben').waitFor({ timeout: 15_000 });
      await page
        .locator('.time-grid .day-column')
        .nth(targetIndex)
        .locator('.event-block', { hasText: `Fokus ${stamp}` })
        .waitFor();
      await page.locator('.mini-month').waitFor();
      await shot('19-local-calendar');
      const events = (
        await call(
          'GET',
          `/api/calendar/events?from=${new Date(Date.now() - 8 * 864e5).toISOString()}&to=${new Date(Date.now() + 8 * 864e5).toISOString()}`
        )
      ).body.events.filter(e => e.summary === `Fokus ${stamp}`);
      assert.equal(events.length, 1);
      assert.equal(events[0].accountId, 'local');
      await call('POST', '/api/calendar/events/delete', { accountId: 'local', url: events[0].url }, 'calendar-v1');
    });

    await step('2.2: Password-protected message – send, open in the app and in the browser', async () => {
      await page.getByRole('button', { name: 'E-Mail' }).first().click();
      await switchAccount(peter.id);
      await page.getByRole('button', { name: 'Neue Nachricht' }).click();
      await page.locator('.compose-panel').getByLabel('An', { exact: true }).fill(env.LEVUVO_IT_USER2);
      await page.locator('.compose-row', { hasText: 'Betreff' }).locator('input').fill(`Geschützt ${stamp}`);
      await page.locator('.compose-editor').first().click();
      await page.keyboard.type('Das WLAN-Passwort lautet Gartenzwerg-77.');
      await page.getByLabel('Ende-zu-Ende-Schutz').selectOption('password');
      const pwInput = page.locator('.password-panel .password-input input');
      const password = 'Wolke-Fenster-Kaffee-42';
      await pwInput.fill(password);
      await page.locator('.password-panel').getByLabel('Hinweis zum Passwort (optional)').fill('wie am Telefon');
      await shot('20-protected-compose');
      await page.locator('.compose-controls .btn.primary', { hasText: 'Senden' }).click();
      await toast('Nachricht gesendet').waitFor({ timeout: 30_000 });

      // Recipient using Levuvo Mail: unlock in the reader.
      await switchAccount(anna.id);
      await openFolder('Posteingang');
      await openMessage(`Geschützt ${stamp}`);
      const card = page.locator('.protected-card');
      await card.waitFor();
      assert.match(await card.innerText(), /wie am Telefon/);
      await card.getByLabel('Passwort').fill('falsch-falsch-falsch');
      await card.getByRole('button', { name: 'Öffnen' }).click();
      await card.locator('.modal-error', { hasText: 'Das Passwort ist falsch' }).waitFor();
      await card.getByLabel('Passwort').fill(password);
      await card.getByRole('button', { name: 'Öffnen' }).click();
      await page.frameLocator('.protected-frame').locator('text=Gartenzwerg-77').waitFor();
      await shot('21-protected-open');

      // Recipient without Levuvo: the attached HTML file opens in any browser.
      const list = (
        await call('GET', `/api/search?account=${anna.id}&folder=INBOX&q=${encodeURIComponent(`Geschützt ${stamp}`)}`)
      ).body.messages;
      const detail = (await call('GET', `/api/messages/${list[0].uid}?folder=INBOX&account=${anna.id}`)).body;
      const file = detail.attachments.find(a => a.filename === 'Geschuetzte-Nachricht.html');
      const html = (
        await server.api.inject({
          method: 'GET',
          url: `/api/messages/${list[0].uid}/attachments/${file.index}?folder=INBOX&account=${anna.id}`,
          headers: { host: H.host, cookie: H.cookie }
        })
      ).body;
      const path = join(dir, 'Geschuetzte-Nachricht.html');
      writeFileSync(path, html);
      const viewer = await context.newPage();
      await viewer.goto(pathToFileURL(path).href);
      await viewer.locator('#pw').fill('noch-immer-falsch');
      await viewer.locator('#go').click();
      await viewer.locator('#err', { hasText: 'falsch' }).waitFor();
      await viewer.locator('#pw').fill(password);
      await viewer.locator('#go').click();
      await viewer.frameLocator('#body').locator('text=Gartenzwerg-77').waitFor({ timeout: 20_000 });
      assert.equal(await viewer.locator('#subject').innerText(), `Geschützt ${stamp}`);
      await viewer.screenshot({ path: join(shots, '22-protected-browser.png') });
      await viewer.close();
    });

    await step('Search "Everywhere" via the local index', async () => {
      await server.ctx.runIndexer(true);
      await page.getByRole('button', { name: 'E-Mail' }).first().click();
      await page.locator('.scope-toggle').click();
      await page.locator('.searchbox input').fill(`Konto gesperrt ${stamp}`);
      await page
        .locator('.message-row', { hasText: `Konto gesperrt ${stamp}` })
        .first()
        .waitFor({ timeout: 15_000 });
      await page.locator('.scope-toggle').click();
      await page.getByLabel('Suche löschen').click();
    });

    await step('English and light theme', async () => {
      await page.getByRole('button', { name: 'Einstellungen' }).last().click();
      await page.locator('.settings-nav button', { hasText: 'Allgemein' }).click();
      await page.getByRole('radio', { name: 'English' }).click();
      await page.getByRole('radio', { name: 'Light' }).click();
      assert.equal(await page.evaluate(() => globalThis.document.documentElement.dataset.theme), 'light');
      await page.locator('.settings-head h1', { hasText: 'General' }).waitFor();
      await shot('10-settings-light-en');
      await page.getByRole('button', { name: 'Email' }).first().click();
      await page.locator('.message-title-row h1', { hasText: 'Inbox' }).waitFor();
      await shot('11-mail-light-en');
      await page.getByRole('button', { name: 'Calendar' }).first().click();
      await page.locator('.calendar-toolbar').waitFor();
      await shot('12-calendar-light-en');
      await page.getByRole('button', { name: 'Settings' }).last().click();
      await page.getByRole('radio', { name: 'Deutsch' }).click();
      await page.getByRole('radio', { name: 'Dunkel' }).click();
    });

    writeFileSync(join(shots, 'errors.json'), JSON.stringify(errors, null, 2));
    assert.deepEqual(errors, [], 'no JavaScript errors in the UI');
  }
);
