/* global document */
// The real desktop app (Electron, main process and renderer) with every module opened in turn:
// (reloading after a renderer crash is covered by apps/server/test/desktop-renderer-recovery.test.mjs,
// since Playwright drops a crashed page together with its request routes)
// no module may leave the window empty (the "black window" when opening Tasks, 2.4.0).
// Runs on macOS ARM64, Windows ARM64 and Windows x64 in the desktop build job, and on Linux.
// Mail data comes from test/a11y/fixtures.json; tasks use the real local task store.
//   npm run build && npm run test:desktop-ui      (Linux without a display: xvfb-run -a …)
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const fixtures = JSON.parse(readFileSync(join(root, 'test/a11y/fixtures.json'), 'utf8'));

let playwright = null;
let electronPath = null;
try {
  playwright = await import('playwright');
  electronPath = require('electron');
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
// In CI a missing Electron or build is a failure, not a skip: a green run must mean it ran.
const strict = Boolean(process.env.CI);
const missing =
  (!playwright && 'playwright missing') ||
  (typeof electronPath !== 'string' && 'electron missing') ||
  (!distReady && 'run npm run build first');
if (strict && missing) throw new Error(`Desktop UI test cannot run in CI: ${missing}`);

test(
  'Desktop app: every module opens without blacking out the window',
  { skip: missing, timeout: 360_000 },
  async t => {
    const home = mkdtempSync(join(tmpdir(), 'lv-desktop-'));
    const app = await playwright._electron.launch({
      executablePath: electronPath,
      args: [root, ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : [])],
      cwd: root,
      env: {
        ...process.env,
        // Own profile: never the developer's or runner's real Levuvo data.
        HOME: home,
        ...(process.platform === 'win32' ? { APPDATA: home } : {})
      },
      timeout: 60_000
    });
    const child = app.process();
    t.after(async () => {
      if (process.exitCode || t.signal?.aborted) console.log(log.join('').slice(-4000));
      await Promise.race([app.close().catch(() => {}), new Promise(r => setTimeout(r, 10_000))]);
      child.kill();
      rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    });
    const log = [];
    child.stdout?.on('data', d => log.push(String(d)));
    child.stderr?.on('data', d => log.push(String(d)));

    // Tasks run against the real local store (unless a step below overrides them); the rest of the
    // API is answered from the recorded fixtures so no mail account is needed.
    let tasksOverride = null;
    let staleTasksChunk = false;
    const context = app.context();
    await context.route(/\/assets\/Tasks-[\w-]+\.js$/, route =>
      staleTasksChunk
        ? route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"Datei nicht gefunden."}' })
        : route.continue()
    );
    await context.route('**/api/**', route => {
      const req = route.request();
      const url = new URL(req.url());
      if (url.pathname.startsWith('/api/tasks')) {
        if (tasksOverride && req.method() === 'GET' && url.pathname === '/api/tasks')
          return route.fulfill({ status: 200, contentType: 'application/json', body: tasksOverride });
        return route.continue();
      }
      const hit = fixtures[`${req.method()} ${url.pathname}`];
      if (hit)
        return route.fulfill({ status: hit.status, contentType: hit.contentType, body: JSON.stringify(hit.body) });
      if (req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return route.fulfill({ status: 204, body: '' });
    });

    const step = msg => process.env.LEVUVO_TEST_DEBUG && console.log(`[desktop-ui] ${msg}`);
    step('launched');
    const page = await app.firstWindow();
    step('window');
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const consoleLines = [];
    page.on('console', m => consoleLines.push(`${m.type()}: ${m.text()}`.slice(0, 300)));
    page.on('requestfailed', r => consoleLines.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
    page.on('response', r => r.status() >= 400 && consoleLines.push(`http ${r.status()}: ${r.url()}`));
    // The first load happened before the routes applied: load again with the fixtures.
    await page.waitForLoadState('load').catch(() => {});
    await page.waitForTimeout(2000);
    await page.evaluate(() => globalThis.location.reload()).catch(() => {});
    const rail = page.locator('nav .rail-item');
    step('reloading');
    await page
      .locator('.message-row')
      .first()
      .waitFor({ timeout: 45_000 })
      .catch(async e => {
        step(
          (
            await page
              .locator('body')
              .innerText()
              .catch(() => '')
          ).slice(0, 300)
        );
        throw e;
      });
    step('mail list');

    const railItem = name =>
      rail.filter({ has: page.locator('.rail-label', { hasText: new RegExp(`^(${name})$`) }) }).first();
    const assertShellAlive = async label => {
      assert.ok((await rail.count()) >= 5, `${label}: the rail is gone (window blacked out)`);
      const size = await page.evaluate(() => document.getElementById('root')?.innerHTML.length || 0);
      assert.ok(size > 1000, `${label}: the app root is empty`);
    };

    await t.test('each module renders', async () => {
      const modules = [
        ['Kalender|Calendar', '.calendar-module, .module-host > .empty-module'],
        ['Kontakte|Contacts', '.contacts-module, .module-host > .empty-module'],
        ['Räume|Spaces', '.spaces-module'],
        ['Aufgaben|Tasks', '.tasks-module'],
        ['E-Mail|Email', '.message-row']
      ];
      for (const [name, selector] of modules) {
        await railItem(name).click();
        await page
          .locator(selector)
          .first()
          .waitFor({ timeout: 20_000 })
          .catch(async e => {
            const text = await page
              .locator('body')
              .innerText()
              .catch(() => '');
            const console = consoleLines.slice(-20).join('\n');
            throw new Error(
              `${name}: ${e.message}\nPage: ${text.slice(0, 800)}\nErrors: ${errors.join(' | ')}\nConsole:\n${console}\nMain:\n${log.join('').slice(-2000)}`,
              { cause: e }
            );
          });
        await assertShellAlive(name);
      }
      assert.deepEqual(errors, [], 'no uncaught errors in the renderer');
    });

    await t.test('tasks: creating one and showing it', async () => {
      await railItem('Aufgaben|Tasks').click();
      const quick = page.locator('.task-quick input');
      await quick.fill('Desktop regression task');
      await quick.press('Enter');
      await page.locator('.task-row', { hasText: 'Desktop regression task' }).waitFor({ timeout: 15_000 });
      await assertShellAlive('tasks with an entry');
    });

    await t.test('a failing module stays inside its error panel', async () => {
      await railItem('E-Mail|Email').click();
      // Data the view cannot handle (a render error inside the tasks module).
      tasksOverride = '{"tasks":"not a list"}';
      await railItem('Aufgaben|Tasks').click();
      await page.locator('.module-error[role="alert"]').waitFor({ timeout: 15_000 });
      await assertShellAlive('render error in tasks');
      // The rest of the app keeps working.
      tasksOverride = null;
      await railItem('E-Mail|Email').click();
      await page.locator('.message-row').first().waitFor({ timeout: 15_000 });
      await railItem('Aufgaben|Tasks').click();
      await page.locator('.tasks-module').waitFor({ timeout: 15_000 });
      errors.length = 0;
    });

    await t.test('a stale module chunk (app updated while open) never blacks out the window', async () => {
      // A fresh page that has not loaded the tasks chunk yet, then the chunk disappears.
      await page.evaluate(() => globalThis.location.reload());
      await page.locator('.message-row').first().waitFor({ timeout: 45_000 });
      staleTasksChunk = true;
      await railItem('Aufgaben|Tasks').click();
      // First failure reloads the page once; when the chunk is still missing, the error panel shows.
      await page.locator('.message-row').first().waitFor({ timeout: 45_000 });
      await railItem('Aufgaben|Tasks').click();
      await page.locator('.module-error[role="alert"]').waitFor({ timeout: 20_000 });
      await assertShellAlive('stale chunk');
      staleTasksChunk = false;
      errors.length = 0;
    });
  }
);
