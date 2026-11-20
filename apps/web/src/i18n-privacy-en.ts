// English texts of the privacy cockpit, the newsletter hub and password-protected sending, kept
// apart from i18n-en.ts to limit merge conflicts. Keys are the German source strings (see i18n.ts);
// checked by scripts/check-i18n.mjs.
export const PRIVACY_EN: Record<string, string> = {
  'Dieses Passwort ist zu leicht zu erraten. Bitte das vorgeschlagene Passwort verwenden oder ein anderes wählen.':
    'This password is too easy to guess. Please use the suggested password or choose another one.',
  'Zu leicht zu erraten': 'Too easy to guess',
  'Passwort kopiert. Es wird nach einer Minute aus der Zwischenablage entfernt.':
    'Password copied. It will be removed from the clipboard after one minute.',
  Antwortvorschlag: 'Reply suggestion',
  'Entwurf schreiben': 'Write draft',
  'Anhang-Prüfung': 'Attachment check',
  'Prüfung vor dem Senden': 'Check before sending',
  'Filterregel vorschlagen': 'Suggest filter rule',
  'Wichtiges erkennen': 'Spot what matters',
  'Einsortieren (Bündel, Screening)': 'Sorting (bundles, screening)',
  'Termine und Aufgaben erkennen': 'Detect events and tasks',
  Sicherheitsbewertung: 'Security assessment',
  'Frag dein Postfach': 'Ask your mailbox',
  Suchindex: 'Search index',
  'Aufgaben und Routinen des Assistenten': 'Assistant tasks and routines',
  'Morgen-Briefing': 'Morning briefing',
  'Versprechen-Tracker': 'Commitment tracker',
  'Termin-Vorbereitung': 'Meeting preparation',
  Diktat: 'Dictation',
  'Newsletter-Überblick': 'Newsletter overview',
  'Datenschutz-Cockpit': 'Privacy cockpit',
  'Das Cockpit konnte nicht geladen werden.': 'The cockpit could not be loaded.',
  'Was in den letzten {days} Tagen auf diesem Gerät passiert ist. Es werden nur Zähler und Zeitpunkte gespeichert, keine Inhalte, Adressen oder Betreffzeilen.':
    'What happened on this device in the last {days} days. Only counters and times are stored, no content, addresses or subjects.',
  'Tracker blockiert': 'Trackers blocked',
  'KI-Aufrufe lokal': 'AI calls on this device',
  'KI-Aufrufe in der Cloud': 'AI calls in the cloud',
  'Zugriffe externer Agenten': 'External agent accesses',
  'Blockierte Tracker pro Tag, letzte {days} Tage: insgesamt {count}':
    'Blocked trackers per day, last {days} days: {count} in total',
  'Was die KI gelesen hat': 'What the AI read',
  'Die KI hat in diesem Zeitraum nichts gelesen.': 'The AI read nothing in this period.',
  Funktion: 'Function',
  Lokal: 'Local',
  Cloud: 'Cloud',
  'Davon automatisch': 'Of which automatic',
  'Der lokale Suchindex wurde {count}-mal aktualisiert (nur auf diesem Gerät).':
    'The local search index was updated {count} times (only on this device).',
  'Letzte Zugriffe': 'Recent accesses',
  'Cloud ({provider})': 'Cloud ({provider})',
  'externer Agent': 'external agent',
  lokal: 'local',
  'Was Levuvo Mail verlassen hat': 'What left Levuvo Mail',
  'Cloud-KI: {list}. Zuletzt am {when}.': 'Cloud AI: {list}. Last on {when}.',
  '{count} Aufrufe an {provider}': '{count} calls to {provider}',
  'Cloud-KI: nichts. Alle KI-Funktionen liefen lokal.': 'Cloud AI: nothing. All AI functions ran locally.',
  '{agent}: {count} Zugriffe ({tools}), zuletzt {when}': '{agent}: {count} accesses ({tools}), last {when}',
  'Externe Agenten (MCP): keine Zugriffe.': 'External agents (MCP): no accesses.',
  'Newsletter-Abmeldungen: {direct} direkt beim Absender, {mail} per E-Mail.':
    'Newsletter unsubscribes: {direct} directly with the sender, {mail} by email.',
  'Externe Bilder: {count}-mal auf deinen Wunsch geladen. Der Absender sieht dabei deine IP-Adresse; Tracker bleiben trotzdem blockiert.':
    'External images: loaded {count} times at your request. The sender sees your IP address; trackers stay blocked anyway.',
  'Modell-Downloads: {list}': 'Model downloads: {list}',
  'Immer: deine E-Mails, Termine und Kontakte gehen nur an die Server deiner Anbieter; Updates werden bei GitHub geprüft.':
    "Always: your emails, events and contacts go only to your providers' servers; updates are checked on GitHub.",
  'KI-Protokoll öffnen': 'Open AI log',
  'Zähler des Cockpits löschen?': "Delete the cockpit's counters?",
  'Die Zähler für Tracker, externe Bilder und Abmeldungen werden gelöscht. Das KI-Protokoll leerst du unter KI & Agenten.':
    'The counters for trackers, external images and unsubscribes are deleted. You clear the AI log under AI & agents.',
  'Zähler löschen': 'Delete counters',
  'Wochenüberblick ({count} Newsletter)': 'Weekly overview ({count} newsletters)',
  Wochenüberblick: 'Weekly overview',
  'Weniger Absender': 'Fewer senders',
  'Alle {count} Absender': 'All {count} senders'
};
