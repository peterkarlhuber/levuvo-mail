# Levuvo Mail 2.2 – Handbuch

*Less effort. More impact.*

Levuvo Mail vereint E-Mail, Kalender und Kontakte in einer App für macOS und Windows. Alles läuft
auf deinem Gerät; Levuvo sieht weder deine Nachrichten noch deine Zugangsdaten.

**Inhalt:** 1 Installation · 2 Konto einrichten · 3 Die Oberfläche · 4 Lesen · 5 Schreiben ·
6 Ordnung halten · 7 Suche & Offline · 8 Filter & Abwesenheit · 9 Kalender · 10 Kontakte ·
11 Verschlüsselung · 12 Sicherheit & Phishing · 13 Einstellungen · 14 Tastenkürzel ·
15 Fehlerbehebung · 16 Datenschutz

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

Links die **Navigationsleiste**: E-Mail, Kalender, Kontakte, Hilfe, Einstellungen (Alt+1, Alt+2, Alt+3, Alt+,).

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
  **lokalen, verschlüsselten Suchindex** – auch ohne Internet. Der Index wird im Hintergrund aufgebaut
  (Einstellungen → Suche & Offline: Status, „Jetzt aktualisieren“, „Neu aufbauen“, abschalten).
- **Offline:** Ohne Verbindung zeigt die App zuletzt geladene Listen und Nachrichten bzw. den Text aus dem
  Index. Verschieben und Senden sind erst wieder online möglich.

## 8 Filter & Abwesenheit

**Einstellungen → Filter & Abwesenheit** (je Konto). Die Regeln laufen **auf deinem Mailserver**
(Sieve) und wirken daher auch, wenn Levuvo Mail geschlossen ist. Voraussetzung: dein Anbieter bietet
ManageSieve an (bei Microsoft- und Google-Anmeldung stattdessen im Webmail einrichten).

- **Abwesenheitsnotiz:** aktivieren, optional Von/Bis-Datum, Betreff, Text, „höchstens alle … Tage“ je Absender.
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
| ! | Spam / kein Spam |
| Entf | Papierkorb |
| P | drucken / PDF |
| / | suchen |
| Strg/⌘ + Enter | senden (im Editor) |
| Alt + 1 · 2 · 3 | E-Mail · Kalender · Kontakte |
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

Siehe `DATENSCHUTZ.md`. Kurz: keine Telemetrie, keine Werbung, keine Levuvo-Server im Datenweg;
Absturzberichte nur, wenn du sie einschaltest.
