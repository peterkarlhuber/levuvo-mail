import test from 'node:test';
import assert from 'node:assert/strict';
import {
  configureWindowsNotifications,
  LEVUVO_WINDOWS_APP_ID,
  LEVUVO_WINDOWS_TOAST_CLSID
} from '../../desktop/windows-integration.mjs';
test('Windows-Mitteilungsidentität passt dauerhaft zur NSIS-App-ID', () => {
  assert.equal(LEVUVO_WINDOWS_APP_ID, 'at.levuvo.mail');
  assert.match(LEVUVO_WINDOWS_TOAST_CLSID, /^\{[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\}$/i);
});
test('Windows registriert AppUserModelID und feste Toast-CLSID', () => {
  const calls = [];
  assert.equal(
    configureWindowsNotifications(
      { setAppUserModelId: v => calls.push(['appId', v]), setToastActivatorCLSID: v => calls.push(['clsid', v]) },
      'win32'
    ),
    true
  );
  assert.deepEqual(calls, [
    ['appId', LEVUVO_WINDOWS_APP_ID],
    ['clsid', LEVUVO_WINDOWS_TOAST_CLSID]
  ]);
});
test('macOS wird von Windows-Integrationscode nicht verändert', () => {
  const calls = [];
  assert.equal(configureWindowsNotifications({ setAppUserModelId: () => calls.push(true) }, 'darwin'), false);
  assert.deepEqual(calls, []);
});
test('Fehlende Electron-CLSID-Funktion blockiert ältere Runtime nicht', () => {
  let appId = null;
  assert.equal(configureWindowsNotifications({ setAppUserModelId: v => (appId = v) }, 'win32'), true);
  assert.equal(appId, LEVUVO_WINDOWS_APP_ID);
});
