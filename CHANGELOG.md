# Changelog

## Unreleased

### New
- **Phishing hints:** the reading pane now also warns about look-alike sender domains (“paypa1.com”, Cyrillic letters, a typo of your own domain such as “levuv0.at”), display names that pose as a brand while the address is from somewhere else, links to look-alike domains, links that hide the real host behind a user name (“https://paypal.com@evil.example”), password forms inside the message and attached web pages (.html, .svg). All checks run locally.
- **Levuvo Mail Assistant (foundation):** optional AI features, off by default, under Settings → AI & agents. By default a local model (Ollama on this computer) does the work and no content leaves the device; Anthropic or OpenAI can be chosen after a recorded consent, never for accounts marked "No cloud AI". API keys are stored only in the keychain. An AI log records what the AI did (no message content, 30 days), and "Delete all AI data" removes settings, consents, keys and the log at once. The AI component is a separate process based on Orkexa with a minimal environment; mail content always reaches the model marked as untrusted data.
- **Reading pane:** tracking pixels (invisible 1×1 images and images from known open-tracking services) are removed from HTML mail, even after "Load images". The reading pane shows how many were blocked, e.g. "3 trackers blocked", with the tracker hosts on hover.
- **Contacts on this device:** contacts can be created, edited, deleted, imported and exported without connecting a CardDAV, Microsoft 365 or Google address book. They are stored as vCards, encrypted with AES-256-GCM; the key lives in the system keychain. Without the keychain (or with a different key) the address book stays locked instead of being replaced by an empty one. Addresses from it are suggested when writing and count as known senders.
- **Attachments in events:** files can be attached to events, shown, previewed (images, PDF, text), downloaded and removed in the event editor (button or drag & drop). In the device calendar and CalDAV calendars the files are stored in the event itself (iCalendar `ATTACH`, up to 5 MB per file and 10 MB per event), so they also appear in other apps and in `.ics` exports; links attached by other apps open in the browser. Microsoft 365 stores them as event attachments (up to 3 MB per file). Google Calendar shows its Google Drive attachments, which can be opened and removed; new files are attached there via Google Drive. Invitations carry the files as normal e-mail attachments, and moving an event to another calendar takes them along.

### Performance (large mailboxes, AUD-011)
- **Folder pages:** loading older messages no longer asks the server for every UID below the current position (about 50,000 UIDs per page on a 100k folder). A UID window just below the cursor is searched instead, sized from the folder's UID density and widened only when needed: about 50 UIDs per page, independent of folder size.
- **Folder search:** further result pages only search the part of the folder below the last hit.
- **Search index:** a folder whose message count and UIDNEXT did not change is not listed again on each background run (read/unread changes are still picked up). "Search everywhere" loads its results in pages of 40 with the exact hit count instead of a fixed top 100, sorted newest first without sorting every hit.
- **Search index for other features:** `entries()` and `removedKeys()` report new and removed index entries incrementally (stable keys, a generation ID that changes on rebuild), so features built on the index do not copy it.
- **Benchmark:** `npm run bench:mailbox` measures paging, IMAP search and the index on 100,000 synthetic messages and fails when an upper bound is exceeded; it runs in CI.

### Fixes
- **Contacts:** the search field no longer takes up half of the contact list; address and phone types are shown in the UI language, and e-mail types written as `INTERNET,WORK` are read as "work".

### Fixes
- **Inbox:** no more empty "(no subject)" entry from "Unknown" that cannot be deleted. When a message is deleted or moved on another connection (this app's own action, a second computer, a phone) and the live connection has not been told yet, Dovecot still answers for it with an empty stand-in (size 0, date 1970, no sender or subject). Such entries are now ignored in the list, the live inbox, the reading pane, the local search index and before moving or deleting.

### Fixes (audit of 2.2.2)
- **Send later – sent at most once, also with several devices:** the send state now lives in IMAP keywords on the scheduled message (`scheduled → claimed → sending → sent | failed | unconfirmed`). The device that scheduled a message sends it; another device takes over only after two minutes, and a two-flag claim on the server keeps both from sending at the same moment. A scheduler run never overlaps with the next one.
- **Send later – nothing gets stuck or lost silently:** a claim left behind by a device that stopped before SMTP is released after ten minutes. If SMTP may have started (crash, lost connection during DATA), the message is shown as "sending not confirmed" in the reading pane and is never resent automatically; a copy in "Sent" settles it. Refusals before DATA are shown as failed (nothing was sent).
- **Send later – no duplicate scheduled messages:** a lost APPEND answer no longer triggers a second APPEND; the server is checked for the message instead. Repeating a schedule request with the same request ID returns the stored message. Servers that cannot store keywords refuse "Send later" instead of sending twice or never.
- **Accounts:** when the server or login of an account changes, the search index, message, list and preview caches and snooze/follow-up entries of the previous mailbox are dropped; the index file is bound to the mailbox identity.
- **Snooze:** the tracking entry is written before the message is moved and completed afterwards; entries a crash left open are reconciled. Messages without Message-ID and without COPYUID are found again by date, size, sender and subject. A message that cannot be found is kept as a reminder (retried hourly) instead of being dropped.
- **Search index:** read/unread changes made on other devices are picked up (CONDSTORE when available, otherwise a flag refresh).
- **Device calendar:** never stored unencrypted – without the system keychain the device calendar is unavailable, and a plain-text file from an earlier version is encrypted on start. One failed save no longer blocks all later saves.
- **Password-protected messages:** opening one no longer blocks the app: key derivation runs off the main thread, and iteration count and fields are checked first.
- **Newsletter one-click unsubscribe:** the host is resolved first and refused if any address is internal (also IPv4-mapped IPv6); the request goes to exactly the checked address.

### Tests
- Regression tests drive the real IMAP client against a server that answers with Dovecot's stand-in for an already expunged message.
- Failure tests for two devices sending at the same moment (forced and random interleavings), crashes before and after SMTP, lost APPEND answers, repeated schedule requests, account identity changes, snooze without COPYUID/Message-ID and with a crash between MOVE and tracking, flag changes in the index, calendar write errors, hostile protected-message boxes and DNS answers pointing to internal addresses.

## 2.2.2 – 13 November 2026

### Fixes
- **Inbox:** opening a newly arrived message no longer leaves an empty or wrong entry behind. Single-message reads (reading pane, raw source, drafts, conversations, scheduled mail) only accept the server's answer for exactly that message; flag updates the server pushes in between (e.g. after reading on another device) are ignored. Previews are no longer left empty by such updates.
- **Inbox:** an inbox snapshot that was read before your own delete, move or read change is no longer applied, and "check now" waits for a fresh read. A list entry for a message that no longer exists is removed quietly instead of showing an error.

### Tests
- Regression tests drive the real IMAP client against a server that pushes flag updates in the middle of answers, and a browser test (opt-in, `test/e2e/inbox-live.e2e.mjs`) runs "new mail arrives, is opened, read and deleted" against Dovecot.

## 2.2.1 – 13 November 2026

### Fixes
- **Inbox:** no more empty extra messages when new mail arrives. Flag updates the server pushes during a refresh were listed as messages without sender or subject that could not be deleted.
- **Inbox:** a deleted message no longer reappears for a moment (and then fails to delete again); new mail now shows up within about five seconds; the newest messages are listed even when the server reports changes late.
- **Mailboxes without Trash, Drafts or Sent:** these folders are created on first use, so deleting, saving drafts and storing sent copies work.
- **Device calendar:** if the keychain key is missing or different, the calendar stays locked instead of being replaced by an empty one; a damaged file is kept as a backup.
- **S/MIME:** certificates from signed mail are only remembered when the chain is trusted and the address matches the sender; a known certificate is no longer replaced by a newer one from an unknown source.
- **Calendar:** editing an event from another time zone no longer shifts it; reminders keep working after more than two days of sleep.
- **Send later:** temporary connection or login problems are retried for up to 24 hours instead of marking the message as failed.
- **Reading pane:** opening a message no longer waits for a slow CardDAV server; toolbar and sender line fit at medium window widths; blocked remote images show no broken-image icon.

### Performance
- The encrypted search index is only rewritten when something changed, and compression no longer blocks the app.

### Build & Release
- Windows ARM64 and x64 get separate update channels (`latest-arm64.yml`, `latest-x64.yml`); the release assembly fails if two build jobs produce different files with the same name.

## 2.2.0 – 13 November 2026

### New: password-protected messages
- Choose **“Protect with password”** when composing: text and attachments are encrypted with a password (AES-256-GCM, key derived from the password via PBKDF2-SHA256 with 600,000 iterations).
- **Works for any recipient** – no account, no installation: they open the attached file “Geschuetzte-Nachricht.html” in a current browser and enter the password. Decryption happens only in their browser; the file loads nothing from the internet.
- Levuvo Mail suggests a strong password (copy, change, regenerate), optionally with a hint. The password is not stored anywhere.
- Recipients with Levuvo Mail open the message directly in the reading pane; your own copy in “Sent” is protected as well. After five wrong attempts there is a short waiting period.
- Only sender, recipients and subject remain visible. Attachments up to 5 MiB in total.

### Build & Release
- GitHub Actions CI/CD: quality and security checks, CodeQL, desktop builds for macOS ARM64, Windows ARM64 and Windows x64, draft releases with SHA-256 checksums and manifest (see `RELEASING.md`, `docs/CI-CD.md`).
- LICENSE changed to the proprietary Levuvo license (previously the GitHub default MIT).
- Release assembly escapes the version completely in its regular expressions and finds the last CHANGELOG section correctly (CodeQL #19, #20).

### Repository
- The repository is now in English: code comments, tests, scripts, CI workflow and job names, documentation and LICENSE. `DATENSCHUTZ.md` was renamed to `PRIVACY.md`. The app itself is unchanged: German (default) and English.
- CI job names changed (e.g. `CI bestanden` → `CI passed`); required status checks in branch protection must be updated accordingly.

## 2.1.1 – 13 November 2026

### New: “On this device” calendar
- The calendar now works **without an account**: enter events, blockers and reminders right away – with recurrence, reminders (system notification), drag & drop and month overview.
- Stored encrypted on the device (AES-256-GCM, key in the keychain). No synchronization with other devices – a note in the sidebar explains this.
- Multiple device calendars with their own color; **export and import as .ics** (backup, transfer from other calendar apps) under Settings → Calendar & contacts.
- **Move events to another calendar:** simply choose a different calendar in the event – between device, CalDAV, Microsoft 365 and Google.
- Invitations from emails can also be saved in the device calendar.

### Fixed
- **Drag & drop in the week and day view** (and for all-day events) did not move anything in 2.1.0; only the month view worked. Now fixed and covered by an end-to-end test.

### Design
- “Levuvo” and “mail.” sit on a common baseline in the sidebar, with matched size and weight.
- The slogan “Less effort. More impact.” is on one line.

## 2.1.0 – 13 November 2026

Work faster, click less. 2.1 focuses on usability, overview and the things you need every day.
*Less effort. More impact.*

### New: calendar & contacts from Microsoft 365 and Google
- Accounts connected with “Sign in with Microsoft” or “Sign in with Google” **bring their calendars and contacts automatically** – directly via Microsoft Graph or Google Calendar/People API, without a CalDAV detour.
- Create, edit (single occurrence or whole series) and delete events, reminders, recurrence, attendees – the provider sends invitations and cancellations itself.
- Invitations in email are answered in the matching calendar of the mailbox; the provider informs the organizer.
- Create, edit and delete contacts, vCard import into the online address book.
- For accounts from 2.0, **a one-time consent** is enough (“Allow access” notice in calendar and contacts) – the account is kept.

### New: email
- **Real conversations:** when reading, “Conversation” shows all related messages – including your own replies from “Sent” and messages in the archive – expandable directly in the message.
- **Undo for all actions:** move, archive, delete, spam and bulk actions can be undone from the notification (via the new UIDs from the server, UIDPLUS).
- **Snooze:** remove a message from the inbox until “later today”, “this evening”, “tomorrow morning”, “Monday”, “in a week” or a custom time. It is kept in the server folder “Zurückgestellt” and comes back **unread** at the chosen time (key B).
- **Follow-up:** when sending, choose “Follow up after 1/2/3/5 days or 1 week”. If no reply arrives by then, the message appears under “Follow-up” (with counter and system notification). A reply ends the follow-up automatically.
- **Templates & text snippets:** save frequent replies and insert them with one click – with placeholders such as {Vorname}, {Name}, {Datum}, {Absender}. Managed under Settings → Templates.
- **Unsubscribe from newsletters** with one click (List-Unsubscribe, one-click per RFC 8058, by email or on the unsubscribe page). Internal network addresses are never called for security reasons.

### Usability & design
- **Command palette (Ctrl/⌘ + K):** reach compose, search, every folder, every account, every area, every settings page and the theme with a few letters – even without umlauts (“entwurfe”).
- **Quick actions in the message list:** archive, delete, read/unread and snooze directly on hover.
- **Calendar:** month overview in the sidebar (days with events marked), **move events via drag & drop** (week/day to the nearest 15 minutes, month and all-day by day) – with undo and optional notification of attendees.
- **Setup:** providers as tiles (Microsoft 365, Gmail, GMX, WEB.DE, IONOS, Hetzner, Strato, easyname, Other).
- The reader toolbar stays on one line; when space is short, labels become icons.
- Consistent menus for choosing a time (send later, snooze, remind), visible keyboard focus, reduced motion is respected.
- All new texts in German and English.

### Security
- New endpoints with action header (mail-v1, calendar-v1, contacts-v1, accounts-v1); OAuth re-sign-in only for the same mailbox.
- One-click unsubscribe without cookies, without redirects, https only, no private/local targets.
- Calendar/contact tokens (Microsoft Graph) separate from the mail token and only in memory; only the refresh token is still stored permanently in the keychain.

### Development
- 197 automated tests, 13 integration tests against real servers (incl. conversation, undo, snooze, follow-up, templates and a Microsoft Graph test server) and 14 end-to-end steps in the browser.

### Upgrading from 2.0
Everything is carried over. Microsoft and Google accounts show the “Allow access” notice once in calendar and contacts. For your own builds, the additional permissions must be added in the Azure app or the Google project (see `docs/OAUTH-SETUP.md`).

## 2.0.0 – 13 November 2026

Levuvo Mail grows from an email program into a workspace for **email, calendar and contacts**.
*Less effort. More impact.*

### New: calendar (CalDAV)
- Day, week, month and agenda view; multiple calendars with colors, can be shown/hidden, create new calendars.
- Events with location, description, all-day, time zone (DST-safe), **recurrence** (daily/weekly with weekdays/monthly/yearly, ending after a count or on a date) and **reminders** (system notification, even with the window closed).
- Series: change or delete “Only this event” or “All events”.
- **Invitations (iMIP):** invite attendees, updates and cancellations by email. Incoming invitations appear as a card in the message – accept/maybe/decline with calendar choice; attendees' replies update your own event.
- Tested with Radicale; suitable for Nextcloud, mailbox.org, iCloud (app password), Fastmail, Posteo.

### New: contacts (CardDAV)
- Address book with search, create, edit, delete; vCard import and export; “Write email”.
- Address suggestions while composing combine the address book and previous emails.

### Email
- **Real editor:** bold, italic, underline, heading, lists, quote, code, links, images; switch between formatted/plain text; replies quote the formatted message.
- **HTML signatures with logo** per sender address; the signature changes automatically with the sender.
- **Sender addresses (aliases/identities)** per account – the server checks that only configured addresses are used.
- **Undo send** (5–30 s, configurable) and **send later** (this evening, tomorrow morning, Monday, custom). Scheduled messages are kept in “Drafts”; opening a scheduled draft unschedules it immediately.
- **Folder management:** create (including subfolders), rename, delete empty folders; tree view.
- **Drag & drop** of single or selected messages onto folders, trash or spam.
- **Flag (star)**, filters “Unread / Flagged / Attachment”, **spam / not spam**.
- Bulk actions in one request for up to 500 messages.
- **Print / as PDF**, **save as .eml**, **attachment preview** (images, PDF, text) without downloading.
- **Phishing protection:** evaluation of SPF/DKIM/DMARC, warnings for fake display names, misleading links, differing reply-to addresses, punycode domains, dangerous and macro-capable attachments; confirmation before downloading dangerous files.
- **Server filters and vacation reply (Sieve/ManageSieve):** rules (from/to/subject → move, mark read, flag, trash) run on the mail server – even when the app is closed. Existing scripts are only replaced after confirmation.
- **Sign-in with Microsoft 365 / Outlook.com and Google (OAuth 2.0, PKCE)** – technically complete; client IDs are configured at build time (see `docs/OAUTH-SETUP.md`).
- **End-to-end encryption:** OpenPGP (PGP/MIME, generate/import/export keys, take over keys from emails) and S/MIME (.p12 import, contacts' certificates automatically, chain of trust). Sign and/or encrypt when composing, warning about missing keys; display of encryption and signature status when reading. Tested for interoperability with GnuPG and OpenSSL.
- **Encrypted local search index** (AES-256-GCM, key in the keychain): “Everywhere” search across all folders and accounts, even offline; offline reading from the index.
- Content types of attachments (PDF, images, Office …) are set correctly so recipients see previews.

### User interface
- New navigation bar: Mail · Calendar · Contacts · Help · Settings (Alt+1/2/3, Alt+,).
- **Light and dark theme** (or automatic like the system), the logo adapts.
- **English user interface** (automatically by system language or chosen explicitly) – all texts incl. server and error messages; a test ensures that no translation is missing.
- Settings as a separate area with ten pages (General, Accounts, Filters & vacation reply, Calendar & contacts, Security, Search & offline, Notifications, Privacy, Help, About).
- HTML messages are shown formatted by default (protected view, external images still blocked).
- Desktop: “Go to” menu, tray with “New message” and “Calendar”, notifications open the account or calendar directly; native texts in German/English.

### Privacy & support
- **Crash reports only with explicit consent** (off by default; only effective if the build contains a report address).
- **Diagnostic report** for download (version, system, error counters – no content, no addresses).
- Imprint placeholders, updated privacy notice, manual (German/English), license notices of all bundled libraries (`THIRD-PARTY-NOTICES.txt`).

### Security
- Every writing request requires an area-specific action header (mail, accounts, draft, send, calendar, contacts, crypto).
- The OAuth callback is the only cookie-free endpoint, with a single-use `state` and PKCE.
- Private keys, OAuth tokens and index keys exclusively in the keychain; decrypted content is never stored for the offline view.
- Attachment preview in its own sandbox with a restrictive CSP; only preview frames of the app's own origin may load.

### Development
- 179 automated tests (server, UI logic, desktop), integration test against real servers (Dovecot with Sieve, SMTP, Radicale, OAuth test provider) and an **end-to-end test of the entire UI** in the browser (`npm run test:e2e`).
- Split bundles (editor, React, icons) for a faster start.

### Upgrading from 1.x
Accounts, passwords and settings are carried over. The display starts in the system theme; language and theme can be changed under Settings → General.

## 1.2.0 – 13 November 2026

### Features
- **Unlimited scrolling:** folders and search results load older messages page by page (automatically when scrolling). Previously only the newest 40 were visible.
- **Instant delivery via IMAP IDLE:** one persistent, read-only connection per account. New mails appear in about one second instead of up to 45 seconds. The double polling (window + background, each every 45 s with a new login) is gone.
- **Text preview** in the message list, attachment icon, unread counter per folder.
- **Reply all** (key A), **forward with attachments** (up to 8 MiB), replies to HTML-only mails with a clean quote.
- **Formatted emails:** bold, italic, links, lists and quotes via a toolbar; sent as HTML with a text version.
- **Address suggestions** while composing (from sent and received mails, in memory only).
- **Unified inbox** of all accounts.
- **Conversation view** (optional): grouping by subject with history in the reading pane.
- **Mark as read when opened** (default, can be switched off).
- **Offline view:** recently loaded folders and messages stay readable when the server is unreachable.
- **Embedded images** (cid:) are shown; **external images** on request per message.
- **Links in HTML mails** are clickable but only open after a confirmation showing the real target.
- **Account setup with connection test:** a wrong password is detected before saving. Presets for Hetzner, IONOS, Strato, easyname, GMX, WEB.DE and Gmail.
- New keyboard shortcuts: A, F, U, E, Del, Ctrl/⌘+Enter.

### Display
- Compact mode (about twice as many messages per screen), less decorative text, clear status (“Live”, “Offline”).
- The folder bar scrolls in small windows; nothing is cut off anymore.
- Contrast according to WCAG AA, clearly recognizable unread messages.
- Custom confirmation dialogs instead of system dialogs.
- Consistent slogan: “Less effort. More impact.”
- Neutral texts instead of references to “Hetzner”.

### Security
- Content Security Policy for the app UI.
- The session key is no longer in environment variables; the server is created directly in the main process.
- The desktop app no longer reads credentials from environment variables.
- Sending additionally requires its own action header.
- Separate macOS entitlements: library validation stays active in signed releases.
- Automatic updates (electron-updater) for signed releases.
- Fixed dependency versions with `package-lock.json`, CI with `npm ci` and GitHub Actions pinned to commits.

### Bug fixes
- A missing UI returned HTTP 500 instead of an understandable message.
- The composer showed a hint text with visible quotation marks.

### Development
- Server as a testable factory function (`createMailServer`), UI split into components.
- ESLint and Prettier, behavior tests instead of source comparisons (146 tests), optional integration test against a real mail server.
- LICENSE and privacy notice.

## 1.1.0
- First start without demo, accounts only in the keychain, separate scroll areas.
