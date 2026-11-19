import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MAC_TITLEBAR_HEIGHT,
  WIN_TITLEBAR_HEIGHT,
  themeFromColor,
  titleBarOverlay,
  windowFrameOptions
} from '../../desktop/window-frame.mjs';

test('Window frame: macOS keeps the traffic lights in the rail, Windows overlays its buttons', () => {
  const mac = windowFrameOptions('darwin', true);
  assert.equal(mac.titleBarStyle, 'hidden');
  assert.ok(mac.trafficLightPosition.x + 52 <= 72, 'traffic lights fit into the 72 px rail');
  assert.ok(mac.trafficLightPosition.x >= 14, 'traffic lights keep a clear left margin');
  assert.equal(mac.trafficLightPosition.y + 6, MAC_TITLEBAR_HEIGHT / 2, 'traffic lights are centred in the strip');
  const win = windowFrameOptions('win32', false);
  assert.equal(win.titleBarStyle, 'hidden');
  assert.deepEqual(win.titleBarOverlay, { color: '#ffffff', symbolColor: '#141414', height: WIN_TITLEBAR_HEIGHT });
  assert.deepEqual(windowFrameOptions('linux', true), {}, 'Linux keeps the system frame');
});

test('Window frame: window buttons follow the page theme colour', () => {
  assert.equal(themeFromColor('#0b0b0b'), 'dark');
  assert.equal(themeFromColor('#ffffff'), 'light');
  assert.equal(themeFromColor(null, false), 'light');
  assert.equal(titleBarOverlay('dark').color, '#0b0b0b');
});

test('Window frame: sizes match the web design tokens', () => {
  const tokens = readFileSync(new URL('../../web/src/styles/tokens.css', import.meta.url), 'utf8');
  assert.match(tokens, new RegExp(`--titlebar-h-mac: ${MAC_TITLEBAR_HEIGHT}px;`));
  assert.match(tokens, new RegExp(`--titlebar-h-win: ${WIN_TITLEBAR_HEIGHT}px;`));
  assert.match(tokens, /--window-controls-w: 138px;/);
  // The page announces its theme colour, which recolours the Windows buttons.
  const prefs = readFileSync(new URL('../../web/src/prefs.ts', import.meta.url), 'utf8');
  assert.match(prefs, /theme-color/);
});
