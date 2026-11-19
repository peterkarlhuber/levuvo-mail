# Levuvo Mail 2.3 – Handbuch

*Less effort. More impact.*

Levuvo Mail vereint E-Mail, Kalender und Kontakte in einer App für macOS und Windows. Alles läuft
auf deinem Gerät; Levuvo sieht weder deine Nachrichten noch deine Zugangsdaten.

**Inhalt:** 1 Installation · 2 Konto einrichten · 3 Die Oberfläche · 4 Lesen · 5 Schreiben ·
6 Ordnung halten · 7 Suche & Offline · 8 Filter & Abwesenheit · 9 Kalender · 10 Kontakte ·
11 Verschlüsselung · 12 Sicherheit & Phishing · 13 Einstellungen · 14 Tastenkürzel ·
15 Fehlerbehebung · 16 Datenschutz · 17 Levuvo Mail Assistant (KI) · 18 Aufgaben · 19 Räume ·
20 Sicherung & Umzug · 21 Neue Absender & Bündel

---

## 1 Installation

- **macOS (Apple Silicon):** DMG öffnen, Levuvo Mail in „Programme“ ziehen, von dort starten.
- **Windows (ARM64/x64):** Setup ausführen. Installation pro Benutzer, ohne Administratorrechte.

Levuvo Mail läuft nach dem Schließen des Fensters im Hintergrund weiter (Menüleiste bzw. Infobereich),
damit Mitteilungen, Terminerinnerungen und geplante Nachrichten funktionieren. Beenden über das Menü
oder das Symbol im Infobereich. „Bei Anmeldung automatisch starten“ ist dort ebenfalls einstellbar.

Signierte Versionen aktualisieren sich selbst (Prüfung alle sechs Stunden, Installation nach Rückfrage
beim Neustart). Manuell: Menü → „Nach Updates suchen …“.

## 2 Konto einrichten

**Einstellungen → Konten → Konto hinzufügen** (beim ersten Start automatisch).

1. **Anbieter** per Kachel wählen (Microsoft 365, Gmail, GMX, WEB.DE, IONOS, Hetzner, Strato, easyname
   oder „Anderer Anbieter“). Bei bekannten Domains (z. B. gmx.at) wird der Anbieter automatisch erkannt.
2. **E-Mail-Adresse** und **Passwort** eingeben, optional Kontoname und dein Name als Absender.
3. **Konto einrichten** – die Verbindung zu Empfang (IMAP) und Versand (SMTP) wird geprüft,
   bevor etwas gespeichert wird. Das Passwort landet im Schlüsselbund des Betriebssystems.

**Microsoft 365 / Outlook.com und Gmail:** Wenn dein Build die Anmeldung freigeschaltet hat, erscheinen
„Mit Microsoft anmelden“ bzw. „Mit Google anmelden“. Der Browser öffnet sich, du meldest dich dort an,
die App übernimmt das Konto automatisch. Gmail funktioniert alternativ mit einem **App-Passwort**.
Mit dieser Anmeldung kommen ab 2.1 auch **Kalender und Kontakte** des Kontos automatisch mit (Kapitel 9 und 10).

**Servereinstellungen** (nur bei „Anderer Anbieter“ nötig): IMAP-Server (nur 993/TLS), SMTP-Server
(587/STARTTLS oder 465/TLS), abweichender SMTP-Benutzer, Ordner für „Gesendet“/„Entwürfe“,
Filterserver (Sieve, Port 4190 oder 2000).

Nach dem Speichern kannst du beim Bearbeiten des Kontos außerdem festlegen:
- **Signatur** – formatiert, mit Links und einem kleinen Logo (bis 200 KB).
- **Weitere Absenderadressen (Aliase)** – z. B. office@ und rechnung@, jeweils mit eigenem Namen und eigener
  Signatur. Nur Adressen eintragen, die dein Mailserver für dieses Postfach zum Senden erlaubt.

Bis zu fünf Konten. „Entfernen“ löscht nur die Einrichtung auf diesem Gerät, nie E-Mails auf dem Server.

## 3 Die Oberfläche

Links die **Navigationsleiste**: E-Mail, Kalender, Kontakte, Räume, Aufgaben, Assistent, Hilfe, Einstellungen
(Alt+1 bis Alt+5, Strg/⌘+J für den Assistenten, Alt+, für die Einstellungen).

Im Bereich E-Mail: **Ordnerleiste** – **Nachrichtenliste** – **Lesebereich**. Die Breite der Liste lässt
sich mit der Maus oder den Pfeiltasten am Trenner ändern (Doppelklick setzt zurück). Die Anzeige oben
rechts zeigt den Verbindungsstatus: **Live** (neue Mails erscheinen sofort), **Verbinde …**,
**Offline** oder **Gestört**.

Mit mehreren Konten wechselst du unten links das Konto; „Alle Posteingänge“ zeigt die neuesten
Nachrichten aller Konten gemeinsam.

**Befehlspalette – Strg + K (Mac: ⌘ + K)** oder das ⌘-Symbol in der Navigationsleiste: ein paar
Buchstaben tippen und mit Enter ausführen – „Neue E-Mail“, „suchen“, jeden Ordner („entw“ → Entwürfe),
jedes Konto, Kalender/Kontakte, jede Einstellungsseite, helles/dunkles Design. Umlaute sind beim Tippen
egal, ↑/↓ wählt, Esc schließt.

**Schnellaktionen:** Fährst du mit der Maus über eine Nachricht in der Liste, erscheinen Archivieren,
Papierkorb, Gelesen/Ungelesen und Zurückstellen – ohne die Nachricht zu öffnen.

## 4 Lesen

- Klick auf eine Nachricht öffnet sie. **J/K** blättern. Optional wird sie beim Öffnen als gelesen markiert.
- **Formatierte Nachrichten** erscheinen in einer geschützten Ansicht: keine Skripte, Links fragen vor
  dem Öffnen nach dem echten Ziel, **externe Bilder sind blockiert** (Schaltfläche „Bilder laden“ pro Nachricht).
  Über „Text/HTML“ wechselst du zur Textfassung.
- **Anhänge:** Auge-Symbol = Vorschau (Bilder, PDF, Text) ohne Download; Pfeil = Herunterladen.
  Gefährliche Dateitypen (z. B. .exe, .js) sind markiert und verlangen eine Bestätigung.
- **Weitere Aktionen (…):** Drucken / als PDF speichern, als .eml speichern.
- **Konversation:** Gehört die Nachricht zu einem Austausch, zeigt der Kasten „Konversation“ alle
  zugehörigen Nachrichten – auch deine Antworten aus „Gesendet“ und bereits archivierte. Ein Klick klappt
  eine Nachricht auf, „Ganze Nachricht öffnen“ springt hin. In der Liste fasst die Einstellung
  „Konversationen“ (Einstellungen → Allgemein) zusammengehörige Nachrichten zusammen.
- **Newsletter abmelden:** Bietet der Absender eine Abmeldung an, erscheint über dem Text „Newsletter
  oder Werbung von …“ mit **Abmelden**. Je nach Absender meldet Levuvo Mail dich direkt ab (One-Click),
  schickt eine Abmelde-E-Mail oder öffnet die Abmeldeseite im Browser – vorher wird immer nachgefragt.
  Danach kannst du die Nachricht gleich löschen.

## 5 Schreiben

**Neue Nachricht** (Taste N), **Antworten** (R), **Allen antworten** (A), **Weiterleiten** (F, inkl. Anhänge bis 8 MiB).

- **Von:** Absenderadresse wählen – die passende Signatur wird automatisch eingesetzt bzw. getauscht.
- **An/CC/BCC:** Vorschläge aus Adressbuch und bisherigen E-Mails. BCC-Empfänger sind für andere unsichtbar.
- **Formatiert / Nur Text:** Werkzeugleiste für Fett, Kursiv, Unterstrichen, Durchgestrichen, Überschrift,
  Listen, Zitat, Code, Link, Bild (bis 1 MB im Text), Formatierung entfernen, Rückgängig/Wiederholen.
- **Anhänge:** bis acht Dateien, zusammen 8 MiB – per Auswahl oder Drag & Drop ins Fenster.
- **Entwürfe** werden automatisch gespeichert; „Als Entwurf schließen“ legt den Stand ab.
- **Senden** (Strg/⌘ + Enter): Einige Sekunden lang erscheint unten „Wird in … s gesendet – Rückgängig“.
  Rückgängig öffnet die Nachricht wieder. Die Dauer (aus, 5–30 s) stellst du unter Einstellungen → Allgemein ein.
- **Später senden:** Pfeil neben „Senden“ → heute Abend, morgen früh, Montag früh oder Datum/Uhrzeit.
  Die Nachricht liegt bis dahin in „Entwürfe“ (mit Hinweis „Geplanter Versand“). Levuvo Mail muss zum
  Zeitpunkt laufen – auch im Hintergrund genügt; sonst geht sie beim nächsten Start hinaus. Öffnest du eine
  geplante Nachricht mit „Bearbeiten“, wird die Planung sofort aufgehoben.
- **Nachfassen:** Unten links im Editor „Nachfassen nach 1/2/3/5 Tagen oder 1 Woche“ wählen. Kommt
  bis dahin keine Antwort, erscheint die Nachricht unter **Nachfassen** in der Ordnerleiste (mit Zähler)
  und du bekommst eine Mitteilung. Dort: „In ‚Gesendet‘ zeigen“, „Später erinnern“ oder „Erledigt“.
  Antwortet der Empfänger vorher, verschwindet der Eintrag von selbst.
- **Vorlagen:** Schaltfläche **Vorlagen** über dem Text – Vorlage wählen und einfügen, oder „Aktuelle
  Nachricht als Vorlage speichern“. Platzhalter wie {Vorname}, {Name}, {Datum} und {Absender} werden beim
  Einfügen ersetzt; was sich nicht ermitteln lässt, bleibt markiert stehen. Verwalten unter
  Einstellungen → Vorlagen.
- **Verschlüsselung:** siehe Kapitel 11.

## 6 Ordnung halten

- **Markieren (Stern):** Taste S oder Stern in der Liste. Filter oben: Alle · Ungelesen · Markiert · Anhang.
- **Archivieren** (E), **Spam / kein Spam** (!), **Papierkorb** (Entf), **Verschieben** (Auswahlfeld im Lesebereich).
- **Drag & Drop:** Nachricht (oder alle angehakten) auf einen Ordner ziehen. Auf „Papierkorb“ bzw. „Spam“
  gezogen, wird sie entsprechend behandelt.
- **Sammelaktionen:** Häkchen setzen (oder „Alle sichtbaren auswählen“) – dann gelesen/ungelesen,
  markieren, archivieren, Spam, Papierkorb für bis zu 500 Nachrichten auf einmal.
- **Ordner:** „Neuer Ordner“ unter der Ordnerliste. Rechtsklick (oder „…“) auf einen Ordner: Unterordner
  anlegen, umbenennen, löschen. Systemordner sind geschützt; gelöscht werden nur leere Ordner.
- Fehlt ein Archivordner, legt Levuvo Mail ihn auf Wunsch an.
- **Rückgängig:** Nach Verschieben, Archivieren, Löschen, Spam oder einer Sammelaktion erscheint unten
  eine Meldung mit **Rückgängig** – ein Klick holt die Nachrichten zurück.
- **Zurückstellen** (Taste B, Wecker-Symbol): Nachricht bis später heute, heute Abend, morgen früh,
  Montag, in einer Woche oder zu einer gewählten Zeit aus dem Posteingang nehmen. Sie wartet im Ordner
  **Zurückgestellt** auf dem Server und kommt zur gewählten Zeit **ungelesen** in den Posteingang zurück
  (Levuvo Mail muss dazu laufen – im Hintergrund genügt). „Jetzt zurückholen“ beim Lesen holt sie sofort.

## 7 Suche & Offline

- **In diesem Ordner:** Suchfeld (Taste /) durchsucht Betreff, Absender und Inhalt auf dem Mailserver.
- **Überall:** Schalter „Überall“ neben dem Suchfeld durchsucht alle Ordner und Konten über den
  **lokalen, verschlüsselten Suchindex** (SQLite, mit SQLCipher verschlüsselt) – auch ohne Internet. Der Index wird im Hintergrund aufgebaut
  (Einstellungen → Suche & Offline: Status, „Jetzt aktualisieren“, „Neu aufbauen“, abschalten).
- **Offline:** Ohne Verbindung zeigt die App zuletzt geladene Listen und Nachrichten bzw. den Text aus dem
  Index. Verschieben und Senden sind erst wieder online möglich.

## 8 Filter & Abwesenheit

**Einstellungen → Filter & Abwesenheit** (je Konto). Die Regeln laufen **auf deinem Mailserver**
(Sieve) und wirken daher auch, wenn Levuvo Mail geschlossen ist. Voraussetzung: dein Anbieter bietet
ManageSieve an (bei Microsoft- und Google-Anmeldung stattdessen im Webmail einrichten).

- **Abwesenheitsnotiz:** aktivieren, optional Von/Bis-Datum, Betreff, Text, „höchstens alle … Tage“ je Absender.
  Der Text lässt sich wie die Signatur formatieren (fett, Links, Bilder). **„Signatur des Kontos anhängen
  (mit Logo)“** fügt die Signatur beim Speichern an – nach einer Änderung an der Signatur bitte erneut
  speichern. Die Notiz wird mit einer Textversion gespeichert; Bilder reisen in der Antwort mit (nichts wird
  aus dem Internet nachgeladen). Kann dein Mailserver nur Text-Antworten senden, speichert Levuvo Mail die
  Textversion und weist darauf hin.
- **Regeln:** „Wenn alle/eine der Bedingungen zutreffen“ (Von, An/CC, Betreff, Kopfzeilen – enthält,
  ist genau, enthält nicht) → Aktionen (in Ordner verschieben, als gelesen markieren, markieren,
  Papierkorb). Reihenfolge mit den Pfeilen, „danach keine weiteren Regeln anwenden“ möglich.
- **Auf dem Server speichern.** Ist bereits ein anderes Filterskript aktiv (z. B. aus dem Webmail),
  fragt Levuvo Mail vor dem Ersetzen; das alte Skript bleibt auf dem Server gespeichert.

## 9 Kalender

**Microsoft 365 und Google:** Mit „Mit Microsoft/Google anmelden“ verbundene Konten bringen ihre
Kalender automatisch mit. Bei Konten aus Version 2.0 erscheint einmalig **„Kalender & Kontakte
verbinden – Freigeben“**; nach der Freigabe im Browser sind die Kalender da. Einladungen und Absagen
verschickt in diesem Fall der Anbieter selbst.

**Ohne Konto – „Auf diesem Gerät“:** Der Kalender funktioniert sofort, auch ganz ohne Verbindung. Termine,
Blocker und Erinnerungen landen im Kalender „Persönlich · Auf diesem Gerät“ (verschlüsselt gespeichert,
Erinnerungen als Systemmitteilung). Sie erscheinen nicht auf dem Handy oder anderen Geräten. Unter
Einstellungen → Kalender & Kontakte kannst du weitere Gerätekalender anlegen, Farben ändern, als **.ics
exportieren** (Sicherung) und **.ics importieren** (z. B. aus einer anderen Kalender-App).

**Andere Anbieter:** **Einstellungen → Kalender & Kontakte → Kalender/Kontakte verbinden** (CalDAV/CardDAV).
Vorlagen für Nextcloud, mailbox.org, iCloud, Fastmail und Posteo; Passwort (am besten ein App-Passwort)
liegt im Schlüsselbund.

- **Ansichten:** Tag, Woche, Monat, Agenda; „Heute“, Pfeile zum Blättern. Klick auf einen Tag öffnet die Tagesansicht.
- **Monatsübersicht** links: springt zu jedem Tag; Tage mit Terminen haben einen Punkt.
- **Verschieben per Drag & Drop:** Termin in der Wochen-/Tagesansicht an eine andere Uhrzeit oder einen
  anderen Tag ziehen (auf 15 Minuten genau), in der Monatsansicht auf einen anderen Tag. Mit Teilnehmenden
  fragt Levuvo Mail, ob sie informiert werden sollen; „Rückgängig“ in der Meldung setzt zurück.
  Serientermine änderst du über den Termin („Nur diesen“ / „Alle“).
- **In einen anderen Kalender verschieben:** Termin öffnen und unter „Kalender“ einen anderen wählen –
  z. B. vom Gerät in den Nextcloud- oder Microsoft-Kalender.
- **Neuer Termin:** Schaltfläche, Klick in ein freies Zeitfeld (Woche/Tag) oder Doppelklick (Monat).
  Titel, Kalender, ganztägig, Beginn/Ende, Ort, Beschreibung, Erinnerung.
- **Wiederholung:** täglich, wöchentlich (Wochentage wählbar), monatlich, jährlich; Intervall; Ende nie,
  nach Anzahl oder an einem Datum. Beim Ändern/Löschen eines Serientermins: „Nur diesen Termin“ oder
  „Alle Termine der Serie“.
- **Erinnerungen** erscheinen als Systemmitteilung, auch bei geschlossenem Fenster.
- **Einladungen:** Teilnehmende per E-Mail-Adresse eintragen und „Einladung per E-Mail senden“ –
  sie erhalten eine Standard-Einladung (iCalendar), die auch Outlook, Apple Kalender und Google verstehen.
  Änderungen und Absagen werden ebenfalls verschickt.
- **Einladung erhalten:** In der E-Mail erscheint eine Einladungskarte – Kalender wählen und
  **Zusagen / Vielleicht / Absagen**. Der Organisator erhält deine Antwort, der Termin landet in deinem Kalender.
  Antworten auf deine eigenen Einladungen übernimmst du mit „Im Kalender übernehmen“ (Teilnahmestatus),
  Absagen mit „Aus dem Kalender entfernen“.
- Links: Kalender ein-/ausblenden; Farben und neue Kalender unter „Kalender verwalten“.

## 10 Kontakte

- Microsoft-365- und Google-Konten zeigen ihr Online-Adressbuch automatisch (nach der Freigabe, siehe Kapitel 9).
- Suchen, **Neuer Kontakt** (Name, Firma, Position, mehrere E-Mail-Adressen und Telefonnummern,
  Adresse, Geburtstag, Notiz), Bearbeiten, Löschen.
- **E-Mail schreiben** öffnet direkt eine neue Nachricht an den Kontakt.
- **Import** einer .vcf-Datei (z. B. Export aus Outlook, Apple Kontakte, Google) und **Export** aller Kontakte.

## 11 Verschlüsselung

**Mit Passwort schützen – für jeden Empfänger, ohne Einrichtung**

Ideal für Zugangsdaten, Verträge oder persönliche Dokumente an Menschen, die keine Verschlüsselung
eingerichtet haben.

1. Beim Schreiben im Auswahlfeld neben „Formatiert/Nur Text“ **„Mit Passwort schützen“** wählen.
2. Levuvo Mail schlägt ein starkes Passwort vor (ändern, kopieren oder neu erzeugen möglich; mindestens
   10 Zeichen). Optional einen **Hinweis** eintragen – er ist für jeden lesbar und darf das Passwort nicht enthalten.
3. Senden. Text und Anhänge (zusammen bis 5 MiB) werden mit dem Passwort verschlüsselt (AES-256-GCM,
   PBKDF2-SHA256). Sichtbar bleiben nur Absender, Empfänger und **Betreff** – also nichts Vertrauliches in den Betreff schreiben.
4. Das Passwort **auf einem anderen Weg** mitteilen – per SMS, Telefon oder Messenger, nie in derselben E-Mail.

**Der Empfänger** erhält eine E-Mail mit der Datei „Geschuetzte-Nachricht.html“. Er speichert sie, öffnet
sie in einem aktuellen Browser (Chrome, Edge, Firefox, Safari) und gibt das Passwort ein. Die
Entschlüsselung passiert nur in seinem Browser; es wird nichts übers Internet geladen. Wer Levuvo Mail
nutzt, gibt das Passwort direkt in der Nachricht ein. Auch deine eigene Kopie in „Gesendet“ ist geschützt
und öffnet sich mit demselben Passwort.

Grenzen: Die Nachricht läuft nicht ab und lässt sich nicht zurückziehen. In der Mail-Vorschau mancher
Handys (z. B. iPhone Mail) laufen keine Skripte – dann die Datei in Safari bzw. Chrome öffnen. Strenge
Firmen-Mailfilter können .html-Anhänge zurückhalten. Für Passwörter, die dauerhaft geteilt werden, ist ein
Passwort-Manager mit Teilen-Funktion oft die bessere Wahl.

**Einstellungen → Sicherheit** (für OpenPGP und S/MIME).

**OpenPGP** (kompatibel mit Thunderbird, GnuPG, Proton u. a.)
1. **Schlüssel erzeugen** für eine deiner Adressen und eine Passphrase (mind. 8 Zeichen) festlegen.
   Die Passphrase gut aufbewahren – ohne sie sind verschlüsselte Nachrichten nicht mehr lesbar.
2. Den **öffentlichen Schlüssel exportieren** und an Kontakte senden.
3. Schlüssel von Kontakten **importieren** (.asc) oder direkt aus einer E-Mail mit „Schlüssel importieren“.
   Vorher den Fingerabdruck auf anderem Weg vergleichen.
4. Zum Lesen/Signieren den eigenen Schlüssel **entsperren** (bleibt 30 Minuten entsperrt).

**S/MIME** (Standard in Outlook/Apple Mail)
1. Eigenes Zertifikat einer Zertifizierungsstelle als **.p12/.pfx** importieren (Passwort der Datei).
   Ältere „Legacy“-Dateien (RC2) bitte mit AES neu exportieren.
2. Zertifikate von Kontakten werden aus signierten E-Mails automatisch übernommen oder manuell importiert.
3. Optional eigene Stammzertifikate („Zertifizierungsstelle vertrauen“) für Firmen-PKI.

**Beim Schreiben:** Auswahlfeld neben „Formatiert/Nur Text“ → OpenPGP oder S/MIME, dann „Signieren“ und/oder
„Verschlüsseln“. Fehlen Schlüssel für Empfänger oder dich selbst, zeigt die App das vor dem Senden an.
Antworten auf verschlüsselte Nachrichten werden automatisch wieder verschlüsselt.

**Beim Lesen** zeigen Plaketten „verschlüsselt“ und den Signaturstatus („Signiert von …“, „Schlüssel
unbekannt“, „nicht vertrauenswürdig“, „Signatur ungültig“). Bei gesperrtem Schlüssel: „Entschlüsseln“.

## 12 Sicherheit & Phishing

Levuvo Mail prüft jede Nachricht und warnt deutlich, wenn
- der Mailserver die Absenderprüfung (SPF/DKIM/DMARC) als fehlgeschlagen vermerkt hat,
- der angezeigte Name eine andere Adresse vortäuscht,
- ein Link etwas anderes anzeigt, als er öffnet,
- Antworten an eine fremde Domain gehen oder die Domain ungewöhnliche Schriftzeichen enthält,
- Anhänge ausführbar sind oder Makros enthalten können.

Eine Warnung ist ein starker Hinweis, aber kein Beweis. Im Zweifel: keine Zugangsdaten eingeben, keine
Zahlung veranlassen und den Absender auf anderem Weg kontaktieren.

Weitere Schutzmaßnahmen: geschützte HTML-Ansicht ohne Skripte, blockierte externe Bilder, Links mit
Rückfrage, Passwörter/Token/Schlüssel nur im Schlüsselbund, die App ist nur von deinem eigenen Gerät erreichbar.

## 13 Einstellungen

| Seite | Inhalt |
|---|---|
| Allgemein | Sprache (System/Deutsch/English), Design (System/Hell/Dunkel), Dichte, beim Öffnen gelesen, Konversationen, Standardformat, Senden rückgängig, Kalender-Startansicht |
| Konten | Konten, Anmeldung mit Microsoft/Google, Signaturen, Absenderadressen, Verbindungsstatus und -test |
| Vorlagen | Textbausteine mit Platzhaltern anlegen, bearbeiten, löschen |
| Filter & Abwesenheit | Serverregeln und Abwesenheitsnotiz |
| Kalender & Kontakte | CalDAV/CardDAV-Verbindungen, Kalenderfarben (auch Microsoft/Google), ein-/ausblenden, neue Kalender |
| Sicherheit | OpenPGP-Schlüssel, S/MIME-Zertifikate |
| Suche & Offline | lokaler Suchindex |
| Mitteilungen | Erlaubnis, jetzt prüfen |
| Datenschutz | Absturzberichte (freiwillig), Diagnosebericht |
| Hilfe / Über | Kurzhilfe, Tastenkürzel, Version, Impressum, Lizenzen |

## 14 Tastenkürzel

| Taste | Aktion |
|---|---|
| J / K | nächste / vorherige Nachricht |
| N | neue Nachricht |
| R / A / F | antworten / allen antworten / weiterleiten |
| U | gelesen ↔ ungelesen |
| S | markieren (Stern) |
| E | archivieren |
| B | zurückstellen |
| Strg/⌘ + K | Befehlspalette |
| Strg/⌘ + J | Levuvo Mail Assistant |
| ! | Spam / kein Spam |
| Entf | Papierkorb |
| P | drucken / PDF |
| / | suchen |
| Strg/⌘ + Enter | senden (im Editor) |
| Alt + 1 · 2 · 3 · 4 · 5 | E-Mail · Kalender · Kontakte · Räume · Aufgaben |
| Strg/⌘ + J | Assistent |
| Alt + , | Einstellungen |
| Esc | schließen / Auswahl aufheben |
| ? | Übersicht |

## 15 Fehlerbehebung

| Problem | Lösung |
|---|---|
| „Zugang prüfen“ beim Start | Schlüsselbund entsperren (macOS) bzw. Windows-Anmeldung prüfen; danach „Erneut prüfen“. Nichts wurde gelöscht. |
| Anmeldung fehlgeschlagen | Passwort prüfen; bei GMX/WEB.DE IMAP im Webmail aktivieren; bei Gmail App-Passwort oder „Mit Google anmelden“. |
| Versand mit Microsoft 365 schlägt fehl | „Authentifiziertes SMTP“ für das Postfach aktivieren lassen (Admin). |
| Filter „nicht verfügbar“ | Anbieter ohne ManageSieve – Filterserver/Port in den Kontoeinstellungen prüfen oder Regeln im Webmail anlegen. |
| Kalender verbindet nicht | Server-Adresse (https, z. B. …/remote.php/dav), Benutzername, App-Passwort prüfen. |
| Kalender/Kontakte von Microsoft oder Google fehlen | Hinweis „Freigeben“ in Kalender oder Kontakten anklicken und im Browser mit **demselben** Konto bestätigen. In Firmen muss ggf. die IT der App zustimmen. |
| Zurückgestellte Nachricht kommt nicht | Levuvo Mail muss zur Zeit laufen (Hintergrund genügt); sonst kommt sie beim nächsten Start. Im Ordner „Zurückgestellt“ jederzeit „Jetzt zurückholen“. |
| Geplante Nachricht nicht gesendet | Levuvo Mail muss laufen (Hintergrund genügt). Status steht beim Entwurf. |
| „Speicherstatus unklar“ beim Entwurf | Entwürfe-Ordner prüfen, nicht sofort erneut speichern (verhindert Duplikate). |
| Support | Einstellungen → Datenschutz → **Diagnosebericht herunterladen** und mitschicken – er enthält keine Inhalte oder Adressen. Bitte nie Passwörter weitergeben. |

## 16 Datenschutz

Siehe `PRIVACY.md` (englisch). Kurz: keine Telemetrie, keine Werbung, keine Levuvo-Server im Datenweg;
Absturzberichte nur, wenn du sie einschaltest.

## 17 Levuvo Mail Assistant (KI)

Der Assistent ist **standardmäßig aus**. Einschalten unter **Einstellungen → KI & Agenten**. Er arbeitet
mit einem lokalen Modell auf diesem Computer. Levuvo bringt dafür ein **eigenes Ollama** mit, getrennt von
einem Ollama, das du selbst installiert hast. Modelle sind nicht im Installer: Wähle im Feld
**Sprachmodell** eines aus der Liste (klein ab 8 GB RAM, Standard ab 16 GB, groß ab 32 GB; die passende
Größe für diesen Computer ist vorgeschlagen, z. B. **Qwen3.5 9B**), dann lädt Levuvo es mit
Fortschrittsbalken herunter. „Abbrechen“ hält an, „Fortsetzen“ macht später weiter, „Löschen“ gibt den
Platz wieder frei. Für die Suche nach Bedeutung ist **BGE-M3** voreingestellt (auf deutschen Mails am
genauesten); ein anderes Suchmodell baut den Suchindex im Hintergrund neu auf. Jedes Modell wird nach dem
Download mit seiner festgelegten Prüfsumme verglichen. Cloud-Modelle (Anthropic, OpenAI) gehen nur nach einer Einwilligung und nie für
Konten mit „Keine Cloud-KI“. Alle Ergebnisse sind als **KI-generiert** gekennzeichnet; im Lesebereich
und beim Schreiben wird nur nach deinem Klick gesendet, gespeichert oder verschoben. Was bei einem
Cloud-Modell übertragen wird, steht im Einwilligungsdialog und in PRIVACY.md (auch Stilproben, Suchtreffer
und was Routinen lesen). Das Einsortieren in Bündel im Hintergrund läuft nur mit dem lokalen Modell.

**In einer Nachricht:** Zusammenfassen (wer will was bis wann, Fristen, Beträge, offene Fragen),
Übersetzen, Termine/Aufgaben/Kontakte finden und mit „Übernehmen“ speichern, Echtheit prüfen
(Druck, Zahlungsaufforderung, geänderte IBAN, falscher Absender).

**Beim Schreiben (Knopf „Assistent“):** Antwort vorschlagen (auch aus deinen Stichworten), Stichpunkte zu
fertiger Mail, Umformulieren (kürzer, höflicher, förmlicher, lockerer, Rechtschreibung, Englisch, Deutsch)
mit „Rückgängig“. Vor dem Senden prüft der Assistent auf vergessenen Anhang, scharfen Ton, falsche
Empfänger und sensible Daten; du entscheidest, ob trotzdem gesendet wird.

**Schreibstil:** Tonfall, Anrede (du/Sie), Grußformel und eigene Anweisungen. Zusätzlich bekommt der
Assistent bei Antwortvorschlägen und „Stichpunkte zu fertiger Mail“ bis zu fünf deiner zuletzt gesendeten
Mails als Stilprobe (nur dein eigener Text, kein Training); bei einem Cloud-Modell gehen sie mit an den
Anbieter. Eine Umformulierung bleibt mit „Vom Assistenten geändert · Rückgängig“ markiert.

**Stil pro Kontakt lernen** (aus, zum Einschalten unter Schreibstil): Levuvo Mail liest deine gesendeten
Mails im lokalen Suchindex und merkt sich je Kontakt Anrede („Hallo Anna,“), Gruß („LG“) und Du oder Sie.
Dafür läuft kein KI-Modell; gespeichert wird verschlüsselt nur auf diesem Gerät, nicht im Backup. Ein
Antwortvorschlag an Anna übernimmt dann ihre Anrede und eure Du/Sie-Form (vor der allgemeinen Einstellung)
und nimmt deine Mails an sie als Stilprobe; der Entwurf zeigt „Im Stil deiner Mails an …“. Die Tabelle zeigt,
was gelernt wurde; einzelne Kontakte oder alles lassen sich löschen, Ausschalten löscht ebenfalls alles.

**Filter in Worten:** unter Einstellungen → Filter z. B. „Rechnungen von Lieferanten in den Ordner
Buchhaltung“ eingeben, „Regel vorschlagen“, prüfen, speichern.

**Assistent-Fenster (✦ links oder Strg/⌘ + J):**
- **Frage:** „Was hat Müller zum Angebot gesagt?“ – kurze Antwort mit den Quell-Mails zum Anklicken, jeweils
  mit Absender, Datum und einer zitierten Stelle (nur Stellen, die wörtlich in der Mail stehen). Die Suche
  verbindet Bedeutung und genaue Wörter, findet also auch Namen, Rechnungsnummern und seltene Begriffe, und
  liest PDF- und Textanhänge der besten Treffer. Rückfragen wie „Und der Preis?“ beziehen sich auf die
  vorige Antwort; das Papierkorb-Symbol beginnt ein neues Gespräch.
- **Aufgabe:** „Kläre mit Anna einen Termin nächste Woche“ – der Assistent sucht freie Zeiten und legt
  einen Entwurf an. Gesendet wird nichts.
- **Routinen:** Tagesbriefing, Offene Antworten, Newsletter aufräumen, Meeting vorbereiten, Termin
  vereinbaren, Antwortentwürfe vorbereiten.
- **Freigaben:** was Agenten vorbereitet haben (Mail senden, Termin mit Teilnehmern, Kontakt, Aufgabe,
  Papierkorb) – „Freigeben“ oder „Ablehnen“.
- **Breite ändern:** den Griff am linken Rand des Fensters nach links (breiter) oder rechts (schmaler)
  ziehen, 340 bis 960 Pixel; ein Teil der App bleibt immer sichtbar. Mit der Tastatur: Tab auf den Griff,
  dann Pfeil links/rechts (mit Umschalt in größeren Schritten), Pos1 für die schmalste, Ende für die
  breiteste Breite. Doppelklick setzt auf 420 Pixel zurück. Die Breite bleibt gespeichert, auch in der
  Sicherung. Auf dem Handy füllt der Assistent den Bildschirm.

**Agenten (MCP-Server):** Unter Einstellungen → KI & Agenten den MCP-Server einschalten, einen Agenten
anlegen (Stufe Lesen, Entwürfe, Ordnen oder Alles inkl. Senden) und den einmal angezeigten Token bzw. die
fertige Konfiguration in Claude Desktop oder Claude Code eintragen. Der Server ist nur auf diesem
Computer erreichbar. Mit der Stufe **Ordnen** darf ein Agent Mails ohne Rückfrage verschieben, archivieren,
markieren und zurückstellen sowie Termine ohne Teilnehmer, Kontakte und Aufgaben anlegen (alles im
KI-Protokoll). Senden, Termine mit Teilnehmern und der Papierkorb warten immer auf deine Freigabe; sie zeigt
Absendekonto, alle Empfänger und den vollständigen Text. Konten mit „Keine Cloud-KI“ sieht ein externer
Agent nicht. Endgültiges Löschen, Konten, Passwörter, Schlüssel und KI-Einstellungen sind für
Agenten nie zugänglich.

**KI-Protokoll:** zeigt, was KI und Agenten getan haben (ohne Mailinhalte, 30 Tage, nur auf diesem
Gerät). „Alle KI-Daten löschen“ entfernt Einstellungen, Einwilligungen, Schlüssel, Protokoll, Routinen,
Freigaben und Agenten.

Für Organisationen: Vorlagen für Nutzungsrichtlinie, Verarbeitungsverzeichnis, Sicherheitskonzept und
eine KI-Kurzanleitung liegen unter `docs/ai/`.

## 18 Aufgaben

**Aufgaben** in der Navigationsleiste (Alt+5). Ansichten: Heute, Demnächst, Überfällig, Alle offenen,
Erledigt. „Neue Aufgabe“ oder die Schnelleingabe oben in der Liste legt eine Aufgabe an; aus einer Mail
über „Als Aufgabe“ (der Link zur Mail bleibt erhalten). Eine Aufgabe hat Fälligkeit (Tag oder Uhrzeit),
Erinnerung als Mitteilung, Priorität, Notiz und Wiederholung; eine wiederholte Aufgabe behält ihre
Uhrzeit auch über die Zeitumstellung. Auf schmalen Fenstern und am Handy stehen Ansichten, Listen und
„Neue Aufgabe“ oben über der Liste.

**Listen verbinden:** Aufgaben → Listen → „Liste verbinden“: eine CalDAV-Liste, Microsoft To Do oder
Google Tasks. Abgeglichen werden Titel, Notiz, Fälligkeit, Erinnerung, Priorität, Wiederholung und Status
(Google Tasks: nur Titel, Notiz, Tag und Status); der Link zur Mail bleibt auf diesem Gerät. Trennen
beendet den Abgleich, auf dem Server wird nichts gelöscht. Aufgaben werden auf dem Gerät verschlüsselt
gespeichert.

**Aufgaben aus Räumen:** Raum-Aufgaben, die dir zugewiesen sind („Für mich“), stehen auch hier, mit dem
Namen des Raums gekennzeichnet; links unter **Räume** filterst du nach einem Raum. Erledigen, Titel,
Notiz, Fälligkeit und Priorität änderst du hier oder im Raum, die Änderung gilt überall und geht wie jede
Raum-Änderung verschlüsselt an alle Mitglieder. Bist du im Raum Leser, siehst du die Aufgabe nur. Umgekehrt
wählst du in einer Aufgabe unter **Raum** einen Raum (als Eigentümer oder Bearbeiter): Die Aufgabe wandert
in den Raum, ist dir zugewiesen und alle Mitglieder sehen sie. Erinnerung, Wiederholung, Liste und der Link
zur Mail entfallen dabei. Raum-Aufgaben werden nie mit CalDAV, Microsoft To Do oder Google Tasks
abgeglichen; war die Aufgabe in einer verbundenen Liste, wird sie dort gelöscht. Raum-Aufgaben liegen nur
im Raum (keine Kopie in deiner Aufgabenliste) und sind mit dem Raum in der Sicherung enthalten.

## 19 Räume

Ein **Raum** (Alt+4) sammelt alles zu einem Thema, Projekt oder Kunden: Notizen, die mehrere gleichzeitig
bearbeiten, angeheftete Mails mit internen Kommentaren, Aufgaben und Termine mit Zuständigen, Dateien mit
Versionen, einen Chat und eine Aktivitätsliste. Mitglieder lädst du per Mail-Adresse ein (Rollen Eigentümer,
Bearbeiter, Leser) und vergleichst beim Beitritt den Sicherheitscode. Es gibt keinen Levuvo-Server: jedes
Mitglied hat eine verschlüsselte Kopie, Änderungen gehen Ende-zu-Ende-verschlüsselt als Mails zwischen den
Postfächern. Die Reiter lassen sich mit den Pfeiltasten wechseln, Dateien auch per Tastatur hochladen.
Im Reiter **Chat** schreiben Eigentümer und Bearbeiter allen Mitgliedern (Enter sendet, Umschalt+Enter
macht eine neue Zeile); Leser lesen mit. Nachrichten kommen meist in wenigen Sekunden an, weil Levuvo das
Postfach per IMAP IDLE beobachtet. Antworten, Bearbeiten und Löschen gehen über die Knöpfe neben einer
Nachricht; gelöscht wird für alle. Ungelesene Nachrichten zählt nur dein Gerät, es gibt keine
Lesebestätigungen. Mit dem Assistenten geschriebene Nachrichten sind als „KI-erstellt“ markiert. Bei der Freigabe wählst du
„Nur diese“ oder „Für diesen Raum bis auf Widerruf“; zurücknehmen kannst du das in den Einstellungen des Raums.
Assistent und Agenten sehen einen Raum nur, wenn der Eigentümer es erlaubt; Cloud-KI braucht eine eigene
Erlaubnis. Details: `docs/SPACES.md`.

## 20 Sicherung & Umzug

**Einstellungen → Sicherung → Sicherung erstellen** speichert alles, was nur auf diesem Gerät liegt
(Einstellungen, Konten ohne Passwörter, lokaler Kalender, Kontakte, Aufgaben, Vorlagen, Absender-
Entscheidungen, eigene Schlüssel, Räume, KI-Einstellungen, Routinen und Agenten ohne Token) in einer mit
deinem Passwort verschlüsselten Datei. **Wiederherstellen** prüft die Datei und ersetzt die Daten beim
nächsten Start; die vorherigen Daten bleiben unter `before-restore/`. Danach die Kontopasswörter einmal neu
eingeben. Bewahre die Sicherung so sorgfältig auf wie den Computer selbst.

## 21 Neue Absender & Bündel

**Neue Absender zuerst prüfen** (Einstellungen → Allgemein): Mails von Absendern, die nicht in deinen
Kontakten stehen und denen du nie geschrieben hast, warten unter „Neue Absender“, bis du sie annimmst oder
blockierst. **Bündel** fassen Newsletter, Rechnungen, Benachrichtigungen u. Ä. in je einer Zeile zusammen;
mit eingeschaltetem lokalem Modell hilft der Assistent beim Einsortieren. Die **Anhang-Übersicht** zeigt
alle Anhänge eines Ordners, die **Phishing-Prüfung** warnt bei verdächtigen Mails (Kapitel 12).
