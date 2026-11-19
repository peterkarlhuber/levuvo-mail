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

### Videocalls

Ein Termin kann einen Videocall bekommen. Levuvo Mail verwendet dafür Jitsi Meet, das ohne Konto im Browser läuft.

1. Öffne den Termin und klicke unter **Ort** auf **Videocall hinzufügen**.
2. Levuvo Mail trägt einen Link mit einem zufälligen Raumnamen ein, den niemand erraten kann. Ist der Ort schon belegt, etwa mit einem Besprechungsraum, steht der Link in der ersten Zeile der Beschreibung.
3. Speichere den Termin. Mit der Einladung bekommen alle Teilnehmenden den Link.

Hat ein Termin einen Videocall, zeigt er **Videocall beitreten** und **Link kopieren**. Der Call öffnet sich im Browser; Levuvo Mail fragt vorher, wie bei jedem Link.

Standard ist der Server meet.ffmuc.net von Freifunk München in Deutschland. Einen eigenen Jitsi-Server trägst du unter **Einstellungen → Allgemein → Videocalls** ein. Wer den Link hat, kann teilnehmen. Teile ihn deshalb nur mit den Personen, die dabei sein sollen.

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

### Kontaktverlauf

Unter den Angaben eines Kontakts zeigt **Verlauf** alles zu dieser Person auf einer Zeitleiste: E-Mails aus allen Konten und Ordnern, gemeinsame Termine, Aufgaben und deine Notizen.

- **Notiz speichern:** Halte fest, was besprochen wurde. Notizen kannst du über den Stift bearbeiten und über den Papierkorb löschen.
- **Aufgabe anlegen:** Die Aufgabe gehört zu dieser Person und erscheint auch unter Aufgaben. Aufgaben, die du aus einer Mail der Person angelegt hast, zeigt der Verlauf ebenfalls.
- **Filtern:** Mit **Alles**, **E-Mails**, **Termine**, **Aufgaben** und **Notizen** blendest du den Rest aus. Ein Klick auf eine E-Mail öffnet sie.

Auch beim Lesen siehst du Notizen und offene Aufgaben: Klicke auf den Absender, um die Kontaktkarte zu öffnen. Dort legst du ebenfalls Notizen und Aufgaben an, auch für Personen, die nicht im Adressbuch stehen.

Der Verlauf bleibt auf diesem Computer. Notizen werden verschlüsselt gespeichert und sind Teil der Sicherung. Es wird nichts im Internet nachgeschlagen und keine KI verwendet. Löschst du den letzten Kontakt mit einer Adresse, werden auch die Notizen dazu gelöscht.

## Aufgaben

Öffne die Aufgaben mit `Alt` + `5`. Links wählst du die Ansicht: **Heute**, **Demnächst**, **Überfällig**, **Alle offenen** oder **Erledigt**.

![Offene Aufgaben mit Fälligkeit und Priorität](tasks.png)

- **Schnell hinzufügen:** Tippe oben in das Feld **Aufgabe hinzufügen …** und drücke `Enter`.
- **Ausführlich:** **Neue Aufgabe** öffnet ein Fenster für Fälligkeit, Erinnerung, Priorität, Notiz und Wiederholung.
- **Aus einer Mail:** Klicke im Lesebereich auf das Aufgaben-Symbol (**Als Aufgabe anlegen**). Die Aufgabe merkt sich die Mail, du kommst mit einem Klick zurück.
- **Erledigt:** Kreis vor der Aufgabe anklicken.

**Mit anderen Listen abgleichen:** Unter **Liste verbinden** verknüpfst du Microsoft To Do, Google Tasks oder eine CalDAV-Liste. Dann siehst du deine Aufgaben auch auf dem Handy. Trennen beendet nur den Abgleich, auf dem Server wird nichts gelöscht.

**Aufgaben aus Räumen:** Raum-Aufgaben, die dir zugewiesen sind, stehen auch hier, mit dem Namen des Raums. Unter **Räume** links filterst du nach einem Raum. Erledigen, Titel, Notiz, Fälligkeit und Priorität änderst du hier oder im Raum, die Änderung gilt überall und geht verschlüsselt an alle Mitglieder. Bist du im Raum Leser, siehst du die Aufgabe nur.

**Aufgabe in einen Raum verschieben:** Wähl in einer Aufgabe unter **Raum** einen Raum, in dem du Eigentümer oder Bearbeiter bist. Die Aufgabe wandert in den Raum, ist dir zugewiesen, und alle Mitglieder sehen sie. Erinnerung, Wiederholung, Liste und der Link zur Mail entfallen dabei. Raum-Aufgaben werden nie mit Microsoft To Do, Google Tasks oder CalDAV abgeglichen; war die Aufgabe in einer verbundenen Liste, wird sie dort gelöscht.
