# Privacy notice – Levuvo Mail 2.0

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
| Local search index: subject, sender, date and the first 3,000 characters of text (no attachments; end-to-end encrypted messages only in their unreadable, encrypted form) | app data folder, **encrypted with AES-256-GCM**; can be switched off and deleted | search across all folders, offline reading |
| Display (language, theme, column width), notification counters (message IDs only) | local app storage | convenience |
| Address suggestions, preview texts, offline view | in memory only | faster work |

Decrypted content is not stored – not even for the offline view.

## Backups

A backup is created only when you ask for it (Settings → Backup) and is saved as a file wherever you choose. It contains the data that exists only on this device: app settings, account settings (without passwords), CalDAV/CardDAV accounts (without passwords), the local calendar with attachments, local contacts, templates, snooze and follow-up entries, your own PGP/S/MIME keys and the assistant's settings and activity log. It does **not** contain account passwords, OAuth tokens, AI API keys, the search index or the installation ID.

The file is encrypted with a password of your choice (scrypt key derivation, AES-256-GCM); without it the backup cannot be read, not even by Levuvo. Only the creation date and app version are readable without the password. Restoring checks the file first and replaces the data on this device at the next start; the previous data is kept in `before-restore/` in the app data folder (the last three restores) and can be deleted there. Since a backup contains personal data of others (contacts, appointments), store it as carefully as the computer itself and delete outdated copies.
## AI features (optional, off by default)

The AI features (Settings → AI & agents) are switched off until you switch them on.

- **Local model (default):** The AI component of the app (a Python process shipped with it, based on
  Orkexa) sends the content of the messages you apply an AI function to only to **Ollama on this
  computer** (address 127.0.0.1). Nothing leaves the device. Other addresses are refused.
- **Cloud model (only with consent):** If you choose Anthropic or OpenAI, the app asks for your consent
  first and records the date and the version of the consent text. From then on, the content of the
  messages you apply an AI function to is sent to that provider and processed under its terms, possibly
  outside the EU. Legal basis: consent (Art. 6(1)(a) GDPR), revocable at any time ("Withdraw consent").
  Accounts marked "No cloud AI" are never processed by a cloud model. The API key is stored only in the
  keychain. For use in an organization, a data processing agreement (Art. 28 GDPR) with the provider is
  required.
- **Semantic search** computes its vectors always locally with Ollama, also when a cloud model is chosen.
- **What is stored:** the AI settings (app data folder, no key) and an **AI log** of what the AI and
  agents did (time, function or tool, provider, model, result) **without message content**, kept for 30
  days on this device. It is not used to monitor anyone's performance.
- **Transparency:** AI results are labelled as AI-generated and are never sent, moved or deleted without
  your action.
- **Semantic index:** the vectors for semantic search are derived from the encrypted local search index
  and kept on this device only, encrypted in the local search index (in older index versions only in
  memory). They are deleted with the index and are not part of backups.
- **Agents and the MCP server (off by default):** If you switch on the MCP server, AI agents that you
  connect yourself (for example Claude Desktop) can use the mailbox through it, only from this computer
  (127.0.0.1) and with a token you create per agent. What the agent's own model does with the data is
  governed by that agent's provider; Levuvo Mail cannot control it. Sending, events with attendees, new
  contacts and moving to the trash wait for your approval. Pending approvals (with the prepared content)
  are kept for at most 7 days; after a decision only a summary remains.
- **Routines and tasks of the built-in assistant** use the same MCP server with a token that is valid for
  at most 20 minutes and exists only in memory. With a cloud model, accounts marked "No cloud AI" are
  invisible to the routine.
- "Delete all AI data" removes settings, consents, keys, the log, own routines, approvals and agent access
  at once.
- For organizations: templates for an internal usage policy, the record of processing activities, the
  security concept and a short AI guide for users are in [docs/ai](docs/ai/).

## Connections to the internet

- **Mail servers** (IMAP, SMTP, ManageSieve for filters/vacation reply) – always encrypted, certificates are verified.
- **CalDAV/CardDAV servers** that you add yourself – HTTPS only.
- **Sign-in with Microsoft or Google (OAuth):** Sign-in takes place in the browser on Microsoft's or Google's pages. Levuvo Mail receives a sign-in token and stores only the refresh token in the keychain. The respective provider's privacy policy also applies.
- **External images in HTML mails** are blocked until you choose “Load images” for a message (the sender can then detect that it was opened).
- **Links** open in the default browser after confirmation (exception without confirmation: levuvo.at and the Microsoft/Google sign-in pages).
- **Updates** (signed versions only): roughly every six hours a request to Levuvo's update server ([address]). For technical reasons the IP address, operating system and app version are transmitted; no account data or content.
- **Crash reports – only with consent:** Off by default. If you switch them on under Settings → Privacy and the build contains a report address, a technical report (memory dump of the crashed process, app version, operating system) is sent to [recipient/service] after a crash. The app is designed so that email content is not held in the main process; however, it cannot be completely ruled out that memory dumps contain fragments. Legal basis: consent (Art. 6(1)(a) GDPR), revocable at any time by switching it off.
- **Diagnostic report:** Saved as a file only at your request (version, system, error counters, connection status – no content, no addresses). You decide whether to pass it on.

## Deletion

- Removing an email account deletes the local setup, the keychain entries and the search index of that account. Emails on the server remain unchanged.
- Calendar/contact accounts, keys and certificates can be removed individually in the settings.
- The search index can be switched off under Settings → Search & offline (it is deleted in the process).
- Backup files you saved yourself are not touched by Levuvo; delete them yourself when no longer needed. Safety copies from a restore are in `before-restore/` in the app data folder.
- All AI data can be deleted under Settings → AI & agents → "Delete all AI data".
- After uninstalling, the app data folder can be deleted: macOS `~/Library/Application Support/Levuvo Mail`, Windows `%APPDATA%\Levuvo Mail`.

## Your rights

Since Levuvo receives no personal data from the app (exceptions: voluntary crash reports and
technical data when checking for updates), requests for access and deletion concerning emails, events
and contacts must be addressed to the respective provider. For crash reports and update logs: [contact].
Complaints: Austrian Data Protection Authority (Österreichische Datenschutzbehörde), Barichgasse 40–42, 1030 Vienna, dsb.gv.at.
