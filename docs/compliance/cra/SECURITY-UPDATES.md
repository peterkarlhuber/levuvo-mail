# Security update mechanism

CRA Annex I Part I (2)(c), Part II (7)–(8). **Not legal advice.**

## Current state

| Element | Implementation |
| --- | --- |
| Update channel | GitHub Releases over HTTPS, `electron-updater` (`apps/desktop/updater.mjs`) |
| Automatic by default | Yes for signed builds: checks 45 s after start and every 6 h, downloads automatically, installs on quit or on "Restart now" |
| Opt-out | Settings → Privacy → "Install updates automatically". When off, Levuvo Mail still checks and shows a notification with "Download" instead of installing silently |
| Postpone | "Later" in the update dialog postpones until the next quit; the menu entry "Check for updates" exists in both modes |
| Integrity and authenticity | Windows: electron-updater verifies the Authenticode publisher of the new installer against the installed one; macOS: Squirrel.Mac requires the same Developer ID signature; plus SHA-512 in `latest*.yml` |
| Downgrades / pre-releases | Disabled (`allowDowngrade = false`, `allowPrerelease = false`) |
| Unsigned internal test builds | No update feed (`app-update.yml` missing), never update themselves; users install manually |
| Security-only releases | Patch versions `x.y.Z`, see [VULNERABILITY-HANDLING.md](VULNERABILITY-HANDLING.md) |

## Gaps and plan

1. **Code signing certificates** (Decision, Peter): Apple Developer ID Application + notarization;
   Windows code signing (EV or Azure Trusted Signing). Without them there is no secure automatic update.
   `scripts/release-signed.mjs` and the `release-signing` environment are prepared.
2. **Signing key protection:** keep certificates only in the protected GitHub environment or a cloud
   HSM (Azure Trusted Signing), never on developer machines; document who has access.
3. **Staged rollout:** optional `stagingPercentage` in `latest*.yml` for large updates.
4. **Compromise plan:** if a signing key leaks → revoke, re-sign, report as a severe incident
   ([INCIDENT-REPORTING.md](INCIDENT-REPORTING.md)).
5. **Update server privacy:** GitHub sees IP address, OS and version (see PRIVACY.md); if Levuvo runs
   its own update server, add it to the record of processing.
