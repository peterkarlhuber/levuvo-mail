# Internal usage policy: Levuvo Mail Assistant

Template for organizations that use Levuvo Mail internally. Adapt the bracketed parts, have it reviewed
(data protection officer, works council where one exists) and make it known to everyone who uses the AI
features. This document is not legal advice.

## 1. Scope

This policy applies to the AI features of Levuvo Mail (Settings → AI & agents): summaries, translation,
reply and writing suggestions, checks before sending, extraction of events, tasks and contacts,
authenticity checks, semantic search and questions to the mailbox, routines, delegated tasks and agents
connected through the MCP server.

## 2. Principles

1. **Local first.** The default is a local model (Ollama on the same computer). Mail content does not
   leave the device.
2. **Cloud only when approved.** Cloud models (Anthropic, OpenAI) may only be used after [the IT
   department / management] has approved the provider and a data processing agreement (Art. 28 GDPR) is in
   place. Every user records their own consent in the app.
3. **No cloud for confidential accounts.** Accounts with content under professional secrecy, health data
   or other special categories (Art. 9 GDPR) must be marked "No cloud AI". [List of affected accounts or
   roles.]
4. **Human in the loop.** AI results are suggestions. The user reads and checks every draft, event,
   contact and task before it is used. In the reading pane and the composer nothing is sent, moved or
   saved without a click by the user. Agents with the level "organize" can move, archive, mark and snooze
   mails and create events without attendees, contacts and tasks without asking (logged in the AI log);
   this level needs [approval by role]. Sending, events with attendees and moving to the trash always
   wait for an approval.
5. **Responsibility stays with the user.** Content sent under one's own name is one's own statement,
   whether or not an AI suggested it.
6. **Labelling.** AI results are marked as "AI-generated" in the app. If a text is published or passed to
   third parties largely unchanged and the recipient could be misled about its origin, say that it was
   generated with AI assistance (Art. 50 AI Act).

## 3. Allowed and not allowed

Allowed:

- Summarizing, translating and checking messages one is entitled to read.
- Drafting replies and rewording one's own drafts.
- Proposing events, contacts and tasks, and accepting them after review.
- Routines that read and prepare (daily briefing, open replies, meeting preparation, reply drafts).
- Connecting an external agent at the lowest level that is sufficient (normally "read" or "drafts").

Not allowed:

- Using the AI to evaluate, rank or monitor colleagues' performance or behaviour.
- Automated decisions about people (applications, dismissals, credit) based on AI output.
- Switching an agent to "send without approval" without written approval by [role].
- Connecting agents or cloud providers that [the IT department] has not approved.
- Pasting passwords, one-time codes or keys into prompts or own instructions.

## 4. Agents and the MCP server

- The MCP server is off by default and reachable only from the same computer.
- Each agent gets its own token and the lowest level that suffices. Tokens are personal, are not shared
  and are revoked when no longer needed.
- Approvals are checked like an outgoing email: recipient, content, attachments.
- The agent's own model processes what it reads. Only agents with an approved provider may be connected.

## 5. Logging

The AI log (Settings → AI & agents) records time, function or tool, provider, model and result, without
message content, for 30 days, only on the user's device. It serves the user's own transparency and
troubleshooting. It is not collected centrally and is not used to monitor performance.

## 6. Training and support

Before using the AI features, users read this policy and the short guide [AI-LITERACY.md](AI-LITERACY.md).
Questions: [contact].

## 7. Incidents

Report immediately to [contact / data protection officer]: suspected data leaks, an AI suggestion that was
sent with wrong or harmful content, an agent that acted unexpectedly, or a mail that tried to manipulate
the assistant (prompt injection).

Version [date], approved by [name, role].
