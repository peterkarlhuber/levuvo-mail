/* global document */
// Accessibility check of every main view with axe-core in Chromium (WCAG 2.0/2.1/2.2 A + AA and
// axe best practices), dark and light, desktop and phone, plus keyboard checks for dialogs.
// The built app is served by the real server; /api is answered from test/a11y/fixtures.json
// (fictional mailbox, recorded from a local Dovecot test server).
//   npm run build && npx playwright install chromium && npm run test:a11y
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createMailServer } from '../../apps/server/src/app.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const fixtures = JSON.parse(readFileSync(join(root, 'test/a11y/fixtures.json'), 'utf8'));
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const SECRET = 'a1'.repeat(32);
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

let playwright = null;
try {
  playwright = await import('playwright');
} catch {
  /* not installed */
}
const distReady = (() => {
  try {
    readFileSync(join(root, 'apps/web/dist/index.html'));
    return true;
  } catch {
    return false;
  }
})();

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
  'Accessibility (axe-core, keyboard)',
  { skip: (!playwright && 'playwright missing') || (!distReady && 'run npm run build first'), timeout: 300_000 },
  async t => {
    const dir = mkdtempSync(join(tmpdir(), 'lv-a11y-'));
    const server = await createMailServer({
      desktop: true,
      sessionSecret: SECRET,
      env: {},
      vault: memoryVault(),
      accountsFile: join(dir, 'accounts.json'),
      background: false
    });
    const { address } = await server.listen();
    let browser;
    try {
      browser = await playwright.chromium.launch();
    } catch (e) {
      t.skip(`Chromium not installed (${e.message.split('\n')[0]})`);
      await server.close();
      return;
    }
    t.after(async () => {
      await browser.close();
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    });

    async function open({ setup, ...options } = {}) {
      // bypassCSP only lets the test inject axe; the app itself runs under its normal policy.
      const context = await browser.newContext({
        locale: 'de-AT',
        timezoneId: 'Europe/Vienna',
        bypassCSP: true,
        ...options
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
      await context.route('**/api/**', route => {
        const req = route.request();
        const path = new URL(req.url()).pathname;
        const hit = fixtures[`${req.method()} ${path}`];
        if (hit)
          return route.fulfill({ status: hit.status, contentType: hit.contentType, body: JSON.stringify(hit.body) });
        if (req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        return route.fulfill({ status: 204, body: '' });
      });
      if (setup) await setup(context);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(address);
      await page.locator('.message-row').first().waitFor({ timeout: 20_000 });
      return { page, context, errors };
    }

    async function axe(page, name) {
      await page.addScriptTag({ content: AXE });
      const result = await page.evaluate(
        tags => globalThis.axe.run(document, { runOnly: { type: 'tag', values: tags } }),
        TAGS
      );
      const problems = result.violations.map(
        v =>
          `${name}: ${v.id} (${v.impact}) – ${v.nodes
            .map(n => n.target.join(' '))
            .slice(0, 3)
            .join(' | ')}`
      );
      assert.deepEqual(problems, [], `axe violations in ${name}`);
    }

    const settingsTabs = [
      'Allgemein',
      'Konten',
      'Vorlagen',
      'Filter & Abwesenheit',
      'Kalender & Kontakte',
      'Sicherheit',
      'Suche & Offline',
      'KI & Agenten',
      'Mitteilungen',
      'Datenschutz',
      'Sicherung',
      'Hilfe',
      'Über'
    ];

    for (const colorScheme of ['dark', 'light']) {
      await t.test(`desktop, ${colorScheme}: all views`, async () => {
        const { page, context, errors } = await open({ viewport: { width: 1440, height: 900 }, colorScheme });
        await axe(page, 'mail list');
        await page.locator('.message-row', { hasText: 'Angebot Website-Relaunch' }).locator('.message-item').click();
        await page.locator('.reader-content h2').waitFor();
        await axe(page, 'reader');
        await page.locator('.compose-button').click();
        await page.locator('.compose-panel').waitFor();
        await axe(page, 'composer');
        await page.keyboard.press('Escape');
        await page.locator('.compose-panel').waitFor({ state: 'detached' });
        await page.keyboard.press('?');
        if (await page.locator('.shortcut-modal').count()) {
          await axe(page, 'shortcuts');
          await page.keyboard.press('Escape');
        }
        await page.locator('.rail-item').nth(1).click();
        await page.locator('.calendar-main').waitFor();
        await axe(page, 'calendar');
        await page.locator('.rail-item').nth(2).click();
        await page.locator('.contacts-module').waitFor();
        await axe(page, 'contacts');
        await page.locator('.rail-item').nth(3).click();
        await page.locator('.spaces-module').waitFor();
        await axe(page, 'spaces');
        await page.locator('.rail-item[aria-label="Einstellungen"]').click();
        for (const tab of settingsTabs) {
          await page.locator('.settings-nav button', { hasText: tab }).first().click();
          await page.waitForTimeout(150);
          await axe(page, `settings › ${tab}`);
        }
        assert.deepEqual(errors, []);
        await context.close();
      });
    }

    await t.test('phone (390px): list, reader, composer, no horizontal scrolling at 320px', async () => {
      const { page, context } = await open({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
        colorScheme: 'dark'
      });
      await axe(page, 'phone list');
      await page.locator('.message-row', { hasText: 'Angebot Website-Relaunch' }).locator('.message-item').click();
      await page.locator('.reader-content h2').waitFor();
      await axe(page, 'phone reader');
      await page.locator('.reader-back').click();
      await page.locator('.compose-fab').click();
      await page.locator('.compose-panel').waitFor();
      await axe(page, 'phone composer');
      await page.keyboard.press('Escape');
      await page.locator('.compose-panel').waitFor({ state: 'detached' });
      for (const [index, name] of [
        [1, 'phone calendar'],
        [2, 'phone contacts'],
        [3, 'phone spaces'],
        [4, 'phone settings']
      ]) {
        await page.locator('.rail-item:visible').nth(index).click();
        await page.waitForTimeout(300);
        await axe(page, name);
      }
      await page.locator('.rail-item:visible').first().click();
      await page.setViewportSize({ width: 320, height: 640 });
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(width <= 320, `page scrolls horizontally at 320px (${width}px)`);
      await context.close();
    });

    await t.test('sender screening: row and screener view', async () => {
      const { page, context, errors } = await open({
        viewport: { width: 1440, height: 900 },
        colorScheme: 'dark',
        setup: async context => {
          await context.addInitScript(() => {
            const key = 'levuvo-mail-prefs-v2';
            const prefs = JSON.parse(globalThis.localStorage.getItem(key) || '{}');
            globalThis.localStorage.setItem(key, JSON.stringify({ ...prefs, screening: true }));
          });
          const state = { since: '2026-01-01T00:00:00.000Z', allowed: [], blocked: [] };
          const json = body => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
          await context.route(
            url => url.pathname === '/api/screening',
            route => route.fulfill(json(state))
          );
          await context.route(
            url => url.pathname === '/api/screening/check',
            route => {
              const emails = route.request().postDataJSON()?.emails || [];
              return route.fulfill(json({ unknown: emails.filter(e => e === 'lukas@hofer-it.at') }));
            }
          );
        }
      });
      await page.locator('.screener-rows .bundle-row').waitFor({ timeout: 10_000 });
      await axe(page, 'screener row');
      await page.locator('.screener-rows .bundle-row').click();
      await page.locator('.screener-item').first().waitFor();
      await axe(page, 'screener view');
      assert.deepEqual(errors, []);
      await context.close();
    });

    await t.test('keyboard: dialogs trap focus and return it, segmented controls use arrow keys', async () => {
      const { page, context } = await open({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
      await page.locator('.compose-button').focus();
      await page.keyboard.press('Enter');
      await page.locator('.compose-panel').waitFor();
      for (let i = 0; i < 40; i++) {
        await page.keyboard.press('Tab');
        assert.ok(
          await page.evaluate(() => Boolean(document.activeElement?.closest('.compose-panel'))),
          `focus left the composer after ${i + 1} × Tab`
        );
      }
      await page.keyboard.press('Escape');
      await page.locator('.compose-panel').waitFor({ state: 'detached' });
      assert.equal(await page.evaluate(() => document.activeElement?.className), 'compose-button');
      await page.locator('.rail-item[aria-label="Einstellungen"]').click();
      const group = page.locator('[role="radiogroup"]').nth(1);
      await group.locator('[role="radio"][tabindex="0"]').focus();
      const before = await group.locator('[aria-checked="true"]').textContent();
      await page.keyboard.press('ArrowRight');
      const after = await group.locator('[aria-checked="true"]').textContent();
      assert.notEqual(after, before, 'arrow key changes the selected option');
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-checked')), 'true');
      await context.close();
    });
  }
);
