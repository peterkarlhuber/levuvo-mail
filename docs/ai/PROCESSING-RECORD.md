# Record of processing activities (Art. 30 GDPR): Levuvo Mail Assistant

Template entry for the controller's record of processing activities. Fill in the bracketed parts and
review it with the data protection officer. This document is not legal advice.

| Field | Entry |
| --- | --- |
| Name of the processing | AI-assisted email work in Levuvo Mail (Levuvo Mail Assistant) |
| Controller | [Organization, address, contact] |
| Data protection officer | [Name, contact] |
| Purposes | Summarizing, translating and checking messages; drafting and rewording emails; proposing events, contacts and tasks; detecting phishing and fraud; searching the mailbox by meaning; routines and delegated tasks that prepare drafts and proposals |
| Legal basis | Art. 6(1)(f) GDPR (legitimate interest in efficient and secure email handling) for local processing; for cloud models: consent of the user (Art. 6(1)(a) GDPR) for the user's own data, a data processing agreement (Art. 28) with the provider, and [to be decided with legal review: legal basis for the data of third parties contained in the content, typically Art. 6(1)(f) GDPR with a documented balancing of interests; the in-app consent then serves as the user's organizational release and information]; for employees additionally [§ 96/96a ArbVG works agreement or individual agreement, where required] |
| Categories of data subjects | Users of the app; senders and recipients of emails; persons named in emails, events and contacts |
| Categories of personal data | Names, email addresses, message content and metadata, calendar entries, contact data, tasks, content of shared spaces; possibly special categories contained in emails (accounts with such content are to be marked "No cloud AI") |
| Content sent to a cloud model (only after consent) | The messages the user applies a function to; for reply suggestions and "bullet points to email" up to five recently sent emails of the user as a style sample (own text, at most 1,500 characters each); for questions to the mailbox the search hits across all accounts not marked "No cloud AI" (the best five read in full, with the text of their PDF and text attachments, at most 8,000 characters per file; the text is read on demand and never stored), plus the last two questions and answers of the conversation; for tasks and routines of the assistant the emails, events, contacts and tasks it reads, and content of spaces whose owner allowed cloud AI. Background sorting into bundles uses the local model only |
| Recipients | None for the local model (processing on the user's device; downloading a model sends only the IP address and the model name to Ollama's registry). With a cloud model: [Anthropic PBC / OpenAI] as processor. With external agents: the provider of the agent the user connects |
| Third-country transfers | Only with a cloud model or external agent: [USA; safeguards: EU–US Data Privacy Framework certification of the provider and/or standard contractual clauses] |
| Retention | No copy of message content is stored by the AI component. AI log without content: 30 days on the device. Pending approvals: invalid after 7 days, removed from the file at the next change or start; content removed once decided. Semantic vectors: on the device, deleted with the search index or "Delete all AI data". Cloud providers: according to the data processing agreement [e.g. 0–30 days] |
| Technical and organizational measures | See [SECURITY-CONCEPT.md](SECURITY-CONCEPT.md): local model by default, consent per provider, per-account cloud block, keys in the system keychain, MCP only on 127.0.0.1 with per-agent tokens and permission levels, approval before sending, no permanent deletion, prompt-injection framing, local log without content, encrypted local index |
| Automated decision-making | None. All results are suggestions; the user decides |
| Data protection impact assessment | [Assessment: normally not required for local use; check when cloud models process accounts with special categories or when agents act on behalf of many users] |

Version [date].
