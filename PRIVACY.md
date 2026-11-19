# Privacy notice – Levuvo Mail 2.3

> **Draft.** Have it reviewed legally before publication and fill in the details of the controller
> (see [docs/IMPRESSUM.md](./docs/IMPRESSUM.md)). Placeholders are in [square brackets].

## Controller

[Company name, legal form] · [Address] · [Email for privacy requests] · [Data protection officer, if applicable]

## Principle

Levuvo Mail runs **entirely on your device**. Levuvo does not operate any server through which your
emails, events, contacts, keys or credentials pass. The app connects directly to your providers'
servers. There is **no telemetry, no usage statistics and no advertising**.

## Which data is processed where

| Data | Where | Purpose |
|---|---|---|
| Emails, folders, attachments | on your provider's mail server; in memory while reading | display, search, sending |
| Events and contacts | on your CalDAV/CardDAV server; in memory while displayed | calendar, address book, invitations |
| Passwords, OAuth sign-in tokens, private PGP/S/MIME keys, index key | exclusively in the operating system keychain (macOS Keychain / Windows Credential Manager) | sign-in, decryption, signing |
| Account settings (address, servers, folders, sender addresses, signatures), CalDAV/CardDAV accounts, public keys and certificates, app settings | files in the app data folder, readable only by your user account | connections, encryption |
| Local search index: subject, sender, recipients, date and the first 3,000 characters of text (no attachments; end-to-end encrypted messages only in their unreadable, encrypted form); with the AI assistant on, also numeric embeddings (vectors) of these texts | app data folder, SQLite database **encrypted as a whole with SQLCipher (AES-256, HMAC-SHA512)**, key in the system keychain; can be switched off and deleted | search across all folders, offline reading |
| Display (language, theme, column width), notification counters (message IDs only) | local app storage | convenience |
| Address suggestions, preview texts, offline view | in memory only | faster work |
| Tasks (title, note, due date, reminder, priority, repetition, status, link to the mail) | on this device, **encrypted with AES-256-GCM** (key in the system keychain); a task in a **connected list** is also stored on that list's server, **without** the link to the mail and without the origin marker | task list, reminders |
| Snoozed mails and follow-up reminders (subject, sender address, time) and sender screening decisions (allowed and blocked addresses per account) | app data folder, **encrypted with AES-256-GCM** (key in the system keychain) | snooze, follow-ups, screening of new senders |
| AI settings, consents (provider, date, version of the consent text), own routines, connected agents (name, permission level, **hash** of the token only) | app data folder, readable only by your user account | AI features, MCP server |
| AI log (time, function or tool, provider, model, result – no message content) | app data folder, 30 days | transparency about what the AI and agents did |
| Privacy cockpit counters (per day: number of blocked trackers, external images loaded, newsletter unsubscribes – no addresses, hosts, subjects or message IDs) | app data folder, 30 days, deletable under Settings → Privacy; not part of backups | showing what was blocked and what left the device |
| Pending agent approvals with the prepared content (recipients, text, event, contact, task) | app data folder, **encrypted with AES-256-GCM**; invalid after 7 days, the content is removed once decided | your approval before an agent acts |
| Shared spaces: notes, tasks, events, pinned mails, comments, files, member list (name, address, public keys) and the activity of the space | a full copy on the device of **every member**, **encrypted with AES-256-GCM**; changes travel as end-to-end encrypted mails between the members' own mailboxes | working together in a space |

Decrypted content is not stored – not even for the offline view.

## Backups

A backup is created only when you ask for it (Settings → Backup) and is saved as a file wherever you choose. It contains the data that exists only on this device: app settings, account settings (without passwords), CalDAV/CardDAV accounts (without passwords), the local calendar with attachments, local contacts, templates, snooze and follow-up entries, sender screening decisions, tasks, your own PGP/S/MIME keys, shared spaces (still encrypted, together with the space key and the member identity from the keychain, so the restored device stays a member) and the assistant's settings, own routines, connected agents (token hashes only, no tokens) and activity log. It does **not** contain pending agent approvals, account passwords, OAuth tokens, AI API keys, the search index or the installation ID.

The file is encrypted with a password of your choice (scrypt key derivation, AES-256-GCM); without it the backup cannot be read, not even by Levuvo. Only the creation date and app version are readable without the password. Restoring checks the file first and replaces the data on this device at the next start; the previous data is kept in `before-restore/` in the app data folder (the last three restores, each for at most 30 days; older copies are deleted automatically at the next start) and can be deleted there earlier. Since a backup contains personal data of others (contacts, appointments), store it as carefully as the computer itself and delete outdated copies.
## AI features (optional, off by default)

The AI features (Settings → AI & agents) are switched off until you switch them on.

- **Local model (default):** The AI component of the app (a Python process shipped with it, based on
  Orkexa) sends the content of the messages you apply an AI function to only to **Ollama on this
  computer** (address 127.0.0.1). Nothing leaves the device. Other addresses are refused. Levuvo brings
  its own Ollama, separate from any Ollama you installed; its models and key pair are stored in the app
  data folder (`ollama/`) and are not part of backups.
- **Model downloads:** when you choose a model that is not on the computer yet, Levuvo's Ollama downloads
  it from Ollama's model registry (registry.ollama.ai and its storage servers). They see your IP address
  and which model is downloaded; no mail content is sent. Only models of a fixed list are downloaded.
- **Cloud model (only with consent):** If you choose Anthropic or OpenAI, the app asks for your consent
  first and records the date and the version of the consent text. From then on, the content an AI
  function needs is sent to that provider and processed under its terms, possibly outside the EU:
  - the messages you apply the function to;
  - for reply suggestions and "Bullet points to email" also up to five of your most recently sent
    emails as a style sample (only the text you wrote, at most 1,500 characters each);
  - for questions to the mailbox the emails the search found, across all accounts that are not marked
    "No cloud AI";
  - for tasks and routines of the built-in assistant the emails, events, contacts and tasks it reads
    to do them, and the content of shared spaces whose owner allowed cloud AI.

  Sorting new mail into bundles in the background never uses a cloud model; it runs only with the local
  model. Legal basis towards the user: consent (Art. 6(1)(a) GDPR), revocable at any time ("Withdraw
  consent"). [To be decided by the controller with legal review: the legal basis for the personal data
  of third parties in these contents (senders, recipients, persons named), typically Art. 6(1)(f) GDPR
  with a documented balancing of interests, see docs/ai/PROCESSING-RECORD.md.]
  Accounts marked "No cloud AI" are never processed by a cloud model. The API key is stored only in the
  keychain. For use in an organization, a data processing agreement (Art. 28 GDPR) with the provider is
  required.
- **Semantic search** computes its vectors always locally with Ollama, also when a cloud model is chosen.
- **What is stored:** the AI settings (app data folder, no key) and an **AI log** of what the AI and
  agents did (time, function or tool, provider, model, result) **without message content**, kept for 30
  days on this device. It is not used to monitor anyone's performance.
- **Transparency:** AI results are labelled as AI-generated. In the reading pane and the composer
  nothing is sent, saved, moved or deleted without your click; a text the assistant rewrote stays marked
  with "Undo" until the next change.
- **Semantic index:** the vectors for semantic search are derived from the encrypted local search index
  and kept on this device only, encrypted in the local search index (in older index versions only in
  memory). They are deleted with the index and are not part of backups.
- **Agents and the MCP server (off by default):** If you switch on the MCP server, AI agents that you
  connect yourself (for example Claude Desktop) can use the mailbox through it, only from this computer
  (127.0.0.1) and with a token you create per agent. What the agent's own model does with the data is
  governed by that agent's provider; Levuvo Mail cannot control it. What an agent may do depends on the
  level you give it:
  - *read:* read mails, events, contacts and tasks; nothing changes;
  - *drafts:* additionally save drafts and propose events, contacts and tasks (saved only after your
    approval);
  - *organize:* additionally, **without approval**, move, archive, mark and snooze mails, create events
    without attendees, save contacts and create or complete tasks (every call is in the AI log);
  - *everything:* additionally send mails after your approval.

  Sending, events with attendees and moving to the trash always wait for your approval; the approval
  shows the full content (all recipients, sending account, text). Pending approvals become invalid after
  7 days and are removed from the file at the next change or start; after a decision only a summary
  remains. Accounts marked "No cloud AI" are hidden from external agents, because their model usually
  runs in a cloud. Removing an agent or lowering its level withdraws its pending approvals.
- **Routines and tasks of the built-in assistant** use the same MCP server with a token that is valid for
  at most 20 minutes and exists only in memory. With a cloud model, accounts marked "No cloud AI" are
  invisible to the routine.
- "Delete all AI data" removes settings, consents, keys, the log, own routines, approvals and agent access
  at once.
- For organizations: templates for an internal usage policy, the record of processing activities, the
  security concept and a short AI guide for users are in [docs/ai](docs/ai/).

## Connections to the internet

- **Mail servers** (IMAP, SMTP, ManageSieve for filters/vacation reply) – always encrypted, certificates are verified.
- **AI:** the local model talks only to Levuvo's own Ollama on this computer (127.0.0.1). Downloading a model you chose contacts registry.ollama.ai (IP address and model name only). With a cloud model and your consent, the contents listed under "AI features" go to Anthropic (api.anthropic.com) or OpenAI (api.openai.com) over HTTPS.
- **Microsoft 365 calendar:** accepting an invitation in a Microsoft 365 calendar creates the event without attendees, so Microsoft does not send invitations on your behalf; your answer goes to the organizer as a reply mail.
- **CalDAV/CardDAV servers** that you add yourself – HTTPS only.
- **Task lists you connect yourself** (Tasks → Lists → "Connect a list": a CalDAV list, Microsoft To Do via Microsoft Graph, or Google Tasks): only the tasks in that list are sent to the server of that list (title, note, due date, reminder, priority, repetition, status); the link to the mail, the origin and the reminder state stay on this device. Nothing is sent before you connect a list. Google Tasks receives only title, note, due day and status (it cannot store the rest). CalDAV passwords are only sent to addresses of the account's own domain over HTTPS; Microsoft and Google receive the sign-in token of that account, which needs a one-time consent for tasks. The provider's privacy policy also applies. Disconnecting a list stops syncing and keeps the tasks on this device; nothing is deleted on the server.
- **Sign-in with Microsoft or Google (OAuth):** Sign-in takes place in the browser on Microsoft's or Google's pages. Levuvo Mail receives a sign-in token and stores only the refresh token in the keychain. The respective provider's privacy policy also applies.
- **Newsletter unsubscribe** (only when you confirm it): a one-click unsubscribe sends a single HTTPS POST without cookies to the sender's unsubscribe address (only public addresses, no redirects); otherwise an unsubscribe mail goes to the address the sender named, from your account.
- **External images in HTML mails** are blocked until you choose “Load images” for a message (the sender can then detect that it was opened).
- **Links** open in the default browser after confirmation (exceptions without confirmation: levuvo.at, and the Microsoft/Google sign-in that Levuvo Mail starts itself; links to those sign-in pages from a mail are confirmed like any other link).
- **Updates** (signed versions only): roughly every six hours a request to Levuvo's update server ([address]). For technical reasons the IP address, operating system and app version are transmitted; no account data or content.
- **Crash reports – only with consent:** Off by default. If you switch them on under Settings → Privacy and the build contains a report address, a technical report (memory dump of the crashed process, app version, operating system) is sent to [recipient/service] after a crash. The mail engine runs in the app's main process, so a memory dump can contain fragments of emails, addresses or keys that were in memory at the time of the crash; only switch crash reports on if that is acceptable for your data. Legal basis: consent (Art. 6(1)(a) GDPR), revocable at any time by switching it off.
- **Shared spaces:** Changes are sent as end-to-end encrypted mails from your mail account to the other members' addresses and moved into a folder called “Levuvo Spaces” on arrival (kept 30 days, then deleted). Mail providers on the way see sender, recipient, time and size, never content. The invitation mail contains the name of the space in readable form. Members you invite receive the content of the space; a removed member keeps what they already had, but cannot read anything added later (the key is replaced). The activity list shows who changed what and when; it contains no statistics or evaluation of individual people. Deleting a mail, comment, task, event, note or file in a space removes its content from every member's copy with the owner's next checkpoint (usually within a minute; members whose app is offline when it happens, on their next sync), deletes the file parts from the device and never sends it to people who join later. Limits: a member who already had the content may have kept it elsewhere (a download, a screenshot), and a member removed before the deletion keeps their copy from before the removal.
- **Diagnostic report:** Saved as a file only at your request (version, system, error counters, connection status – no content, no addresses). You decide whether to pass it on.

## Deletion

- Removing an email account deletes the local setup, the keychain entries and the search index of that account. Emails on the server remain unchanged.
- Calendar/contact accounts, keys and certificates can be removed individually in the settings.
- Shared spaces: leaving a space or dissolving it (owner) stops syncing; afterwards the local copy can be deleted under Spaces. Copies on other members' devices are under their control.
- The search index can be switched off under Settings → Search & offline (it is deleted in the process).
- Backup files you saved yourself are not touched by Levuvo; delete them yourself when no longer needed. Safety copies from a restore are in `before-restore/` in the app data folder.
- The privacy cockpit's counters can be deleted under Settings → Privacy → "Delete counters"; they expire after 30 days anyway.
- All AI data can be deleted under Settings → AI & agents → "Delete all AI data".
- After uninstalling, the app data folder can be deleted: macOS `~/Library/Application Support/Levuvo Mail`, Windows `%APPDATA%\Levuvo Mail`.

## Your rights

Since Levuvo receives no personal data from the app (exceptions: voluntary crash reports and
technical data when checking for updates), requests for access and deletion concerning emails, events
and contacts must be addressed to the respective provider. For crash reports and update logs: [contact].
Complaints: Austrian Data Protection Authority (Österreichische Datenschutzbehörde), Barichgasse 40–42, 1030 Vienna, dsb.gv.at.
