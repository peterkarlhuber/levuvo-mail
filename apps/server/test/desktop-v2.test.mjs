import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyExternalUrl, isPreviewFrameUrl } from '../../desktop/links.mjs';
import { createReminderMonitor } from '../../desktop/reminders.mjs';
import { createTranslator, DESKTOP_TEXTS } from '../../desktop/i18n.mjs';

test('Desktop: Microsoft/Google sign-in pages open without asking, others need confirmation', () => {
  assert.equal(classifyExternalUrl('https://login.microsoftonline.com/common/oauth2/v2.0/authorize?x=1').trusted, true);
  assert.equal(classifyExternalUrl('https://accounts.google.com/o/oauth2/v2/auth').trusted, true);
  assert.equal(classifyExternalUrl('http://accounts.google.com/').trusted, false);
  assert.equal(classifyExternalUrl('https://accounts.google.com.evil.example/').trusted, false);
  assert.deepEqual(classifyExternalUrl('tel:+43 (1) 234-56'), {
    url: 'tel:+43123456',
    kind: 'tel',
    host: '',
    display: '+43123456',
    trusted: false
  });
  assert.equal(classifyExternalUrl('javascript:alert(1)'), null);
});

test('Desktop: only attachment previews of the own origin may load in frames', () => {
  const origin = 'http://127.0.0.1:41234';
  assert.equal(isPreviewFrameUrl(`${origin}/api/messages/12/attachments/0?folder=INBOX&inline=1`, origin), true);
  assert.equal(isPreviewFrameUrl(`${origin}/api/messages/12/attachments/0?folder=INBOX`, origin), false);
  assert.equal(isPreviewFrameUrl(`${origin}/api/messages/12/raw?inline=1`, origin), false);
  assert.equal(isPreviewFrameUrl('https://evil.example/api/messages/1/attachments/0?inline=1', origin), false);
  // blob: previews created by the app page and Chromium's PDF viewer inside them
  assert.equal(isPreviewFrameUrl(`blob:${origin}/5e16aa87-42f5-428b-acba-c69d98b7bb00`, origin), true);
  assert.equal(isPreviewFrameUrl('blob:https://evil.example/5e16aa87', origin), false);
  assert.equal(isPreviewFrameUrl('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html', origin), true);
  assert.equal(isPreviewFrameUrl('chrome-extension://abcdefghijklmnopabcdefghijklmnop/index.html', origin), false);
});

test('Desktop: event reminder is shown exactly once, even with overlapping polls', async () => {
  let now = Date.parse('2026-11-13T08:00:00Z');
  const shown = [];
  const alarm = {
    key: 'a|1|15',
    at: Date.parse('2026-11-13T08:00:30Z'),
    title: 'Jour fixe',
    start: '2026-11-13T08:15:00Z',
    allDay: false,
    location: ''
  };
  const monitor = createReminderMonitor({
    now: () => now,
    readAlarms: async () => ({ alarms: [alarm] }),
    notify: a => shown.push(a.title)
  });
  await monitor.check();
  assert.deepEqual(shown, []); // not due yet
  now += 60_000;
  await monitor.check();
  await monitor.check();
  assert.deepEqual(shown, ['Jour fixe']);
});

test('Desktop: menu and dialog texts complete in German and English', () => {
  assert.deepEqual(Object.keys(DESKTOP_TEXTS.en).sort(), Object.keys(DESKTOP_TEXTS.de).sort());
  assert.equal(createTranslator('de-AT')('quit'), 'Beenden');
  assert.equal(createTranslator('en-US')('quit'), 'Quit');
  assert.equal(createTranslator('fr-FR')('upToDate', '2.0.0'), 'Levuvo Mail 2.0.0 is up to date.');
});
