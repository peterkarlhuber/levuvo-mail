# Record of processing activities (Art. 30 GDPR): Levuvo Mail Assistant

Template entry for the controller's record of processing activities. Fill in the bracketed parts and
review it with the data protection officer. This document is not legal advice.

| Field | Entry |
| --- | --- |
| Name of the processing | AI-assisted email work in Levuvo Mail (Levuvo Mail Assistant) |
| Controller | [Organization, address, contact] |
| Data protection officer | [Name, contact] |
| Purposes | Summarizing, translating and checking messages; drafting and rewording emails; proposing events, contacts and tasks; detecting phishing and fraud; searching the mailbox by meaning; routines and delegated tasks that prepare drafts and proposals |
| Legal basis | Art. 6(1)(f) GDPR (legitimate interest in efficient and secure email handling) for local processing; Art. 6(1)(a) GDPR (consent of the user) and a data processing agreement (Art. 28) for cloud models; for employees additionally [§ 96/96a ArbVG works agreement or individual agreement, where required] |
| Categories of data subjects | Users of the app; senders and recipients of emails; persons named in emails, events and contacts |
| Categories of personal data | Names, email addresses, message content and metadata, calendar entries, contact data; possibly special categories contained in emails (accounts with such content are to be marked "No cloud AI") |
| Recipients | None for the local model (processing on the user's device). With a cloud model: [Anthropic PBC / OpenAI] as processor. With external agents: the provider of the agent the user connects |
| Third-country transfers | Only with a cloud model or external agent: [USA; safeguards: EU–US Data Privacy Framework certification of the provider and/or standard contractual clauses] |
| Retention | No copy of message content is stored by the AI component. AI log without content: 30 days on the device. Pending approvals: at most 7 days. Semantic vectors: on the device, deleted with the search index or "Delete all AI data". Cloud providers: according to the data processing agreement [e.g. 0–30 days] |
| Technical and organizational measures | See [SECURITY-CONCEPT.md](SECURITY-CONCEPT.md): local model by default, consent per provider, per-account cloud block, keys in the system keychain, MCP only on 127.0.0.1 with per-agent tokens and permission levels, approval before sending, no permanent deletion, prompt-injection framing, local log without content, encrypted local index |
| Automated decision-making | None. All results are suggestions; the user decides |
| Data protection impact assessment | [Assessment: normally not required for local use; check when cloud models process accounts with special categories or when agents act on behalf of many users] |

Version [date].
