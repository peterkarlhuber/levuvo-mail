# Levuvo Mail 2.5.0 – release kit

The ZIP contains the complete source code, the locked dependency list (`package-lock.json`)
and the build configuration for three platforms. **Finished DMG/EXE files are not included**:
they must be built on the respective operating system (native keychain module).

| Platform | File | Build machine |
|---|---|---|
| macOS Apple Silicon | `Levuvo-Mail-2.5.0-arm64.dmg` (+ `.zip` for updates) | Mac with Apple Silicon |
| Windows 11 ARM64 | `Levuvo-Mail-Setup-2.5.0-arm64.exe` | Windows ARM64 (e.g. UTM) |
| Windows x64 | `Levuvo-Mail-Setup-2.5.0-x64.exe` | Windows Intel/AMD |

## A) Test installers (unsigned, without auto-update)

```bash
npm ci
npm run release:check
npm run ai:runtime -- --arch arm64       # AI runtime for the installer (x64 for Windows Intel/AMD)
npm run ollama:runtime -- --arch arm64   # Levuvo's own Ollama (pinned release, checksum, signature)
npm run desktop:mac                      # or desktop:win:arm64 / desktop:win:x64
npm run release:manifest -- --arch arm64 # or x64
```

Unsigned installers trigger Gatekeeper or SmartScreen warnings and do not update themselves.
Use them for internal testing only.

## B) Signed release with automatic updates

### Obtain once

| For | What | Note |
|---|---|---|
| macOS | Apple Developer Program (USD 99/year), **Developer ID Application** certificate as `.p12` | notarization via app-specific password |
| Windows | code signing certificate (OV/EV) as `.pfx` **or** Azure Trusted Signing | without a signature SmartScreen warns |
| Updates | HTTPS folder, e.g. `https://levuvo.at/downloads/mail/` | static web space is sufficient |

### Environment variables (never in the repository!)

```bash
LEVUVO_UPDATE_URL=https://…/mail/
# macOS
CSC_LINK=/path/developer-id.p12   CSC_KEY_PASSWORD=…
APPLE_ID=…   APPLE_APP_SPECIFIC_PASSWORD=…   APPLE_TEAM_ID=…
# Windows (own certificate; CSC_LINK on Windows also works locally)
WIN_CSC_LINK=C:\path\codesign.pfx   WIN_CSC_KEY_PASSWORD=…
LEVUVO_WIN_PUBLISHER="Exact name from the certificate (CN)"
```

### Build

```bash
npm ci
npm run release:check
# Bundled AI runtime for the machine's architecture (needs Python 3.13 for uv):
python -m pip install --require-hashes -r apps/ai/requirements-build.txt
npm run ai:runtime -- --arch arm64  # or x64; the signed build refuses to run without it
npm run ollama:runtime -- --arch arm64  # or x64; also required by the signed build
npm run release:signed:mac          # on the Mac
npm run release:signed:win:x64      # on Windows x64
npm run release:signed:win:arm64    # on Windows ARM64
npm run release:manifest -- --signed
```

Then upload **all** files from `release/` (installers, `.zip`, `.blockmap`, `latest-mac.yml`, `latest-x64.yml`, `latest-arm64.yml`)
to the `LEVUVO_UPDATE_URL` folder. `release:signed:*` already checked architectures, Electron fuses and the
Windows publisher name of the update feed. Installed signed versions find the update within six hours
(or immediately via “Check for updates …”) and install it on restart after asking.

Signed macOS builds use `build/entitlements.mac.release.plist` (library validation active),
test builds use `build/entitlements.mac.plist`.

## C) Via GitHub Actions

- `ci.yml` runs on every push and pull request (quality, security, AI runtime with pip-audit, tests in the Node of
  Electron, unsigned desktop builds); `release.yml` creates drafts; `supply-chain.yml` scans weekly.
- `build-desktop.yml` is started manually. Without the “signed” checkbox it produces test installers; with it,
  signed releases. For that, create the values from section B as **repository secrets**
  in the environment `release-signing` (`CSC_LINK` = Base64 of the macOS .p12, `WIN_CSC_LINK` = Base64 of the
  Windows .pfx; each job receives only its own certificate). All actions are pinned to fixed commits.
- Artifacts remain private Actions artifacts (14 days).

## D) Fill in before the first public release

| What | Where | Note |
|---|---|---|
| Legal notice (Impressum) and controller | `apps/web/src/Settings.tsx` (About), `PRIVACY.md` | template: `docs/IMPRESSUM.md` |
| Microsoft/Google sign-in | `package.json` → `levuvo.oauth` | registration: `docs/OAUTH-SETUP.md` (Google: plan for verification/CASA) |
| Crash reports (optional) | `package.json` → `levuvo.crashReportUrl` (https) | e.g. own Crashpad/Sentry minidump endpoint; stays off until users consent |
| Update server | `LEVUVO_UPDATE_URL` | see section B |

Without these details the app works fully – the OAuth buttons then do not appear and
crash reports are technically disabled.

## Checksums

`npm run release:manifest` writes `SHA256SUMS.txt` and `release-manifest.json` from the real files;
`npm run release:verify` checks that all three installers are present and the checksums match.

## What does not belong in the package

No `.env`, no `accounts.json`, no certificates (`*.p12`, `*.pfx` – exception: worthless test certificates under `apps/server/test/fixtures/`, see the README there), no mails. `.gitignore`
and the `files` list in `package.json` exclude them.
