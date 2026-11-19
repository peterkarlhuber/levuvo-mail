# AI system inventory and risk classification

One row per AI feature of Levuvo Mail. Update in the same pull request that adds or changes an AI
feature. **Not legal advice.**

Columns: **Risk** = AI Act category for the intended purpose (P = prohibited, H = high-risk,
T = transparency obligation Art. 50, M = minimal). **Output** = what the user gets.
**Oversight** = how a human stays in control. **Cloud** = may use a cloud model with consent.

| Feature | Output | Risk | Art. 50 measure | Oversight | Cloud |
| --- | --- | --- | --- | --- | --- |
| Summary, key points, translation (reader) | text shown in the reader | T | "AI-generated" marker with model name | read only | yes |
| Reply suggestion, rewrite, bullet points to mail (composer) | draft text | T | in-app marker "Written/changed by the assistant", undo; header `X-Levuvo-AI-Assisted` on the sent mail | user edits and sends | yes |
| Pre-send check (tone, recipients, sensitive data, forgotten attachment, discriminatory or unlawful wording) | notes | M (assistive) | "Notes from Levuvo Mail Assistant (AI)" | user decides to send | yes |
| Phishing / fraud assessment | hint | M | marked as AI hint, "a hint, not a verdict" | user decides | yes |
| Bundles / screening / prioritisation | grouping, order | M | marked, rule-based fallback | user can move mails; never deletes | **no** (local only) |
| Semantic search, questions to the mailbox | answer with sources | T | AI marker, source mails linked | read only | yes (answer), embeddings local |
| Events, contacts, tasks from text | proposals | T | "AI-created" line in the item | saved only after a click | yes |
| Filter in words (Sieve) | rule proposal | T | "Rule suggested (model). Please review and save." | saved only after a click | yes |
| Automations in words | rule proposal (conditions, actions) | T | "AI proposal · model" marker in the editor and on the saved rule; the rule is shown in plain words built from the rule itself (not by the AI) | dry run on the newest mails; the rule is off until the user switches it on; actions limited to move, mark read, star, create task (never delete, forward, send or move to trash) | yes (only the user's description and folder names, no mail content) |
| Assistant panel: tasks, routines, briefing, meeting preparation | drafts, proposals, summaries | T | panel named "Levuvo Mail Assistant", AI markers | approvals for sending, attendees, trash | yes |
| External agents via MCP | actions depending on level | outside Levuvo (agent provider) | drafts carry `X-Levuvo-AI-Generated` with the agent's name | approval for sending, attendees, trash; levels; log | agent's own model |
| Dictation (if enabled) | transcribed text | M (assistive) | marker in the composer while dictating | user edits | local |

## Excluded uses (written into the usage policy)

- Screening, ranking or filtering job applications or candidates (would be high-risk, Annex III no. 4(a)).
- Monitoring or evaluating performance or behaviour of employees with the AI log or agent routines
  (Annex III no. 4(b); Austrian ArbVG § 96).
- Decisions on access to essential private or public services, credit or insurance (Annex III no. 5).
- Emotion recognition of people (Art. 5(1)(f)); the tone check describes the text, not the person.

## How to add a feature

1. Add a row here and classify it; if it could be H or P, stop and get a legal opinion first.
2. Mark every output (UI marker and, for sent content, the machine-readable header).
3. Keep a human decision before anything leaves the device or is deleted.
4. Add eval cases incl. prompt-injection mails.
5. Update [PRIVACY.md](../../../PRIVACY.md) and the record of processing if new data is used.
