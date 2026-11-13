# Security

## Reporting vulnerabilities

Please do **not** report them publicly as an issue. Use _Security → Report a vulnerability_ (GitHub Private Vulnerability Reporting) in this repository or write to the contact address listed on <https://levuvo.at>. We will acknowledge receipt promptly.

## Supported versions

Only the latest published version is supported.

## Measures in this repository

- CI: `npm audit` (runtime blocking from _high_; all dependencies blocking from _high_, the rest in the job summary), secret scan, CodeQL, workflow policy check.
- Workflows: `contents: read` by default, write permissions only in the publish job, SHA-pinned actions, no `pull_request_target`, secrets only in the protected `release-signing` environment.
- Dependabot for npm and GitHub Actions.
- Credentials are stored exclusively in the operating system keychain, never in the repository or the installer.

## Known open items

See `docs/CI-CD.md` → “Open security findings”.
