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
