# Einstellungen, Sicherheit und Hilfe

## Die Einstellungen im Überblick

Öffne die Einstellungen über das Regler-Symbol unten links oder mit `Alt` + `,`.

![Einstellungen, Bereich Allgemein](settings-general.png)

| Bereich | Was du dort einstellst |
|---|---|
| Allgemein | Sprache, helles oder dunkles Design, Dichte der Liste, Senden rückgängig, neue Absender zuerst prüfen, Jitsi-Server für Videocalls |
| Konten | Konten hinzufügen und entfernen, Signaturen, weitere Absenderadressen |
| Vorlagen | Textbausteine für wiederkehrende Mails |
| Filter & Abwesenheit | Regeln auf dem Mailserver und Abwesenheitsnotiz |
| Automatisierungen | Regeln, die Levuvo Mail auf neue Mails anwendet, auch mit Aufgaben |
| Kalender & Kontakte | Kalender anderer Anbieter verbinden, Farben, Import und Export |
| Buchungslinks | Links, über die andere einen Termin bei dir buchen |
| Sicherheit | Schlüssel und Zertifikate für verschlüsselte Mails |
| Suche & Offline | Stand des Suchindex, neu aufbauen |
| KI & Agenten | Assistent, Sprachmodelle, Cloud-Einwilligung, Agenten |
| Mitteilungen | Benachrichtigungen erlauben und testen |
| Datenschutz | Absturzberichte (freiwillig), Diagnosebericht |
| Sicherung | Sicherung erstellen und wiederherstellen |
| Hilfe | Dieses Handbuch mit Suche, Kurzhilfe, Tastenkürzel |
| Über | Version, Impressum, Lizenzen |

### Signatur und weitere Absenderadressen

Unter **Einstellungen → Konten** klickst du auf ein Konto, um es zu bearbeiten. Dort legst du eine **Signatur** an, auch mit Links und kleinem Logo. Unter **Weitere Absenderadressen (Aliase)** trägst du zusätzliche Adressen ein, etwa office@ und rechnung@, jeweils mit eigener Signatur. Trag nur Adressen ein, mit denen dein Mailserver dich senden lässt.

![Konten und Signaturen](settings-accounts.png)

### Automatisierungen

Unter **Einstellungen → Automatisierungen** legst du mit **Neue Automatisierung** Regeln für neue Mails im Posteingang an: zum Beispiel Mails eines Absenders in einen Ordner verschieben, als gelesen markieren, mit Stern markieren oder eine **Aufgabe anlegen**. Ist der Assistent eingeschaltet, beschreibst du die Regel **in einfachen Worten** und wählst **Regel vorschlagen**. Die lokale KI füllt dann den Editor, und der Vorschlag ist als KI-Vorschlag gekennzeichnet. Prüfe ihn, denn die KI kann sich irren.

Unter **So läuft die Regel** steht die Regel in Worten. Mit **Probelauf** siehst du, welche der 50 neuesten Mails sie behandeln würde, ohne dass sich etwas ändert. Eine Regel läuft erst, wenn du sie einschaltest, und nur für Mails, die danach ankommen. Sie löscht nie, antwortet nie und verschiebt nie in den Papierkorb. Im **Protokoll** siehst du, was die Regeln getan haben.

## So schützt Levuvo Mail deine Daten

- **Alles bleibt auf deinem Computer.** Es gibt keinen Server von Levuvo Mail, über den deine Mails laufen. Deine Mails gehen nur an die Server deines Mailanbieters. Levuvo Mail erfasst nicht, wie du die App nutzt.
- **Passwörter im sicheren Speicher.** Kontopasswörter und Schlüssel liegen im Schlüsselbund (Mac) oder in der Anmeldeinformationsverwaltung (Windows), nie in einer einfachen Datei.
- **Lokale Daten verschlüsselt.** Suchindex, lokale Kalender, Kontakte, Aufgaben und Räume sind auf der Festplatte verschlüsselt.
- **Sichere Anzeige.** Mails werden ohne Skripte angezeigt, externe Bilder sind blockiert, Links fragen vorher nach.
- **Nur von deinem Gerät erreichbar.** Die App nimmt keine Verbindungen von anderen Computern an.
- **Absturzberichte nur freiwillig.** Unter **Einstellungen → Datenschutz** entscheidest du, ob bei einem Absturz ein technischer Bericht geschickt wird. Er kann Teile gerade geöffneter Mails oder Adressen enthalten. Deshalb ist er standardmäßig aus.

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

1. Öffne **Einstellungen → Datenschutz** und klicke beim **Diagnosebericht** auf **Herunterladen**.
2. Schick den Bericht zusammen mit einer kurzen Beschreibung an deinen Support oder deine IT.

Der Diagnosebericht enthält keine Mailinhalte und keine Adressen. Gib niemals dein Passwort weiter, auch nicht an den Support.
