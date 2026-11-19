# Einstellungen, Sicherheit und Hilfe

## Die Einstellungen im Überblick

Öffne die Einstellungen über das Regler-Symbol unten links oder mit `Alt` + `,`.

![Einstellungen, Bereich Allgemein](settings-general.png)

| Bereich | Was du dort einstellst |
|---|---|
| Allgemein | **Darstellung** (Sprache, Design, Dichte), **Lesen** (Bündeln, neue Absender prüfen), **Schreiben** (Senden rückgängig), **Kalender** |
| Konten | Konten, Signaturen, Absenderadressen, **Verbindungsstatus** |
| Vorlagen | **Textbausteine und Vorlagen** |
| Filter & Abwesenheit | **Filterregeln** auf dem Mailserver und **Abwesenheitsnotiz** |
| Kalender & Kontakte | **Server-Konten** anderer Anbieter, Farben, Import und Export |
| Sicherheit | Schlüssel und Zertifikate (OpenPGP, S/MIME) |
| Suche & Offline | Stand des Suchindex, neu aufbauen |
| KI & Agenten | **KI-Assistent**, **Funktionen**, **Schreibstil**, **KI-Protokoll**, Agenten und **Freigaben** |
| Mitteilungen | Benachrichtigungen erlauben und testen |
| Datenschutz | Datenschutz-Cockpit, **Deine Daten**, Absturzberichte, Diagnosebericht, **Gespeicherte Daten auf diesem Gerät** |
| Sicherung | **Sicherung erstellen**, **Wiederherstellen oder auf neuen Rechner umziehen** |
| Hilfe | Dieses **Handbuch** mit Suche, **Kurzhilfe**, Tastenkürzel |
| Über | Version, **Sicherheit und Support**, **Impressum**, Open-Source-Lizenzen |

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

### Deine Daten exportieren oder löschen

Unter **Einstellungen → Datenschutz** zeigt das **Datenschutz-Cockpit** die letzten 30 Tage: blockierte Tracker, KI-Aufrufe und was das Gerät verlassen hat. Darunter, bei **Deine Daten**:

- **Meine Daten exportieren** speichert eine lesbare Kopie (JSON) der Daten, die nur auf diesem Gerät liegen., ohne Passwörter und private Schlüssel.
- **Alle Daten auf diesem Gerät löschen** entfernt beim nächsten Start alles, was Levuvo Mail hier gespeichert hat, auch die Einträge im Schlüsselbund. Bis dahin kannst du abbrechen; Mails auf den Servern bleiben.
- **Updates automatisch installieren** ist eingeschaltet. Schaltest du es aus, fragt Levuvo Mail vor jedem Update. Installiere Sicherheitsupdates dann bitte zügig.

Unter **Einstellungen → Über** steht bei **Sicherheit und Support**, bis wann diese Version kostenlose Sicherheitsupdates bekommt und wie du eine Sicherheitslücke meldest. **Open-Source-Lizenzen** zeigt die Lizenztexte aller mitgelieferten Bausteine.

![Sicherheit: Schlüssel und Zertifikate](settings-security.png)

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

Dieses Handbuch steckt mit Suche auch in der App: **Einstellungen → Hilfe** oder das Fragezeichen links. Oder frag den Assistenten, etwa „Wie lege ich eine Sicherung an?“; er antwortet aus dem Handbuch.

Kommst du nicht weiter:

1. Öffne **Einstellungen → Datenschutz** und klicke beim **Diagnosebericht** auf **Herunterladen**. Er enthält keine Mailinhalte und keine Adressen.
2. Schick ihn mit einer kurzen Beschreibung an deinen Support oder deine IT. Dein Passwort gibst du nie weiter, auch nicht an den Support.
