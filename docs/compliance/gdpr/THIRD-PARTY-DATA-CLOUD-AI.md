# DOC-LEV-009 – legal basis for third-party data sent to a cloud AI

**Status: open. Decision by Peter after legal review.** This page prepares the options; it does not
decide. **Not legal advice.**

## The question

When a user applies a cloud AI function (Anthropic, OpenAI), the request contains personal data of
**third parties**: senders, recipients and people named in the mails, events, contacts and spaces.
The in-app consent (Art. 6(1)(a)) only covers the **user's own** data. For employees, the
voluntariness of consent towards the employer is also doubtful (recital 43, Art. 7(4)). The
audit (2026-11-19, finding DOC-LEV-009) therefore asks for a legal basis that fits the third parties.

## Facts that matter for the assessment

- Cloud AI is off by default and used only after consent per provider; accounts can be blocked
  ("No cloud AI"); background sorting never uses the cloud.
- Only what a function needs is sent (the selected mail, up to five own sent mails as style
  sample, with "Learn style per contact" on the user's mails to that recipient and the learned
  greeting, closing and du/Sie; search hits for questions with the text of their PDF and text
  attachments and the last two questions and answers; items a routine reads).
- Providers act as processors under their API terms (no training on API data by default; retention
  typically up to 30 days for abuse monitoring; zero-data-retention available on request).
- Transfers to the USA: both providers are certified under the EU–US Data Privacy Framework
  [verify current certification]; SCCs are part of their DPAs.
- Third parties are not informed individually (Art. 14(5)(b) disproportionate effort is the usual
  argument for mail processing).

## Options

| Option | What it means | Pros | Cons / risks | Code changes |
| --- | --- | --- | --- | --- |
| **A. Legitimate interest (Art. 6(1)(f)) of the organisation + DPA** (audit recommendation) | The organisation documents a balancing test (efficient mail handling vs. third parties' interests), signs the provider's DPA (Art. 28), checks transfers; the in-app consent remains as the user's release and information | Fits third parties; common for mail processing tools; no change for users | Balancing must be done and documented; special categories (Art. 9) are **not** covered by 6(1)(f) → such accounts must be blocked | Rename consent dialog wording to "release" + information; templates updated |
| **B. A + mandatory DPIA and zero-data-retention** | As A, plus a DPIA before enabling cloud AI, and only providers/contracts with zero data retention and EU processing where available | Strongest position; good for professional secrecy (lawyers, doctors, tax advisers) | More effort for each customer; ZDR needs a provider agreement | Optional "EU region / ZDR" note per provider in settings |
| **C. Local only for third-party content** | Cloud AI only for the user's own text (composer rewrite of what the user typed); anything containing received mails stays local | Avoids the question for most cases | Loses cloud quality for summaries/questions; complex to explain | Restrict cloud to composer functions; block reader/search/routines in the cloud |
| **D. Disable cloud AI in builds for sale** | Ship only the local model; cloud only in internal builds | No third-party transfer at all | Loses a feature | Build flag |

## Recommendation for the legal review

The development team leans to **A**, with **B** as the recommended setting for organisations bound
by professional secrecy (§ 9 RAO, § 80 WTBG, § 54 ÄrzteG and similar) or with special categories.
The lawyer should confirm: (1) Art. 6(1)(f) for third parties incl. the balancing test text, (2) the
role of the in-app consent, (3) Art. 9 handling, (4) Art. 14 information duty, (5) transfer
mechanism, (6) professional-secrecy rules, (7) employee consent and § 96a ArbVG.

## After the decision

Update [PRIVACY.md](../../../PRIVACY.md) (bracketed placeholder in "AI features"),
[docs/ai/PROCESSING-RECORD.md](../../ai/PROCESSING-RECORD.md) ("Legal basis"), the consent text
(`apps/web/src/CloudConsent.tsx`, bump its version so users confirm again) and close DOC-LEV-009.
