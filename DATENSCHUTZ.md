# Datenschutzhinweis – Levuvo Mail 2.0

> **Entwurf.** Vor der Veröffentlichung rechtlich prüfen lassen und die Angaben zum Verantwortlichen
> (siehe [docs/IMPRESSUM.md](./docs/IMPRESSUM.md)) einsetzen. Platzhalter stehen in [eckigen Klammern].

## Verantwortlicher

[Firmenname, Rechtsform] · [Anschrift] · [E-Mail für Datenschutzanfragen] · [ggf. Datenschutzbeauftragte:r]

## Grundsatz

Levuvo Mail läuft **vollständig auf deinem Gerät**. Levuvo betreibt keinen Server, über den deine
E-Mails, Termine, Kontakte, Schlüssel oder Zugangsdaten laufen. Die App verbindet sich direkt mit den
Servern deiner Anbieter. Es gibt **keine Telemetrie, keine Nutzungsstatistik und keine Werbung**.

## Welche Daten wo verarbeitet werden

| Daten | Wo | Zweck |
|---|---|---|
| E-Mails, Ordner, Anhänge | auf dem Mailserver deines Anbieters; beim Lesen im Arbeitsspeicher | Anzeigen, Suchen, Versenden |
| Termine und Kontakte | auf deinem CalDAV-/CardDAV-Server; beim Anzeigen im Arbeitsspeicher | Kalender, Adressbuch, Einladungen |
| Passwörter, OAuth-Anmeldetoken, private PGP-/S/MIME-Schlüssel, Indexschlüssel | ausschließlich im Schlüsselbund des Betriebssystems (macOS-Schlüsselbund / Windows-Anmeldeinformationsverwaltung) | Anmeldung, Entschlüsselung, Signatur |
| Kontoeinstellungen (Adresse, Server, Ordner, Absenderadressen, Signaturen), CalDAV/CardDAV-Konten, öffentliche Schlüssel und Zertifikate, App-Einstellungen | Dateien im App-Datenordner, nur für dein Benutzerkonto lesbar | Verbindungen, Verschlüsselung |
| Lokaler Suchindex: Betreff, Absender, Datum und die ersten 3.000 Zeichen Text (keine Anhänge; Ende-zu-Ende-verschlüsselte Nachrichten nur in ihrer unlesbaren, verschlüsselten Form) | App-Datenordner, **verschlüsselt mit AES-256-GCM**; abschaltbar und löschbar | Suche über alle Ordner, Offline-Lesen |
| Darstellung (Sprache, Design, Spaltenbreite), Benachrichtigungs-Zähler (nur Nachrichten-IDs) | lokaler App-Speicher | Bedienkomfort |
| Adressvorschläge, Vorschautexte, Offline-Ansicht | nur im Arbeitsspeicher | schnelleres Arbeiten |

Entschlüsselte Inhalte werden nicht gespeichert – auch nicht für die Offline-Ansicht.

## Verbindungen ins Internet

- **Mailserver** (IMAP, SMTP, ManageSieve für Filter/Abwesenheit) – immer verschlüsselt, Zertifikate werden geprüft.
- **CalDAV/CardDAV-Server**, die du selbst einträgst – nur über HTTPS.
- **Anmeldung mit Microsoft oder Google (OAuth):** Die Anmeldung findet im Browser auf den Seiten von Microsoft bzw. Google statt. Levuvo Mail erhält ein Anmeldetoken und speichert nur das Erneuerungstoken im Schlüsselbund. Es gelten zusätzlich die Datenschutzbestimmungen des jeweiligen Anbieters.
- **Externe Bilder in HTML-Mails** sind blockiert, bis du bei einer Nachricht „Bilder laden“ wählst (der Absender kann dann das Öffnen erkennen).
- **Links** öffnen sich nach Rückfrage im Standardbrowser (Ausnahme ohne Rückfrage: levuvo.at und die Anmeldeseiten von Microsoft/Google).
- **Updates** (nur signierte Versionen): etwa alle sechs Stunden Abfrage beim Update-Server von Levuvo ([Adresse]). Technisch bedingt werden IP-Adresse, Betriebssystem und App-Version übermittelt; keine Kontodaten oder Inhalte.
- **Absturzberichte – nur mit Zustimmung:** Standardmäßig aus. Wenn du sie unter Einstellungen → Datenschutz einschaltest und der Build eine Berichtsadresse enthält, wird nach einem Absturz ein technischer Bericht (Speicherabbild des abgestürzten Prozesses, App-Version, Betriebssystem) an [Empfänger/Dienst] gesendet. Die App ist so aufgebaut, dass E-Mail-Inhalte nicht im Hauptprozess liegen; vollständig ausschließen lässt sich bei Speicherabbildern aber nicht, dass Bruchstücke enthalten sind. Rechtsgrundlage: Einwilligung (Art. 6 Abs. 1 lit. a DSGVO), jederzeit widerrufbar durch Ausschalten.
- **Diagnosebericht:** Wird nur auf deinen Wunsch als Datei gespeichert (Version, System, Fehlerzähler, Verbindungsstatus – keine Inhalte, keine Adressen). Du entscheidest, ob du ihn weitergibst.

## Löschen

- Ein E-Mail-Konto zu entfernen löscht die lokale Einrichtung, die Einträge im Schlüsselbund und den Suchindex dieses Kontos. E-Mails auf dem Server bleiben unverändert.
- Kalender-/Kontaktkonten, Schlüssel und Zertifikate lassen sich einzeln in den Einstellungen entfernen.
- Der Suchindex lässt sich unter Einstellungen → Suche & Offline abschalten (wird dabei gelöscht).
- Nach der Deinstallation kann der App-Datenordner gelöscht werden: macOS `~/Library/Application Support/Levuvo Mail`, Windows `%APPDATA%\Levuvo Mail`.

## Deine Rechte

Da Levuvo keine personenbezogenen Daten aus der App erhält (Ausnahme: freiwillige Absturzberichte und
technische Daten beim Update-Abruf), richten sich Auskunfts- und Löschbegehren zu E-Mails, Terminen
und Kontakten an den jeweiligen Anbieter. Für Absturzberichte und Update-Protokolle: [Kontakt].
Beschwerden: Österreichische Datenschutzbehörde, Barichgasse 40–42, 1030 Wien, dsb.gv.at.
