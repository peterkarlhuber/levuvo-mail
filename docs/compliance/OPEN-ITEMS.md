# Open items for Peter, a lawyer or a notified body

Everything that engineering cannot decide or do. Reviewed every release. **Not legal advice** – the
legal assessments in this folder must be confirmed by a lawyer before Levuvo Mail is placed on the market.

## Peter (manufacturer decisions)

| # | Item | Why | Where it is prepared |
| --- | --- | --- | --- |
| P1 | **Code signing certificates**: Apple Developer ID Application (+ notarization) and Windows code signing (EV or Azure Trusted Signing) | Secure automatic updates (CRA Annex I Part I (2)(c), Part II (7)); no SmartScreen/Gatekeeper warnings | [RELEASING.md](../../RELEASING.md), `scripts/release-signed.mjs`, environment `release-signing` |
| P2 | **Support period** (proposal: 5 years per major version, 2.x until 2031-11-30) | CRA Art. 13(8) | [cra/SUPPORT-PERIOD.md](cra/SUPPORT-PERIOD.md), `package.json` → `levuvo.supportUntil` |
| P3 | **Manufacturer details** (company, address, register number, VAT ID) in the imprint, privacy notice and app | CRA Art. 13(16), ECG § 5, GDPR Art. 13 | [docs/IMPRESSUM.md](../IMPRESSUM.md), PRIVACY.md, About |
| P4 | **Security contact**: a monitored `security@` address and `https://levuvo.at/.well-known/security.txt` (RFC 9116) | CRA Annex I Part II (6), Art. 13(17) | [SECURITY.md](../../SECURITY.md) |
| P5 | Name a **security owner and deputy** who can report to the CSIRT within 24 h | CRA Art. 14 | [cra/VULNERABILITY-HANDLING.md](cra/VULNERABILITY-HANDLING.md) § 7 |
| P6 | Register for the **ENISA single reporting platform** once available | CRA Art. 14, 16 | [cra/INCIDENT-REPORTING.md](cra/INCIDENT-REPORTING.md) |
| P7 | **Sign the EU declaration of conformity** and decide on CE marking (only when selling, from 11 Dec 2027 at the latest) | CRA Art. 28, 30 | [cra/EU-DECLARATION-OF-CONFORMITY.md](cra/EU-DECLARATION-OF-CONFORMITY.md) |
| P8 | Crash report service: choose one (or keep crash reports unavailable) and sign its DPA | GDPR Art. 28 | PRIVACY.md "Crash reports" |
| P9 | Product liability insurance and terms of sale/EULA | PLD (EU) 2024/2853; consumer law | [OTHER-REGULATIONS.md](OTHER-REGULATIONS.md) |
| P10 | DPAs with Anthropic and OpenAI for the own organisation (if cloud AI is used internally) | GDPR Art. 28 | [gdpr/PROCESSOR-CHECKLIST.md](gdpr/PROCESSOR-CHECKLIST.md) |

## Lawyer

| # | Item | Where it is prepared |
| --- | --- | --- |
| L1 | **DOC-LEV-009**: legal basis for third-party data sent to cloud AI (options A–D) | [gdpr/THIRD-PARTY-DATA-CLOUD-AI.md](gdpr/THIRD-PARTY-DATA-CLOUD-AI.md) |
| L2 | Confirm the CRA **default category** (not Annex III: embedded browser, PKI software) | [CRA.md](CRA.md) § 1 |
| L3 | Confirm AI Act classification: not high-risk, Art. 50(2) marking via mail header sufficient, Art. 50(4) not applicable to correspondence | [AI-ACT.md](AI-ACT.md), [ai-act/AI-SYSTEM-INVENTORY.md](ai-act/AI-SYSTEM-INVENTORY.md) |
| L4 | Review the privacy notice, the record of processing templates and the DPIA template | PRIVACY.md, [gdpr/](gdpr/) |
| L5 | EAA applicability (most likely not covered) | [ACCESSIBILITY.md](ACCESSIBILITY.md) |
| L6 | Works council / ArbVG §§ 96, 96a template for customers | [docs/ai/USAGE-POLICY.md](../ai/USAGE-POLICY.md) |
| L7 | Export control classification (mass-market encryption) before selling outside the EU | [OTHER-REGULATIONS.md](OTHER-REGULATIONS.md) |
| L8 | Licence review for any component outside the allow-list | [LICENSING.md](LICENSING.md), `scripts/license-policy.json` |

## Notified body

Not needed if the default category is confirmed (internal control, module A). Needed only if Levuvo
Mail is classified as an important product (Annex III) and harmonised standards are not applied in
full, or as a critical product (Annex IV). See [cra/CONFORMITY-ASSESSMENT.md](cra/CONFORMITY-ASSESSMENT.md).

## Optional, recommended before selling

- External penetration test of the release build.
- EN 301 549 accessibility audit and conformance report.
- Annual exercise of the 24 h/72 h reporting process.
