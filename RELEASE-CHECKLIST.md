# Levuvo Mail 2.2.0 – Abnahme pro Plattform

Auf **macOS arm64, Windows arm64 und Windows x64** jeweils abhaken. Automatisch bereits geprüft
(siehe `VALIDATION-REPORT.md`) ist alles, was ohne das native Betriebssystem testbar ist.

## Technik
- [ ] `npm ci` ohne Fehler
- [ ] `npm run release:check` grün (Audit, Syntax, Lint, Format, Tests, Typecheck, Build, Lizenzhinweise)
- [ ] Optional mit Testservern: `npm run test:integration` und `npm run test:e2e`
- [ ] Installer startet; bei signierten Builds keine Gatekeeper-/SmartScreen-Warnung
- [ ] Einstellungen → Über zeigt 2.2.0, Impressum ausgefüllt

## Ersteinrichtung (frisches Benutzerprofil)
- [ ] Willkommensseite in Systemsprache (Deutsch bzw. Englisch), Design folgt dem System
- [ ] Falsches Passwort → klare Meldung, nichts gespeichert; „Verbindung testen“ grün
- [ ] Falls OAuth freigeschaltet: „Mit Microsoft anmelden“ / „Mit Google anmelden“ → Browser → Konto verbunden
- [ ] Nach Neustart ist das Konto da, Passwort/Token nur im Schlüsselbund

## Upgrade von 2.0 (und 1.2)
- [ ] Bestehende Konten ohne neue Passworteingabe, Status „Live“
- [ ] Microsoft-/Google-Konto aus 2.0: Kalender zeigt „Freigeben“ → Browser → Kalender und Kontakte erscheinen, E-Mail läuft unverändert weiter

## E-Mail
- [ ] Neue Mail mit Formatierung, Bild und Anhang → beim Empfänger (Outlook, Gmail-Web, Apple Mail) korrekt
- [ ] Signatur mit Logo, Wechsel der Absenderadresse tauscht die Signatur
- [ ] Senden rückgängig; Später senden (App im Hintergrund lassen) → kommt pünktlich an
- [ ] Antworten / Allen / Weiterleiten, Entwurf automatisch gespeichert
- [ ] Ordner anlegen/umbenennen/löschen, Drag & Drop, Stern, Filter, Spam, Sammelaktionen
- [ ] Drucken/PDF, .eml speichern, Anhangsvorschau (Bild, **PDF im nativen Fenster**, Text)
- [ ] Phishing-Testmail (gefälschter Link) → rote Warnung; .exe-Anhang → Rückfrage
- [ ] Suche im Ordner und „Überall“; Netzwerk trennen → Offline-Hinweis, Suche „Überall“ funktioniert
- [ ] Neue Mail bei geschlossenem Fenster → Systemmitteilung, Klick öffnet das Konto
- [ ] Konversation zeigt eigene Antwort aus „Gesendet“; Rückgängig nach Löschen/Archivieren/Verschieben
- [ ] Zurückstellen (App im Hintergrund lassen) → Nachricht kommt pünktlich ungelesen zurück
- [ ] Nachfassen nach 1 Tag ohne Antwort → Eintrag unter „Nachfassen“ + Systemmitteilung; mit Antwort → verschwindet
- [ ] Vorlage speichern, mit Platzhaltern einfügen; Befehlspalette (Strg/⌘ + K) auf allen Plattformen
- [ ] Newsletter mit One-Click-Abmeldung (z. B. echter Newsletter) → „Abgemeldet“

## Filter & Abwesenheit
- [ ] Regel und Abwesenheitsnotiz speichern (Anbieter mit ManageSieve) → Testmail wird verschoben bzw. beantwortet

## Kalender & Kontakte
- [ ] CalDAV/CardDAV (z. B. Nextcloud) verbinden
- [ ] **Microsoft 365** (echtes Konto, nach Eintragen der Client-ID): Kalender, Termin anlegen/verschieben/löschen, Einladung beantworten, Kontakte anlegen
- [ ] **Google** (echtes Konto, Calendar- und People-API im Projekt aktiviert): dasselbe
- [ ] Termin per Drag & Drop verschieben (Woche, Tag, Monat, ganztägig), Rückgängig
- [ ] Ohne Kalenderkonto: Termin „Auf diesem Gerät“ mit Erinnerung → Systemmitteilung; .ics exportieren und in Apple Kalender/Outlook öffnen; Termin in verbundenen Kalender verschieben
- [ ] Termin, Serientermin, „nur diesen“/„alle“ ändern und löschen, Zeitzone über Sommerzeit
- [ ] Erinnerung erscheint als Systemmitteilung (auch Fenster geschlossen), Klick öffnet den Kalender
- [ ] Einladung an Outlook-/Gmail-Adresse → Annahme dort → Status in Levuvo übernehmen
- [ ] Einladung aus Outlook/Google empfangen → Zusagen → Termin im Kalender, Organisator erhält Antwort
- [ ] Kontakte anlegen, vCard-Import aus Outlook/Apple, Export, „E-Mail schreiben“

## Verschlüsselung
- [ ] Mit Passwort geschützte Nachricht an Gmail, Outlook.com und ein Firmenpostfach → Datei kommt an, öffnet in Chrome/Edge/Safari (Desktop) und Safari/Chrome (Handy, „In Safari öffnen“); falsches Passwort wird abgelehnt
- [ ] OpenPGP mit Thunderbird: Schlüssel austauschen, verschlüsselt + signiert in beide Richtungen
- [ ] S/MIME mit Outlook: .p12 importieren, signiert + verschlüsselt in beide Richtungen

## Darstellung
- [ ] Hell und Dunkel, Deutsch und Englisch: keine abgeschnittenen Texte
- [ ] 1440×900, 1280×800, Mindestgröße 900×600

## Release
- [ ] `release:manifest` und `release:verify` erfolgreich
- [ ] Signierte Builds: Update-Dateien hochgeladen, Testupdate 2.2.0 → 2.2.1 einmal durchgespielt
- [ ] Datenschutzhinweis rechtlich geprüft, Impressum eingesetzt
