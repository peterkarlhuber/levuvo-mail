# CI/CD documentation

| Workflow | Trigger | Contents |
|---|---|---|
| `ci.yml` | PR, push to `master` | Quality (lockfile consistency, workflow policy, syntax, lint, format, all unit tests of server, UI and desktop configuration, i18n, typecheck, build, large-mailbox benchmark, accessibility test with axe-core in Chromium, license notices), security (audit, secret scan), AI sidecar (Python: ruff, pytest, bundled runtime build with hashed lock, `pip-audit` of the hashed Python locks, CPython patch check), tests in the Node of Electron (`ELECTRON_RUN_AS_NODE`, the runtime the server really uses), unsigned desktop builds, aggregate status `CI passed` |
| `build-desktop.yml` | called by CI/release, manual | Matrix macOS ARM64 (`macos-15`), Windows ARM64 (`windows-11-arm`), Windows x64 (`windows-2022`): tests on the target platform, installer, architecture check, Electron fuse check, app startup test, Credential Manager test (Windows), checksums, upload. Signed: each platform receives only its own certificate (`CSC_LINK` macOS, `WIN_CSC_LINK` Windows) |
| `supply-chain.yml` | weekly, manual | `npm audit` (runtime, from moderate), Electron support window (`check-electron-support.mjs`), `pip-audit` of the Python locks, bundled CPython is the newest patch release (`check-python-runtime.mjs --strict`) |
| `release.yml` | tag `vX.Y.Z`, manual | version/tag check, commit must be on `master` (also for manual and signed runs), **gate: the `CI` and `CodeQL` runs of exactly this SHA (push to `master`) must have succeeded** (`scripts/release-gate.mjs`, waits up to 90 min), quality, builds, assembly, draft release |
| `codeql.yml` | PR, push, weekly | CodeQL JavaScript/TypeScript |

Helper scripts in `scripts/`: `verify-app-arch.mjs` (PE/Mach-O architecture), `verify-fuses.mjs` (Electron fuses of the packaged binary), `check-release-version.mjs` (part of `release:check`: CHANGELOG section for the version, nothing left under “Unreleased”), `smoke-packaged.mjs` (startup test), `assemble-release.mjs` (assembly, SHA-256, manifest, notes), `secret-scan.mjs`, `check-workflows.mjs`.

## Recommended repository settings (admin)

- Ruleset/branch protection for `master`: PR required, status check `CI passed`, no force pushes.
- Environment `release-signing` with required reviewers and the secrets from `RELEASING.md`.
- Enable secret scanning + push protection, Dependabot alerts, private vulnerability reporting.
- Settings → Actions → Workflow permissions: _Read repository contents_ as the default.

## Not in CI

`npm run test:integration` and `npm run test:e2e` need test servers (Dovecot, Radicale, OAuth test provider, Playwright) whose configuration is not in the repository. They are skipped there (opt-in) and must be run separately.

## Open security findings

Known and deliberately open points are maintained in `SECURITY.md` (section “Known open items”), together with the audit summary of the respective CI run.

## CodeQL findings (import 2.2.0, 15 alerts)

CodeQL remains an active gate. Handling:

| Alert | File | Assessment | Action |
|---|---|---|---|
| Incomplete multi-character sanitization (7) | `html-mail`, `cloud`, `previews`, `security-analysis`, `templates` | real, low risk (output is plain text) | fixed: `stripTags`/`replaceUntilStable` remove tags until the result is stable |
| Double escaping/unescaping | `cloud.mjs` | real (`&amp;lt;` → `<`) | fixed: `&amp;` is decoded last |
| Polynomial regex (vCard import) | `routes-dav.mjs` | real (quadratic with many `BEGIN:VCARD` without `END`) | fixed: linear `splitVcards` |
| Insufficient password hash | `inbox-watcher.mjs` | no password hashing: in-memory fingerprint for change detection, never stored | fixed: hashing removed, direct in-memory comparison value (HMAC was still flagged by CodeQL) |
| Replacement of a substring with itself | `test/integration/full.test.mjs` | test no-op | fixed (removed) |
| Incomplete multi-character sanitization (remaining) | `previews.mjs` (entity decoding after tag removal) | plain-text preview; `&lt;script&gt;` is meant to appear as text (React escapes it) | reworked: entities decoded per text segment between the tags; if CodeQL still reports it: false positive |
| Missing rate limiting [#10](https://github.com/peterkarlhuber/levuvo-mail/security/code-scanning/10) | `app.mjs`, `GET /` (reads `index.html`) | false positive (see below) | dismiss in GitHub as “False positive” |
| Missing rate limiting [#11](https://github.com/peterkarlhuber/levuvo-mail/security/code-scanning/11) | `app.mjs`, `GET /*` (reads assets) | false positive (see below) | dismiss in GitHub as “False positive” |
| Missing rate limiting [#12](https://github.com/peterkarlhuber/levuvo-mail/security/code-scanning/12) | `routes-accounts.mjs`, `GET /oauth/callback` | false positive (see below) | dismiss in GitHub as “False positive” |
| Incomplete URL substring sanitization | `test/cloud.test.mjs` | false positive: exact set comparison in a test, no URL check | switched to `Set.has`; otherwise dismiss |

Regression tests: `apps/server/test/codeql-fixes.test.mjs`.

### Justification for “Missing rate limiting” (#10, #11, #12)

CodeQL stays fully active; there is no query exclusion. The three alerts are dismissed individually because the routes are reachable only locally and do no expensive or attackable work without prior checks:

- **Shared controls** (`app.mjs`, `onRequest` hook): The server binds exclusively to `127.0.0.1` (`api.listen({ host: '127.0.0.1' })`), in desktop mode on a random port. Every request with a foreign `Host` (protection against DNS rebinding), a foreign `Origin` or `Sec-Fetch-Site: cross-site` is rejected with 403. Tests: `app.test.mjs` (“Desktop API requires session cookie, correct Host and Origin”).
- **#10 `GET /`** and **#11 `GET /*`**: Registered only in desktop mode and not exempt from the cookie requirement, i.e. the 64-character session cookie from Electron is additionally required (`validDesktopCookie`, constant-time comparison). `GET /*` reads only files that `safeStaticFile` allows: fixed allowlist (`/assets/*.js|css|png|svg|woff2`, two logos), no `..`, `\` or NUL, the path must be under `staticRoot`, URL at most 512 characters. Tests: `desktop-runtime.test.mjs`. An attacker would need local code on the machine and the session cookie; a rate limit on reading the app's own files would then be ineffective.
- **#12 `GET /oauth/callback`**: Deliberately without cookie (return from the system browser), but with the host check. Authorization happens via the `state` from `oauth.start` (24 bytes of `randomBytes`, single use, valid for 10 minutes). An invalid `state` is rejected in `oauth.complete` before any token exchange or network access takes place; failed attempts change no state, and the diagnostic log is size-limited. Guessing 192 bits is hopeless even without a rate limit. Tests: `mail-features.test.mjs` (`oauth_state_invalid`).
