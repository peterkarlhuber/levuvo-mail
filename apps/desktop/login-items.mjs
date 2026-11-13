// Login item controls for packaged desktop builds only. No Mail/IMAP access.
// On macOS an ad-hoc signature may be insufficient for reliable login items;
// the OS may require approval in Settings > General > Login Items & Extensions.
export function getLoginItemState(electronApp, platform = process.platform, executable = process.execPath) {
  if (!['darwin', 'win32'].includes(platform) || !electronApp.isPackaged) {
    return { available: false, enabled: false, status: 'requires-packaged-app', launchedAtLogin: false };
  }
  try {
    const options = platform === 'win32' ? { path: executable, args: ['--hidden'] } : {};
    const settings = electronApp.getLoginItemSettings(options);
    return {
      available: true,
      enabled: settings.openAtLogin === true,
      status: settings.status || (settings.openAtLogin ? 'enabled' : 'not-registered'),
      launchedAtLogin: platform === 'darwin' && settings.wasOpenedAtLogin === true
    };
  } catch {
    return { available: false, enabled: false, status: 'unavailable', launchedAtLogin: false };
  }
}

export function changeLoginItemState(electronApp, enable, platform = process.platform, executable = process.execPath) {
  const prior = getLoginItemState(electronApp, platform, executable);
  if (!prior.available) return { ...prior, ok: false };
  try {
    const settings = { openAtLogin: enable === true };
    if (platform === 'win32') {
      settings.path = executable;
      settings.args = ['--hidden'];
    }
    electronApp.setLoginItemSettings(settings);
    const updated = getLoginItemState(electronApp, platform, executable);
    return { ...updated, ok: updated.enabled === (enable === true) };
  } catch {
    return { ...prior, ok: false, status: 'update-failed' };
  }
}

export function isHiddenLoginLaunch(electronApp, argv = process.argv, platform = process.platform) {
  if (!electronApp.isPackaged) return false;
  if (platform === 'win32') return argv.includes('--hidden');
  if (platform === 'darwin') return getLoginItemState(electronApp, platform).launchedAtLogin;
  return false;
}
