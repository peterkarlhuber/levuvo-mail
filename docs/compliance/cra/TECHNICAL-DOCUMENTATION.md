# Technical documentation (index)

CRA Art. 31, Annex VII. This file is the index of the technical documentation; the documents
themselves live in the repository and in the release assets. Keep it for **10 years** after the
product is placed on the market or for the support period, whichever is longer (Art. 13(13)).

| Annex VII item | Where |
| --- | --- |
| 1(a) Intended purpose | [RISK-ASSESSMENT.md](RISK-ASSESSMENT.md) § 1, [README.md](../../../README.md) |
| 1(b) Versions of software affecting compliance | `package.json` version, release manifest (`release-manifest.json` per release), SBOM |
| 1(c) Photos/illustrations of external features | n/a (software); screenshots in the manual [docs/manual](../../manual) |
| 1(d) User information and instructions (Annex II) | [../USER-INFORMATION.md](../USER-INFORMATION.md), manual (DE/EN), in-app About → Security and support |
| 2(a) Design, development, production and vulnerability handling: system architecture, how software components interact | [docs/ai/SECURITY-CONCEPT.md](../../ai/SECURITY-CONCEPT.md) (trust boundaries), [docs/SPACES.md](../../SPACES.md), [docs/PERFORMANCE.md](../../PERFORMANCE.md), source code |
| 2(b) Vulnerability handling: SBOM, CVD policy, contact, secure distribution of updates | SBOM `levuvo-mail-<version>.cdx.json` in each release, [SECURITY.md](../../../SECURITY.md), [VULNERABILITY-HANDLING.md](VULNERABILITY-HANDLING.md), [SECURITY-UPDATES.md](SECURITY-UPDATES.md) |
| 2(c) Production and monitoring processes and their validation | [docs/CI-CD.md](../../CI-CD.md), [RELEASING.md](../../../RELEASING.md), workflows in `.github/workflows/`, [VALIDATION-REPORT.md](../../../VALIDATION-REPORT.md) |
| 3 Cybersecurity risk assessment | [RISK-ASSESSMENT.md](RISK-ASSESSMENT.md) |
| 4 Information used to determine the support period | [SUPPORT-PERIOD.md](SUPPORT-PERIOD.md) |
| 5 Harmonised standards / common specifications / certification applied | None yet (harmonised standards under the CRA are being drafted by CEN/CENELEC/ETSI). Orientation: ETSI EN 303 645 principles, OWASP ASVS 5.0 for the local API, NIST SSDF (SP 800-218). Reassess when standards are cited in the Official Journal |
| 6 Test reports | CI runs of the release commit (linked in the release notes), audit reports in the project files (`audit-2026-11-13`, `audit-2026-11-19-claude`, `chatgpt-audit`) – copy the final ones into the release kit |
| 7 Copy of the EU declaration of conformity | [EU-DECLARATION-OF-CONFORMITY.md](EU-DECLARATION-OF-CONFORMITY.md) (signed PDF per version, stored with the release) |
| 8 SBOM (on request of market surveillance) | release asset, also reproducible with `npm run sbom` |

## Per-release record

For every release, keep together (GitHub release assets + this repository at the tag):
release manifest, SHA256SUMS, SBOM, licence report, release notes, CI run URL, signed declaration of
conformity (once applicable), the completed release checklist.
