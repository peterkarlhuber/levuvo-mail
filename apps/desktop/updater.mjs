// Automatic updates via electron-updater. Active only in packaged builds that were
// produced with an update feed (app-update.yml, written by electron-builder when a
// `publish` target is configured, see scripts/release-signed.mjs). Unsigned test
// builds therefore never try to update themselves.
import { existsSync } from 'node:fs';
import path from 'node:path';

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 45 * 1000;

export function updateFeedConfigured(app, resourcesPath = process.resourcesPath) {
  return Boolean(app.isPackaged && resourcesPath && existsSync(path.join(resourcesPath, 'app-update.yml')));
}

/**
 * `autoInstall()` reads the user's choice (Settings → Privacy → "Install updates automatically",
 * on by default, CRA Annex I Part I (2)(c)). Off: Levuvo Mail still checks and asks before it
 * downloads; "Later" postpones in both modes.
 */
export async function createUpdater({
  app,
  dialog,
  getWindow,
  beforeInstall,
  autoInstall = async () => true,
  logger = () => {},
  t = key => key
}) {
  if (!updateFeedConfigured(app)) {
    return { enabled: false, check: async () => ({ status: 'disabled' }) };
  }
  const { default: electronUpdater } = await import('electron-updater');
  const { autoUpdater } = electronUpdater;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.logger = null;
  let prompted = false;
  let lastStatus = 'idle';

  autoUpdater.on('error', () => {
    lastStatus = 'error';
    logger('Update check failed.');
  });
  autoUpdater.on('update-not-available', () => {
    lastStatus = 'current';
  });
  let offered = '';
  autoUpdater.on('update-available', async info => {
    if (autoUpdater.autoDownload) {
      lastStatus = 'downloading';
      return;
    }
    lastStatus = 'available';
    const version = info?.version || '';
    if (offered === version) return;
    offered = version;
    const result = await dialog.showMessageBox(getWindow() || undefined, {
      type: 'info',
      buttons: [t('later'), t('download')],
      defaultId: 1,
      cancelId: 0,
      title: t('updateAvailable'),
      message: `Levuvo Mail ${version}`.trim(),
      detail: t('updateAvailableDetail')
    });
    if (result.response === 1) {
      lastStatus = 'downloading';
      // Chosen by the user: install at the next quit like an automatic update.
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.downloadUpdate().catch(() => {
        lastStatus = 'error';
      });
    }
  });
  autoUpdater.on('update-downloaded', async info => {
    lastStatus = 'ready';
    if (prompted) return;
    prompted = true;
    const result = await dialog.showMessageBox(getWindow() || undefined, {
      type: 'info',
      buttons: [t('later'), t('restartNow')],
      defaultId: 1,
      cancelId: 0,
      title: t('updateReady'),
      message: `Levuvo Mail ${info?.version || ''}`.trim(),
      detail: t('updateReadyDetail')
    });
    if (result.response === 1) {
      await beforeInstall?.();
      autoUpdater.quitAndInstall(false, true);
    }
  });

  const check = async () => {
    try {
      let automatic = true;
      try {
        automatic = (await autoInstall()) !== false;
      } catch {
        /* settings unreadable: keep the secure default */
      }
      autoUpdater.autoDownload = automatic;
      if (automatic) autoUpdater.autoInstallOnAppQuit = true;
      else if (lastStatus !== 'ready' && lastStatus !== 'downloading') autoUpdater.autoInstallOnAppQuit = false;
      await autoUpdater.checkForUpdates();
    } catch {
      lastStatus = 'error';
    }
    return { status: lastStatus };
  };
  setTimeout(() => void check(), FIRST_CHECK_DELAY_MS).unref?.();
  setInterval(() => void check(), CHECK_INTERVAL_MS).unref?.();
  return { enabled: true, check, status: () => lastStatus };
}
