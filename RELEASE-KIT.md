# Levuvo Mail 2.2.0 – release kit

The ZIP contains the complete source code, the locked dependency list (`package-lock.json`)
and the build configuration for three platforms. **Finished DMG/EXE files are not included**:
they must be built on the respective operating system (native keychain module).

| Platform | File | Build machine |
|---|---|---|
| macOS Apple Silicon | `Levuvo-Mail-2.2.0-arm64.dmg` (+ `.zip` for updates) | Mac with Apple Silicon |
| Windows 11 ARM64 | `Levuvo-Mail-Setup-2.2.0-arm64.exe` | Windows ARM64 (e.g. UTM) |
| Windows x64 | `Levuvo-Mail-Setup-2.2.0-x64.exe` | Windows Intel/AMD |

## A) Test installers (unsigned, without auto-update)

```bash
npm ci
npm run release:check
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
# Windows
CSC_LINK=C:\path\codesign.pfx   CSC_KEY_PASSWORD=…
LEVUVO_WIN_PUBLISHER="Exact name from the certificate (CN)"
```

### Build

```bash
npm ci
npm run release:check
npm run release:signed:mac          # on the Mac
npm run release:signed:win:x64      # on Windows x64
npm run release:signed:win:arm64    # on Windows ARM64
npm run release:manifest -- --signed
```

Then upload **all** files from `release/` (installers, `.zip`, `.blockmap`, `latest.yml`, `latest-mac.yml`)
to the `LEVUVO_UPDATE_URL` folder. Installed signed versions find the update within six hours
(or immediately via “Check for updates …”) and install it on restart after asking.

Signed macOS builds use `build/entitlements.mac.release.plist` (library validation active),
test builds use `build/entitlements.mac.plist`.

## C) Via GitHub Actions

- `ci.yml` runs on every push: `npm ci` + `npm run release:check`.
- `build-desktop.yml` is started manually. Without the “signed” checkbox it produces test installers; with it,
  signed releases. For that, create the values from section B as **repository secrets**
  (`CSC_LINK` as Base64 of the certificate). All actions are pinned to fixed commits.
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
