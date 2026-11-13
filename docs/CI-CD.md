# CI/CD-Dokumentation

| Workflow | Auslöser | Inhalt |
|---|---|---|
| `ci.yml` | PR, Push auf `master` | Qualität (Syntax, Lint, Format, 201 Tests, i18n, Typecheck, Build, Lizenzhinweise), Sicherheit (Audit, Secret-Scan, Workflow-Check), unsignierte Desktop-Builds, Sammelstatus `CI bestanden` |
| `build-desktop.yml` | von CI/Release aufgerufen, manuell | Matrix macOS ARM64 (`macos-15`), Windows ARM64 (`windows-11-arm`), Windows x64 (`windows-2022`): Tests auf Zielplattform, Installer, Architekturprüfung, App-Start-Test, Credential-Manager-Test (Windows), Prüfsummen, Upload |
| `release.yml` | Tag `vX.Y.Z`, manuell | Version/Tag-Prüfung, Qualität, Builds, Zusammenführung, Draft-Release |
| `codeql.yml` | PR, Push, wöchentlich | CodeQL JavaScript/TypeScript |

Hilfsskripte in `scripts/`: `verify-app-arch.mjs` (PE/Mach-O-Architektur), `smoke-packaged.mjs` (Start-Test), `assemble-release.mjs` (Zusammenführung, SHA-256, Manifest, Notes), `secret-scan.mjs`, `check-workflows.mjs`.

## Empfohlene Repository-Einstellungen (Admin)

- Ruleset/Branch-Protection für `master`: PR erforderlich, Status-Check `CI bestanden`, keine Force-Pushes.
- Environment `release-signing` mit Required Reviewers und den Secrets aus `RELEASING.md`.
- Secret Scanning + Push Protection, Dependabot Alerts, Private Vulnerability Reporting aktivieren.
- Settings → Actions → Workflow-Berechtigungen: _Read repository contents_ als Standard.

## Nicht in der CI

`npm run test:integration` und `npm run test:e2e` benötigen Testserver (Dovecot, Radicale, OAuth-Testanbieter, Playwright), deren Konfiguration nicht im Repository liegt. Sie sind dort übersprungen (Opt-in) und müssen separat laufen.

## Offene Sicherheitsbefunde

Siehe Abschnitt „Bekannt und bewusst offen“ in `VALIDATION-REPORT.md` sowie das Audit-Summary des jeweiligen CI-Laufs (Build-Werkzeug-Abhängigkeiten von `electron-builder`, nur zur Bauzeit relevant).

## CodeQL-Befunde (Import 2.2.0, 15 Alerts)

CodeQL bleibt als aktives Gate bestehen. Bearbeitung:

| Alert | Datei | Bewertung | Maßnahme |
|---|---|---|---|
| Incomplete multi-character sanitization (7) | `html-mail`, `cloud`, `previews`, `security-analysis`, `templates` | real, geringes Risiko (Ausgabe ist Klartext) | behoben: `stripTags`/`replaceUntilStable` entfernen Tags bis zum stabilen Ergebnis |
| Double escaping/unescaping | `cloud.mjs` | real (`&amp;lt;` → `<`) | behoben: `&amp;` wird zuletzt dekodiert |
| Polynomial regex (vCard-Import) | `routes-dav.mjs` | real (quadratisch bei vielen `BEGIN:VCARD` ohne `END`) | behoben: linearer `splitVcards` |
| Insufficient password hash | `inbox-watcher.mjs` | kein Passwort-Hashing: In-Memory-Fingerprint zur Änderungserkennung, nie gespeichert | behoben: Hashing entfernt, direkter In-Memory-Vergleichswert (HMAC wurde von CodeQL weiterhin geflaggt) |
| Replacement of a substring with itself | `test/integration/full.test.mjs` | Test-No-op | behoben (entfernt) |
| Incomplete multi-character sanitization (Rest) | `previews.mjs` (Entity-Dekodierung nach Tag-Entfernung) | Klartext-Vorschau; `&lt;script&gt;` soll als Text erscheinen (React escaped) | umgebaut: Entities je Textabschnitt zwischen den Tags dekodiert; falls CodeQL weiter meldet: False Positive |
| Missing rate limiting [#10](https://github.com/peterkarlhuber/levuvo-mail/security/code-scanning/10) | `app.mjs`, `GET /` (liest `index.html`) | False Positive (siehe unten) | in GitHub als „False positive“ dismissen |
| Missing rate limiting [#11](https://github.com/peterkarlhuber/levuvo-mail/security/code-scanning/11) | `app.mjs`, `GET /*` (liest Assets) | False Positive (siehe unten) | in GitHub als „False positive“ dismissen |
| Missing rate limiting [#12](https://github.com/peterkarlhuber/levuvo-mail/security/code-scanning/12) | `routes-accounts.mjs`, `GET /oauth/callback` | False Positive (siehe unten) | in GitHub als „False positive“ dismissen |
| Incomplete URL substring sanitization | `test/cloud.test.mjs` | False Positive: exakter Mengenvergleich in einem Test, keine URL-Prüfung | auf `Set.has` umgestellt; sonst dismissen |

Regressionstests: `apps/server/test/codeql-fixes.test.mjs`.

### Begründung „Missing rate limiting“ (#10, #11, #12)

CodeQL bleibt vollständig aktiv; es gibt keine Query-Ausnahme. Die drei Alerts werden einzeln dismisst, weil die Routen nur lokal erreichbar sind und keine teure oder angreifbare Arbeit ohne vorherige Prüfung leisten:

- **Gemeinsame Kontrollen** (`app.mjs`, `onRequest`-Hook): Der Server bindet ausschließlich an `127.0.0.1` (`api.listen({ host: '127.0.0.1' })`), im Desktop-Modus auf einem zufälligen Port. Jede Anfrage mit fremdem `Host` (Schutz gegen DNS-Rebinding), fremdem `Origin` oder `Sec-Fetch-Site: cross-site` wird mit 403 abgewiesen. Tests: `app.test.mjs` („Desktop-API verlangt Sitzungscookie, richtigen Host und Origin“).
- **#10 `GET /`** und **#11 `GET /*`**: Nur im Desktop-Modus registriert und nicht von der Cookie-Pflicht ausgenommen, d. h. zusätzlich ist das 64-stellige Sitzungscookie von Electron nötig (`validDesktopCookie`, zeitkonstanter Vergleich). `GET /*` liest nur Dateien, die `safeStaticFile` zulässt: feste Allowlist (`/assets/*.js|css|png|svg|woff2`, zwei Logos), kein `..`, `\` oder NUL, Pfad muss unter `staticRoot` liegen, URL höchstens 512 Zeichen. Tests: `desktop-runtime.test.mjs`. Ein Angreifer bräuchte lokalen Code auf dem Rechner und das Sitzungscookie; dann wäre ein Rate-Limit auf das Lesen eigener App-Dateien wirkungslos.
- **#12 `GET /oauth/callback`**: Bewusst ohne Cookie (Rückkehr aus dem System-Browser), aber mit Host-Prüfung. Die Autorisierung erfolgt über den `state` aus `oauth.start` (24 Byte `randomBytes`, einmalig, 10 Minuten gültig). Ein ungültiger `state` wird in `oauth.complete` abgewiesen, bevor ein Token-Tausch oder Netzwerkzugriff stattfindet; Fehlversuche ändern keinen Zustand, und das Diagnose-Protokoll ist größenbegrenzt. Ein Erraten von 192 Bit ist auch ohne Rate-Limit aussichtslos. Tests: `mail-features.test.mjs` (`oauth_state_invalid`).
