# Regulatory compliance – Levuvo Mail

> **Not legal advice.** These documents were prepared by the development team as an engineering
> gap analysis and as templates. They do not replace a review by a lawyer, a data protection
> officer or, where required, a notified body. Every statement about what a law requires must be
> confirmed by legal review before Levuvo Mail is placed on the market. See [OPEN-ITEMS.md](OPEN-ITEMS.md).

## Starting point

Levuvo Mail is a desktop email, calendar, contacts and tasks client for macOS and Windows with an
optional AI assistant (bundled Orkexa sidecar, bundled Ollama, optional cloud models from
Anthropic or OpenAI) and an optional MCP server for external AI agents. It has no server of its own
and no telemetry.

Today it is **used internally only**. From 2026-11-19 the target is: Levuvo Mail behaves **as if it
were placed on the EU market** as a commercial product. These documents therefore assess both roles:

| Role | Today (internal use) | When sold or otherwise made available on the market |
| --- | --- | --- |
| Cyber Resilience Act | not "made available on the market", obligations do not apply yet | **manufacturer** of a product with digital elements |
| AI Act | **deployer** of an AI system (Art. 3(4)), and provider for own use | **provider** of an AI system built on general-purpose AI models (Art. 3(3), Art. 3(68) downstream provider) |
| GDPR | the organisation using the app is **controller**; Levuvo receives no personal data | still no access to user data; Levuvo becomes controller only for update logs, crash reports and support requests |

## Documents

| Topic | File |
| --- | --- |
| Overview and applicability of every relevant law | this file, section below |
| Cyber Resilience Act (Regulation (EU) 2024/2847) | [CRA.md](CRA.md) and [cra/](cra/) |
| EU AI Act (Regulation (EU) 2024/1689) | [AI-ACT.md](AI-ACT.md) and [ai-act/](ai-act/) |
| GDPR (Regulation (EU) 2016/679), Austrian DSG | [GDPR.md](GDPR.md) and [gdpr/](gdpr/) |
| Accessibility (EAA, EN 301 549, WCAG 2.2) | [ACCESSIBILITY.md](ACCESSIBILITY.md) |
| ePrivacy, NIS2, product liability, consumer law, export control, Austrian law | [OTHER-REGULATIONS.md](OTHER-REGULATIONS.md) |
| Open-source licences of all bundled components and models | [LICENSING.md](LICENSING.md) |
| Information for users (CRA Annex II, AI Act Art. 50, GDPR Art. 13) | [USER-INFORMATION.md](USER-INFORMATION.md) |
| What only Peter, a lawyer or a notified body can do | [OPEN-ITEMS.md](OPEN-ITEMS.md) |

Existing documents that are part of the compliance file and are referenced, not duplicated:
[PRIVACY.md](../../PRIVACY.md), [SECURITY.md](../../SECURITY.md), [docs/ai/](../ai/) (usage policy,
AI literacy guide, security concept, AI processing record, models), [docs/IMPRESSUM.md](../IMPRESSUM.md),
[RELEASING.md](../../RELEASING.md), [docs/CI-CD.md](../CI-CD.md).

## Applicability at a glance

| Law | Applies? | Why | Key dates |
| --- | --- | --- | --- |
| **Cyber Resilience Act** | Yes, once made available on the market | Software product with digital elements and a data connection (Art. 2(1), Art. 3(1)) | Reporting obligations (Art. 14) from **11 Sep 2026**; all other obligations from **11 Dec 2027** (Art. 71(2)) |
| **AI Act** | Yes | AI system (Art. 3(1)) built on GPAI models; not high-risk in its intended purpose; transparency obligations | Art. 4 and 5 since 2 Feb 2025; Art. 50 since 2 Aug 2026 (check the Commission's "Digital Omnibus" proposal for any change of dates) |
| **GDPR** | Yes, for every organisation using the app; for Levuvo for update/crash/support data | Processes personal data of users and third parties | in force |
| **ePrivacy Directive / Austrian TKG 2021** | Partly | Art. 5(3): no storing/reading on the terminal without consent except strictly necessary; Levuvo has no tracking | in force |
| **European Accessibility Act** | Most likely no (a mail client is not a listed product or service), but required in public procurement | Directive (EU) 2019/882 Art. 2; EN 301 549 in procurement (Directive 2014/24/EU Art. 42) | 28 Jun 2025 |
| **NIS2** | Not for Levuvo as a vendor (check size and sector); customers that are NIS2 entities will ask for supply-chain evidence | Directive (EU) 2022/2555 Art. 21(2)(d) | national law (Austria: NISG, check status) |
| **Product Liability Directive** | Yes, when sold | Software is a product (Directive (EU) 2024/2853 Art. 4(1)) | transposition until 9 Dec 2026 |
| **Digital content directive** | Only for sales to consumers | Update obligation (Directive (EU) 2019/770 Art. 8; Austria: VGG) | in force |
| **Dual-use export control** | Low risk | Encryption: mass-market note (Regulation (EU) 2021/821 Annex I, Cat. 5 Part 2, Note 3) | in force |
| **Open-source licences** | Yes | Electron, npm packages, CPython, Python packages, Ollama, models | always |
| **Austrian law** (ECG, MedienG, UGB, ArbVG §§ 96/96a, BAO) | Yes | Imprint, works council for AI and logging in companies, retention | in force |

## How compliance is kept up to date

- **Every release:** the release checklist ([RELEASE-CHECKLIST.md](../../RELEASE-CHECKLIST.md),
  section "Compliance") requires reviewing these documents, the SBOM and licence report attached to
  the release, the support period and the open items.
- **CI:** SBOM (CycloneDX), licence policy check, npm audit, pip-audit, CodeQL, secret scan and the
  weekly supply-chain scan (see [docs/CI-CD.md](../CI-CD.md)).
- **Change rule:** a new feature that processes personal data, uses AI, opens a network connection
  or adds a bundled component updates the matching document in the same pull request
  (see [CONTRIBUTING.md](../../CONTRIBUTING.md)).

Status legend used in the gap analyses: **Done** (implemented, evidence linked), **Partial**
(implemented with known gaps), **Open** (engineering work still to do), **Decision** (needs Peter, a
lawyer or a notified body; listed in [OPEN-ITEMS.md](OPEN-ITEMS.md)), **n/a** (not applicable, with reason).

Last reviewed: 2026-11-19 (version 2.5.0).
