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
- After uninstalling, the app data folder can be deleted: macOS `~/Library/Application Support/Levuvo Mail`, Windows `%APPDATA%\Levuvo Mail`.

## Your rights

Since Levuvo receives no personal data from the app (exceptions: voluntary crash reports and
technical data when checking for updates), requests for access and deletion concerning emails, events
and contacts must be addressed to the respective provider. For crash reports and update logs: [contact].
Complaints: Austrian Data Protection Authority (Österreichische Datenschutzbehörde), Barichgasse 40–42, 1030 Vienna, dsb.gv.at.
