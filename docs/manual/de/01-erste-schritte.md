# Erste Schritte

## Levuvo Mail installieren

Lade die passende Datei für deinen Computer herunter. Nimm sie nur aus einer vertrauenswürdigen Quelle, zum Beispiel direkt von deiner IT.

| Computer | Datei |
|---|---|
| Mac mit Apple-Chip (M1 und neuer) | `Levuvo-Mail-…-arm64.dmg` |
| Windows-PC (die meisten Geräte) | `Levuvo-Mail-Setup-…-x64.exe` |
| Windows-PC mit ARM-Chip (z. B. Snapdragon) | `Levuvo-Mail-Setup-…-arm64.exe` |

Macs mit Intel-Chip werden nicht unterstützt.

### Auf dem Mac

1. Öffne die heruntergeladene `.dmg`-Datei per Doppelklick.
2. Ziehe **Levuvo Mail** in den Ordner **Programme**.
3. Starte Levuvo Mail aus dem Ordner **Programme**.

### Unter Windows

1. Öffne die heruntergeladene `Setup`-Datei per Doppelklick.
2. Folge den Schritten des Installationsprogramms. Du brauchst dafür keine Administratorrechte.
3. Levuvo Mail startet danach von selbst und liegt im Startmenü.

### Warnung beim ersten Öffnen

Die aktuellen Installationsdateien sind noch nicht mit einem Zertifikat von Apple oder Microsoft unterschrieben. Deshalb warnt dein Computer beim ersten Öffnen. Das ist bei dieser Version normal.

**Mac:** Es erscheint „Levuvo Mail“ kann nicht geöffnet werden, weil Apple die App nicht überprüfen konnte.

1. Klicke auf **Fertig** (nicht auf „In den Papierkorb legen“).
2. Öffne **Systemeinstellungen → Datenschutz & Sicherheit**.
3. Scrolle nach unten zum Abschnitt **Sicherheit**. Dort steht ein Hinweis zu Levuvo Mail. Klicke auf **Dennoch öffnen**.
4. Bestätige mit deinem Mac-Passwort oder Touch ID und klicke noch einmal auf **Dennoch öffnen**.

Danach startet Levuvo Mail ohne Rückfrage.

**Windows:** Es erscheint ein blaues Fenster „Der Computer wurde durch Windows geschützt“ (Microsoft Defender SmartScreen).

1. Klicke auf **Weitere Informationen**.
2. Prüfe, dass als App `Levuvo-Mail-Setup-…` angezeigt wird.
3. Klicke auf **Trotzdem ausführen**.

> **Wichtig:** Schalte den Virenschutz oder SmartScreen dafür nicht ab. Die Ausnahme gilt nur für diese eine Datei.

Unsignierte Versionen aktualisieren sich nicht selbst. Eine neue Version installierst du einfach über die alte. Deine Daten bleiben dabei erhalten.

## Dein E-Mail-Konto einrichten

Beim ersten Start fragt Levuvo Mail nach deinem E-Mail-Konto. Später fügst du weitere Konten unter **Einstellungen → Konten → Konto hinzufügen** hinzu, bis zu fünf.

![Beim ersten Start richtest du dein Konto ein.](onboarding.png)

1. Wähle deinen **Anbieter**, zum Beispiel Microsoft 365, Gmail, GMX, WEB.DE, IONOS, Hetzner oder Strato. Ist deiner nicht dabei, nimm **Anderer Anbieter**.
2. Gib deine **E-Mail-Adresse** und dein **Passwort** ein. Optional kannst du einen Kontonamen (etwa „Arbeit“) und deinen Namen als Absender eintragen.
3. Klicke auf **Konto einrichten**. Levuvo Mail prüft zuerst, ob Empfangen und Senden funktionieren, und speichert erst dann. Ist der Server gerade nicht erreichbar, kannst du mit **Trotzdem speichern und später prüfen** fortfahren.

Dein Passwort liegt danach im sicheren Passwortspeicher deines Computers: im Schlüsselbund auf dem Mac, in der Anmeldeinformationsverwaltung unter Windows.

**Microsoft 365 und Outlook.com:** Diese Konten funktionieren nur mit **Mit Microsoft anmelden**, nicht mit einem Passwort. Dein Browser öffnet sich, du meldest dich dort an und die App übernimmt das Konto. Kalender und Kontakte kommen gleich mit. Fehlt der Knopf, wende dich an deine IT.

**Gmail:** Nimm **Mit Google anmelden**, wenn der Knopf da ist. Sonst brauchst du ein **App-Passwort**. Das ist ein eigenes Passwort nur für Levuvo Mail. Du erzeugst es in deinem Google-Konto unter **Sicherheit → 2-Schritt-Verifizierung → App-Passwörter**. Die 2-Schritt-Verifizierung muss dafür eingeschaltet sein.

**Anderer Anbieter:** Hier brauchst du die Serveradressen deines Anbieters. Er nennt sie meist „IMAP“ (zum Empfangen, Port 993) und „SMTP“ (zum Senden, Port 465 oder 587). Du findest sie in der Hilfe deines Anbieters. Klicke auf **Servereinstellungen anzeigen** und trag sie dort ein.

> **Tipp:** „Entfernen“ bei einem Konto löscht nur die Einrichtung auf diesem Computer. Deine E-Mails auf dem Server bleiben unberührt.

## Die Oberfläche im Überblick

![Posteingang mit geöffneter Nachricht](mail.png)

- **Linke Leiste:** wechselt zwischen E-Mail, Kalender, Kontakten, Räumen und Aufgaben. Unten findest du den Assistenten (Funkel-Symbol ✦), die Befehlspalette (`⌘`-Symbol), die Hilfe (Fragezeichen) und die Einstellungen (Regler-Symbol).
- **Ordnerleiste:** Posteingang, Entwürfe, Gesendet, Archiv und deine eigenen Ordner. Ganz unten wechselst du das Konto.
- **Nachrichtenliste:** alle Nachrichten des gewählten Ordners. Oben filterst du nach **Ungelesen**, **Markiert** oder **Anhang**.
- **Lesebereich:** die geöffnete Nachricht mit allen Aktionen.

Oben neben dem Ordnernamen zeigt ein kleines Feld die Verbindung: **Live** heißt, neue Mails erscheinen sofort. **Verbinde …** heißt, die Verbindung wird gerade aufgebaut. **Offline** heißt, du arbeitest ohne Internet. **Gestört** heißt, der Mailserver antwortet nicht richtig (siehe Kapitel 6).

### Alles mit einer Suche erreichen

Drücke `Strg` + `K`. Es öffnet sich die Befehlspalette. Tippe ein paar Buchstaben, etwa „entw“ für Entwürfe oder „neue“ für eine neue Nachricht, und drücke `Enter`. So erreichst du jeden Ordner, jedes Konto und jede Einstellung, ohne zu suchen.

![Die Befehlspalette findet Ordner, Befehle und Einstellungen.](palette.png)

### Levuvo Mail im Hintergrund

Wenn du das Fenster schließt, läuft Levuvo Mail im Hintergrund weiter. So bekommst du Mitteilungen über neue Mails und Termine, und geplante Nachrichten gehen pünktlich hinaus. Ganz beenden kannst du die App über das Symbol in der Menüleiste (Mac) oder im Infobereich neben der Uhr (Windows): Symbol anklicken und **Beenden** wählen.

## Eine Sicherung anlegen

Manche Daten liegen nur auf deinem Computer, zum Beispiel deine Einstellungen, lokale Kalender und Kontakte, Aufgaben, Vorlagen und Räume. Leg deshalb gleich zu Beginn eine Sicherung an und wiederhole das regelmäßig.

![Sicherung erstellen und wiederherstellen](settings-backup.png)

1. Öffne **Einstellungen → Sicherung**.
2. Vergib unter **Sicherung erstellen** ein Passwort mit mindestens 12 Zeichen und wiederhole es. Die Datei wird damit verschlüsselt.
3. Klicke auf **Sicherung speichern** und speichere die Datei an einem sicheren Ort, etwa auf einem USB-Stick.

Passwörter deiner Konten sind aus Sicherheitsgründen nicht in der Sicherung. Du gibst sie nach dem Wiederherstellen einmal neu ein.

**Auf einen neuen Computer umziehen:** Installiere Levuvo Mail auf dem neuen Gerät. Klicke im Willkommensfenster auf **Umzug von einem anderen Rechner? Sicherung wiederherstellen**, wähle die Sicherungsdatei und gib ihr Passwort ein. Klicke danach auf **Jetzt neu starten**, dann werden die Daten übernommen.

> **Wichtig:** Bewahre die Sicherung und ihr Passwort so sorgfältig auf wie den Computer selbst. Ohne das Passwort lässt sich die Datei nicht öffnen.
