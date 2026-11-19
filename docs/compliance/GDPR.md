# GDPR – gap analysis

Regulation (EU) 2016/679 (GDPR) and the Austrian Data Protection Act (DSG). **Not legal advice** –
see [README.md](README.md).

## 1. Roles

| Processing | Controller | Processor / recipient |
| --- | --- | --- |
| Mail, calendar, contacts, tasks, spaces, AI on the device | the **organisation or person using** Levuvo Mail | none (local); mail/calendar providers are the user's own processors |
| Cloud AI (optional) | the organisation using Levuvo Mail | Anthropic or OpenAI as **processor** (Art. 28) – DPA needed |
| External agents via MCP | the organisation using Levuvo Mail | the agent's provider |
| Update checks (signed builds) | Levuvo | GitHub (Microsoft) as processor/hosting |
| Crash reports (opt-in) | Levuvo | [crash report service] |
| Support requests, diagnostics report sent by the user | Levuvo | [mail provider] |

Levuvo has **no access** to user content. Most obligations therefore fall on the organisation using
the app; Levuvo's job is **privacy by design and by default** (Art. 25) and good templates.

## 2. Requirements and status

| Requirement | Status | Evidence / measure |
| --- | --- | --- |
| Art. 5(1)(a) lawfulness, fairness, transparency | Done | [PRIVACY.md](../../PRIVACY.md), in-app privacy tab, consent dialog for cloud AI |
| Art. 5(1)(b)–(c) purpose limitation, data minimisation | Done | No telemetry; index limited to 3,000 characters; AI log without content; style samples max 5 × 1,500 characters |
| Art. 5(1)(e) storage limitation | Done | AI log 30 days, approvals 7 days, space mails 30 days, restore safety copies 30 days |
| Art. 5(1)(f), Art. 32 security | Done | Encryption at rest and in transit, keychain, see [CRA.md](CRA.md) |
| Art. 6 legal basis | Partial / **Decision** | Local processing: Art. 6(1)(f) of the organisation. Cloud AI: consent of the user for their own data; **third-party data (DOC-LEV-009)**: options in [gdpr/THIRD-PARTY-DATA-CLOUD-AI.md](gdpr/THIRD-PARTY-DATA-CLOUD-AI.md) – Peter/lawyer decides |
| Art. 7 conditions for consent (proof, withdrawal) | Done | Consent stored with date and text version; "Withdraw consent" |
| Art. 9 special categories | Done (organisational) | Per-account "No cloud AI" block; DPIA template asks for it |
| Art. 12–14 information | Done (template) | PRIVACY.md (controller placeholders: **Decision**), USER-INFORMATION.md |
| Art. 15 access | Done | Settings → Privacy → "Export my data" (all local-only data in readable JSON); for third parties: search, contact card, export |
| Art. 16 rectification | Done | All local data editable |
| Art. 17 erasure | Done | Per-feature deletion, "Delete all AI data", Settings → Privacy → "Delete all data on this device"; server-side data via the provider |
| Art. 18 restriction | Done (manual) | Accounts can be paused / marked "No cloud AI" |
| Art. 20 portability | Done | "Export my data" (JSON), vCard/ICS export, .eml export, encrypted backup |
| Art. 21 objection | n/a | No profiling or direct marketing by Levuvo |
| Art. 22 automated decisions | n/a | None; all AI results are suggestions |
| Art. 25 privacy by design and default | Done | AI, MCP, crash reports, external images off by default; local model default; cloud block per account |
| Art. 28 processor terms | Template | [gdpr/PROCESSOR-CHECKLIST.md](gdpr/PROCESSOR-CHECKLIST.md) for Anthropic/OpenAI and agent providers |
| Art. 30 record of processing | Done (templates) | [gdpr/RECORD-OF-PROCESSING.md](gdpr/RECORD-OF-PROCESSING.md) (whole app) and [docs/ai/PROCESSING-RECORD.md](../ai/PROCESSING-RECORD.md) (assistant) |
| Art. 33/34 breach notification | Done (process) | [gdpr/BREACH-RESPONSE.md](gdpr/BREACH-RESPONSE.md) |
| Art. 35 DPIA | Template | [gdpr/DPIA-TEMPLATE.md](gdpr/DPIA-TEMPLATE.md); likely needed for cloud AI with professional-secrecy or special-category mail, and for agents acting for many users |
| Art. 44–49 third-country transfers | Template | PROCESSOR-CHECKLIST: EU–US Data Privacy Framework certification or SCCs; transfer impact assessment |
| Art. 37–39 DPO | n/a for Levuvo (small, no core monitoring); check for customers |
| § 96/96a ArbVG (Austria), employee data | Done (template) | [docs/ai/USAGE-POLICY.md](../ai/USAGE-POLICY.md); AI log not used for performance control |

## 3. Data map (where personal data lives)

See the table in [PRIVACY.md](../../PRIVACY.md) § "Which data is processed where". Rule for
developers: every new local file is listed there, in `BACKUP_FILES` or `NOT_BACKED_UP`
(`apps/server/src/backup.mjs`), in the data export and in "Delete all data on this device".
The tests in `apps/server/test/data-rights.test.mjs` fail when a file in the data folder is not covered.

## 4. Guardrails against unlawful use

Levuvo Mail helps users stay within the rules **at the moment they act**, and leaves the decision to
them. Design rules, because a tool that watches its users would itself breach the GDPR and, in Austria,
§ 96/96a ArbVG:

- Warnings only, shown right before the action; the user can always continue.
- Nothing is logged, counted, scored or reported – not on the device, not to the organisation, not to
  Levuvo. The AI log records only that the AI pre-send check ran, never its findings.
- Local rules first (no AI, no data leaves the device); the optional AI check adds hints marked as AI.
- Conservative patterns: a warning that fires on every invoice teaches people to click it away. An
  IBAN alone does not warn (it is in most business signatures).

| Situation | Check | Legal basis of the hint |
| --- | --- | --- |
| 10+ external recipients from 3+ organisations openly in To/Cc | local, `apps/web/src/compliance-checks.ts` | Art. 5(1)(f), 32 (disclosure of addresses) |
| Card number (Luhn), Austrian social security number (with label and check digit), password/PIN/TAN after a label, sent unencrypted to an external recipient | local | Art. 5(1)(f), 32 |
| Health data terms (diagnosis, medical report, sick note …) sent unencrypted externally | local | Art. 9, 32 |
| Discriminatory wording (age, gender, origin, religion, disability, pregnancy), sharing other people's sensitive data, threats | AI pre-send check (`legal` kind), optional | Art. 9; GlBG / AGG; StGB |
| Request to rank applicants, profile people, collect data behind someone's back | assistant declines with reason and lawful alternative (`BASE_RULES`) | Art. 5, 22; AI Act Annex III no. 4 |
| Switching off automatic updates or the AI marking | confirmation with explanation | CRA Annex I Part I (2)(c); AI Act Art. 50(2) |

Encrypted sending (PGP, S/MIME, password-protected message) and internal mail (same domain as the
sender) do not trigger the data warnings.
