# Cyber Resilience Act – gap analysis

Regulation (EU) 2024/2847 on horizontal cybersecurity requirements for products with digital
elements ("CRA"). **Not legal advice** – see [README.md](README.md).

## 1. Scope and classification

| Question | Assessment | Reference |
| --- | --- | --- |
| Product with digital elements? | Yes: software with a remote data connection (IMAP, SMTP, CalDAV, Graph, cloud AI, updates) | Art. 2(1), Art. 3(1) |
| Made available on the market? | Not today (internal use). Yes as soon as it is supplied in the course of a commercial activity, free or paid | Art. 3(22), recital 15 |
| Role of Levuvo | Manufacturer (develops and markets under its own name) | Art. 3(13), Art. 13 |
| Category | **Default category** (assessment): an email client is not listed in Annex III (important) or Annex IV (critical). Points to confirm legally: the embedded Chromium of Electron renders only the app's own interface and is not a general-purpose "embedded browser" (Annex III class I no. 2); key management for PGP/S/MIME does not issue certificates (class I no. 10 "PKI and digital certificate issuance software"). Check against the Commission implementing act on the technical description of the categories (Art. 7(4)) | Art. 7, Annex III, Annex IV |
| Conformity assessment | Default category: internal control (module A, Annex VIII) by Levuvo itself, no notified body | Art. 32(1)(a) |
| Bundled open source (Electron, Ollama, CPython, npm/PyPI packages) | Levuvo is responsible for the whole product; due diligence for components | Art. 13(5) |
| Orkexa (own repository, bundled) | Part of the product, same obligations | Art. 13(5) |
| Dates | Reporting (Art. 14) from 11 Sep 2026, everything else from 11 Dec 2027; products placed on the market before 11 Dec 2027 fall under the CRA only after a substantial modification, but Art. 14 applies to them too | Art. 69, Art. 71 |

## 2. Essential cybersecurity requirements – Annex I Part I

| Requirement | Status | Evidence / measure |
| --- | --- | --- |
| (1) Appropriate level of cybersecurity based on risks | Done | Risk assessment [cra/RISK-ASSESSMENT.md](cra/RISK-ASSESSMENT.md), AI security concept [docs/ai/SECURITY-CONCEPT.md](../ai/SECURITY-CONCEPT.md), audits in the project files |
| (2)(a) No known exploitable vulnerabilities at release | Done | `npm audit` (blocking from high), pip-audit of all hashed Python locks, Ollama advisory check, CodeQL, Electron support window, CPython patch check; release gate requires green CI ([release.yml](../../.github/workflows/release.yml)) |
| (2)(b) Secure by default configuration, reset to original state | Done | AI off by default, cloud AI only with consent, MCP server off, external images blocked, crash reports off, link confirmation; reset: Settings → Privacy → "Delete all data on this device" |
| (2)(c) Security updates, automatic by default with opt-out, notification, postponing | Done for signed builds | `apps/desktop/updater.mjs`: automatic download and install on quit, "Later" postpones, Settings → Privacy → "Install updates automatically" (opt-out, then notification only). Unsigned internal builds have no update feed: Decision (certificates) |
| (2)(d) Protection from unauthorised access, report possible unauthorised access | Done | Local API only on 127.0.0.1 with per-start token and per-action headers, MCP tokens per agent (hash stored), OS keychain for secrets, Electron sandbox/contextIsolation, Fuses; login problems shown in account status |
| (2)(e) Confidentiality of stored and transmitted data (encryption) | Done | TLS ≥ 1.2 with certificate check (`app.mjs`, `send-service.mjs`, `sieve.mjs`), SQLCipher index, AES-256-GCM stores, keychain, E2E-encrypted spaces, OpenPGP/S/MIME |
| (2)(f) Integrity of data, commands, programs, configuration | Done | Asar integrity fuse, signed builds (once certificates exist), SHA-256 of release files, hashed Python locks, pinned Ollama checksum and model digests, AES-GCM authentication |
| (2)(g) Data minimisation | Done | No telemetry, search index stores only 3,000 characters, AI log without content, see [GDPR.md](GDPR.md) |
| (2)(h) Availability of essential functions, resilience against DoS | Done | Rate limits on local routes, timeouts (`http-timeout.mjs`), offline mode, sidecar restart, large-mailbox windowing |
| (2)(i) Minimise negative impact on other devices/networks | Done | Back-off and polling limits, IMAP IDLE, no open listening ports beyond loopback |
| (2)(j) Limit attack surfaces incl. external interfaces | Done | Loopback-only servers, MCP off by default, permission handler denies device permissions, navigation blocked, no `pull_request_target` in CI |
| (2)(k) Exploitation mitigation | Done | Sandboxed renderer, CSP, DOMPurify for HTML mail, prompt-injection framing for AI, Fuses (no `runAsNode`, no `NODE_OPTIONS`) |
| (2)(l) Security-relevant logging and monitoring, with opt-out | Partial | AI/agent log (30 days, no content), diagnostics report on request, account error counters. No general security event log yet; acceptable for a local client, document in the risk assessment |
| (2)(m) Users can securely and easily remove all data and settings, and transfer data | Done | Settings → Privacy → "Delete all data on this device" (app data folder and keychain entries); "Export my data" (readable JSON) and encrypted backup for moving to another device |

## 3. Vulnerability handling – Annex I Part II

| Requirement | Status | Evidence / measure |
| --- | --- | --- |
| (1) Identify and document components, **SBOM** in a machine-readable format | Done | `npm run sbom` writes a CycloneDX 1.6 SBOM of npm, Python, CPython, Electron and Ollama components; attached to every release as `levuvo-mail-<version>.cdx.json`; CI validates it |
| (2) Address and remediate vulnerabilities without delay, separate security updates where feasible | Done (process) | [cra/VULNERABILITY-HANDLING.md](cra/VULNERABILITY-HANDLING.md): severity-based deadlines, patch releases `x.y.Z` for security fixes only |
| (3) Regular tests and reviews of security | Done | CI on every change, weekly supply-chain scan, nightly integration tests, CodeQL, external audits (2026-11-13, 2026-11-19) |
| (4) Disclose fixed vulnerabilities (description, affected product, impact, severity, remediation) | Done (process) | GitHub Security Advisories, CHANGELOG "Security" section; see VULNERABILITY-HANDLING.md |
| (5) Coordinated vulnerability disclosure policy | Done | [SECURITY.md](../../SECURITY.md) |
| (6) Contact address for reporting vulnerabilities | Partial | GitHub Private Vulnerability Reporting; **Decision:** a dedicated `security@` address and a `security.txt` on levuvo.at (RFC 9116) |
| (7) Secure distribution of updates | Done for signed builds | HTTPS (GitHub Releases), electron-updater checks the code signature (Windows) / Squirrel signature (macOS), SHA-256 sums; **Decision:** certificates |
| (8) Security updates free of charge without delay, with advisory | Done (process) | SUPPORT-PERIOD.md and VULNERABILITY-HANDLING.md |

## 4. Manufacturer obligations

| Obligation | Status | Evidence / measure |
| --- | --- | --- |
| Art. 13(2)–(4) cybersecurity risk assessment, documented and updated | Done | [cra/RISK-ASSESSMENT.md](cra/RISK-ASSESSMENT.md), reviewed every release |
| Art. 13(5) due diligence for third-party components | Done | Pinned and hashed dependencies, audits, licence check, Dependabot, support window checks |
| Art. 13(6) report vulnerabilities found in components to their maintainers | Done (process) | VULNERABILITY-HANDLING.md § "Upstream" |
| Art. 13(8) support period of at least five years unless shorter use is expected; published | Decision | Proposal in [cra/SUPPORT-PERIOD.md](cra/SUPPORT-PERIOD.md): 5 years per major version; **Peter** decides |
| Art. 13(9) security updates available for at least 10 years or the support period | Done (process) | Old releases stay on GitHub Releases |
| Art. 13(12) technical documentation (Annex VII) | Done | [cra/TECHNICAL-DOCUMENTATION.md](cra/TECHNICAL-DOCUMENTATION.md) |
| Art. 13(12), Art. 28 EU declaration of conformity (Annex V) | Template | [cra/EU-DECLARATION-OF-CONFORMITY.md](cra/EU-DECLARATION-OF-CONFORMITY.md); signing: **Peter** |
| Art. 30 CE marking | Decision | [cra/CONFORMITY-ASSESSMENT.md](cra/CONFORMITY-ASSESSMENT.md): in the About dialog and on the website; only after the conformity decision |
| Art. 13(13) keep documentation 10 years | Done (process) | Git history plus release assets; [cra/TECHNICAL-DOCUMENTATION.md](cra/TECHNICAL-DOCUMENTATION.md) |
| Art. 13(15) unique product identification | Done | Product name, version and commit in About, release manifest |
| Art. 13(16) manufacturer name, address, contact | Decision | Imprint placeholders ([docs/IMPRESSUM.md](../IMPRESSUM.md)) |
| Art. 13(17) single point of contact for vulnerabilities | Partial | SECURITY.md; see Annex I Part II (6) |
| Art. 13(18), Annex II user information and instructions | Done | [USER-INFORMATION.md](USER-INFORMATION.md), shipped in the app (About → Security and support) and the release kit |
| Art. 13(19) end of support date communicated at purchase and in the product | Done | About → Security and support shows the end of support of the installed version |
| Art. 14(1)–(2) report actively exploited vulnerabilities: early warning 24 h, notification 72 h, final report 14 days after a fix | Done (process) | [cra/INCIDENT-REPORTING.md](cra/INCIDENT-REPORTING.md) |
| Art. 14(3)–(4) severe incidents: 24 h, 72 h, final report within one month | Done (process) | [cra/INCIDENT-REPORTING.md](cra/INCIDENT-REPORTING.md) |
| Art. 14(8) inform affected users | Done (process) | Advisory + in-app update dialog + release notes |
| Art. 13(7) reporting obligations from 11 Sep 2026 also for products already on the market | n/a today | Applies only once Levuvo Mail is made available on the market |

## 5. What remains open

See [OPEN-ITEMS.md](OPEN-ITEMS.md): code signing certificates (macOS Developer ID, Windows), the
support period decision, the legal confirmation of the default category, the security contact
address, the manufacturer details, signing the declaration of conformity and affixing the CE marking.
