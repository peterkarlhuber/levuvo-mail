# Security

## Reporting vulnerabilities (coordinated vulnerability disclosure)

Please do **not** report vulnerabilities publicly as an issue. Use one of these channels:

- _Security → Report a vulnerability_ (GitHub Private Vulnerability Reporting) in this repository – preferred;
- the security contact on <https://levuvo.at> ([security@levuvo.at], see `/.well-known/security.txt` once published).

Please include the affected version, steps to reproduce and the impact you expect. We

- acknowledge your report within **3 working days**;
- give a first assessment (CVSS v4.0) within **10 working days**;
- aim to release a fix within 72 hours (critical or actively exploited), 14 days (high), 60 days
  (medium) or with the next release (low);
- publish a GitHub Security Advisory (and a CVE where applicable) when the fix is available, and
  credit you if you wish;
- ask you to keep the issue confidential until then, at most 90 days after your report.

We will not take legal action against good-faith research that respects users' privacy, does not
access other people's data, does not degrade services and gives us reasonable time to fix the issue.

The full internal process (triage, deadlines, reporting actively exploited vulnerabilities within
24 hours under the Cyber Resilience Act) is in
[docs/compliance/cra/VULNERABILITY-HANDLING.md](docs/compliance/cra/VULNERABILITY-HANDLING.md) and
[docs/compliance/cra/INCIDENT-REPORTING.md](docs/compliance/cra/INCIDENT-REPORTING.md).

## Supported versions

| Version | Security updates |
| --- | --- |
| 2.x (latest minor) | yes, until the end of support shown in Settings → About (proposal: 2031-11-30, see [docs/compliance/cra/SUPPORT-PERIOD.md](docs/compliance/cra/SUPPORT-PERIOD.md)) |
| older 2.x minors | update to the latest 2.x |
| 1.x | no |

Security fixes are released as patch versions without new features where feasible, free of charge.

## Software bill of materials

Every release has a CycloneDX SBOM (`levuvo-mail-<version>.cdx.json`) covering the npm packages,
Electron, the bundled CPython and Python packages of the AI runtime and the bundled Ollama.
`npm run sbom` produces it locally.

## Measures in this repository

- CI: `npm audit` (runtime blocking from _high_; all dependencies blocking from _high_, the rest in the job summary), secret scan, CodeQL, workflow policy check.
- Workflows: `contents: read` by default, write permissions only in the publish job, SHA-pinned actions, no `pull_request_target`, secrets only in the protected `release-signing` environment.
- Dependabot for npm, pip and GitHub Actions; pip-audit of all hashed Python locks; weekly supply-chain scan (Electron support window, CPython patch level, Ollama advisories, model pins).
- SBOM (CycloneDX) and licence policy check in CI and in every release.
- Credentials are stored exclusively in the operating system keychain, never in the repository or the installer.

## Password-protected messages ("Protect with password")

Reviewed 2026-11-19 (`apps/server/src/protected-message.mjs`). The message, its formatting and attachments are sealed into a self-contained HTML file that the recipient opens offline in any browser.

- **Crypto:** PBKDF2-HMAC-SHA256 with 600 000 iterations (OWASP 2023), random 16-byte salt and 12-byte IV per message, AES-256-GCM. Only WebCrypto primitives, so no server and no installation is needed. Argon2 would be stronger against GPU attacks but is not available in WebCrypto.
- **Passwords:** at least 10 characters; the composer suggests a random 16-character password (~93 bits). Because the file can be attacked offline without any rate limit, easily guessed passwords (few distinct characters, alphabet or digit runs, common words with digits) are refused on both the client and the server. The copied password is removed from the clipboard after one minute. The password is never stored or logged.
- **Viewer:** strict CSP (`default-src 'none'`, no network, `form-action 'none'`), the body is shown in a sandboxed frame without scripts, attachments are offered as `application/octet-stream` downloads. Inside Levuvo Mail, received protected messages are decrypted locally (bounded iteration count and size, 5 attempts per minute) and shown through the regular HTML sanitizer.
- **Limits, by design:** the subject, sender, recipients and the password hint stay readable. The viewer file itself is not signed; a party that can modify the mail in transit could replace the viewer. Automatically saved drafts stay unencrypted in the sender's own Drafts folder until sending (the composer says so); the Sent copy contains only the encrypted file.

## Known open items

State 2.5.0 (internal use only):

- **Unsigned internal test builds:** deliberately without code signing and without auto-update; Gatekeeper/SmartScreen warn. Signed releases need the certificates from `RELEASING.md`.
- **Build tool dependencies** of `electron-builder` with known advisories, relevant only at build time; see the audit summary of the respective CI run.
