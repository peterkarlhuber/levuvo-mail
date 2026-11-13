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
| Incomplete multi-character sanitization (Rest) | `previews.mjs` (Entity-Dekodierung nach Tag-Entfernung) | False Positive: Klartext-Vorschau; `&lt;script&gt;` soll als Text `<script>` erscheinen, die Oberfläche rendert Text escaped (React) | begründet dismissen |
| Missing rate limiting (3) | `app.mjs` ×2, `routes-accounts.mjs` | False Positive: Server bindet ausschließlich an `127.0.0.1`, mit Host-/Origin-Prüfung; Statische Dateien bzw. OAuth-Rückruf (zufälliger, einmaliger `state`) | begründet dismissen |
| Incomplete URL substring sanitization | `test/cloud.test.mjs` | False Positive: exakter Array-Vergleich in einem Test, keine URL-Prüfung | begründet dismissen |

Regressionstests: `apps/server/test/codeql-fixes.test.mjs`.
