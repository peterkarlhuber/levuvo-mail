# Support period

CRA Art. 13(8), 13(19), Annex II no. 7. **Proposal – Peter decides** (see [../OPEN-ITEMS.md](../OPEN-ITEMS.md)).

## Proposal

| Item | Proposal |
| --- | --- |
| Support period per major version | **5 years** from the first release of that major version (Art. 13(8): at least five years unless the product is expected to be in use for less time) |
| What support means | Security updates free of charge, for the latest minor/patch line of the major version |
| Feature updates | Only in the latest minor version |
| End of support | Shown in the app (Settings → About → Security and support), on the release page and in [USER-INFORMATION.md](../USER-INFORMATION.md) |
| Availability of old security updates | Every release stays downloadable on GitHub Releases for at least 10 years or the support period, whichever is longer (Art. 13(9)) |

## Current values

| Major version | First release | End of support |
| --- | --- | --- |
| 2.x | 2026-11 (2.0) | 2031-11-30 |

The value is stored in `package.json` → `levuvo.supportUntil` and read by the app. Change both
together; `scripts/check-compliance.mjs` (part of `npm run release:check`) fails when the date is
missing, in the past, or less than five years after the major version's first release without a
documented reason here.

## Third-party support windows

The support period of Levuvo Mail is only realistic if the bundled components can be kept on
supported versions: Electron (support window checked by `check:electron-support`), CPython (3.13
security support until 2029-10, then move to a newer CPython), Ollama (pinned release, advisory check).
Moving to a newer major version of a component during the support period is part of security
maintenance.
