import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  nativeTheme,
  shell,
  session,
  dialog,
  Notification,
  crashReporter
} from 'electron';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDesktopInboxMonitor } from './background-monitor.mjs';
import { configureWindowsNotifications } from './windows-integration.mjs';
import { getLoginItemState, changeLoginItemState, isHiddenLoginLaunch } from './login-items.mjs';
import { createUpdater } from './updater.mjs';
import { classifyExternalUrl, isPreviewFrameUrl } from './links.mjs';
import { createTranslator } from './i18n.mjs';
import { createReminderMonitor } from './reminders.mjs';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const iconFile = path.join(dirname, 'assets', 'levuvo.png');
const SLOGAN = 'Less effort. More impact.';
let windowRef;
let trayRef;
let quitting = false;
let mailServer;
let backgroundMonitor;
let reminderMonitor;
let followupTimer;
let updater = { enabled: false, check: async () => ({ status: 'disabled' }) };
let appOrigin = '';
const activeNativeNotifications = new Set();
let t = createTranslator('de');

// Windows toast identity must be registered before the first window/notification.
configureWindowsNotifications(app);
const single = app.requestSingleInstanceLock();
if (!single) app.quit();

function showWindow() {
  if (!windowRef || windowRef.isDestroyed()) return;
  windowRef.show();
  if (windowRef.isMinimized()) windowRef.restore();
  windowRef.focus();
}
app.on('second-instance', showWindow);

// Same profile directory as earlier versions, so existing accounts stay in place.
app.setName('Levuvo Mail');
app.setPath('userData', path.join(app.getPath('appData'), 'Levuvo Mail'));
app.setAboutPanelOptions?.({
  applicationName: 'Levuvo Mail',
  applicationVersion: app.getVersion(),
  copyright: `© Levuvo · ${SLOGAN}`,
  website: 'https://levuvo.at'
});

async function shutdown() {
  quitting = true;
  backgroundMonitor?.stop();
  reminderMonitor?.stop();
  if (followupTimer) clearInterval(followupTimer);
  try {
    await mailServer?.close();
  } catch {
    /* already closed */
  }
}

async function quitWithConfirmation() {
  if (quitting) return;
  const result = await dialog.showMessageBox(windowRef || undefined, {
    type: 'question',
    buttons: [t('cancel'), t('quit')],
    defaultId: 0,
    cancelId: 0,
    title: t('quitTitle'),
    message: t('quitMessage'),
    detail: t('quitDetail')
  });
  if (result.response !== 1) return;
  await shutdown();
  app.quit();
}

// Every link from a mail or the app opens in the system browser only after the user
// has seen the real destination. Only http(s) and mailto are ever handed to the OS.
async function openExternalWithConfirmation(raw) {
  const target = classifyExternalUrl(raw);
  if (!target) return;
  if (target.trusted) {
    void shell.openExternal(target.url);
    return;
  }
  const result = await dialog.showMessageBox(windowRef || undefined, {
    type: 'question',
    buttons: [
      t('cancel'),
      target.kind === 'mailto' ? t('openMail') : target.kind === 'tel' ? t('call') : t('openBrowser')
    ],
    defaultId: 0,
    cancelId: 0,
    title: target.kind === 'tel' ? t('callTitle') : t('openLink'),
    message:
      target.kind === 'mailto'
        ? t('mailTo', target.display)
        : target.kind === 'tel'
          ? target.display
          : t('target', target.host),
    detail: t('linkDetail', target.display)
  });
  if (result.response === 1) void shell.openExternal(target.url);
}

function loginItemMenuEntry() {
  const state = getLoginItemState(app);
  return {
    label: t('autostart'),
    type: 'checkbox',
    checked: state.enabled,
    enabled: state.available,
    click: () => {
      void toggleLoginItem();
    }
  };
}

async function toggleLoginItem() {
  const previous = getLoginItemState(app);
  const result = changeLoginItemState(app, !previous.enabled);
  refreshMenus();
  if (!result.ok) {
    await dialog.showMessageBox(windowRef || undefined, {
      type: 'warning',
      title: t('autostartFailedTitle'),
      message: t('autostartFailed'),
      detail: process.platform === 'win32' ? t('autostartWin') : t('autostartMac')
    });
  }
}

async function checkForUpdatesManually() {
  if (!updater.enabled) {
    await dialog.showMessageBox(windowRef || undefined, {
      type: 'info',
      title: t('updates'),
      message: t('updatesOff'),
      detail: t('updatesOffDetail')
    });
    return;
  }
  const { status } = await updater.check();
  if (status === 'current') {
    await dialog.showMessageBox(windowRef || undefined, {
      type: 'info',
      title: t('updates'),
      message: t('upToDate', app.getVersion())
    });
  } else if (status === 'error') {
    await dialog.showMessageBox(windowRef || undefined, {
      type: 'warning',
      title: t('updates'),
      message: t('updateFailed'),
      detail: t('updateFailedDetail')
    });
  }
}

function configureMenu() {
  const appEntries = [
    { label: t('open'), click: showWindow },
    loginItemMenuEntry(),
    { label: t('checkUpdates'), click: () => void checkForUpdatesManually() }
  ];
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin'
        ? [
            {
              label: 'Levuvo Mail',
              submenu: [
                { role: 'about' },
                { type: 'separator' },
                ...appEntries,
                { type: 'separator' },
                { label: t('settings'), accelerator: 'Cmd+,', click: () => navigate({ module: 'settings' }) },
                { type: 'separator' },
                { label: t('quit'), accelerator: 'Cmd+Q', click: quitWithConfirmation }
              ]
            }
          ]
        : []),
      {
        label: t('file'),
        submenu: [
          {
            label: t('newMessage'),
            accelerator: 'CmdOrCtrl+N',
            click: () => navigate({ module: 'mail', compose: true })
          },
          { type: 'separator' },
          ...(process.platform === 'darwin'
            ? [{ label: t('open'), click: showWindow }]
            : [
                ...appEntries,
                { label: t('settings'), accelerator: 'Ctrl+,', click: () => navigate({ module: 'settings' }) }
              ]),
          { type: 'separator' },
          {
            label: t('quit'),
            accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
            click: quitWithConfirmation
          }
        ]
      },
      {
        label: t('edit'),
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' }
        ]
      },
      {
        label: t('view'),
        submenu: [
          { role: 'reload' },
          { role: 'toggleDevTools', visible: !app.isPackaged },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' }
        ]
      },
      {
        label: t('go'),
        submenu: [
          { label: t('mail'), accelerator: 'Alt+1', click: () => navigate({ module: 'mail' }) },
          { label: t('calendar'), accelerator: 'Alt+2', click: () => navigate({ module: 'calendar' }) },
          { label: t('contacts'), accelerator: 'Alt+3', click: () => navigate({ module: 'contacts' }) }
        ]
      }
    ])
  );
}

function refreshMenus() {
  configureMenu();
  if (!trayRef || trayRef.isDestroyed()) return;
  trayRef.setContextMenu(
    Menu.buildFromTemplate([
      { label: t('open'), click: showWindow },
      { label: t('newMessage'), click: () => navigate({ module: 'mail', compose: true }) },
      { label: t('calendar'), click: () => navigate({ module: 'calendar' }) },
      loginItemMenuEntry(),
      { label: t('testNotification'), click: () => nativeNotify({ label: t('test'), count: 1, test: true }) },
      { type: 'separator' },
      { label: t('quit'), click: quitWithConfirmation }
    ])
  );
}

/** Brings the window up and switches the app to a module (via a DOM event in the page). */
function navigate(detail) {
  showWindow();
  if (!windowRef || windowRef.isDestroyed()) return;
  const safe = JSON.stringify({
    module: ['mail', 'calendar', 'contacts', 'settings'].includes(detail.module) ? detail.module : 'mail',
    ...(typeof detail.accountId === 'string' ? { accountId: detail.accountId.slice(0, 40) } : {}),
    ...(detail.compose ? { compose: true } : {})
  });
  void windowRef.webContents
    .executeJavaScript(`window.dispatchEvent(new CustomEvent('levuvo:navigate', { detail: ${safe} }))`)
    .catch(() => {});
}

function nativeNotify({ label, count, test = false, accountId, title, body, module = 'mail' }) {
  if (!Notification.isSupported()) return;
  const notification = new Notification({
    title: title || `Levuvo Mail · ${label}`,
    body: body || (test ? t('testBody') : t('newMail', count)),
    silent: false
  });
  activeNativeNotifications.add(notification);
  if (activeNativeNotifications.size > 20)
    activeNativeNotifications.delete(activeNativeNotifications.values().next().value);
  notification.on('click', () => (test ? showWindow() : navigate({ module, accountId })));
  notification.on('close', () => activeNativeNotifications.delete(notification));
  // Never log account data or message text.
  notification.on('failed', () => activeNativeNotifications.delete(notification));
  notification.show();
}

/**
 * Opt-in crash reports: only when the user enabled them in Settings → Privacy AND this
 * build contains a report URL (package.json "levuvo.crashReportUrl" or LEVUVO_CRASH_REPORT_URL).
 * Minidumps contain no mail content by design of the app (mail data is not kept in the
 * main process); extra parameters are limited to version and platform.
 */
async function startCrashReporting(localGet) {
  let url = process.env.LEVUVO_CRASH_REPORT_URL || '';
  try {
    url ||=
      JSON.parse(readFileSync(path.join(dirname, '..', '..', 'package.json'), 'utf8')).levuvo?.crashReportUrl || '';
  } catch {
    /* no package metadata */
  }
  if (!/^https:\/\//.test(url)) return;
  try {
    const settings = await localGet('/api/app-settings');
    if (settings?.crashReports !== true) return;
    crashReporter.start({
      submitURL: url,
      uploadToServer: true,
      compress: true,
      ignoreSystemCrashHandler: true,
      extra: { version: app.getVersion(), platform: process.platform }
    });
  } catch {
    /* settings unreadable: stay off */
  }
}

async function boot() {
  if (!single) return;
  t = createTranslator(app.getLocale());
  // The session secret only lives in this process; it is never placed in the
  // environment where child processes or diagnostics could read it.
  const secret = randomBytes(32).toString('hex');
  const { createMailServer } = await import('../server/src/app.mjs');
  mailServer = await createMailServer({
    desktop: true,
    sessionSecret: secret,
    env: process.env,
    logger: msg => console.log(`[Levuvo Mail] ${msg}`)
  });
  const { address } = await mailServer.listen();
  appOrigin = new URL(address).origin;
  const hostHeader = new URL(address).host;

  // Background notifications read the inbox state that the IDLE watchers keep
  // up to date. This uses Fastify inject (no socket) and never opens extra logins.
  const localGet = async url => {
    const response = await mailServer.api.inject({
      method: 'GET',
      url,
      headers: { host: hostHeader, cookie: `levuvo_desktop_session=${secret}` }
    });
    if (response.statusCode !== 200) throw new Error('Protected request failed.');
    return response.json();
  };
  backgroundMonitor = createDesktopInboxMonitor({
    listAccounts: async () => (await localGet('/api/accounts')).accounts,
    readInbox: async accountId => localGet(`/api/inbox/monitor?account=${encodeURIComponent(accountId)}`),
    notify: ({ label, count, id }) => nativeNotify({ label, count, accountId: id }),
    intervalMs: 20000,
    logger: msg => console.warn('[Levuvo Mail]', msg)
  });
  backgroundMonitor.start();
  reminderMonitor = createReminderMonitor({
    readAlarms: (from, to) =>
      localGet(`/api/calendar/alarms?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
    notify: alarm => {
      const when = alarm.allDay
        ? t('allDay')
        : new Date(alarm.start).toLocaleTimeString(app.getLocale(), { hour: '2-digit', minute: '2-digit' });
      nativeNotify({
        title: `${t('reminder')}: ${alarm.title}`,
        body: [when, alarm.location].filter(Boolean).join(' · '),
        module: 'calendar'
      });
    }
  });
  reminderMonitor.start();
  // Follow-ups: a sent message got no answer in time → one notification per item.
  const notifiedFollowups = new Set();
  followupTimer = setInterval(async () => {
    try {
      const { items = [] } = await localGet('/api/followups');
      for (const f of items) {
        if (f.state !== 'due' || notifiedFollowups.has(f.id)) continue;
        notifiedFollowups.add(f.id);
        nativeNotify({ title: t('followupTitle'), body: f.subject || '', accountId: f.accountId, module: 'mail' });
      }
    } catch {
      /* server busy */
    }
  }, 60_000);
  followupTimer.unref?.();
  await startCrashReporting(localGet);

  // httpOnly cookie, rotated on every launch; the API rejects requests without it.
  const ses = session.fromPartition('persist:levuvo-mail');
  await ses.cookies.set({
    url: appOrigin,
    name: 'levuvo_desktop_session',
    value: secret,
    httpOnly: true,
    secure: false,
    sameSite: 'strict',
    path: '/'
  });
  const isOwnPage = webContents =>
    webContents === windowRef?.webContents && webContents.getURL().startsWith(`${appOrigin}/`);
  ses.setPermissionRequestHandler((webContents, permission, callback) =>
    callback(permission === 'notifications' && isOwnPage(webContents))
  );
  ses.setPermissionCheckHandler(
    (webContents, permission) => permission === 'notifications' && Boolean(webContents) && isOwnPage(webContents)
  );

  windowRef = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Levuvo Mail',
    icon: iconFile,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0b0b' : '#ffffff',
    webPreferences: {
      partition: 'persist:levuvo-mail',
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      spellcheck: true,
      // Built-in PDF viewer for attachment previews (same-origin frames only, see below).
      plugins: true,
      backgroundThrottling: true
    }
  });
  windowRef.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalWithConfirmation(url);
    return { action: 'deny' };
  });
  windowRef.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${appOrigin}/`)) {
      event.preventDefault();
      void openExternalWithConfirmation(url);
    }
  });
  windowRef.webContents.on('will-frame-navigate', event => {
    // The mail frame must never navigate itself; links open via window.open → confirmation.
    // Exception: attachment previews served by the local API (own origin, inline=1).
    if (!event.isMainFrame && !event.url.startsWith('about:') && !isPreviewFrameUrl(event.url, appOrigin))
      event.preventDefault();
  });
  windowRef.webContents.on('will-attach-webview', event => event.preventDefault());
  windowRef.on('close', event => {
    if (!quitting) {
      event.preventDefault();
      windowRef.hide();
    }
  });
  const hiddenLaunch = isHiddenLoginLaunch(app);
  windowRef.once('ready-to-show', () => {
    if (!hiddenLaunch) windowRef.show();
  });
  await windowRef.loadURL(`${appOrigin}/`);

  const image = nativeImage.createFromPath(iconFile);
  if (!image.isEmpty()) {
    trayRef = new Tray(image.resize({ width: 18, height: 18 }));
    trayRef.setToolTip('Levuvo Mail');
    trayRef.on('double-click', showWindow);
    if (process.platform === 'win32') trayRef.on('click', showWindow);
  }
  updater = await createUpdater({
    app,
    dialog,
    getWindow: () => windowRef,
    beforeInstall: shutdown,
    logger: msg => console.warn('[Levuvo Mail]', msg),
    t
  });
  refreshMenus();
}

app.on('activate', showWindow);
app.on('window-all-closed', () => {
  /* stays in the tray; mail is still watched */
});
app.on('before-quit', () => {
  quitting = true;
});
app
  .whenReady()
  .then(boot)
  .catch(error => {
    dialog.showErrorBox(t('startFailed'), t('startFailedDetail', String(error?.message || error)));
    app.quit();
  });
