// Texts of the native parts (menus, dialogs, notifications) in German or English,
// following the operating system language.
const TEXTS = {
  de: {
    cancel: 'Abbrechen',
    quit: 'Beenden',
    quitTitle: 'Levuvo Mail beenden',
    quitMessage: 'Levuvo Mail wirklich beenden?',
    quitDetail:
      'Nicht gespeicherte Eingaben können verloren gehen. Nach dem Beenden gibt es keine Mitteilungen über neue E-Mails, keine Terminerinnerungen und geplante Nachrichten werden erst beim nächsten Start gesendet.',
    openMail: 'E-Mail-Programm öffnen',
    openBrowser: 'Im Browser öffnen',
    openLink: 'Link öffnen?',
    mailTo: 'E-Mail an {x}',
    target: 'Ziel: {x}',
    linkDetail:
      '{x}\n\nNur öffnen, wenn du dem Absender vertraust. Links in E-Mails können auf gefälschte Seiten führen.',
    call: 'Anrufen',
    callTitle: 'Telefonnummer öffnen?',
    autostart: 'Bei Anmeldung automatisch starten',
    autostartFailedTitle: 'Autostart nicht eingerichtet',
    autostartFailed: 'Der Autostart konnte nicht bestätigt werden.',
    autostartWin: 'Levuvo Mail über das Startmenü starten und unter Einstellungen → Apps → Autostart prüfen.',
    autostartMac:
      'Die installierte Levuvo Mail.app aus dem Programme-Ordner starten und unter Systemeinstellungen → Allgemein → Anmeldeobjekte prüfen.',
    updates: 'Updates',
    updatesOff: 'Automatische Updates sind in dieser Version nicht aktiv.',
    updatesOffDetail:
      'Testversionen ohne Signatur aktualisieren sich nicht selbst. Signierte Releases suchen alle sechs Stunden nach Updates.',
    upToDate: 'Levuvo Mail {x} ist aktuell.',
    updateFailed: 'Die Updateprüfung ist fehlgeschlagen.',
    updateFailedDetail: 'Bitte Internetverbindung prüfen und später erneut versuchen.',
    open: 'Levuvo Mail öffnen',
    checkUpdates: 'Nach Updates suchen …',
    file: 'Datei',
    edit: 'Bearbeiten',
    view: 'Ansicht',
    go: 'Gehe zu',
    mail: 'E-Mail',
    calendar: 'Kalender',
    contacts: 'Kontakte',
    settings: 'Einstellungen …',
    newMessage: 'Neue Nachricht',
    testNotification: 'Systemmitteilung testen',
    test: 'Test',
    testBody: 'Mitteilungen funktionieren. Dies ist keine neue E-Mail.',
    newMail: '{x} neue Nachricht(en) im Posteingang.',
    allDay: 'ganztägig',
    reminder: 'Erinnerung',
    startFailed: 'Levuvo Mail konnte nicht gestartet werden',
    startFailedDetail: '{x}\n\nBitte keine Zugangsdaten in Support-Nachrichten einfügen.',
    later: 'Später',
    restartNow: 'Jetzt neu starten',
    updateReady: 'Update bereit',
    updateReadyDetail:
      'Das Update wurde geprüft und heruntergeladen. Es wird beim Neustart installiert. Offene Entwürfe vorher speichern.'
  },
  en: {
    cancel: 'Cancel',
    quit: 'Quit',
    quitTitle: 'Quit Levuvo Mail',
    quitMessage: 'Really quit Levuvo Mail?',
    quitDetail:
      'Unsaved input may be lost. After quitting there are no notifications about new emails, no event reminders, and scheduled messages are only sent at the next start.',
    openMail: 'Open email app',
    openBrowser: 'Open in browser',
    openLink: 'Open link?',
    mailTo: 'Email to {x}',
    target: 'Destination: {x}',
    linkDetail: '{x}\n\nOnly open it if you trust the sender. Links in emails can lead to fake websites.',
    call: 'Call',
    callTitle: 'Open phone number?',
    autostart: 'Start automatically at login',
    autostartFailedTitle: 'Autostart not set up',
    autostartFailed: 'Autostart could not be confirmed.',
    autostartWin: 'Start Levuvo Mail from the Start menu and check Settings → Apps → Startup.',
    autostartMac:
      'Start the installed Levuvo Mail.app from the Applications folder and check System Settings → General → Login Items.',
    updates: 'Updates',
    updatesOff: 'Automatic updates are not active in this version.',
    updatesOffDetail:
      'Unsigned test builds do not update themselves. Signed releases check for updates every six hours.',
    upToDate: 'Levuvo Mail {x} is up to date.',
    updateFailed: 'The update check failed.',
    updateFailedDetail: 'Please check your internet connection and try again later.',
    open: 'Open Levuvo Mail',
    checkUpdates: 'Check for updates …',
    file: 'File',
    edit: 'Edit',
    view: 'View',
    go: 'Go',
    mail: 'Email',
    calendar: 'Calendar',
    contacts: 'Contacts',
    settings: 'Settings …',
    newMessage: 'New message',
    testNotification: 'Test system notification',
    test: 'Test',
    testBody: 'Notifications work. This is not a new email.',
    newMail: '{x} new message(s) in the inbox.',
    allDay: 'all day',
    reminder: 'Reminder',
    startFailed: 'Levuvo Mail could not be started',
    startFailedDetail: '{x}\n\nPlease do not include credentials in support messages.',
    later: 'Later',
    restartNow: 'Restart now',
    updateReady: 'Update ready',
    updateReadyDetail:
      'The update was verified and downloaded. It will be installed on restart. Save open drafts first.'
  }
};

export function createTranslator(locale) {
  const lang = String(locale || '')
    .toLowerCase()
    .startsWith('de')
    ? 'de'
    : 'en';
  const fn = (key, x = '') => (TEXTS[lang][key] ?? TEXTS.de[key] ?? key).replace('{x}', String(x));
  fn.lang = lang;
  return fn;
}
export const DESKTOP_TEXT_KEYS = Object.keys(TEXTS.de);
export const DESKTOP_TEXTS = TEXTS;
