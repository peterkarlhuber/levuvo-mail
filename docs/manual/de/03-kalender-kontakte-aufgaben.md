# Kalender, Kontakte und Aufgaben

## Kalender

Öffne den Kalender über die linke Leiste oder mit `Alt` + `2`.

![Wochenansicht des Kalenders](calendar.png)

### Welche Kalender du siehst

- **Auf diesem Gerät:** Dieser Kalender funktioniert sofort und ohne Konto. Termine bleiben verschlüsselt auf deinem Computer und erscheinen nicht auf dem Handy.
- **Microsoft 365 und Google:** Hast du dich mit Microsoft oder Google angemeldet, kommen deine Kalender automatisch mit. Erscheint einmalig **Zugriff freigeben**, klicke darauf und bestätige im Browser mit demselben Konto.
- **Andere Anbieter** wie Nextcloud, mailbox.org oder iCloud: Klicke links auf **Kalender verbinden** und gib die Server-Adresse, deinen Benutzernamen und ein App-Passwort ein. Der Fachbegriff dafür ist CalDAV. Levuvo Mail hat Vorlagen für die bekannten Anbieter.

### Termine anlegen und ändern

1. Klicke auf **Neuer Termin** oder in ein freies Feld der Woche.
2. Gib Titel, Beginn und Ende ein, optional Ort, Beschreibung und eine Erinnerung.
3. Für einen wiederkehrenden Termin wählst du bei **Wiederholung** etwa **Wöchentlich**.
4. Klicke auf **Speichern**.

Zum **Verschieben** ziehst du einen Termin mit der Maus an eine andere Stelle. Hat der Termin Teilnehmende, fragt Levuvo Mail, ob sie informiert werden sollen.

Oben rechts wechselst du zwischen **Tag**, **Woche**, **Monat** und **Agenda** (Liste der nächsten Termine). **Heute** springt zum aktuellen Tag.

### Einladungen

- **Einladen:** Trag im Termin die E-Mail-Adressen der Teilnehmenden ein und wähle **Einladung per E-Mail senden**. Die Einladung verstehen auch Outlook, Apple Kalender und Google.
- **Einladung erhalten:** In der Mail erscheint eine Karte mit **Zusagen**, **Vielleicht** und **Absagen**. Deine Antwort geht an den Organisator, der Termin landet in deinem Kalender.

Erinnerungen erscheinen als Mitteilung deines Computers, auch wenn das Fenster geschlossen ist.

## Kontakte

Öffne die Kontakte mit `Alt` + `3`.

![Kontakte mit geöffneter Kontaktkarte](contacts.png)

- **Neuer Kontakt:** Klicke auf **+**, trag Name, E-Mail-Adressen, Telefonnummern und weitere Angaben ein und speichere.
- **E-Mail schreiben** öffnet direkt eine neue Nachricht an den Kontakt.
- **Importieren und exportieren:** Mit den Pfeil-Symbolen über der Liste liest du eine `.vcf`-Datei ein (etwa aus Outlook oder Google) oder speicherst alle Kontakte als Datei.

Kontakte von Microsoft 365 und Google erscheinen nach der Freigabe automatisch. Lokale Kontakte bleiben verschlüsselt auf diesem Computer.

## Aufgaben

Öffne die Aufgaben mit `Alt` + `5`. Links wählst du die Ansicht: **Heute**, **Demnächst**, **Überfällig**, **Alle offenen** oder **Erledigt**.

![Offene Aufgaben mit Fälligkeit und Priorität](tasks.png)

- **Schnell hinzufügen:** Tippe oben in das Feld **Aufgabe hinzufügen …** und drücke `Enter`.
- **Ausführlich:** **Neue Aufgabe** öffnet ein Fenster für Fälligkeit, Erinnerung, Priorität, Notiz und Wiederholung.
- **Aus einer Mail:** Klicke im Lesebereich auf das Aufgaben-Symbol (**Als Aufgabe anlegen**). Die Aufgabe merkt sich die Mail, du kommst mit einem Klick zurück.
- **Erledigt:** Kreis vor der Aufgabe anklicken.

**Mit anderen Listen abgleichen:** Unter **Liste verbinden** verknüpfst du Microsoft To Do, Google Tasks oder eine CalDAV-Liste. Dann siehst du deine Aufgaben auch auf dem Handy. Trennen beendet nur den Abgleich, auf dem Server wird nichts gelöscht.

## Mein Tag

Beim ersten Öffnen am Tag zeigt Levuvo Mail **Mein Tag**: einen Überblick über alles, was heute ansteht.

- **Termine heute** mit Ort und Zahl der Teilnehmenden.
- **Aufgaben für heute**, auch überfällige. Mit dem Kreis hakst du sie gleich ab.
- **Wartet auf deine Antwort:** Mails von Menschen aus den letzten drei Tagen, auf die du noch nicht geantwortet hast. Newsletter und automatische Mails fehlen hier.
- **Keine Antwort erhalten:** gesendete Mails, bei denen dein Nachfassen fällig ist.
- **Versprechen:** Vorschläge des Versprechen-Trackers (siehe Kapitel „KI-Assistent“), falls eingeschaltet.
- **Neues in deinen Räumen** und offene Einladungen.

Ein Klick auf einen Eintrag öffnet die Mail, den Kalender oder die Aufgaben. Der Überblick entsteht auf diesem Computer, ganz ohne KI. Ist der Assistent eingeschaltet, ordnet **Mit KI ordnen: was braucht heute eine Antwort?** die wartenden Mails nach Wichtigkeit. Die KI ändert nur die Reihenfolge, sie blendet nichts aus, und das Ergebnis ist als **Reihenfolge KI-generiert** gekennzeichnet.

**Mein Tag** erscheint nur, wenn es etwas zu zeigen gibt. Jederzeit öffnest du es über die Befehlspalette (`Strg` + `K`, **Mein Tag: Überblick für heute**). Abschalten kannst du es im Fenster selbst oder unter **Einstellungen → Allgemein → Lesen** mit **„Mein Tag“ beim ersten Öffnen am Tag zeigen**.

## Termin-Vorbereitung

Kurz vor einem Termin mit anderen Menschen erscheint unten rechts eine Karte **Termin-Vorbereitung**. Sie zeigt:

- die **Teilnehmenden** mit ihrem Eintrag im Adressbuch und ob sie zugesagt haben,
- die **Letzte Mails** mit ihnen oder zum Thema des Termins,
- **Dateien**: Anhänge des Termins und dieser Mails,
- **Offene Punkte**: Aufgaben, Mails ohne Antwort und Versprechen, die diese Menschen betreffen.

Ein Klick öffnet die Mail. Mit eingeschaltetem Assistenten fasst **Worum geht es? Mit KI zusammenfassen** die Mails zusammen. Die Zusammenfassung ist als KI-Ergebnis gekennzeichnet. Die Karte verdeckt nichts und schließt mit `Esc`.

Wann die Karte erscheint, stellst du unter **Einstellungen → Allgemein → Lesen** bei **Termin-Vorbereitung** ein: 5, 10 oder 15 Minuten vorher oder **Aus**. Für den nächsten Termin öffnest du sie jederzeit über die Befehlspalette mit **Nächsten Termin vorbereiten**.
