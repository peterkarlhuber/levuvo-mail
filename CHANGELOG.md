# Änderungen

## [Unreleased]

### Build & Release
- GitHub-Actions-CI/CD: Qualitäts- und Sicherheitsprüfungen, CodeQL, Desktop-Builds für macOS ARM64, Windows ARM64 und Windows x64, Draft-Releases mit SHA-256-Prüfsummen und Manifest (siehe `RELEASING.md`, `docs/CI-CD.md`).
- LICENSE an die proprietäre Levuvo-Lizenz angepasst (zuvor GitHub-Standard MIT).

## 2.2.0 – 13. November 2026

### Neu: Mit Passwort geschützte Nachrichten
- Beim Schreiben **„Mit Passwort schützen“** wählen: Text und Anhänge werden mit einem Passwort verschlüsselt (AES-256-GCM, Schlüssel aus dem Passwort per PBKDF2-SHA256 mit 600 000 Durchläufen).
- **Funktioniert für jeden Empfänger** – ohne Konto, ohne Installation: Er öffnet die angehängte Datei „Geschuetzte-Nachricht.html“ in einem aktuellen Browser und gibt das Passwort ein. Die Entschlüsselung passiert nur in seinem Browser; die Datei lädt nichts aus dem Internet.
- Levuvo Mail schlägt ein starkes Passwort vor (kopieren, ändern, neu erzeugen), optional mit Hinweis. Das Passwort wird nirgends gespeichert.
- Empfänger mit Levuvo Mail öffnen die Nachricht direkt im Lesebereich; die eigene Kopie in „Gesendet“ ist ebenfalls geschützt. Nach fünf falschen Versuchen kurze Wartezeit.
- Sichtbar bleiben nur Absender, Empfänger und Betreff. Anhänge bis zusammen 5 MiB.

## 2.1.1 – 13. November 2026

### Neu: Kalender „Auf diesem Gerät“
- Der Kalender funktioniert jetzt **ohne Konto**: Termine, Blocker und Erinnerungen sofort eintragen – mit Wiederholungen, Erinnerungen (Systemmitteilung), Drag & Drop und Monatsübersicht.
- Gespeichert verschlüsselt auf dem Gerät (AES-256-GCM, Schlüssel im Schlüsselbund). Keine Synchronisation mit anderen Geräten – ein Hinweis in der Seitenleiste erklärt das.
- Mehrere Gerätekalender mit eigener Farbe; **Export und Import als .ics** (Sicherung, Übernahme aus anderen Kalender-Apps) unter Einstellungen → Kalender & Kontakte.
- **Termine in einen anderen Kalender verschieben:** Im Termin einfach einen anderen Kalender wählen – zwischen Gerät, CalDAV, Microsoft 365 und Google.
- Einladungen aus E-Mails können auch im Gerätekalender gespeichert werden.

### Behoben
- **Drag & Drop in der Wochen- und Tagesansicht** (sowie bei ganztägigen Terminen) hat in 2.1.0 nichts verschoben; nur die Monatsansicht funktionierte. Jetzt behoben und durch einen Ende-zu-Ende-Test abgesichert.

### Design
- „Levuvo“ und „mail.“ stehen in der Seitenleiste auf einer gemeinsamen Grundlinie, in abgestimmter Größe und Stärke.
- Der Slogan „Less effort. More impact.“ steht in einer Zeile.

## 2.1.0 – 13. November 2026

Schneller arbeiten, weniger klicken. 2.1 konzentriert sich auf Bedienbarkeit, Übersicht und die Dinge, die man jeden Tag braucht.
*Less effort. More impact.*

### Neu: Kalender & Kontakte von Microsoft 365 und Google
- Konten, die mit „Mit Microsoft anmelden“ bzw. „Mit Google anmelden“ verbunden sind, bringen ihre **Kalender und Kontakte automatisch mit** – direkt über Microsoft Graph bzw. Google Calendar/People API, ohne CalDAV-Umweg.
- Termine anlegen, bearbeiten (einzeln oder ganze Serie), löschen, Erinnerungen, Wiederholungen, Teilnehmende – Einladungen und Absagen verschickt der Anbieter selbst.
- Einladungen in der E-Mail werden im passenden Kalender des Postfachs beantwortet; der Organisator wird vom Anbieter informiert.
- Kontakte anlegen, bearbeiten, löschen, vCard-Import in das Online-Adressbuch.
- Für Konten aus 2.0 genügt **eine einmalige Freigabe** („Freigeben“-Hinweis in Kalender und Kontakten) – das Konto bleibt erhalten.

### Neu: E-Mail
- **Echte Konversationen:** Beim Lesen zeigt „Konversation“ alle zugehörigen Nachrichten – auch die eigenen Antworten aus „Gesendet“ und Nachrichten im Archiv – zum Aufklappen direkt in der Nachricht.
- **Rückgängig für alle Aktionen:** Verschieben, Archivieren, Löschen, Spam sowie Sammelaktionen lassen sich aus der Meldung heraus zurücknehmen (über die neuen UIDs vom Server, UIDPLUS).
- **Zurückstellen (Snooze):** Nachricht bis „später heute“, „heute Abend“, „morgen früh“, „Montag“, „in einer Woche“ oder frei gewählt aus dem Posteingang nehmen. Sie liegt im Serverordner „Zurückgestellt“ und kommt zur gewählten Zeit **ungelesen** zurück (Taste B).
- **Nachfassen:** Beim Senden „Nachfassen nach 1/2/3/5 Tagen oder 1 Woche“ wählen. Kommt bis dahin keine Antwort, erscheint die Nachricht unter „Nachfassen“ (mit Zähler und Systemmitteilung). Eine Antwort beendet das Nachfassen automatisch.
- **Vorlagen & Textbausteine:** Häufige Antworten speichern und mit einem Klick einfügen – mit Platzhaltern wie {Vorname}, {Name}, {Datum}, {Absender}. Verwaltung unter Einstellungen → Vorlagen.
- **Newsletter abmelden** mit einem Klick (List-Unsubscribe, One-Click nach RFC 8058, per E-Mail oder auf der Abmeldeseite). Interne Netzadressen werden aus Sicherheitsgründen nie aufgerufen.

### Bedienbarkeit & Design
- **Befehlspalette (Strg/⌘ + K):** Schreiben, Suchen, jeden Ordner, jedes Konto, jeden Bereich, jede Einstellungsseite und das Design mit ein paar Buchstaben erreichen – auch ohne Umlaute („entwurfe“).
- **Schnellaktionen in der Nachrichtenliste:** Archivieren, Löschen, Gelesen/Ungelesen und Zurückstellen direkt beim Darüberfahren.
- **Kalender:** Monatsübersicht in der Seitenleiste (Tage mit Terminen markiert), **Termine per Drag & Drop verschieben** (Woche/Tag auf 15 Minuten genau, Monat und ganztägig tageweise) – mit Rückgängig und optionaler Benachrichtigung der Teilnehmenden.
- **Einrichtung:** Anbieter als Kacheln (Microsoft 365, Gmail, GMX, WEB.DE, IONOS, Hetzner, Strato, easyname, Andere).
- Lese-Werkzeugleiste bleibt einzeilig; bei wenig Platz werden Beschriftungen zu Symbolen.
- Einheitliche Menüs für Zeitwahl (Später senden, Zurückstellen, Erinnern), sichtbare Tastaturfokusse, reduzierte Bewegung wird respektiert.
- Alle neuen Texte auf Deutsch und Englisch.

### Sicherheit
- Neue Endpunkte mit Aktions-Header (mail-v1, calendar-v1, contacts-v1, accounts-v1); OAuth-Neuanmeldung nur für dasselbe Postfach.
- One-Click-Abmeldung ohne Cookies, ohne Weiterleitungen, nur https, keine privaten/lokalen Ziele.
- Kalender-/Kontakt-Token (Microsoft Graph) getrennt vom Mail-Token und nur im Arbeitsspeicher; dauerhaft liegt weiterhin nur das Refresh-Token im Schlüsselbund.

### Entwicklung
- 197 automatische Tests, 13 Integrationstests gegen echte Server (inkl. Konversation, Rückgängig, Zurückstellen, Nachfassen, Vorlagen und Microsoft-Graph-Testserver) und 14 Ende-zu-Ende-Schritte im Browser.

### Upgrade von 2.0
Alles wird übernommen. Microsoft- und Google-Konten zeigen in Kalender und Kontakten einmalig den Hinweis „Freigeben“. Für eigene Builds müssen in der Azure-App bzw. im Google-Projekt die zusätzlichen Berechtigungen eingetragen werden (siehe `docs/OAUTH-SETUP.md`).

## 2.0.0 – 13. November 2026

Levuvo Mail wird vom E-Mail-Programm zum Arbeitsplatz für **E-Mail, Kalender und Kontakte**.
*Less effort. More impact.*

### Neu: Kalender (CalDAV)
- Tag-, Wochen-, Monats- und Agenda-Ansicht; mehrere Kalender mit Farben, ein-/ausblendbar, neue Kalender anlegen.
- Termine mit Ort, Beschreibung, ganztägig, Zeitzone (sommerzeitfest), **Wiederholungen** (täglich/wöchentlich mit Wochentagen/monatlich/jährlich, Ende nach Anzahl oder Datum) und **Erinnerungen** (Systemmitteilung, auch bei geschlossenem Fenster).
- Serien: „Nur diesen Termin“ oder „Alle Termine“ ändern bzw. löschen.
- **Einladungen (iMIP):** Teilnehmende einladen, Aktualisierungen und Absagen per E-Mail. Eingehende Einladungen erscheinen als Karte in der Nachricht – Zusagen/Vielleicht/Absagen mit Kalenderwahl; Antworten der Teilnehmenden aktualisieren den eigenen Termin.
- Getestet mit Radicale; geeignet für Nextcloud, mailbox.org, iCloud (App-Passwort), Fastmail, Posteo.

### Neu: Kontakte (CardDAV)
- Adressbuch mit Suche, Anlegen, Bearbeiten, Löschen; vCard-Import und -Export; „E-Mail schreiben“.
- Adressvorschläge beim Schreiben kombinieren Adressbuch und bisherige E-Mails.

### E-Mail
- **Echter Editor:** Fett, kursiv, unterstrichen, Überschrift, Listen, Zitat, Code, Links, Bilder; Umschalten Formatiert/Nur Text; Antworten zitieren die formatierte Nachricht.
- **HTML-Signaturen mit Logo** pro Absenderadresse; Signatur wechselt automatisch mit dem Absender.
- **Absenderadressen (Aliase/Identitäten)** pro Konto – der Server prüft, dass nur eingerichtete Adressen verwendet werden.
- **Senden rückgängig** (5–30 s, einstellbar) und **Später senden** (heute Abend, morgen früh, Montag, frei wählbar). Geplante Nachrichten liegen in „Entwürfe“; ein geöffneter geplanter Entwurf wird sofort entplant.
- **Ordnerverwaltung:** anlegen (auch Unterordner), umbenennen, leere Ordner löschen; Baumansicht.
- **Drag & Drop** einzelner oder markierter Nachrichten auf Ordner, Papierkorb oder Spam.
- **Markieren (Stern)**, Filter „Ungelesen / Markiert / Anhang“, **Spam / kein Spam**.
- Sammelaktionen in einer Anfrage für bis zu 500 Nachrichten.
- **Drucken / als PDF**, **als .eml speichern**, **Anhangsvorschau** (Bilder, PDF, Text) ohne Download.
- **Phishing-Schutz:** Auswertung von SPF/DKIM/DMARC, Warnung bei gefälschtem Anzeigenamen, irreführenden Links, abweichender Antwortadresse, Punycode-Domains, gefährlichen und makrofähigen Anhängen; Rückfrage vor dem Herunterladen gefährlicher Dateien.
- **Serverfilter und Abwesenheitsnotiz (Sieve/ManageSieve):** Regeln (Von/An/Betreff → verschieben, gelesen, markieren, Papierkorb) laufen auf dem Mailserver – auch wenn die App geschlossen ist. Vorhandene Skripte werden nur nach Bestätigung ersetzt.
- **Anmeldung mit Microsoft 365 / Outlook.com und Google (OAuth 2.0, PKCE)** – technisch fertig; Client-IDs werden beim Build hinterlegt (siehe `docs/OAUTH-SETUP.md`).
- **Ende-zu-Ende-Verschlüsselung:** OpenPGP (PGP/MIME, Schlüssel erzeugen/importieren/exportieren, Schlüssel aus E-Mails übernehmen) und S/MIME (.p12-Import, Zertifikate von Kontakten automatisch, Vertrauenskette). Signieren und/oder verschlüsseln beim Verfassen, Warnung bei fehlenden Schlüsseln; Anzeige von Verschlüsselung und Signaturstatus beim Lesen. Interoperabel mit GnuPG und OpenSSL getestet.
- **Verschlüsselter lokaler Suchindex** (AES-256-GCM, Schlüssel im Schlüsselbund): Suche „Überall“ über alle Ordner und Konten, auch offline; Offline-Lesen aus dem Index.
- Inhaltstypen von Anhängen (PDF, Bilder, Office …) werden korrekt gesetzt, damit Empfänger Vorschauen sehen.

### Oberfläche
- Neue Navigationsleiste: E-Mail · Kalender · Kontakte · Hilfe · Einstellungen (Alt+1/2/3, Alt+,).
- **Helles und dunkles Design** (oder automatisch wie das System), Logo passt sich an.
- **Englische Oberfläche** (automatisch nach Systemsprache oder fest wählbar) – alle Texte inkl. Server- und Fehlermeldungen; ein Test stellt sicher, dass keine Übersetzung fehlt.
- Einstellungen als eigener Bereich mit zehn Seiten (Allgemein, Konten, Filter & Abwesenheit, Kalender & Kontakte, Sicherheit, Suche & Offline, Mitteilungen, Datenschutz, Hilfe, Über).
- HTML-Nachrichten werden standardmäßig formatiert angezeigt (geschützte Ansicht, externe Bilder weiterhin blockiert).
- Desktop: Menü „Gehe zu“, Tray mit „Neue Nachricht“ und „Kalender“, Mitteilungen öffnen direkt Konto bzw. Kalender; native Texte auf Deutsch/Englisch.

### Datenschutz & Support
- **Absturzberichte nur mit ausdrücklicher Zustimmung** (standardmäßig aus; nur wirksam, wenn der Build eine Berichtsadresse enthält).
- **Diagnosebericht** zum Herunterladen (Version, System, Fehlerzähler – keine Inhalte, keine Adressen).
- Impressum-Platzhalter, aktualisierter Datenschutzhinweis, Handbuch (Deutsch/Englisch), Lizenzhinweise aller mitgelieferten Bibliotheken (`THIRD-PARTY-NOTICES.txt`).

### Sicherheit
- Jede schreibende Anfrage verlangt einen bereichsspezifischen Aktions-Header (mail, accounts, draft, send, calendar, contacts, crypto).
- OAuth-Rückruf ist der einzige cookiefreie Endpunkt, mit einmaligem `state` und PKCE.
- Private Schlüssel, OAuth-Token und Indexschlüssel ausschließlich im Schlüsselbund; entschlüsselte Inhalte werden nie für die Offline-Ansicht gespeichert.
- Anhangsvorschau in eigener Sandbox mit restriktiver CSP; nur Vorschau-Frames der eigenen Herkunft dürfen laden.

### Entwicklung
- 179 automatische Tests (Server, Oberflächenlogik, Desktop), Integrationstest gegen echte Server (Dovecot mit Sieve, SMTP, Radicale, OAuth-Testanbieter) und **Ende-zu-Ende-Test der gesamten Oberfläche** im Browser (`npm run test:e2e`).
- Aufgeteilte Bundles (Editor, React, Symbole) für schnelleren Start.

### Upgrade von 1.x
Konten, Passwörter und Einstellungen werden übernommen. Die Darstellung startet im Systemdesign; Sprache und Design lassen sich unter Einstellungen → Allgemein ändern.

## 1.2.0 – 13. November 2026

### Funktionen
- **Unbegrenzt blättern:** Ordner und Suchergebnisse laden ältere Nachrichten seitenweise nach (automatisch beim Scrollen). Bisher waren nur die neuesten 40 sichtbar.
- **Sofortige Zustellung per IMAP IDLE:** Eine dauerhafte, lesende Verbindung pro Konto. Neue Mails erscheinen in rund einer Sekunde statt bis zu 45 Sekunden. Das doppelte Abfragen (Fenster + Hintergrund, je alle 45 s mit neuem Login) entfällt.
- **Textvorschau** in der Nachrichtenliste, Anhang-Symbol, Ungelesen-Zähler pro Ordner.
- **Allen antworten** (Taste A), **Weiterleiten mit Anhängen** (bis 8 MiB), Antworten auf reine HTML-Mails mit sauberem Zitat.
- **Formatierte E-Mails:** Fett, kursiv, Links, Listen und Zitate über eine Werkzeugleiste; Versand als HTML mit Textversion.
- **Adressvorschläge** beim Schreiben (aus gesendeten und empfangenen Mails, nur im Arbeitsspeicher).
- **Gemeinsamer Posteingang** aller Konten.
- **Konversationsansicht** (optional): Gruppierung nach Betreff mit Verlauf im Lesebereich.
- **Beim Öffnen als gelesen markieren** (Standard, abschaltbar).
- **Offline-Ansicht:** Zuletzt geladene Ordner und Nachrichten bleiben lesbar, wenn der Server nicht erreichbar ist.
- **Eingebettete Bilder** (cid:) werden angezeigt; **externe Bilder** auf Wunsch pro Nachricht.
- **Links in HTML-Mails** sind klickbar, öffnen sich aber erst nach einer Rückfrage mit dem echten Ziel.
- **Konto-Einrichtung mit Verbindungstest:** Ein falsches Passwort wird vor dem Speichern erkannt. Voreinstellungen für Hetzner, IONOS, Strato, easyname, GMX, WEB.DE und Gmail.
- Neue Tastenkürzel: A, F, U, E, Entf, Strg/⌘+Enter.

### Darstellung
- Kompaktmodus (rund doppelt so viele Nachrichten pro Bildschirm), weniger Dekotext, klarer Status („Live“, „Offline“).
- Ordnerleiste scrollt bei kleinen Fenstern; nichts wird mehr abgeschnitten.
- Kontrast nach WCAG AA, deutlich erkennbare ungelesene Nachrichten.
- Eigene Bestätigungsdialoge statt Systemdialogen.
- Einheitlicher Slogan: „Less effort. More impact.“
- Neutrale Texte statt „Hetzner“-Bezügen.

### Sicherheit
- Content-Security-Policy für die App-Oberfläche.
- Sitzungsschlüssel liegt nicht mehr in Umgebungsvariablen; der Server wird direkt im Hauptprozess erzeugt.
- Die Desktop-App liest keine Zugangsdaten mehr aus Umgebungsvariablen.
- Versand verlangt zusätzlich einen eigenen Aktions-Header.
- Getrennte macOS-Entitlements: Library Validation bleibt in signierten Releases aktiv.
- Automatische Updates (electron-updater) für signierte Releases.
- Feste Abhängigkeitsversionen mit `package-lock.json`, CI mit `npm ci` und auf Commits gepinnten GitHub Actions.

### Fehlerbehebungen
- Fehlende Oberfläche lieferte HTTP 500 statt einer verständlichen Meldung.
- Composer zeigte einen Hinweistext mit sichtbaren Anführungszeichen.

### Entwicklung
- Server als testbare Fabrikfunktion (`createMailServer`), Oberfläche in Komponenten aufgeteilt.
- ESLint und Prettier, Verhaltenstests statt Quelltext-Vergleichen (146 Tests), optionaler Integrationstest gegen einen echten Mailserver.
- LICENSE und Datenschutzhinweis.

## 1.1.0
- Erststart ohne Demo, Konten nur im Schlüsselbund, getrennte Scrollbereiche.
