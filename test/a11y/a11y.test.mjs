/* global document, HTMLElement */
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

// In CI a missing browser or build is a failure, not a skip: a green run must mean the checks ran.
const strict = Boolean(process.env.CI);
const missing = (!playwright && 'playwright missing') || (!distReady && 'run npm run build first');
if (strict && missing) throw new Error(`Accessibility test cannot run in CI: ${missing}`);

test('Accessibility (axe-core, keyboard)', { skip: missing, timeout: 300_000 }, async t => {
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
    await server.close();
    if (strict) throw new Error(`Chromium did not start in CI: ${e.message.split('\n')[0]}`, { cause: e });
    t.skip(`Chromium not installed (${e.message.split('\n')[0]})`);
    return;
  }
  t.after(async () => {
    await browser.close();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function open({ setup, briefing = false, ...options } = {}) {
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
    // "Mein Tag" opens by itself on the first start of a day; only its own test wants it.
    await context.addInitScript(show => {
      try {
        const key = 'levuvo-mail-prefs-v2';
        const prefs = JSON.parse(globalThis.localStorage.getItem(key) || '{}');
        globalThis.localStorage.setItem(key, JSON.stringify({ ...prefs, briefingOnStart: show }));
        if (!show) globalThis.localStorage.removeItem('levuvo-mail-briefing-day');
      } catch {
        /* documents without storage (about:blank) */
      }
    }, briefing);
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
      // A space with members, a note, tasks, an event and a file (QA-LEV-009).
      await page.locator('.space-row', { hasText: 'Projekt Relaunch' }).click();
      await page.locator('.space-tabs').waitFor();
      await axe(page, 'space overview');
      for (const tab of ['Notizen', 'Aufgaben', 'Termine', 'Dateien', 'Mitglieder']) {
        await page.getByRole('tab', { name: tab }).click();
        await page.waitForTimeout(150);
        await axe(page, `space › ${tab}`);
      }
      // Tabs: arrow keys move the selection and the focus (UX-LEV-013).
      await page.getByRole('tab', { name: 'Dateien' }).focus();
      await page.keyboard.press('ArrowRight');
      assert.equal(
        await page.evaluate(() => document.activeElement?.getAttribute('aria-selected')),
        'true',
        'arrow key selects the next tab'
      );
      await page.locator('.rail-item').nth(4).click();
      await page.locator('.tasks-module').waitFor();
      await axe(page, 'tasks');
      await page.locator('.tasks-sidebar .folder-item', { hasText: 'Alle offenen' }).click();
      await page.locator('.task-row').first().waitFor();
      await axe(page, 'tasks with entries');
      await page.locator('.tasks-sidebar .btn.primary').click();
      await page.locator('.task-dialog').waitFor();
      assert.ok(await page.locator('.task-dialog').evaluate(d => d.contains(document.activeElement)));
      await axe(page, 'task dialog');
      await page.keyboard.press('Escape');
      await page.locator('.task-dialog').waitFor({ state: 'detached' });
      // Typed input is not thrown away by Escape: a discard question comes first, starting on "Abbrechen"
      // (UX-LEV-007/008).
      await page.locator('.tasks-sidebar .btn.primary').click();
      await page.locator('.task-dialog').waitFor();
      await page.keyboard.type('Entwurf');
      await page.keyboard.press('Escape');
      await page.locator('.confirm-card[role="alertdialog"]').last().waitFor();
      assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Abbrechen');
      await axe(page, 'discard question');
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('.task-dialog input').first().inputValue(), 'Entwurf');
      await page.keyboard.press('Escape');
      await page.locator('.confirm-card .btn.primary.danger').click();
      await page.locator('.task-dialog').waitFor({ state: 'detached' });
      await page.locator('.task-list-actions button', { hasText: 'Liste verbinden' }).click();
      await page.locator('.ui-dialog').waitFor();
      await page.locator('.ui-dialog .empty-list').waitFor({ state: 'detached' });
      await axe(page, 'connect task list');
      await page.keyboard.press('Escape');
      await page.locator('.ui-dialog').waitFor({ state: 'detached' });
      await page.locator('.rail-item[aria-label="Assistent"]').click();
      await page.locator('.assistant-panel').waitFor();
      await axe(page, 'assistant');
      // UX-LEV-011: the drawer keeps the focus, Escape closes it and focus returns to the rail button.
      assert.ok(await page.evaluate(() => !!document.activeElement?.closest('.assistant-panel')));
      await page.keyboard.press('Escape');
      await page.locator('.assistant-panel').waitFor({ state: 'detached' });
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Assistent');
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
      [4, 'phone tasks'],
      [6, 'phone settings']
    ]) {
      await page.locator('.rail-item:visible').nth(index).click();
      // Modules load lazily: check the view itself, not the loading placeholder in between.
      await page.locator('main:visible').first().waitFor();
      await page.locator('main:visible h1, h1:visible').first().waitFor({ state: 'attached' });
      await page.waitForTimeout(300);
      await axe(page, name);
    }
    await page.locator('.rail-item:visible').first().click();
    await page.setViewportSize({ width: 320, height: 640 });
    // Tasks keep their views and "Neue Aufgabe" on a phone (UX-LEV-001).
    await page.locator('.rail-item:visible').nth(4).click();
    await page.locator('.tasks-sidebar .btn.primary').waitFor({ state: 'visible' });
    await page.locator('.tasks-sidebar .folder-item', { hasText: 'Alle offenen' }).waitFor({ state: 'visible' });
    await page.locator('.rail-item:visible').first().click();
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(width <= 320, `page scrolls horizontally at 320px (${width}px)`);
    await context.close();
  });

  await t.test('own Ollama: model list, download progress and downloaded models', async () => {
    const { MODEL_CATALOG, fitFor } = await import('../../apps/server/src/ai-model-catalog.mjs');
    const json = body => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    const ram = 16 * 1024 ** 3;
    for (const colorScheme of ['dark', 'light']) {
      const { page, context, errors } = await open({
        viewport: { width: 1440, height: 900 },
        colorScheme,
        setup: async context => {
          const status = structuredClone(fixtures['GET /api/ai/status'].body);
          Object.assign(status.settings, { enabled: true, localRuntime: 'bundled', embedModel: 'bge-m3' });
          await context.route(
            url => url.pathname === '/api/ai/status',
            route => route.fulfill(json(status))
          );
          await context.route(
            url => url.pathname === '/api/ai/local-models',
            route =>
              route.fulfill(
                json({
                  reachable: true,
                  ram,
                  recommendedTier: 'standard',
                  freeBytes: 120e9,
                  runtime: { version: '0.40.16', running: true },
                  selected: { model: 'qwen3.5:9b', embedModel: 'bge-m3', provider: 'ollama' },
                  index: [{ accountId: 'acc', messages: 1200, vectors: 300, running: true }],
                  models: MODEL_CATALOG.map(m => ({
                    ...m,
                    default: Boolean(m.default),
                    fit: fitFor(m, ram),
                    installed: m.id === 'bge-m3' || m.id === 'ministral-3:3b',
                    mismatch: false,
                    job:
                      m.id === 'qwen3.5:9b'
                        ? { status: 'downloading', completed: 2.1e9, total: m.size, error: null }
                        : m.id === 'gemma4:12b'
                          ? { status: 'canceled', completed: 1e9, total: m.size, error: null }
                          : null
                  }))
                })
              )
          );
        }
      });
      await page.locator('.rail-item[aria-label="Einstellungen"]').click();
      await page.locator('.settings-nav button', { hasText: 'KI & Agenten' }).first().click();
      await page.locator('.local-model-status progress').first().waitFor();
      await axe(page, `own Ollama settings (${colorScheme})`);
      assert.deepEqual(errors, []);
      await context.close();
    }
  });

  for (const colorScheme of ['dark', 'light'])
    await t.test(`Mein Tag (morning briefing), ${colorScheme}`, async () => {
      const { page, context, errors } = await open({
        viewport: { width: 1440, height: 900 },
        colorScheme,
        briefing: true
      });
      await page.locator('.briefing .briefing-item').first().waitFor({ timeout: 10_000 });
      await axe(page, `briefing ${colorScheme}`);
      // Opening an entry closes the overview and goes there.
      await page.locator('.briefing-item', { hasText: 'Angebot Website-Relaunch' }).click();
      await page.locator('.briefing').waitFor({ state: 'detached' });
      await page.locator('.reader-content h2').waitFor();
      assert.deepEqual(errors, []);
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

  await t.test('large mailbox: 20,000 rows stay windowed, keyboard reaches every row', async () => {
    const COUNT = 20_000;
    const template = fixtures['GET /api/messages'].body.messages[0];
    const messages = Array.from({ length: COUNT }, (_, i) => ({
      ...template,
      uid: COUNT - i,
      seq: COUNT - i,
      subject: `Massentest ${i + 1}`,
      messageId: `<bulk-${i}@levuvo.test>`,
      inReplyTo: null,
      date: new Date(Date.UTC(2026, 10, 18) - i * 60_000).toISOString()
    }));
    const body = { ...fixtures['GET /api/messages'].body, total: COUNT, messages, hasMore: false, nextBeforeUid: null };
    const monitor = { ...fixtures['GET /api/inbox/monitor'].body, ...body, highestUid: COUNT };
    const { page, context, errors } = await open({
      viewport: { width: 1440, height: 900 },
      colorScheme: 'dark',
      setup: async context => {
        const json = b => ({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
        await context.route(
          url => url.pathname === '/api/messages',
          route => route.fulfill(json(body))
        );
        await context.route(
          url => url.pathname === '/api/inbox/monitor',
          route => route.fulfill(json(monitor))
        );
        await context.route(
          url => /^\/api\/messages\/\d+$/.test(url.pathname),
          route => {
            const uid = Number(new URL(route.request().url()).pathname.split('/').pop());
            const m = messages[COUNT - uid];
            return route.fulfill(json({ ...fixtures['GET /api/messages/1'].body, uid, subject: m.subject }));
          }
        );
      }
    });
    await page.locator('.message-row', { hasText: 'Massentest 1' }).first().waitFor({ timeout: 30_000 });
    const rendered = () => page.locator('.message-row').count();
    assert.ok((await rendered()) < 80, `only the visible rows are in the DOM (${await rendered()})`);
    await axe(page, 'large list');
    const active = () =>
      page.evaluate(() => {
        const row = document.activeElement?.closest('[role="listitem"]');
        return row ? { pos: row.getAttribute('aria-posinset'), size: row.getAttribute('aria-setsize') } : null;
      });
    await page.locator('.message-row', { hasText: 'Massentest 1' }).first().locator('.message-item').focus();
    const started = Date.now();
    await page.keyboard.press('End');
    assert.deepEqual(await active(), { pos: String(COUNT), size: String(COUNT) }, 'End focuses the last row');
    await page.keyboard.press('ArrowUp');
    assert.equal((await active())?.pos, String(COUNT - 1));
    await page.keyboard.press('Home');
    assert.equal((await active())?.pos, '1');
    await page.keyboard.press('PageDown');
    assert.ok(Number((await active())?.pos) > 2, 'PageDown moves by a page');
    assert.ok(Date.now() - started < 5_000, `keyboard navigation is fast (${Date.now() - started} ms)`);
    // Scrolling far down renders the rows there and still keeps the DOM small.
    await page.locator('.message-list').evaluate(el => {
      el.scrollTop = el.scrollHeight / 2;
    });
    await page.waitForFunction(() => document.querySelector('.message-row[aria-posinset="10000"]') !== null, null, {
      timeout: 5_000
    });
    assert.ok((await rendered()) < 100, `DOM stays small after scrolling (${await rendered()})`);
    // j selects the next message; the selected row stays visible.
    await page.locator('.message-row', { hasText: 'Massentest 10000' }).first().locator('.message-item').click();
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.keyboard.press('j');
    await page.locator('.message-row.selected', { hasText: 'Massentest 10001' }).waitFor();
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

  // Regression test for the mail view (list, search, reader): pins the behaviour while
  // MailInstance is split into modules (ARC-LEV-005). Requests are recorded, the server is mocked.
  await t.test('mail view: list, filters, search, reader and bulk actions', async () => {
    const inbox = fixtures['GET /api/messages'].body;
    const accountId = fixtures['GET /api/status'].body.accountId;
    const byUid = uid => inbox.messages.find(m => m.uid === uid);
    const requests = [];
    const json = b => ({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    const { page, context, errors } = await open({
      viewport: { width: 1440, height: 900 },
      colorScheme: 'dark',
      setup: async context => {
        await context.route(
          url => url.pathname.startsWith('/api/'),
          route => {
            const req = route.request();
            const url = new URL(req.url());
            const body = req.method() === 'POST' ? req.postDataJSON() : null;
            requests.push({ method: req.method(), path: url.pathname, query: url.search, body });
            if (url.pathname === '/api/search') {
              const q = url.searchParams.get('q').toLowerCase();
              const hits = inbox.messages.filter(m => m.subject.toLowerCase().includes(q));
              return route.fulfill(json({ ...inbox, total: hits.length, messages: hits }));
            }
            if (url.pathname === '/api/search/local') {
              const first = !url.searchParams.get('cursor');
              const hit = {
                ...byUid(first ? 8 : 4),
                accountId: 'other-account',
                accountLabel: 'Büro',
                folder: 'INBOX'
              };
              return route.fulfill(json({ messages: [hit], total: 2, nextCursor: first ? 'page-2' : null }));
            }
            const detail = url.pathname.match(/^\/api\/messages\/(\d+)$/);
            if (detail) {
              const m = byUid(Number(detail[1]));
              return route.fulfill(
                json({
                  ...fixtures['GET /api/messages/1'].body,
                  uid: m.uid,
                  subject: m.subject,
                  unread: m.unread,
                  attachments: []
                })
              );
            }
            if (url.pathname === '/api/followups')
              return route.fulfill(
                json({
                  items: [
                    {
                      id: 'f1',
                      accountId,
                      messageId: '<sent-1@levuvo.test>',
                      subject: 'Angebot für den Relaunch',
                      to: ['anna.berger@beispiel.at'],
                      due: '2026-11-20T08:00:00.000Z',
                      state: 'due',
                      createdAt: '2026-11-12T08:00:00.000Z'
                    }
                  ]
                })
              );
            if (url.pathname === '/api/messages/batch-action')
              return route.fulfill(json({ destination: 'Trash', count: body.uids.length }));
            if (/^\/api\/messages\/\d+\/action$/.test(url.pathname)) return route.fulfill(json({ ok: true }));
            return route.fallback();
          }
        );
      }
    });
    const count = () => page.locator('.list-count').textContent();
    const rows = () => page.locator('.message-row').count();
    const row = subject => page.locator('.message-row', { hasText: subject }).first();
    const selected = () => page.locator('.message-row.selected .message-subject').textContent();
    const blur = () =>
      page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    const until = async (fn, what) => {
      for (let i = 0; i < 50 && !(await fn()); i++) await page.waitForTimeout(100);
      assert.ok(await fn(), what);
    };

    // List: title, count with unread folder counter, filter chips.
    assert.equal((await page.locator('.message-title-row h1').textContent()).trim(), 'Posteingang.');
    assert.equal(await count(), '12 Nachrichten · 11 ungelesen');
    assert.equal(await rows(), 12);
    await page.locator('.filter-chips button', { hasText: 'Anhang' }).click();
    assert.equal(await rows(), 1);
    assert.equal(await count(), '1 von 12 geladenen');
    await page.locator('.filter-chips button', { hasText: 'Ungelesen' }).click();
    assert.equal(await rows(), 11);
    assert.equal(await page.locator('.filter-chips button[aria-pressed="true"]').textContent(), 'Ungelesen');
    await page.locator('.filter-chips button', { hasText: 'Alle' }).click();
    assert.equal(await rows(), 12);

    // Reader: opening a message loads the detail and marks it read after a short delay.
    await row('Protokoll Workshop').locator('.message-item').click();
    await page.locator('.reader-column.reader-open .reader-content h2', { hasText: 'Protokoll Workshop' }).waitFor();
    await until(
      () => requests.some(r => r.path === '/api/messages/10/action' && r.body?.action === 'markRead'),
      'opened message is marked read'
    );
    await until(async () => !(await row('Protokoll Workshop').getAttribute('class')).includes('unread'), 'row read');
    assert.equal(await count(), '12 Nachrichten · 10 ungelesen');
    // j/k move the selection, Escape closes the reader.
    await blur();
    await page.keyboard.press('j');
    await until(async () => (await selected()).includes('Moodboard'), 'j selects the next message');
    await page.locator('.reader-content h2', { hasText: 'Moodboard' }).waitFor();
    await page.keyboard.press('k');
    await until(async () => (await selected()).includes('Protokoll Workshop'), 'k selects the previous message');
    await page.locator('.reader-content h2', { hasText: 'Protokoll Workshop' }).waitFor();
    // r answers, f forwards the open message (composer prefilled from the detail).
    await page.keyboard.press('r');
    await page.locator('.compose-panel').waitFor();
    assert.equal(
      await page.locator('.compose-panel').getByLabel('Betreff', { exact: true }).inputValue(),
      'Re: Protokoll Workshop 12.11.'
    );
    await page.keyboard.press('Escape');
    await page.locator('.compose-panel').waitFor({ state: 'detached' });
    await blur();
    await page.keyboard.press('f');
    await page.locator('.compose-panel').waitFor();
    assert.equal(
      await page.locator('.compose-panel').getByLabel('Betreff', { exact: true }).inputValue(),
      'Fwd: Protokoll Workshop 12.11.'
    );
    assert.ok((await page.locator('.compose-panel').textContent()).includes('Weitergeleitete Nachricht'));
    await page.keyboard.press('Escape');
    await page.locator('.compose-panel').waitFor({ state: 'detached' });
    await blur();
    await page.keyboard.press('Escape');
    await page.locator('.reader-column.reader-open').waitFor({ state: 'detached' });
    assert.ok((await selected()).includes('Protokoll Workshop'), 'Escape keeps the selection');

    // Bulk actions: select all, count, then trash two messages; the list drops them.
    await page.locator('.select-all input').check();
    assert.equal(await page.locator('.bulk-toolbar span').first().textContent(), '12 ausgewählt');
    await page.locator('.bulk-toolbar button[aria-label="Auswahl aufheben"]').click();
    assert.equal(await page.locator('.bulk-toolbar').count(), 0);
    await row('Mittagessen').locator('.message-select input').check();
    await row('Ihre Rechnung').locator('.message-select input').check();
    assert.equal(await page.locator('.bulk-toolbar span').first().textContent(), '2 ausgewählt');
    await page.locator('.bulk-toolbar button[aria-label="In den Papierkorb"]').click();
    await until(async () => (await rows()) === 10, 'trashed messages leave the list');
    const trash = requests.find(r => r.path === '/api/messages/batch-action');
    assert.deepEqual(trash.body, { folder: 'INBOX', action: 'trash', uids: [7, 8] });
    await page.locator('.toast', { hasText: '2 Nachrichten nach „Papierkorb“ verschoben.' }).waitFor();

    // Trashing the open message selects the next one.
    await row('Protokoll Workshop').locator('.message-item').click();
    await blur();
    await page.keyboard.press('#');
    await until(async () => (await rows()) === 9, 'open message trashed');
    assert.ok((await selected()).includes('Moodboard'), 'next message is selected after removal');

    // Search in this folder: debounced server search, hit count, clearing restores the folder.
    const searches = () => requests.filter(r => r.path === '/api/search');
    await page.locator('.searchbox input').fill('Server');
    await until(async () => (await count()) === '2 Treffer', 'search shows hit count');
    assert.equal(searches().length, 1, 'one request after the typing pause');
    assert.equal(searches()[0].query, `?folder=INBOX&q=Server&limit=40&account=${encodeURIComponent(accountId)}`);
    assert.equal(await rows(), 2);
    const loadsBefore = requests.filter(r => r.path === '/api/messages').length;
    await page.locator('.searchbox button[aria-label="Suche löschen"]').click();
    await until(async () => (await rows()) === 12, 'clearing the search reloads the folder');
    assert.equal(requests.filter(r => r.path === '/api/messages').length, loadsBefore + 1);
    assert.equal(await page.locator('.searchbox input').inputValue(), '');
    // One character only filters the loaded list locally.
    await page.locator('.searchbox input').fill('M');
    await page.waitForTimeout(500);
    assert.equal(searches().length, 1, 'no server search below two characters');
    assert.ok((await rows()) < 12);
    await page.locator('.searchbox input').fill('');

    // Search everywhere (local index): own title, no filters, paging with the cursor.
    await page.locator('.scope-toggle').click();
    assert.equal(await page.locator('.scope-toggle').getAttribute('aria-pressed'), 'true');
    await page.locator('.searchbox input').fill('Rechnung');
    await page.locator('.message-title-row h1', { hasText: 'Suche in allen Ordnern' }).waitFor();
    await until(async () => (await count()) === '2 Treffer', 'everywhere search shows the total');
    assert.equal(await page.locator('.filter-chips').count(), 0);
    assert.equal(await page.locator('.select-all').count(), 0);
    const local = () => requests.filter(r => r.path === '/api/search/local');
    assert.equal(local()[0].query, '?q=Rechnung&limit=40');
    await until(async () => (await rows()) === 2, 'the next page loads through the cursor');
    assert.equal(local()[1].query, '?q=Rechnung&limit=40&cursor=page-2');
    await page.locator('.searchbox button[aria-label="Suche löschen"]').click();
    assert.equal(await page.locator('.scope-toggle').getAttribute('aria-pressed'), 'false');
    await page.locator('.message-title-row h1', { hasText: 'Posteingang' }).waitFor();
    await until(async () => (await rows()) === 12, 'folder list is back');
    await axe(page, 'mail view after search');

    // Switching folders resets search and selection; the filter chip stays.
    await page.locator('.filter-chips button', { hasText: 'Markiert' }).click();
    await page.locator('.folder-item', { hasText: 'Gesendet' }).first().click();
    await page.locator('.message-title-row h1', { hasText: 'Gesendet' }).waitFor();
    assert.equal(await page.locator('.filter-chips button[aria-pressed="true"]').textContent(), 'Markiert');
    assert.equal(await page.locator('.searchbox input').inputValue(), '');
    assert.equal(await page.locator('.message-row.selected').count(), 0);
    assert.ok(requests.some(r => r.path === '/api/messages' && r.query.startsWith('?folder=Sent&')));

    // Follow-ups: "show in Sent" opens the sent folder and searches the subject there.
    await page.locator('.folder-item', { hasText: 'Nachfassen' }).first().click();
    await page.locator('.followup-row').waitFor();
    await page.locator('.followup-row button[aria-label="In „Gesendet“ zeigen"]').click();
    await page.locator('.message-title-row h1', { hasText: 'Gesendet' }).waitFor();
    await until(
      () => requests.some(r => r.path === '/api/search' && r.query.startsWith('?folder=Sent&q=Angebot')),
      'the subject is searched in the sent folder'
    );
    assert.equal(await page.locator('.searchbox input').inputValue(), 'Angebot für den Relaunch');
    assert.deepEqual(errors, []);
    await context.close();
  });
});
