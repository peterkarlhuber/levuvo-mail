# Mitarbeit

- `master` ist stabil und geschützt. Änderungen nur über Feature-Branches (`feature/…`, `fix/…`) und Pull Requests.
- Voraussetzung: Node.js ≥ 22.12, `npm ci`.
- Vor dem PR lokal: `npm run release:check` (Audit, Syntax, Lint, Format, Tests, Typecheck, Build, Lizenzhinweise). Formatierung: `npm run format`.
- Die CI läuft automatisch bei jedem PR: Qualität, Sicherheit (npm audit, Secret-Scan, Workflow-Richtlinien), CodeQL und unsignierte Builds für macOS ARM64, Windows ARM64 und Windows x64. Alle müssen grün sein.
- Tests dürfen nie deaktiviert werden, um die CI grün zu bekommen. Externe Dienste werden gemockt; Integrations-/E2E-Tests (`test:integration`, `test:e2e`) brauchen eigene Testserver und laufen nicht in der PR-CI. **Niemals echte Postfächer verwenden.**
- Keine Zugangsdaten, `.env`, Zertifikate oder Maildaten committen (`.gitignore`, Secret-Scan).
- Neue GitHub-Actions nur per Commit-SHA pinnen (`uses: owner/repo@<sha> # vX.Y.Z`); `scripts/check-workflows.mjs` erzwingt das.
- Änderungen in `CHANGELOG.md` unter `## [Unreleased]` eintragen.

Release-Ablauf: `RELEASING.md`. Sicherheitslücken: `SECURITY.md`.
