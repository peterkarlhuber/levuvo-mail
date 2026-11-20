/* global document, window */
// Takes the screenshots for the user manual (docs/manual) from the real, built app.
// Dark theme (the app's default), desktop window 1320 × 860 at 2x, German and English UI.
// /api is answered from test/a11y/fixtures.json (a fictional mailbox) plus demo-data.mjs
// (calendar, contacts, tasks, local models), with the clock fixed to Thursday 19 Nov 2026.
//   npm run build && node scripts/manual/capture-screenshots.mjs [--lang de|en] [--only name]
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createMailServer } from '../../apps/server/src/app.mjs';
import { demoRoutes, NOW, localize, OPEN_SUBJECT, SPACE_NAME } from './demo-data.mjs';
import { createManual } from '../../apps/server/src/manual.mjs';

// Settings → Help shows the manual itself (the images from the last capture).
const manual = createManual();

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const fixtures = JSON.parse(readFileSync(join(root, 'test/a11y/fixtures.json'), 'utf8'));
const SECRET = 'b2'.repeat(32);
const { values: args } = parseArgs({ options: { lang: { type: 'string', multiple: true }, only: { type: 'string' } } });
const languages = args.lang?.length ? args.lang : ['de', 'en'];

let playwright;
try {
  playwright = await import('playwright');
} catch {
  console.error('Playwright is missing: npm ci && npx playwright install chromium');
  process.exit(1);
}
try {
  readFileSync(join(root, 'apps/web/dist/index.html'));
} catch {
  console.error('Run npm run build first.');
  process.exit(1);
}

function memoryVault() {
  const m = new Map();
  return {
    available: true,
    get: (i, k) => m.get(`${i}:${k}`) || '',
    set: (i, k, v) => m.set(`${i}:${k}`, v),
    delete: (i, k) => m.delete(`${i}:${k}`)
  };
}

const L = (lang, de, en) => (lang === 'en' ? en : de);
const settingsTab = async (page, lang, de, en) => {
  await page.locator('.rail-item[aria-label="' + L(lang, 'Einstellungen', 'Settings') + '"]').click();
  await page
    .locator('.settings-nav button', { hasText: L(lang, de, en) })
    .first()
    .click();
  await page.waitForTimeout(250);
};
const openMessage = async (page, lang = 'de') => {
  await page.locator('.message-row', { hasText: OPEN_SUBJECT[lang] }).locator('.message-item').click();
  await page.locator('.reader-content h2').waitFor();
  await page.waitForTimeout(200);
};

// Each shot starts from a fresh window showing the inbox.
const SHOTS = [
  {
    name: 'onboarding',
    routes: { 'GET /api/accounts': { accounts: [] } },
    ready: '.onboarding-panel',
    run: async page => {
      await page.locator('.onboarding-panel').waitFor();
    }
  },
  {
    name: 'mail',
    run: async (page, lang) => {
      await openMessage(page, lang);
    }
  },
  {
    // The cover: the inbox from its first message on, nothing cut at the top of the list.
    name: 'cover',
    run: async (page, lang) => {
      await openMessage(page, lang);
      await page.evaluate(() => {
        for (const el of document.querySelectorAll('.message-list, .message-list-scroll, [data-list-scroll]'))
          el.scrollTop = 0;
      });
      await page.mouse.move(700, 120);
      await page.waitForTimeout(200);
    }
  },
  {
    name: 'composer',
    run: async (page, lang) => {
      await openMessage(page, lang);
      await page
        .locator('.reader-toolbar button', { hasText: L(lang, 'Antworten', 'Reply') })
        .first()
        .click();
      await page.locator('.compose-panel').waitFor();
      await page.locator('.compose-panel [contenteditable="true"]').first().click();
      await page.keyboard.press('Control+Home');
      await page.keyboard.type(
        L(
          lang,
          'Hallo Anna,\ndanke für das Angebot. Montag, 23.11. um 10:00 passt gut.\nViele Grüße\nAlex\n',
          'Hi Anna,\nthanks for the quote. Monday 23 Nov at 10:00 works well.\nBest regards\nAlex\n'
        )
      );
      await page.waitForTimeout(400);
    }
  },
  {
    name: 'palette',
    // Only the middle of the window, so the palette stays readable on the page.
    clip: { x: 330, y: 80, width: 660, height: 196 },
    run: async (page, lang) => {
      await openMessage(page, lang);
      await page.keyboard.press('Control+k');
      await page.locator('.command-palette, [role="dialog"]').first().waitFor();
      await page.keyboard.type(L(lang, 'entw', 'dra'));
      await page.waitForTimeout(200);
    }
  },
  {
    name: 'screening',
    prefs: { screening: true },
    run: async page => {
      await page.locator('.screener-rows .bundle-row').waitFor({ timeout: 10_000 });
      await page.locator('.screener-rows .bundle-row').click();
      await page.locator('.screener-item').first().waitFor();
    }
  },
  {
    name: 'calendar',
    run: async page => {
      await page.locator('.rail-item').nth(1).click();
      await page.locator('.calendar-main').waitFor();
      await page.locator('.calendar-main :is(.event, .cal-event, [class*="event"])').first().waitFor();
    }
  },
  {
    name: 'contacts',
    run: async page => {
      await page.locator('.rail-item').nth(2).click();
      await page.locator('.contacts-module').waitFor();
      await page.locator('.contact-row', { hasText: 'Anna Berger' }).click();
      await page.waitForTimeout(300);
    }
  },
  {
    name: 'tasks',
    run: async (page, lang) => {
      await page.locator('.rail-item').nth(4).click();
      await page.locator('.tasks-module').waitFor();
      await page.locator('.tasks-sidebar .folder-item', { hasText: L(lang, 'Alle offenen', 'All open') }).click();
      await page.locator('.task-row').first().waitFor();
    }
  },
  {
    // "My day" as it opens on the first start of the day (task due today, not overdue).
    name: 'my-day',
    prefs: { briefingOnStart: true },
    routes: {
      'GET /api/briefing': (() => {
        const body = structuredClone(fixtures['GET /api/briefing'].body);
        for (const task of body.tasks || []) task.overdue = false;
        return body;
      })()
    },
    ready: '.briefing',
    run: async page => {
      await page.locator('.briefing').waitFor();
      await page.waitForTimeout(300);
    }
  },
  {
    name: 'spaces',
    run: async (page, lang) => {
      await page.locator('.rail-item').nth(3).click();
      await page.locator('.spaces-module').waitFor();
      await page.locator('.space-row', { hasText: SPACE_NAME[lang] }).click();
      await page.locator('.space-tabs').waitFor();
      await page.waitForTimeout(300);
    }
  },
  {
    name: 'assistant',
    ai: true,
    run: async (page, lang) => {
      await page.locator('.rail-item[aria-label="' + L(lang, 'Assistent', 'Assistant') + '"]').click();
      await page.locator('.assistant-panel').waitFor();
      await page.waitForTimeout(400);
    }
  },
  {
    name: 'reader-assist',
    ai: true,
    run: async (page, lang) => {
      await openMessage(page, lang);
      await page.waitForTimeout(400);
    }
  },
  {
    name: 'settings-general',
    run: (page, lang) => settingsTab(page, lang, 'Allgemein', 'General')
  },
  {
    name: 'settings-accounts',
    run: (page, lang) => settingsTab(page, lang, 'Konten', 'Accounts')
  },
  {
    name: 'settings-ai',
    ai: true,
    run: async (page, lang) => {
      await settingsTab(page, lang, 'KI & Agenten', 'AI & agents');
      await page.locator('.local-model-status progress').first().waitFor();
    }
  },
  {
    name: 'settings-security',
    run: (page, lang) => settingsTab(page, lang, 'Sicherheit', 'Security')
  },
  {
    name: 'settings-backup',
    run: (page, lang) => settingsTab(page, lang, 'Sicherung', 'Backup')
  },
  {
    name: 'settings-help',
    run: (page, lang) => settingsTab(page, lang, 'Hilfe', 'Help')
  }
];

const dir = mkdtempSync(join(tmpdir(), 'lv-manual-'));
const server = await createMailServer({
  desktop: true,
  sessionSecret: SECRET,
  env: {},
  vault: memoryVault(),
  accountsFile: join(dir, 'accounts.json'),
  background: false
});
const { address } = await server.listen();
const browser = await playwright.chromium.launch();
let failed = 0;

try {
  for (const lang of languages) {
    const outDir = join(root, 'docs/manual/img', lang);
    mkdirSync(outDir, { recursive: true });
    for (const shot of SHOTS) {
      if (args.only && args.only !== shot.name) continue;
      const context = await browser.newContext({
        viewport: { width: 1320, height: 860 },
        deviceScaleFactor: 2,
        colorScheme: 'dark',
        locale: lang === 'en' ? 'en-GB' : 'de-AT',
        timezoneId: 'Europe/Vienna',
        // The desktop app's own window frame (traffic lights in the rail, see window-frame.ts).
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/537.36 (KHTML, like Gecko) ' +
          'Chrome/140.0.0.0 Electron/39.0.0 Safari/537.36'
      });
      await context.clock.install({ time: NOW });
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
      // "My day" and the meeting card would open over every shot; the my-day shot opens it itself.
      const prefs = {
        theme: 'dark',
        language: lang,
        calendarView: 'week',
        briefingOnStart: false,
        meetingPrep: 0,
        ...(shot.prefs || {})
      };
      await context.addInitScript(p => {
        window.localStorage.setItem('levuvo-mail-prefs-v2', JSON.stringify(p));
        // Draw the macOS traffic lights the system puts into the window.
        window.addEventListener('DOMContentLoaded', () => {
          const s = document.createElement('style');
          s.textContent =
            '.lv-traffic{position:fixed;top:14px;left:14px;display:flex;gap:8px;z-index:99999;pointer-events:none}' +
            '.lv-traffic i{width:12px;height:12px;border-radius:50%;display:block}' +
            '*{caret-color:transparent!important}';
          document.head.append(s);
          const t = document.createElement('div');
          t.className = 'lv-traffic';
          t.innerHTML =
            '<i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i>';
          document.body.append(t);
        });
      }, prefs);
      const routes = demoRoutes({ lang, ai: Boolean(shot.ai), extra: shot.routes || {} });
      await context.route('**/api/**', route => {
        const req = route.request();
        const key = `${req.method()} ${new URL(req.url()).pathname}`;
        if (key === 'GET /api/manual') {
          const chapters = manual
            .chapters(lang)
            .map(({ id, number, title, markdown }) => ({ id, number, title, markdown }));
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ lang, chapters })
          });
        }
        const img = /^GET \/api\/manual\/img\/(\w+)\/([^/]+)$/.exec(key);
        if (img && manual.imagePath(img[1], img[2]))
          return route.fulfill({
            status: 200,
            contentType: 'image/png',
            body: readFileSync(manual.imagePath(img[1], img[2]))
          });
        const own = typeof routes[key] === 'function' ? routes[key](req) : routes[key];
        if (own !== undefined)
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(localize(own, lang))
          });
        const hit = fixtures[key];
        if (hit)
          return route.fulfill({
            status: hit.status,
            contentType: hit.contentType,
            body: JSON.stringify(localize(hit.body, lang))
          });
        if (req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        return route.fulfill({ status: 204, body: '' });
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      try {
        await page.goto(address);
        await page
          .locator(shot.ready || '.message-row')
          .first()
          .waitFor({ timeout: 20_000 });
        await shot.run(page, lang);
        await page.mouse.move(1319, 859);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(300);
        await page.screenshot({ path: join(outDir, `${shot.name}.png`), animations: 'disabled', clip: shot.clip });
        if (errors.length) throw new Error(errors.join('; '));
        console.log(`✓ ${lang}/${shot.name}`);
      } catch (e) {
        failed++;
        console.error(`✗ ${lang}/${shot.name}: ${e.message.split('\n')[0]}`);
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
  rmSync(dir, { recursive: true, force: true });
}
if (failed) process.exitCode = 1;
