# EU AI Act – gap analysis

Regulation (EU) 2024/1689 laying down harmonised rules on artificial intelligence ("AI Act").
**Not legal advice** – see [README.md](README.md). Feature-by-feature classification:
[ai-act/AI-SYSTEM-INVENTORY.md](ai-act/AI-SYSTEM-INVENTORY.md).

## 1. Roles and classification

| Question | Assessment | Reference |
| --- | --- | --- |
| Is the Levuvo Mail Assistant an AI system? | Yes: machine-based, infers from input how to generate outputs (summaries, drafts, classifications, recommendations) | Art. 3(1) |
| Role today (internal use) | **Deployer** (Art. 3(4)); also provider of an AI system put into service for own use (Art. 3(3), 3(11)) | Art. 3 |
| Role when sold | **Provider** of an AI system placed on the market under its own name | Art. 3(3), 3(9) |
| General-purpose AI models used | Local: Qwen 3.5/3.8 (Alibaba), Gemma 4 (Google), Ministral 3 / Mistral Small 3.2 (Mistral AI), BGE-M3, Qwen3-Embedding; cloud: Anthropic Claude, OpenAI GPT | Art. 3(63) |
| Is Levuvo a GPAI model provider? | No. Models are used unchanged (no fine-tuning, no training); Levuvo is a **downstream provider** | Art. 3(68), recital 97, 109 |
| Prohibited practices | None. Tone check analyses text, not biometric data, so it is not emotion recognition (Art. 5(1)(f) needs biometric data, Art. 3(39)); no social scoring, no manipulation | Art. 5 |
| High-risk? | **No** for the intended purpose: no Annex III use case (employment, education, essential services, law enforcement …) and not a safety component of an Annex I product | Art. 6, Annex III |
| Foreseeable high-risk misuse | Using prioritisation/screening to filter **job applications** (Annex III no. 4(a)) or the AI log to **monitor or evaluate employees** (Annex III no. 4(b)). The usage policy forbids both; the AI log contains no content and is not designed for evaluation | Art. 6(2), Annex III no. 4 |
| Systemic-risk GPAI | Not provided by Levuvo | Art. 51 |

## 2. Obligations and status

| Obligation | Applies from | Status | Evidence / measure |
| --- | --- | --- | --- |
| **Art. 4 AI literacy** of staff of providers and deployers | 2 Feb 2025 | Done (templates) | [docs/ai/AI-LITERACY.md](../ai/AI-LITERACY.md), [docs/ai/USAGE-POLICY.md](../ai/USAGE-POLICY.md); first-use hint in the app; organisation must train its users and keep a record (template in AI-LITERACY.md) |
| **Art. 5** prohibited practices | 2 Feb 2025 | Done | Assessed above; checked for every new AI feature (CONTRIBUTING rule) |
| **Art. 50(1)** persons interacting with an AI system are informed | 2 Aug 2026 | Done | Assistant panel is named "Levuvo Mail Assistant" and states it is AI; consent dialog for cloud; AI results carry the AI marker |
| **Art. 50(2)** synthetic text marked in a **machine-readable** way, detectable as AI-generated | 2 Aug 2026 | Done | Drafts written by agents carry `X-Levuvo-AI-Generated`; mails whose text was written or rewritten by the assistant carry `X-Levuvo-AI-Assisted` when sent (setting "Mark AI-assisted mails", on by default); events/contacts get the line "AI-created". Exception for assistive editing (spelling, short rewording that does not substantially alter the input) is not relied on |
| **Art. 50(4)** deployers disclose AI text published to inform the public | 2 Aug 2026 | n/a | Private correspondence is not "published to inform the public on matters of public interest"; usage policy reminds organisations if they use the assistant for press releases |
| **Art. 50(5)** information at the latest at first interaction, clear and accessible | 2 Aug 2026 | Done | Activation screen in Settings → AI & agents, consent dialog, markers announced to screen readers |
| Art. 53/54 GPAI provider obligations (documentation for downstream providers) | 2 Aug 2025 | n/a for Levuvo; used as input | Model cards and licences recorded in [docs/ai/MODELS.md](../ai/MODELS.md) and [LICENSING.md](LICENSING.md); keep the downstream documentation of each model provider (Art. 53(1)(b), Annex XII) in the compliance file |
| Art. 25 responsibilities along the value chain | – | Done | No substantial modification of models; if Levuvo ever fine-tunes a model, reassess (could become GPAI provider for the modification) |
| Art. 26 deployer obligations | 2 Aug 2026 | n/a | Only for high-risk systems. Voluntary good practice adopted: human oversight, logs, information of workers (see below) |
| Art. 26(7) informing workers' representatives | – | Recommended | Only for high-risk; but Austrian ArbVG §§ 96/96a may require a works agreement for AI and logging → [docs/ai/USAGE-POLICY.md](../ai/USAGE-POLICY.md) |
| Art. 95 voluntary codes of conduct | – | Adopted partly | Human oversight, logging, robustness and transparency implemented as if the system were high-risk where cheap (see § 3) |

## 3. Voluntary good practice (beyond the minimum)

| Topic | Implementation |
| --- | --- |
| Human oversight (cf. Art. 14) | Nothing is sent, deleted, moved or accepted without a click in reader and composer; agent approvals show full content; "organize" level documented and logged; undo for rewrites |
| Logging (cf. Art. 12) | AI log: time, function/tool, provider, model, result, no content, 30 days, local only |
| Accuracy and robustness (cf. Art. 15) | Eval cases incl. prompt-injection mails in `apps/ai/tests`; error kinds contract; timeouts; fallbacks |
| Data governance (cf. Art. 10) | No training on user data; style samples only at request time |
| Instructions for use (cf. Art. 13) | [docs/ai/AI-LITERACY.md](../ai/AI-LITERACY.md), [USER-INFORMATION.md](USER-INFORMATION.md) § AI |
| Cybersecurity of the AI component | [docs/ai/SECURITY-CONCEPT.md](../ai/SECURITY-CONCEPT.md) |

## 4. Open points

- Watch the Commission guidelines on Art. 50 and the code of practice on marking and labelling of
  AI-generated content; adjust the header format if a standard emerges (for example a C2PA-like
  text manifest or a registered header name).
- Watch the "Digital Omnibus" proposal (November 2025) that may postpone parts of the AI Act.
- Legal confirmation that no feature is high-risk in the way customers use it (OPEN-ITEMS).
