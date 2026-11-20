# Record of processing activities (Art. 30 GDPR) – Levuvo Mail, whole application

Template for the organisation that uses Levuvo Mail (controller). The AI assistant has its own
entry: [docs/ai/PROCESSING-RECORD.md](../../ai/PROCESSING-RECORD.md). A second part lists what
**Levuvo as vendor** processes. Fill in the brackets and review with the data protection officer.
**Not legal advice.**

## Part 1 – organisation using Levuvo Mail

| Field | Entry |
| --- | --- |
| Name of the processing | Email, calendar, contacts, tasks and shared spaces with Levuvo Mail |
| Controller | [Organisation, address, contact] |
| Data protection officer | [Name, contact / not designated] |
| Purposes | Business communication; scheduling (incl. finding a time with others, polls and booking links by e-mail); automations on incoming mail; contact management including a contact history (notes about a person, tasks linked to them); video call links (Jitsi); task management; collaboration in shared spaces; encryption of messages; local search |
| Legal basis | Art. 6(1)(b) (contracts with communication partners), Art. 6(1)(c) (retention duties, e.g. § 132 BAO, § 212 UGB), Art. 6(1)(f) (efficient communication); employees: [§ 96/96a ArbVG / employment contract] |
| Data subjects | Users (employees); senders, recipients and persons named in mails; contacts; meeting attendees and people asked for a time (incl. free/busy of colleagues); people writing to a booking link; members of shared spaces |
| Data categories | Names, addresses, mail content and metadata, attachments, events, contact data, tasks, public keys/certificates; possibly special categories in content |
| Recipients | The organisation's mail/calendar providers [names] as processors; the Jitsi server operator for calls that users open (default meet.ffmuc.net, Freifunk München e.V., Germany, or the organisation's own server [name]); communication partners; members of shared spaces; with optional features see AI record |
| Third-country transfers | Depends on the mail provider [e.g. Microsoft 365 EU Data Boundary / Google Workspace]; Levuvo Mail itself transfers nothing to Levuvo |
| Retention | Mail on the server according to the organisation's retention policy; local copies: search index until deleted or the account is removed; snooze/follow-up until done; tasks until deleted; contact notes until deleted (or until the last contact with the address is deleted); polls 30 days after their last proposed time; automation log 30 days; spaces until left/deleted; space transport mails 30 days; restore safety copies 30 days |
| Technical and organisational measures | Encryption at rest (SQLCipher, AES-256-GCM, OS keychain), TLS ≥ 1.2, no telemetry, sandboxed rendering of mail, phishing warnings, external images blocked, encrypted backups, E2E encryption options; see [docs/compliance/CRA.md](../CRA.md) § 2. Organisation: full-disk encryption, screen lock, OS updates, [policy] |
| DPIA | [not required / see DPIA] – see [DPIA-TEMPLATE.md](DPIA-TEMPLATE.md) |

## Part 2 – Levuvo as vendor

| Processing | Data | Purpose and legal basis | Recipient | Retention |
| --- | --- | --- | --- | --- |
| Update checks (signed builds only) | IP address, OS, app version | providing security updates, Art. 6(1)(f) (and legal duty under the CRA, Art. 6(1)(c)) | GitHub, Inc. (USA, DPF) | GitHub logs per its terms |
| Crash reports (opt-in) | minidump (may contain mail fragments), version, OS | fixing crashes, Art. 6(1)(a) | [service] | [90 days] |
| Vulnerability reports and support | name, contact, report content, diagnostics report (no content) | handling reports, Art. 6(1)(f), CRA Art. 13(17) | GitHub (advisories), [mail provider] | 10 years for vulnerability records (CRA Art. 13(13)), support [2 years] |
| Website levuvo.at | [hosting logs] | [ ] | [ ] | [ ] |
