# Levuvo Mail 2.2.0 – Prüfbericht

Erstellt am 13. November 2026 bei der Paketierung (Linux-Build-Umgebung, Node.js 22.23, Electron 45.3.1).

## Ausgeführt und bestanden

| Prüfung | Ergebnis |
|---|---|
| `npm ci` aus `package-lock.json` (frisch entpacktes Kit) | exakte Versionen, reproduzierbar |
| `npm audit --omit=dev` (alles, was in der App läuft) | **0 Schwachstellen** |
| `check:syntax` · `lint` · `format:check` · `typecheck` · `build` | ohne Befund |
| `npm test` | **201 von 201 bestanden** (Server, Oberflächenlogik, Desktop, Übersetzungs-Vollständigkeit) – neu u. a. Microsoft-Graph- und Google-Abbildung (Termine, Serien, Erinnerungen, Kontakte, Fehlerfälle), getrennte Graph-Token, Rückgängig über COPYUID, Zurückstellen/Nachfassen, Vorlagen, List-Unsubscribe inkl. Sperre interner Adressen, Drag-&-Drop-Zeitberechnung, Befehlspalette |
| `check:i18n` | jede Oberflächen- und Servermeldung hat eine englische Übersetzung (≈ 1 090 Texte), Platzhalter identisch |
| **Integrationstest gegen echte Server** (`npm run test:integration`, 15 Szenarien) | bestanden – Dovecot (IMAP 993/TLS, IDLE, ManageSieve, UIDPLUS), SMTP 465/TLS, Radicale (CalDAV/CardDAV), lokaler OAuth-Testanbieter mit **Microsoft-Graph-Testserver** (Kalender, Termin anlegen/lesen/löschen, Kontakte, erneute Freigabe für dasselbe Postfach), GnuPG und OpenSSL; neu: **mit Passwort geschützte Nachricht** (kein Klartext in Mail und Anhang, falsches Passwort, Sperre nach Fehlversuchen, Kopie in „Gesendet“), **Kalender „Auf diesem Gerät“ (Erinnerung, Export, Verschieben in CalDAV, Import)**, **Konversation über Posteingang und Gesendet, Rückgängig mit neuer UID, Zurückstellen und Zurückholen (ungelesen), Nachfassen (Antwort beendet, ohne Antwort fällig), Vorlagen** |
| **Ende-zu-Ende-Test der Oberfläche** (Chromium, `npm run test:e2e`, 16 Abläufe, 0 JavaScript-Fehler) | alle Abläufe aus 2.0 sowie neu: **Konversation** aufklappen · **Schnellaktion „Papierkorb“ mit Rückgängig** · **Zurückstellen** und „Jetzt zurückholen“ · **Vorlage speichern und einfügen** · **Nachfassen** beim Senden → Liste „Nachfassen“ · **Befehlspalette** (Ordner, Kalender mit Monatsübersicht, Posteingang) · **Newsletter abmelden** (Abmelde-E-Mail kommt beim Absender an) · **Gerätekalender ohne Konto** mit **Drag & Drop in der Wochenansicht** · **geschützte Nachricht**: senden, in der App entsperren und die angehängte Datei in einem normalen Browser öffnen |
| **Electron-App, auch gepackt** (`electron-builder --linux dir` aus frisch entpacktem Kit, App-Archiv 26 MB; unter Xvfb mit Secret-Service-Schlüsselbund) | startet, Version 2.2.0, Konto über Schlüsselbund, Befehlspalette, „Nachfassen“, Kalender; Vorlagen- und Nachfassen-Schnittstellen erreichbar; keine JavaScript-Fehler |

### Beim Testen gefundene und behobene Fehler (Auszug)

- **2.1.1:** Drag & Drop in Wochen-/Tagesansicht und bei ganztägigen Terminen verschob nichts (der Zielbereich las den gezogenen Termin, nachdem er bereits zurückgesetzt war) → behoben, neuer Ende-zu-Ende-Test zieht einen Termin auf einen anderen Tag.

- Nachfassen- und Vorlagen-Schnittstellen verlangten bei mehreren Konten eine Kontoangabe → jetzt kontounabhängig.
- Fehler aus Kalender-/Kontaktdiensten (Microsoft/Google) wurden als IMAP-Fehler gemeldet → eigene, verständliche Meldungen.
- Befehlspalette: schnelles Öffnen direkt nach dem Schließen übernahm den alten Suchtext; die ersten Tastendrücke konnten in der Liste als Tastenkürzel landen → Fokus und Zurücksetzen sofort beim Öffnen, Tastenkürzel ruhen bei offener Palette.
- Menüs in der Lese-Werkzeugleiste übernahmen das Aussehen der Werkzeugschaltflächen → einheitliche Menüs.
- Lese-Werkzeugleiste brach bei schmalen Fenstern um bzw. schnitt „Weiterleiten“ ab → Beschriftungen werden zu Symbolen (Container-Abfragen).
- Einrichtung: lange Anbieternamen wurden abgeschnitten → Kacheln im 3er-Raster.

## Lizenzen

`THIRD-PARTY-NOTICES.txt` (wird mit `npm run notices` erzeugt und in die App gepackt): 153 Pakete,
überwiegend MIT/BSD/ISC/Apache-2.0. **OpenPGP.js steht unter LGPL-3.0**: Die Bibliothek wird unverändert
und austauschbar (eigenes Modul im App-Archiv) ausgeliefert; Lizenztext liegt bei. Bitte bei der
rechtlichen Prüfung berücksichtigen.

## Bekannt und bewusst offen

- `npm audit` inkl. Build-Werkzeuge: 15 Befunde „moderate“ in `electron-builder`-Abhängigkeiten; nur beim Bauen relevant, nicht in der App.
- **OAuth (Microsoft/Google):** technisch vollständig und gegen einen Testanbieter geprüft. Für echte Konten braucht es Client-IDs von Levuvo (`docs/OAUTH-SETUP.md`); Google verlangt für den Gmail-Bereich eine Verifizierung/Sicherheitsbewertung.
- **Kalender & Kontakte von Microsoft 365 / Google:** gegen einen nachgebauten Graph-Server (Integrationstest) bzw. nachgebildete Google-Antworten (Unit-Tests) geprüft – **noch nicht gegen echte Microsoft-/Google-Konten**, weil dafür die Client-IDs fehlen. Erst nach dem Eintragen der IDs abnehmen (`RELEASE-CHECKLIST.md`). Bei Microsoft werden Serien als ganze Serie oder einzelnes Vorkommen geändert; Ausnahmen-Details (z. B. einzeln verschobene Vorkommen) zeigt Levuvo so, wie Microsoft/Google sie liefert.
- **Zurückstellen und Nachfassen** brauchen eine laufende App (Hintergrund genügt); Zeitpunkte werden lokal gespeichert, die zurückgestellte Nachricht liegt sicher im Serverordner „Zurückgestellt“.
- **Newsletter-Abmeldung:** One-Click nur an öffentliche https-Adressen; eine Namensauflösung auf interne Adressen (DNS-Rebinding) wird nicht zusätzlich geprüft.
- **Absturzberichte:** Einwilligung und Technik vorhanden; ohne `levuvo.crashReportUrl` bleiben sie aus.
- **Impressum/Datenschutz:** Vorlagen mit Platzhaltern (`docs/IMPRESSUM.md`, `DATENSCHUTZ.md`), rechtliche Prüfung erforderlich.
- S/MIME: derzeit RSA-Zertifikate (ECDSA wird beim Import abgelehnt); .p12 im Legacy-Format (RC2) bitte mit AES exportieren.
- Geplante Nachrichten werden versendet, solange Levuvo Mail läuft (auch im Hintergrund); sonst beim nächsten Start.
- Nur IMAP über 993/TLS (kein STARTTLS auf 143) – bewusste Sicherheitsentscheidung.

- **Gerätekalender:** keine Synchronisation mit anderen Geräten (bewusst). Ist der Schlüsselbund gesperrt, fehlt der Gerätekalender bis zur Entsperrung (es wird nichts überschrieben).

- **Geschützte Nachrichten:** kein Ablaufdatum, kein Zurückziehen (dafür bräuchte es einen Server). Handy-Mailvorschauen ohne Skripte (z. B. iPhone Mail) zeigen nur die Passwortseite – Datei in Safari/Chrome öffnen. Strenge Firmenfilter können .html-Anhänge zurückhalten; vor dem Release mit Gmail, Outlook.com und einem Firmenpostfach prüfen.

## Noch auf den Zielsystemen zu bestätigen

- Native Builds (DMG, beide EXE), Installation, Schlüsselbund/Credential Manager (`desktop:win:check:vault`).
- Systemmitteilungen (neue Mail, Terminerinnerung), Tray, Autostart, Link-Rückfrage, Drucken im nativen Fenster.
- Zusammenspiel mit echten Gegenstellen: Outlook/Exchange (Einladungen, S/MIME), Gmail, Apple Mail, Thunderbird (OpenPGP), Nextcloud.
- Signierung, Notarisierung und ein echter Update-Durchlauf (Zertifikate und Update-URL, siehe `RELEASE-KIT.md`).

Checkliste: `RELEASE-CHECKLIST.md`. Im Kit sind **keine vorgetäuschten Installer** enthalten.
