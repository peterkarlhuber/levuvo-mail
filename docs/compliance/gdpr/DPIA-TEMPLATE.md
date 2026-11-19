# Data protection impact assessment (Art. 35 GDPR) – template

For organisations that use Levuvo Mail with **cloud AI models** or **external agents**, or that
process mail with special categories of data or under professional secrecy. Based on Art. 35(7)
and the Austrian DSB's DSFA-V (list of processing operations requiring a DPIA). **Not legal advice.**

## 0. Is a DPIA needed?

Answer yes/no. Two or more "yes" → carry out the DPIA (EDPB WP248 criteria).

- [ ] Sensitive or highly personal data (Art. 9/10, professional secrecy, health, legal advice)
- [ ] Large scale (many users or many mailboxes processed by AI)
- [ ] New technology (LLM, agents)
- [ ] Data of vulnerable persons (employees, patients, clients)
- [ ] Systematic monitoring (not intended; the AI log must not be used for it)
- [ ] Transfer to third countries (cloud AI in the USA)
- [ ] Matching or combining data sets (questions across all accounts)

## 1. Description of the processing (Art. 35(7)(a))

| Item | Entry |
| --- | --- |
| Features used | [summaries, replies, questions to the mailbox, routines, agents …] |
| Model / provider | [local Ollama model / Anthropic / OpenAI / agent …] |
| Accounts in scope / excluded ("No cloud AI") | [ ] |
| Data flows | device → provider API (HTTPS) → response; see PRIVACY.md "AI features" |
| Retention at the provider | [0 days (ZDR) / up to 30 days] |
| Contract | DPA dated [ ], SCCs / DPF |

## 2. Necessity and proportionality (Art. 35(7)(b))

- Purpose: [ ]
- Why the local model is not sufficient: [ ]
- Minimisation in Levuvo Mail: only the data a function needs; style samples limited; background sorting local; per-account block.
- Legal basis: see [THIRD-PARTY-DATA-CLOUD-AI.md](THIRD-PARTY-DATA-CLOUD-AI.md).
- Information of data subjects: [ ]

## 3. Risks to the rights and freedoms of data subjects (Art. 35(7)(c))

| Risk | Likelihood | Severity | Notes |
| --- | --- | --- | --- |
| Disclosure of confidential content to the provider or its staff | | | |
| Access by third-country authorities | | | |
| Wrong or invented content in AI output leads to harm (wrong reply, wrong date) | | | |
| Prompt injection makes an agent leak or act | | | |
| Use of AI logs to monitor employees | | | |
| Breach of professional secrecy | | | |

## 4. Measures (Art. 35(7)(d))

Built into Levuvo Mail: consent per provider, per-account block, approvals before sending/deleting,
AI markers, AI log without content (30 days), MCP only on loopback with per-agent tokens and
levels, encrypted local storage, prompt-injection framing. Organisational: [training (AI literacy),
usage policy, works agreement, ZDR contract, EU region, restricted user group].

## 5. Result

- Residual risk: [low / medium / high] → if high after measures: prior consultation of the
  Austrian Data Protection Authority (Art. 36).
- DPO opinion: [ ]
- Approved by: [ ] on [date]; review by [date] or on any change of provider or feature.
