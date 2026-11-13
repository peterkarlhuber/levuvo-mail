# Release process

Releases are created **exclusively in GitHub Actions** from a verified commit on `master` – no manual ZIP files.

## Procedure

1. Feature branch → pull request → CI (`CI` workflow) must be green → merge into `master`.
2. Release PR: bump `version` in `package.json` and `package-lock.json` (`npm version X.Y.Z --no-git-tag-version`), add `## X.Y.Z` to `CHANGELOG.md`, merge.
3. Start the release – one of two variants:
   - **Tag:** `git tag vX.Y.Z <commit-on-master> && git push origin vX.Y.Z` (the tag must match `package.json` exactly).
   - **Manual:** Actions → _Release_ → _Run workflow_ (branch `master`; option `signed` only with certificates).
4. The workflow checks version/tag, runs `release:check`, builds macOS ARM64, Windows ARM64 and Windows x64 in parallel, verifies the binary architecture (PE/Mach-O), briefly starts the unpacked app, computes checksums and creates a **draft release**.
5. Review the draft, work through `RELEASE-CHECKLIST.md` on target devices, and only then publish manually.

Existing tags and releases are never overwritten: if `vX.Y.Z` already exists, the workflow aborts.

## Artifacts

| File | Platform |
|---|---|
| `Levuvo-Mail-<v>-arm64.dmg` | macOS Apple Silicon |
| `Levuvo-Mail-Setup-<v>-arm64.exe` | Windows ARM64 |
| `Levuvo-Mail-Setup-<v>-x64.exe` | Windows x64 |
| `SHA256SUMS.txt`, `release-manifest.json`, `RELEASE_NOTES.md` | all |

The file names follow electron-builder (`-arm64`/`-x64`); the update metadata (`latest*.yml`) depends on them, so they are not renamed. Each Windows architecture has its own update channel (`latest-arm64.yml`, `latest-x64.yml`), macOS uses `latest-mac.yml`; the assembly step fails if two build jobs produce different files with the same name.

## Signing

Without certificates, **unsigned internal test builds** are produced (draft marked as _pre-release_, auto-update off). Signed releases need the following secrets in the GitHub environment `release-signing` (reviewer approval recommended):

| Secret | Purpose |
|---|---|
| `LEVUVO_UPDATE_URL` | https update feed (e.g. `https://levuvo.at/downloads/mail/`) |
| `CSC_LINK`, `CSC_KEY_PASSWORD` | certificate (.p12 for macOS Developer ID, .pfx for Windows; base64 or path) |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | notarization |
| `LEVUVO_WIN_PUBLISHER` | exact certificate CN |

Signed builds verify the signature (`Get-AuthenticodeSignature`, `codesign`, `spctl`, `stapler`) and fail on errors. Since macOS and Windows certificates are separate files, a separate secret per platform may be needed (`WIN_CSC_LINK`) – see `scripts/release-signed.mjs`.

## Updates

`electron-updater` only becomes active if the build contains an update feed (`app-update.yml`) – i.e. only for signed builds. Unsigned builds never update themselves. To roll out, upload all files of the signed release (incl. `latest*.yml`, `.blockmap`, `.zip`) to `LEVUVO_UPDATE_URL`; GitHub drafts do not serve as an update feed.

## Build vs. acceptance

A successful workflow proves: tests, build, architecture, checksums, app startup. **It does not replace acceptance testing** (keychain in daily use, notifications, tray, autostart, real mailboxes) – see `RELEASE-CHECKLIST.md`.
