# KI-Assistent

Der **Levuvo Mail Assistant** unterstützt dich beim Lesen und Beantworten von Mails. Er fasst lange Nachrichten zusammen, schlägt Antworten vor, findet Termine und Aufgaben in Mails und beantwortet Fragen zu deinem Postfach.

Der Assistent ist **standardmäßig ausgeschaltet**. Er tut nichts ohne dich: Gesendet, gespeichert, verschoben oder gelöscht wird nur, wenn du es bestätigst. Alles, was die KI erzeugt, ist als **KI-generiert** gekennzeichnet.

## Was ist ein Sprachmodell?

Ein Sprachmodell ist das Programm, das Texte versteht und schreibt. Es gibt zwei Arten:

- **Lokales Modell:** läuft direkt auf deinem Computer. Kein Inhalt verlässt das Gerät, auch ohne Internet funktioniert alles. Dafür braucht es etwas Arbeitsspeicher und Speicherplatz.
- **Cloud-Modell** (Anthropic oder OpenAI): läuft auf den Servern dieser Anbieter, oft außerhalb der EU. Die nötigen Inhalte werden dafür dorthin übertragen. Das geht nur nach deiner ausdrücklichen Einwilligung.

Levuvo Mail bringt für lokale Modelle ein eigenes, abgeschottetes Programm mit (Ollama). Es läuft nur für Levuvo Mail und ist nur von diesem Computer aus erreichbar. Ein Ollama, das du vielleicht selbst installiert hast, bleibt davon getrennt.

## Den Assistenten einschalten

![KI-Einstellungen mit Modellauswahl und Download](settings-ai.png)

1. Öffne **Einstellungen → KI & Agenten**.
2. Schalte **KI-Funktionen** ein.
3. Lass bei **Modell-Anbieter** die Einstellung **Lokal (Ollama)** stehen.
4. Wähle bei **Sprachmodell** ein Modell aus der Liste. Levuvo Mail schlägt die Größe vor, die zu deinem Computer passt.
5. Der Download startet mit Fortschrittsbalken. Je nach Internet dauert er einige Minuten. **Abbrechen** hält ihn an, später machst du mit **Fortsetzen** weiter.
6. Sobald „… ist heruntergeladen und geprüft“ erscheint, kannst du loslegen. **Bereit** neben **Lokale KI** heißt nur, dass das Programm für lokale Modelle läuft.

Für die **Suche nach Bedeutung** lädt Levuvo Mail zusätzlich ein kleines Suchmodell. Voreingestellt ist BGE-M3, es lieferte in unseren Tests die besten Ergebnisse, gerade bei deutschen Mails. Damit findet die Suche auch „Lieferung“, wenn in der Mail „Zustellung“ steht.

Jedes Modell wird nach dem Download mit einer festen Prüfsumme verglichen, einer Art digitalem Fingerabdruck der Datei. So ist sichergestellt, dass genau das richtige Modell auf deinem Computer liegt. Unter **Heruntergeladene Modelle** gibst du mit **Löschen** den Speicherplatz wieder frei.

### Welches Modell passt?

{{models}}

Klein läuft ab 8 GB Arbeitsspeicher (RAM), Standard ab 16 GB, Groß ab 32 GB. Wie viel dein Computer hat, zeigt Levuvo Mail unter **Lokale KI** an. Größere Modelle antworten besser, aber langsamer. Mit **EU** markierte Modelle stammen von Mistral AI aus Frankreich. Bei einem lokalen Modell spielt die Herkunft für deine Daten keine Rolle, denn sie verlassen deinen Computer nicht.

## Was der Assistent kann

### In einer Nachricht

Über dem Text einer geöffneten Mail erscheinen die Knöpfe des Assistenten:

![Assistent im Lesebereich](reader-assist.png)

- **Zusammenfassen:** wer was bis wann will, Fristen, Beträge und offene Fragen.
- **Übersetzen** in deine Sprache.
- **Termine, Aufgaben, Kontakte:** findet sie in der Mail. Mit **Übernehmen** speicherst du sie.
- **Echtheit prüfen:** achtet auf Druck, Zahlungsaufforderungen, geänderte Kontonummern und gefälschte Absender.

### Beim Schreiben

Im Editor öffnet der Knopf **Assistent** diese Hilfen:

- **Antwort vorschlagen**, auch aus ein paar Stichworten von dir.
- **Stichpunkte zu fertiger Mail** macht aus Notizen einen vollständigen Text.
- **Umformulieren:** **Kürzer**, **Höflicher**, **Förmlicher**, **Lockerer**, **Rechtschreibung korrigieren**, **Auf Englisch** oder **Auf Deutsch**. Mit **Rückgängig** kommst du zum Original zurück.

Vor dem Senden prüft der Assistent auf vergessene Anhänge, scharfen Ton, falsche Empfänger und sensible Daten. Du entscheidest, ob trotzdem gesendet wird.

Unter **Schreibstil** legst du fest, wie der Assistent für dich schreibt: Tonfall, du oder Sie, Grußformel und eigene Hinweise.

**Stil pro Kontakt lernen** (unter Schreibstil, anfangs aus): Levuvo Mail liest deine gesendeten Mails im lokalen Suchindex und merkt sich je Kontakt Anrede, Gruß und du oder Sie. Dafür läuft kein KI-Modell; gespeichert wird verschlüsselt nur auf diesem Gerät. Ein Antwortvorschlag an diese Person übernimmt dann ihre Anrede und eure Du/Sie-Form und zeigt „Im Stil deiner Mails an …“. In der Tabelle siehst du, was gelernt wurde, und kannst einzelne Kontakte oder alles löschen.

### Diktieren

Unter **Einstellungen → KI & Agenten → Diktieren** wählst du ein Sprachmodell: **Whisper base** (schnell, ungenau), **Whisper small** (ausgewogen) oder **Whisper large-v3-turbo** (am genauesten, braucht für gutes Tempo eine Grafikkarte). Es wird einmal heruntergeladen und gegen feste Prüfsummen geprüft.

Danach erscheint im Editor der Knopf **Diktieren** mit dem Mikrofon. Klicke ihn, sprich, und klicke **Fertig**; der Text landet an der Schreibmarke. Eine Aufnahme dauert höchstens fünf Minuten. Die Sprache wird auf deinem Computer erkannt, Ton und Text verlassen das Gerät nicht, und die Aufnahme wird nicht gespeichert. Beim ersten Mal fragt das System nach dem Mikrofon.

### Das Assistent-Fenster

Klicke links auf das Funkel-Symbol ✦ oder drücke `Strg` + `J`.

![Das Assistent-Fenster](assistant.png)

- **Frage:** „Wann kommt die Lieferung von Müller?“ Die Antwort nennt die Mails, aus denen sie stammt. Ein Klick öffnet sie.
- **Aufgabe:** „Kläre mit Anna einen Termin nächste Woche.“ Der Assistent sucht freie Zeiten und bereitet einen Entwurf vor. Gesendet wird nichts.
- **Routinen:** fertige Abläufe wie Tagesbriefing, offene Antworten oder Newsletter aufräumen.
- **Freigaben:** alles, was der Assistent oder ein Agent vorbereitet hat und auf dein **Freigeben** oder **Ablehnen** wartet.

## Externe Agenten anbinden

Fortgeschrittene können KI-Programme wie Claude Desktop mit Levuvo Mail verbinden. Dafür stellt Levuvo Mail eine Schnittstelle bereit, den sogenannten MCP-Server. Er ist nur von diesem Computer aus erreichbar. Unter **Einstellungen → KI & Agenten → Agenten-Schnittstelle (MCP)** schaltest du ihn ein und legst mit **Neuer Agent** einen Zugang mit festen Rechten an: nur lesen, Entwürfe anlegen, ordnen oder alles. Senden, Termine mit Teilnehmenden und Löschen warten auf deine Freigabe. Nur wenn du bei der Stufe „Alles inkl. Senden“ **ohne Freigabe senden** ankreuzt, sendet der Agent direkt. Passwörter, Schlüssel und Konten sind für Agenten nie erreichbar.

## Datenschutz und KI-Regeln

- **Lokal ist Standard.** Mit einem lokalen Modell bleibt jeder Inhalt auf deinem Computer.
- **Cloud nur mit Einwilligung.** Bevor du ein Cloud-Modell nutzt, zeigt Levuvo Mail genau, welche Inhalte übertragen werden. Du kannst die Einwilligung jederzeit mit **Einwilligung widerrufen** zurücknehmen.
- **Konten sperren.** Unter **Keine Cloud-KI für diese Konten** schließt du einzelne Postfächer, etwa dein dienstliches, ganz von Cloud-KI aus.
- **Daten anderer Menschen.** Mails enthalten auch Namen und Daten deiner Kontakte. Nutze Cloud-KI für dienstliche Mails nur, wenn deine Organisation das erlaubt.
- **Kennzeichnung und Kontrolle.** KI-Ergebnisse sind immer gekennzeichnet. KI kann sich irren: Prüfe Zusammenfassungen und Vorschläge, besonders Beträge, Fristen und Namen. Die letzte Entscheidung triffst du, so verlangt es auch die europäische KI-Verordnung (EU AI Act).
- **KI-Protokoll.** Unter **KI-Protokoll** siehst du, was KI und Agenten getan haben, ohne Mailinhalte, 30 Tage lang und nur auf diesem Gerät.
- **Alles löschen.** **Alle KI-Daten löschen** entfernt Einstellungen, Einwilligungen, Schlüssel, Protokoll und Agenten. Deine Mails bleiben unverändert.
