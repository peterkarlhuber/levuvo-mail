// Windows 10/11: stable native toast identity, aligned to NSIS appId/Start Menu shortcut.
// Keep both constants unchanged across updates so Windows recognizes the same app.
export const LEVUVO_WINDOWS_APP_ID = 'at.levuvo.mail';
export const LEVUVO_WINDOWS_TOAST_CLSID = '{8febfb69-1519-559e-9a8b-b0bd80c654d1}';

export function configureWindowsNotifications(electronApp, platform = process.platform) {
  if (platform !== 'win32') return false;
  electronApp.setAppUserModelId(LEVUVO_WINDOWS_APP_ID);
  // Electron 45 supports an explicit stable toast activation CLSID. Without it,
  // notifications may be registered under a new random identity each start.
  if (typeof electronApp.setToastActivatorCLSID === 'function') {
    electronApp.setToastActivatorCLSID(LEVUVO_WINDOWS_TOAST_CLSID);
  }
  return true;
}
