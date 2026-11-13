# Levuvo Mail 2.2.0

E-Mail, Kalender und Kontakte für **macOS (Apple Silicon)** und **Windows (ARM64, x64)**.
*Less effort. More impact.*

- **E-Mail:** IMAP (993/TLS) und SMTP (587/STARTTLS, 465/TLS), bis zu fünf Konten, Absenderadressen (Aliase), HTML-Editor mit Signaturen und Logo, **Konversationen**, **Rückgängig für alle Aktionen**, **Zurückstellen**, **Nachfassen**, **Vorlagen**, **Newsletter abmelden**, Senden rückgängig, Später senden, Ordnerverwaltung mit Drag & Drop, Markieren, Spam, Drucken/PDF, .eml, Anhangsvorschau
- **Kalender** (auf dem Gerät ohne Konto, CalDAV sowie **Microsoft 365 und Google direkt**) mit Wiederholungen, Erinnerungen, Einladungen und Drag & Drop · **Kontakte** (CardDAV, Microsoft 365, Google) mit vCard-Import/-Export
- **Befehlspalette (Strg/⌘ + K)**, Schnellaktionen in der Liste, Anbieter-Kacheln bei der Einrichtung
- **Mit Passwort geschützte Nachrichten** für jeden Empfänger (AES-256, Öffnen im Browser) · **Sicherheit:** Passwörter, Token und private Schlüssel nur im Schlüsselbund · Phishing-Warnungen (SPF/DKIM/DMARC, Links, Anhänge) · OpenPGP und S/MIME · geschützte HTML-Ansicht
- **Serverfilter und Abwesenheitsnotiz** (Sieve) · **Anmeldung mit Microsoft 365 und Google** (OAuth 2.0)
- **Verschlüsselter lokaler Suchindex** – Suche über alle Ordner und Konten, auch offline
- Deutsch und Englisch, helles und dunkles Design

Neuerungen: [CHANGELOG.md](./CHANGELOG.md) · Handbuch: [docs/HANDBUCH.md](./docs/HANDBUCH.md) · Manual (EN): [docs/MANUAL.md](./docs/MANUAL.md) · Datenschutz: [DATENSCHUTZ.md](./DATENSCHUTZ.md) · Impressum-Vorlage: [docs/IMPRESSUM.md](./docs/IMPRESSUM.md)

## Entwicklung

Voraussetzung: Node.js 22.12 oder neuer.

```bash
npm ci                 # exakt die Versionen aus package-lock.json
npm run dev            # API (Browser-Modus, Port 3001) + Vite (http://127.0.0.1:5173)
npm run desktop:dev    # Electron-App lokal
```

Im Browser-Modus können Testkonten über Umgebungsvariablen (`IMAP_USER`, `IMAP_PASSWORD`, `IMAP_HOST`, `ENABLE_SEND=true` …) gesetzt werden. Die Desktop-App ignoriert sie bewusst (Ausnahme: `LEVUVO_OAUTH_*` für Test-Builds, siehe `docs/OAUTH-SETUP.md`).

### Qualitätsprüfung

```bash
npm run release:check  # Audit, Syntax, ESLint, Prettier, Tests, TypeScript, Build, Lizenzhinweise
npm run check:i18n     # jede Oberflächen- und Servermeldung hat eine englische Übersetzung
```

#### Integrationstests gegen echte Server (optional, schreiben Testdaten)

Benötigt zwei Testpostfächer auf einem Mailserver mit lokaler Zustellung und ManageSieve, einen CalDAV/CardDAV-Server mit zwei Benutzern und optional einen OAuth-Testanbieter. **Nur mit eigenen Testkonten verwenden.**

```bash
export LEVUVO_IT_ALLOW_WRITES=1 LEVUVO_IT_IMAP_HOST=mail.test.example LEVUVO_IT_SMTP_PORT=465
export LEVUVO_IT_USER=peter@test.example LEVUVO_IT_PASSWORD=… LEVUVO_IT_USER2=anna@test.example LEVUVO_IT_PASSWORD2=…
export LEVUVO_IT_DAV_URL=https://dav.test.example/ LEVUVO_IT_DAV_USER=peter LEVUVO_IT_DAV_PASSWORD=… LEVUVO_IT_DAV_USER2=anna LEVUVO_IT_DAV_PASSWORD2=…
export LEVUVO_IT_OAUTH_URL=http://127.0.0.1:9900     # optional
npm run test:integration
```

#### Ende-zu-Ende-Test der Oberfläche (Browser)

Gleiche Umgebungsvariablen, zusätzlich Playwright mit Chromium:

```bash
npm run build
npx playwright install chromium
npm run test:e2e        # bzw. LEVUVO_PLAYWRIGHT=$(npm root -g)/playwright bei globaler Installation
```

Der Test bedient die App wie ein Mensch (Verfassen mit Formatierung, Rückgängig, Antworten, Ordner und Drag & Drop, Phishing-Warnung, Anhangsvorschau, Später senden, Kalender mit Einladung und Antwort, Kontakte, OpenPGP, Filter/Abwesenheit, Konversation, Rückgängig, Zurückstellen, Nachfassen, Vorlagen, Befehlspalette, Newsletter-Abmeldung, Offline-Suche, Englisch und helles Design) und legt Bildschirmfotos unter `test/e2e/screenshots/` ab.

### Aufbau

| Pfad | Inhalt |
|---|---|
| `apps/server/src/app.mjs` | lokale API (Fastify), nur `127.0.0.1`, Sitzungscookie, Aktions-Header |
| `apps/server/src/routes-*.mjs` | E-Mail, Konten/OAuth, Kalender/Kontakte, Verschlüsselung/Diagnose |
| `apps/server/src/inbox-watcher.mjs` | IMAP-IDLE-Verbindung pro Konto |
| `apps/server/src/dav.mjs`, `calendar-model.mjs`, `vcard.mjs` | CalDAV/CardDAV, iCalendar, iTIP, vCard |
| `apps/server/src/cloud.mjs` | Kalender & Kontakte über Microsoft Graph und Google Calendar/People API |
| `apps/server/src/local-calendar.mjs` | Kalender „Auf diesem Gerät“ (verschlüsselt, .ics-Export/-Import) |
| `apps/server/src/protected-message.mjs` | Mit Passwort geschützte Nachrichten (Verschlüsselung, Browser-Ansicht) |
| `apps/server/src/thread.mjs`, `followups.mjs`, `templates.mjs`, `unsubscribe.mjs` | Konversationen, Zurückstellen/Nachfassen, Vorlagen, Newsletter-Abmeldung |
| `apps/server/src/pgp.mjs`, `smime.mjs`, `mime-crypto.mjs` | OpenPGP, S/MIME, PGP/MIME |
| `apps/server/src/sieve.mjs` | ManageSieve-Client, Regeln, Abwesenheit |
| `apps/server/src/local-index.mjs` | verschlüsselter Suchindex |
| `apps/server/src/security-analysis.mjs` | Phishing-Erkennung |
| `apps/desktop/main.mjs` | Electron-Hauptprozess, Tray, Mitteilungen, Erinnerungen, Updates |
| `apps/web/src/` | React-Oberfläche (`App`, `MailInstance`, `Reader`, `Composer`, `Calendar`, `Contacts`, `Settings`, `CommandPalette` …) |
| `apps/web/src/i18n-en.ts` | englische Texte (Schlüssel = deutscher Quelltext) |

## Installer bauen

Siehe [RELEASE-KIT.md](./RELEASE-KIT.md) (Test-Installer und signierte Releases) und [RELEASE-CHECKLIST.md](./RELEASE-CHECKLIST.md) (Abnahme). Windows-Details: [README-WINDOWS.md](./README-WINDOWS.md). OAuth-Anmeldung freischalten: [docs/OAUTH-SETUP.md](./docs/OAUTH-SETUP.md).

## Upgrade von 2.0

Einfach installieren – alles wird übernommen. Microsoft- und Google-Konten zeigen in Kalender und Kontakten einmalig „Freigeben“ (zusätzliche Berechtigung). Eigene Builds: neue Berechtigungen in Azure bzw. Google eintragen, siehe [docs/OAUTH-SETUP.md](./docs/OAUTH-SETUP.md).

## Upgrade von 1.x

Einfach installieren. Konten und Passwörter (Schlüsselbund-Dienst `at.levuvo.mail`) werden übernommen. Kalender und Kontakte verbindest du unter Einstellungen → Kalender & Kontakte.
