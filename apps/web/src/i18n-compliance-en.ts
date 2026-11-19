// English texts of the privacy, data rights, security-support and licence views (compliance),
// kept apart from i18n-en.ts to limit merge conflicts. Keys are the German source strings.
export const COMPLIANCE_EN: Record<string, string> = {
  'Deine Daten': 'Your data',
  'Updates automatisch installieren': 'Install updates automatically',
  'Empfohlen. Sicherheitsupdates werden geladen und beim Beenden installiert; „Später“ verschiebt die Installation. Ausgeschaltet fragt Levuvo Mail vor jedem Download. Nur in signierten Versionen mit Update-Funktion.':
    'Recommended. Security updates are downloaded and installed when you quit; “Later” postpones the installation. When off, Levuvo Mail asks before every download. Only in signed versions with the update function.',
  'Meine Daten exportieren': 'Export my data',
  'Lesbare Kopie (JSON) der Daten, die nur auf diesem Gerät liegen: Einstellungen, Konten ohne Passwörter, lokaler Kalender, Kontakte, Aufgaben, Vorlagen, Wiedervorlagen, Assistent-Daten. Ohne private Schlüssel und Passwörter. Die Datei ist nicht verschlüsselt.':
    'Readable copy (JSON) of the data that exists only on this device: settings, accounts without passwords, local calendar, contacts, tasks, templates, follow-ups, assistant data. Without private keys and passwords. The file is not encrypted.',
  Exportieren: 'Export',
  'Alle Daten auf diesem Gerät löschen': 'Delete all data on this device',
  'Alle Daten auf diesem Gerät löschen?': 'Delete all data on this device?',
  'Levuvo Mail löscht alles, was es auf diesem Computer gespeichert hat: Einstellungen, Konten, lokalen Kalender, Kontakte, Aufgaben, Vorlagen, Räume, Suchindex, Assistent-Daten und Modelle sowie die Einträge im Schlüsselbund. E-Mails, Termine und Kontakte auf den Servern deiner Anbieter bleiben unverändert. Das lässt sich nicht rückgängig machen; erstelle vorher eine Sicherung, wenn du die Daten noch brauchst. Levuvo Mail startet danach neu.':
    'Levuvo Mail deletes everything it stored on this computer: settings, accounts, local calendar, contacts, tasks, templates, spaces, search index, assistant data and models, and its keychain entries. Mails, events and contacts on your providers’ servers stay unchanged. This cannot be undone; create a backup first if you still need the data. Levuvo Mail restarts afterwards.',
  'Alles löschen': 'Delete everything',
  'Bitte Levuvo Mail jetzt beenden und neu starten.': 'Please quit and restart Levuvo Mail now.',
  'Setzt Levuvo Mail auf diesem Computer vollständig zurück und entfernt die Einträge im Schlüsselbund. Daten bei deinen Anbietern bleiben erhalten.':
    'Resets Levuvo Mail on this computer completely and removes its keychain entries. Data at your providers is kept.',
  'Wird beim Neustart gelöscht …': 'Deleting at restart …',
  'Wird beim nächsten Start gelöscht. Bitte Levuvo Mail beenden und neu starten.':
    'Will be deleted at the next start. Please quit and restart Levuvo Mail.',
  'Die Daten wurden gelöscht, aber nicht alle Einträge im Schlüsselbund ließen sich entfernen. Bitte in der Schlüsselbundverwaltung (macOS) bzw. der Anmeldeinformationsverwaltung (Windows) die Einträge „at.levuvo.mail“ löschen.':
    'The data was deleted, but not all keychain entries could be removed. Please delete the entries “at.levuvo.mail” in Keychain Access (macOS) or Credential Manager (Windows).',
  'Alle Daten werden beim Neustart gelöscht. Bis dahin sind keine Änderungen möglich.':
    'All data will be deleted at the restart. No changes are possible until then.',
  'Bestätigung fehlt.': 'Confirmation missing.',
  'Sicherheit und Support': 'Security and support',
  'Sicherheitsupdates für diese Version bis {date}, kostenlos.':
    'Security updates for this version until {date}, free of charge.',
  'Sicherheitslücke melden: über „Report a vulnerability“ im GitHub-Repository von Levuvo Mail oder an die Sicherheitsadresse auf levuvo.at. Details in SECURITY.md.':
    'Report a vulnerability: via “Report a vulnerability” in the Levuvo Mail GitHub repository or to the security address on levuvo.at. Details in SECURITY.md.',
  'Jede Version hat eine Software-Stückliste (SBOM, CycloneDX) und eine Liste aller Lizenzen; beide liegen dem Release bei.':
    'Every version has a software bill of materials (SBOM, CycloneDX) and a list of all licences; both are attached to the release.',
  'Open-Source-Lizenzen': 'Open-source licences',
  'Levuvo Mail verwendet Open-Source-Komponenten, u. a. Electron, React, Fastify, ImapFlow, Nodemailer, OpenPGP.js, PKI.js, ical.js, tsdav, TipTap, Lucide, Python, Orkexa und Ollama. Die Lizenzen der Modelle stehen in der Modellliste unter „KI & Agenten“.':
    'Levuvo Mail uses open-source components, among them Electron, React, Fastify, ImapFlow, Nodemailer, OpenPGP.js, PKI.js, ical.js, tsdav, TipTap, Lucide, Python, Orkexa and Ollama. The licences of the models are shown in the model list under “AI & agents”.',
  Anzeigen: 'Show',
  'Lizenztexte werden geladen …': 'Loading licence texts …',
  'Nicht Teil dieser Installation.': 'Not part of this installation.',
  'Unbekannt.': 'Unknown.',
  Kennzeichnung: 'Marking',
  'KI-geschriebene Mails kennzeichnen': 'Mark AI-written mails',
  'Empfohlen (EU AI Act Art. 50). Mails, deren Text der Assistent oder ein Agent geschrieben hat, bekommen beim Senden die unsichtbare Kopfzeile „X-Levuvo-AI-Assisted“. Nur ausschalten, wenn du solche Texte immer selbst wesentlich überarbeitest.':
    'Recommended (EU AI Act Art. 50). Mails whose text the assistant or an agent wrote get the invisible header “X-Levuvo-AI-Assisted” when sent. Only switch it off if you always substantially rework such texts yourself.',
  // Guardrails before sending and when switching off protections (compliance-checks.ts)
  '{count} externe Empfänger sehen alle Adressen unter „An“ und „Cc“. Für Rundschreiben „Bcc“ verwenden (DSGVO Art. 5 und 32).':
    '{count} external recipients see all addresses in “To” and “Cc”. Use “Bcc” for circulars (GDPR Art. 5 and 32).',
  'Die Mail enthält {what} und geht unverschlüsselt an externe Empfänger. Besser verschlüsselt oder mit Passwort senden.':
    'The mail contains {what} and goes unencrypted to external recipients. Better send it encrypted or with a password.',
  'Die Mail enthält offenbar Gesundheitsdaten (besondere Kategorie, DSGVO Art. 9) und geht unverschlüsselt an externe Empfänger. Nur senden, wenn das nötig und erlaubt ist, am besten verschlüsselt.':
    'The mail appears to contain health data (special category, GDPR Art. 9) and goes unencrypted to external recipients. Send it only if that is necessary and permitted, preferably encrypted.',
  'eine Kartennummer': 'a card number',
  'eine Sozialversicherungsnummer': 'a social security number',
  'ein Passwort oder einen Code': 'a password or code',
  'Hinweise des Levuvo Mail Assistant (KI):': 'Notes from Levuvo Mail Assistant (AI):',
  'Du entscheidest. Trotzdem senden?': 'It is your decision. Send anyway?',
  'Automatische Updates ausschalten?': 'Switch off automatic updates?',
  'Sicherheitsupdates schließen bekannte Lücken. Ohne automatische Installation musst du jedes Update selbst laden und installieren, sonst bleibt Levuvo Mail angreifbar.':
    'Security updates close known vulnerabilities. Without automatic installation you have to download and install every update yourself, otherwise Levuvo Mail stays vulnerable.',
  'Kennzeichnung ausschalten?': 'Switch off marking?',
  'Der EU AI Act (Art. 50) verlangt, dass KI-erzeugte Texte maschinenlesbar erkennbar sind. Ausschalten ist nur vertretbar, wenn du Texte des Assistenten immer selbst wesentlich überarbeitest. Selbst geschriebene Mails werden ohnehin nie gekennzeichnet.':
    'The EU AI Act (Art. 50) requires AI-generated text to be detectable in a machine-readable way. Switching this off is only justifiable if you always substantially revise the assistant’s texts yourself. Mails you write yourself are never marked anyway.',
  Ausschalten: 'Switch off'
};
