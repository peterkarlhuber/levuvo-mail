# CI/CD documentation

| Workflow | Trigger | Contents |
|---|---|---|
| `ci.yml` | PR, push to `master` | Quality (syntax, lint, format, 201 tests, i18n, typecheck, build, license notices), security (audit, secret scan, workflow check), unsigned desktop builds, aggregate status `CI passed` |
| `build-desktop.yml` | called by CI/release, manual | Matrix macOS ARM64 (`macos-15`), Windows ARM64 (`windows-11-arm`), Windows x64 (`windows-2022`): tests on the target platform, installer, architecture check, app startup test, Credential Manager test (Windows), checksums, upload |
| `release.yml` | tag `vX.Y.Z`, manual | version/tag check, quality, builds, assembly, draft release |
| `codeql.yml` | PR, push, weekly | CodeQL JavaScript/TypeScript |

Helper scripts in `scripts/`: `verify-app-arch.mjs` (PE/Mach-O architecture), `smoke-packaged.mjs` (startup test), `assemble-release.mjs` (assembly, SHA-256, manifest, notes), `secret-scan.mjs`, `check-workflows.mjs`.

## Recommended repository settings (admin)

- Ruleset/branch protection for `master`: PR required, status check `CI passed`, no force pushes.
- Environment `release-signing` with required reviewers and the secrets from `RELEASING.md`.
- Enable secret scanning + push protection, Dependabot alerts, private vulnerability reporting.
- Settings → Actions → Workflow permissions: _Read repository contents_ as the default.

## Not in CI

`npm run test:integration` and `npm run test:e2e` need test servers (Dovecot, Radicale, OAuth test provider, Playwright) whose configuration is not in the repository. They are skipped there (opt-in) and must be run separately.

## Open security findings

See the section “Known and deliberately open” in `VALIDATION-REPORT.md` and the audit summary of the respective CI run (build tool dependencies of `electron-builder`, relevant only at build time).

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
