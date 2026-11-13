import test from 'node:test';
import assert from 'node:assert/strict';
import {
  configureWindowsNotifications,
  LEVUVO_WINDOWS_APP_ID,
  LEVUVO_WINDOWS_TOAST_CLSID
} from '../../desktop/windows-integration.mjs';
test('Windows notification identity permanently matches the NSIS app ID', () => {
  assert.equal(LEVUVO_WINDOWS_APP_ID, 'at.levuvo.mail');
  assert.match(LEVUVO_WINDOWS_TOAST_CLSID, /^\{[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\}$/i);
});
test('Windows registers AppUserModelID and a fixed toast CLSID', () => {
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
test('macOS is not changed by the Windows integration code', () => {
  const calls = [];
  assert.equal(configureWindowsNotifications({ setAppUserModelId: () => calls.push(true) }, 'darwin'), false);
  assert.deepEqual(calls, []);
});
test('Missing Electron CLSID function does not block an older runtime', () => {
  let appId = null;
  assert.equal(configureWindowsNotifications({ setAppUserModelId: v => (appId = v) }, 'win32'), true);
  assert.equal(appId, LEVUVO_WINDOWS_APP_ID);
});
