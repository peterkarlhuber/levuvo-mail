# Changelog

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
