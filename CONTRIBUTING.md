# Contributing

- `master` is stable and protected. Changes only via feature branches (`feature/…`, `fix/…`) and pull requests.
- Requirement: Node.js ≥ 22.12, `npm ci`.
- Before opening a PR, run locally: `npm run release:check` (audit, syntax, lint, format, tests, typecheck, build, license notices). Formatting: `npm run format`.
- CI runs automatically on every PR: quality, security (npm audit, secret scan, workflow policy), CodeQL and unsigned builds for macOS ARM64, Windows ARM64 and Windows x64. All of them must be green.
- Tests must never be disabled to get CI green. External services are mocked; integration/E2E tests (`test:integration`, `test:e2e`) need their own test servers and do not run in PR CI. **Never use real mailboxes.**
- Do not commit credentials, `.env`, certificates or mail data (`.gitignore`, secret scan).
- Pin new GitHub Actions only by commit SHA (`uses: owner/repo@<sha> # vX.Y.Z`); `scripts/check-workflows.mjs` enforces this.
- Record changes in `CHANGELOG.md` under `## [Unreleased]`.
- The repository (code, comments, docs) is in English. The app's user interface stays bilingual: German (default, source texts in `apps/web/src`) and English (`apps/web/src/i18n-en.ts`, `apps/desktop/i18n.mjs`).

Release process: `RELEASING.md`. Security vulnerabilities: `SECURITY.md`.
