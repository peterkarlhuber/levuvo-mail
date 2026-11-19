# Einstellungen, Sicherheit und Hilfe

## Die Einstellungen im Überblick

Öffne die Einstellungen über das Regler-Symbol unten links oder mit `Alt` + `,`.

![Einstellungen, Bereich Allgemein](settings-general.png)

| Bereich | Was du dort einstellst |
|---|---|
| Allgemein | Sprache, helles oder dunkles Design, Dichte der Liste, Senden rückgängig, neue Absender zuerst prüfen |
| Konten | Konten hinzufügen und entfernen, Signaturen, weitere Absenderadressen |
| Vorlagen | Textbausteine für wiederkehrende Mails |
| Filter & Abwesenheit | Regeln auf dem Mailserver und Abwesenheitsnotiz |
| Kalender & Kontakte | Kalender anderer Anbieter verbinden, Farben, Import und Export |
| Sicherheit | Schlüssel und Zertifikate für verschlüsselte Mails |
| Suche & Offline | Stand der letzten Prüfung, aktualisieren, neu aufbauen, Index für die Suche nach Bedeutung |
| KI & Agenten | Assistent, Sprachmodelle, Cloud-Einwilligung, Agenten |
| Mitteilungen | Benachrichtigungen erlauben und testen |
| Datenschutz | Absturzberichte (freiwillig), Diagnosebericht, Speicherorte der Daten |
| Sicherung | Sicherung erstellen und wiederherstellen |
| Hilfe | Dieses Handbuch mit Suche, Kurzhilfe, Tastenkürzel |
| Über | Version, Impressum, Lizenzen |

### Signatur und weitere Absenderadressen

Unter **Einstellungen → Konten** klickst du auf ein Konto, um es zu bearbeiten. Dort legst du eine **Signatur** an, auch mit Links und kleinem Logo. Unter **Weitere Absenderadressen (Aliase)** trägst du zusätzliche Adressen ein, etwa office@ und rechnung@, jeweils mit eigener Signatur. Trag nur Adressen ein, mit denen dein Mailserver dich senden lässt.

![Konten und Signaturen](settings-accounts.png)

## So schützt Levuvo Mail deine Daten

- **Alles bleibt auf deinem Computer.** Es gibt keinen Server von Levuvo Mail, über den deine Mails laufen. Deine Mails gehen nur an die Server deines Mailanbieters. Levuvo Mail erfasst nicht, wie du die App nutzt.
- **Passwörter im sicheren Speicher.** Kontopasswörter und Schlüssel liegen im Schlüsselbund (Mac) oder in der Anmeldeinformationsverwaltung (Windows), nie in einer einfachen Datei.
- **Lokale Daten verschlüsselt.** Suchindex, lokale Kalender, Kontakte, Aufgaben und Räume sind auf der Festplatte verschlüsselt.
- **Sichere Anzeige.** Mails werden ohne Skripte angezeigt, externe Bilder sind blockiert, Links fragen vorher nach.
- **Nur von deinem Gerät erreichbar.** Die App nimmt keine Verbindungen von anderen Computern an.
- **Absturzberichte nur freiwillig.** Unter **Einstellungen → Datenschutz** entscheidest du, ob bei einem Absturz ein technischer Bericht geschickt wird. Er kann Teile gerade geöffneter Mails oder Adressen enthalten. Deshalb ist er standardmäßig aus.

![Sicherheit: Schlüssel und Zertifikate](settings-security.png)

## Wo Levuvo Mail Daten speichert

Levuvo Mail speichert alles in einem eigenen Ordner auf deinem Computer:

- **Mac:** `~/Library/Application Support/Levuvo Mail/`
- **Windows:** `%APPDATA%\Levuvo Mail\` (also `C:\Users\<Name>\AppData\Roaming\Levuvo Mail\`)

| Was | Wo im Ordner |
|---|---|
| Einstellungen, Konten ohne Passwörter, Vorlagen | Dateien wie `app-settings.json`, `ai.json`, `templates.json` |
| Lokale Kontakte, Kalender und Aufgaben (verschlüsselt) | `contacts-local.json`, `calendar-local.json`, `tasks-local.json` |
| Suchindex samt Suche nach Bedeutung (verschlüsselt) | `index/` |
| KI-Modelle des eigenen Ollama | `ollama/models/` |
| Gemeinsame Räume (verschlüsselt) | `spaces/` |
| Vorheriger Stand nach einer Wiederherstellung | `before-restore/` |

Passwörter, Anmeldungen und private Schlüssel liegen nicht in diesem Ordner, sondern im Schlüsselbund (Mac) oder in der Anmeldeinformationsverwaltung (Windows). Deine Mails bleiben auf dem Mailserver. Sicherungen speicherst du selbst an einem Ort deiner Wahl.

Unter **Einstellungen → Datenschutz → Gespeicherte Daten auf diesem Gerät** siehst du die Pfade deines Computers mit ihrer Größe. **Im Finder zeigen** (Mac) oder **Im Explorer zeigen** (Windows) öffnet den Ordner. Der Speicherort lässt sich nicht ändern.

Alle Größen in Levuvo Mail sind Dezimalangaben, wie im Finder: 1 MB sind 1.000.000 Byte. Der Windows-Explorer rechnet mit 1.024 und zeigt deshalb etwas kleinere Zahlen.

## Wenn etwas nicht klappt

| Problem | Lösung |
|---|---|
| Beim Start erscheint „Zugang prüfen“ | Entsperre den Schlüsselbund (Mac) oder prüfe deine Windows-Anmeldung, dann **Erneut prüfen**. Es wurde nichts gelöscht. |
| Mac meldet, die App sei „beschädigt“ | Bitte deine IT um Hilfe. Das lässt sich mit einem kurzen Befehl im Terminal beheben. |
| Anmeldung schlägt fehl | Passwort prüfen. Bei GMX und WEB.DE im Webmail den Zugriff per IMAP erlauben. Bei Gmail ein App-Passwort nutzen oder **Mit Google anmelden**. |
| Senden mit Microsoft 365 klappt nicht | Deine IT muss für das Postfach „Authentifiziertes SMTP“ einschalten. |
| Filter sind „nicht verfügbar“ | Dein Anbieter bietet keine Serverfilter an. Lege die Regeln dann im Webmail an. |
| Kalender verbindet nicht | Adresse (beginnt mit https), Benutzername und App-Passwort prüfen. |
| Kalender oder Kontakte von Microsoft oder Google fehlen | Auf **Zugriff freigeben** klicken und im Browser mit demselben Konto bestätigen. In Firmen muss eventuell die IT zustimmen. |
| Geplante oder zurückgestellte Mail kam nicht | Levuvo Mail muss zur geplanten Zeit laufen, im Hintergrund reicht. Sonst passiert es beim nächsten Start. |
| Keine Mitteilungen | **Einstellungen → Mitteilungen** öffnen und die Erlaubnis erteilen, auch in den Systemeinstellungen deines Computers. |
| Assistent antwortet nicht | Unter **Einstellungen → KI & Agenten** prüfen, ob beim Sprachmodell „… ist heruntergeladen und geprüft“ steht. Sonst Levuvo Mail neu starten. |
| Anzeige **Gestört** | Der Mailserver antwortet nicht richtig. Unter **Einstellungen → Konten** die Verbindung prüfen; oft hilft es, kurz zu warten. |

## Hilfe bekommen

1. Öffne **Einstellungen → Datenschutz** und klicke beim **Diagnosebericht** auf **Herunterladen**.
2. Schick den Bericht zusammen mit einer kurzen Beschreibung an deinen Support oder deine IT.

Der Diagnosebericht enthält keine Mailinhalte und keine Adressen. Gib niemals dein Passwort weiter, auch nicht an den Support.
