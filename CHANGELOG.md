# Changelog

## Unreleased

### Video calls and contact history
- **Video calls with Jitsi Meet:** "Add video call" in an event creates a link with a random room name (125 bits, cannot be guessed) and puts it in the location or, if that is taken, at the top of the description, so attendees get it with the invitation. Events with a Jitsi link show "Join video call" and "Copy link". The composer has a "Video call" button that inserts the link at the cursor, and "Start video call" in a space chat sends it to all members; links in chat messages can now be clicked. The default server is meet.ffmuc.net (Freifunk München, Germany); an own Jitsi server can be set under Settings → General → Video calls (https only). Levuvo Mail only builds the link and opens no connection itself; the call runs in the browser after the usual link confirmation.
- **Contact history (mini CRM):** every contact has a "History" with emails (local search index, all accounts and folders), shared events, tasks and notes on one timeline, with filters. Notes can be added, edited and deleted; "Add task" creates a task linked to the person, and tasks made from one of their mails appear as well. The reader's contact card shows open tasks and the latest notes and can add both, also for people who are not in an address book. Notes are stored only on this device, encrypted with AES-256-GCM (key `contact-notes-key` in the keychain, fail closed), are part of the backup and are deleted with the last contact that has the address. No AI and no online lookup.

### Window frame (macOS)
- **Calmer top left corner:** the traffic lights now sit 16 px from the edge, centred in a 40 px strip, with no rail border next to them. The logo keeps a clear gap below, and the "Levuvo mail." wordmark sits on the same row as the logo.

### Ask your mailbox
- **Names and numbers are found:** a question searches by meaning and by exact words at the same time (merged by rank), so "What did Müller say about the offer?" finds Müller's mails even when the meaning search misses them, and questions work while the search index is still being built.
- **Whole mails and attachments:** the best five hits are read in full, with the text of their PDF and text attachments (CSV, Markdown, HTML; at most 8 MB, 30 pages and 8,000 characters per file, read on demand, never stored). PDFs are read with scripting off.
- **Sources with a quote:** every source email shows sender, date and a passage from it; a passage is shown only if it literally occurs in that email or attachment.
- **Follow-up questions:** "and the price?" refers to the previous answer (the last two turns go along, framed as untrusted). The bin icon starts a new conversation.

### Spaces
- **Chat in every space:** a new "Chat" tab for quick exchanges between the members, end-to-end encrypted over your mailboxes like everything else in a space. Owners and editors write, readers follow along. Reply to a message, edit your own, delete your own (the owner may delete any); a deleted message disappears from every member's copy. Enter sends, Shift+Enter starts a new line.
- **Arrives within seconds:** chat messages are sent right away instead of after the 20-second pause, and the app fetches them as soon as the IMAP IDLE connection reports them, usually within 1 to 5 seconds. Without IDLE, accounts with spaces are checked every 30 seconds. No server of our own is involved.
- **Unread messages** are counted on the rail, in the list of spaces and on the tab, on this device only: there are no read receipts and no typing indicators.
- **Assistant:** it can read and search the chat and, after your approval, write a message; such messages are marked "AI-generated" for every member. Approve "Only this one" or "For this space until revoked" (then it writes there without asking, at most 10 messages in 10 minutes, until you revoke it in the space settings).

### Compliance
- Compliance: gap analyses and templates for the Cyber Resilience Act, the AI Act, the GDPR, accessibility and other rules in `docs/compliance/` (vulnerability handling, 24 h/72 h reporting, support period, risk assessment, technical documentation, EU declaration of conformity template, record of processing, DPIA template, options for DOC-LEV-009, AI system inventory, licensing policy, user information); coordinated vulnerability disclosure policy in `SECURITY.md`; compliance section in the release checklist. Not legal advice.
- Every release carries a CycloneDX 1.6 SBOM (`levuvo-mail-<version>.cdx.json`: npm packages, Electron, AI sidecar with its Python packages, CPython, Ollama) and `THIRD-PARTY-NOTICES.txt`; CI checks a licence policy for npm and Python packages (`npm run check:licenses`, `scripts/license-policy.json`) and the compliance file and support period (`npm run check:compliance`). The licence notices now also list packages npm de-duplicates and reproduce Apache NOTICE files.
- Settings → Privacy → "Your data": **Export my data** (readable JSON of the device-local data, GDPR Art. 15/20, no private keys or passwords), **Delete all data on this device** (all Levuvo files and keychain entries, removed at the next start before anything opens; CRA Annex I Part I (2)(m)) and **Install updates automatically** (on by default; when off, Levuvo Mail asks before downloading, CRA Annex I Part I (2)(c)).
- Settings → About: **Security and support** (end of security support of this version, how to report a vulnerability, SBOM) and **Open-source licences** with the full texts of the app, the AI runtime and Ollama.
- AI Act Art. 50(2): mails whose text the assistant wrote or rewrote, and mails an agent sends after approval, carry the machine-readable header `X-Levuvo-AI-Assisted` (who wrote it, model). On by default; Settings → AI & agents → "Mark AI-written mails".
- The assistant's base rules now also carry the compliance limits: use personal data only as far as needed, never rate or profile people (applicants, employees), no guesses about emotions or sensitive traits, output is a marked suggestion, no legal/tax/medical advice as fact.
- **Guardrails at the moment of action:** before sending, Levuvo Mail warns locally, without AI, when many external recipients from several organisations see each other's addresses (use Bcc), when card numbers, Austrian social security numbers or passwords go unencrypted outside the organisation, and when a mail appears to contain health data (GDPR Art. 9). The optional AI check also points out discriminatory wording, sharing other people's sensitive data and threats. Switching off automatic updates or the AI marking asks once and explains why. You always decide; nothing is logged, counted or reported. The assistant declines requests the law forbids (for example ranking applicants) with a short reason and a lawful alternative.

## 2.5.0 – 19 November 2026

> **Larger installer, models on demand:** the installer now contains Levuvo Mail's own Ollama, so it is bigger than 2.4.0 (about 0.6 GB more unpacked on macOS, 0.5 GB on Windows ARM64, 1.1 GB on Windows x64). No AI model is included: a model is downloaded when you first choose it in Settings → AI & agents, which needs a few GB of free disk space and an internet connection once.

### Vacation reply
- **Formatted vacation reply with signature and logo:** Settings → Filters & vacation uses the same editor as the signature (bold, links, images). "Append the account's signature (with logo)" adds the account signature. The reply is stored on the mail server as MIME (Sieve `vacation :mime`) with a plain-text version, the images inline, so recipients see the logo without loading anything from the internet. Mail servers that only accept plain-text replies get the text version, and Levuvo Mail says so. Too large images are refused with a clear message (at most 4 images, 400 KB together), and the server's size limit is checked before saving.

### Window
- **No separate title bar:** on macOS the app reaches the top edge and the traffic lights sit in the top of the left rail; on Windows minimize, maximize and close are drawn in the top right corner in the app's colours and follow its light or dark theme. The top strip still moves the window and maximizes it on double click. Linux and the browser keep their normal frame.
- **One logo:** the mark stays only in the rail, the sidebar shows the wordmark "Levuvo mail."; the vertical line between mark and name is gone (also on the welcome screen and in Settings → About).

### Levuvo Mail's own Ollama
- **Ollama in the installer, only for Levuvo Mail:** the app ships a pinned Ollama build (0.40.16) and starts it itself when a local model is needed: own models folder and key pair in the app data folder, a free port on 127.0.0.1 only, Ollama's cloud features off, none of your own Ollama settings. An Ollama you installed yourself is never used, started or stopped. It stops after 30 idle minutes and when Levuvo Mail closes.
- **Choose a model, it downloads:** Settings → AI & agents lists a fixed choice of language models in three sizes (small from 8 GB RAM, standard from 16 GB, large from 32 GB, with EU models of Mistral AI in each) and three search models. Choosing one that is missing downloads it with a progress bar; cancel, resume later, delete, and remove interrupted downloads. The size that fits the computer's memory is suggested on the first start; too large models ask first. No model ships in the installer.
- **Checksums:** every model is pinned to its manifest digest on Ollama's registry; a download with other content is deleted again. CI checks the pins, the Ollama release (size, SHA-256, code signature, architecture) and known security advisories.
- **BGE-M3 is the new default search model:** on German test mails it finds the right message first in 29 of 30 queries (Qwen3-Embedding 0.6B: 26 of 30) at the same speed. Changing the search model asks first and rebuilds the index in the background with progress. Details in docs/ai/MODELS.md.
- **Backups** leave out the downloaded models; they are downloaded again from the list.
- **Installer size:** about 0.6 GB more unpacked on macOS, 0.5 GB on Windows ARM64 and 1.1 GB on Windows x64 (CUDA 12 libraries left out; older Nvidia GPUs use Vulkan).

### Settings
- **Free-text fields are wide enough:** "Closing line" and "Own instructions" (AI & agents → Writing style) sit below their label at full width; the instructions box shows four lines and can be resized vertically. Single-line fields beside a label (Ollama address, models, API key) get a usable width instead of the browser default.

### Newsletter hub
- **Weekly overview:** the newsletter bundle offers "Weekly overview": the assistant reads the newsletters of the last seven days (at most 20) and gives one line per newsletter plus up to three highlights; each line opens the mail. Runs only when started, marked as AI-generated, under the "Summarize" function and its cloud rules.
- **All senders:** the newsletter bundle lists every sender (not only the first twelve) with one-click unsubscribe.

### Privacy cockpit
- **Settings → Privacy shows what happened in the last 30 days:** how many tracking pixels were blocked (per day), how often the AI ran on this device and how often in the cloud (per function, and how much of it ran automatically), which external agents (MCP) accessed what, newsletter unsubscribes, external images you loaded and model downloads. "What left Levuvo Mail" lists every kind of data that went off the device.
- **Data-minimised:** besides the existing AI log (no content) only daily counters are stored – no addresses, hosts, subjects or message IDs; 30 days, deletable, not in backups.

### Protect with password
- **Security review:** easily guessed passwords (few distinct characters, runs like "1234567890", common words with digits) are refused, because the encrypted file can be attacked offline without a limit; the suggested random password stays the default. A copied password is removed from the clipboard after one minute. The composer now says that automatically saved drafts stay unencrypted in the own Drafts folder until sending. Review notes in SECURITY.md.

### Fixes
- **Tasks open again on macOS and Windows:** the builds for macOS and Windows (case-insensitive disks) loaded the task helpers (`tasks.ts`) instead of the Tasks view (`Tasks.tsx`), so opening Tasks failed and the whole window went black. The view is now `TasksModule.tsx`, and a test rejects source files that differ only in case.
- **No more black window when an area fails:** an error while loading or showing one area now stays in that area, with "Try again", "Reload app" and technical details; the rail and the other areas keep working. A part of the app that is missing because Levuvo Mail was updated while its window was only hidden reloads the page once by itself. A crashed window process is reloaded instead of leaving an empty window. Unreadable due or reminder dates in tasks are shown as text instead of breaking the view.
- **Desktop UI test on every platform:** CI starts the real desktop app on macOS ARM64, Windows ARM64, Windows x64 and Linux and opens every area, including an area that fails and a missing part after an update.

## 2.4.0 – 19 November 2026

> **After updating:** the consent for cloud AI is asked again, because its text now lists every kind of content that is sent. Backups made with 2.4.0 cannot be restored in 2.3; to keep a way back, save a backup in 2.3 (Settings → Backup) before installing.

### Mail
- **Follow-ups:** "Show in Sent" searches the subject in the sent folder again; it used to ask the server to search the follow-up view itself and found nothing.

### Mail view split into modules (internal audit of 19 November 2026, ARC-LEV-005)
- **No visible change.** The message list (loaded messages, paging, checkboxes, filter chip) is one reducer in `mail/list-state.ts`; toolbar and column resizer are their own components. The search (query, scope, hit count, index cursor) is a reducer in `mail/search-state.ts` with the debounced requests in `useMailSearch` and the field in `SearchBar`. The reader (selection, open state, detail) is a reducer in `mail/reader-state.ts`; `useReader`/`useMarkReadOnOpen` load and mark the message, `compose-from-message.ts` builds reply, forward and draft contents. `MailInstance.tsx` shrinks from 1690 to about 1250 lines. A Playwright regression test pins list, filters, search, reader and bulk actions.

### Spaces storage (internal audit of 19 November 2026, ARC-LEV-003)
- **Spaces use the shared storage layer** of the other local files (`local-store.mjs`): one encryption format, one atomic write and one write queue. Each file stays bound to its own name, so a space file copied over another one does not open.
- **Migration:** space and index files of versions up to 2.3 are read and rewritten in the shared format on the first start, one atomic write per file and only after every file opened with the key. A start that is cut off in between leaves readable files; nothing is lost. Without a working keychain key spaces stay locked and files are not touched. Older backups are migrated the same way after a restore. Leftovers of cut-off writes are removed on start.

### AI core and search index (internal audit of 19 November 2026)
- **Semantic search on large mailboxes:** the first embedding run continues where it stopped after a restart, sleep or an Ollama outage instead of starting over; it reads texts batch by batch instead of all at once. New messages written during a long index sync are never skipped. The vector set in memory follows changes instead of being reloaded after every batch and is released after ten idle minutes.
- **Search index format:** the stored schema version is read; older files are migrated, files of a newer version (after rolling back an update) are rebuilt.
- **Ollama cloud models** with tags like `gpt-oss:120b-cloud` are refused as local models (settings, download, model list), like `:cloud` before: content would otherwise leave the device.
- **Clear AI error messages:** every error kind of the AI component (rate limit, provider overloaded, model without tools, disk full, too many steps, …) has its own text. A short Ollama outage no longer makes agent runs fail until the next restart.
- **AI component stays responsive:** status and settings no longer wait behind slow model calls; when timed-out calls would block every worker, the component restarts. Messages for an AI function load three at a time.
- **AI labels that last:** drafts, events and contacts created by agents keep a label (draft header shown in reader and composer, closing line in events and contacts).
- **Agent calendar tools** report an invalid or too long range (more than 62 days) as an error instead of "no free time".
- **Inbox bundles by AI:** messages the model skipped are not sent again on every list update; after errors the next try waits (30 s, doubling up to 30 min).
- **Maintenance:** no more import cycle between the AI routes and the MCP server (`ai-payloads.mjs`); built-in approval types use the same registry as added ones; AI background timers start only with the app's background jobs and stop on close. The AI sidecar is tested against the pinned Orkexa API and installed in CI from the hashed locks.

### Release and supply chain
- **Electron fuses:** installers switch off running Levuvo Mail as a plain Node runtime (ELECTRON_RUN_AS_NODE), NODE_OPTIONS and the --inspect debugger, load the app only from its archive and check the archive's integrity. Another program on the computer can no longer start the Levuvo binary with its own code and so read Levuvo's keychain entries. Every desktop build checks the fuses of the packaged binary.
- **Python runtime under watch:** Dependabot now also covers the hashed Python locks of the bundled AI runtime, every CI run scans them with pip-audit, and a weekly supply-chain run also checks the Electron support window and whether a newer CPython patch release exists. The first scan found a TLS root issue in the build tool uv (PYSEC-2026-4321): uv is now 0.13.7, and the bundled CPython moves from 3.13.14 to 3.13.18.
- **Reproducible AI runtime:** Tabrion, Orkexa and the sidecar are built against hash-locked build backends instead of whatever PyPI serves at build time; the backends are removed from the runtime afterwards.
- **Signed builds (prepared, no certificates yet):** macOS and Windows each receive only their own certificate (`CSC_LINK` / `WIN_CSC_LINK`); the Windows publisher name keeps its spaces (no shell), and the build stops if `app-update.yml` would carry another name, which would make installed apps reject every update. The local signed path refuses to build without the AI runtime for the target and checks architectures and fuses.
- **Tests in the real runtime:** CI also runs all tests in the Node of Electron (24.x), in which the server actually runs.
- **Integration tests against real servers, nightly:** `test/servers/` starts Dovecot/Postfix (with ManageSieve) and Radicale with a throwaway CA and two test accounts; `integration.yml` runs the integration and UI end-to-end suites every night. New real-server scenarios cover the 2.3 areas: CalDAV task sync in both directions, shared spaces between two computers over real mail, backup → restore on a new computer → restart, and an external agent on the MCP server.
- **Release gate:** `release:check` fails when CHANGELOG entries are still under "Unreleased" or the version has no CHANGELOG section of its own.

### Security and reliability (external audits of 2.3.0)
- **Cloud AI block holds for questions across all accounts:** accounts marked "No cloud AI" are left out of the search before a cloud model answers, and every account whose text is in the model input is checked again right before the call.
- **AI provider switch fails closed:** a task only runs once the AI component confirmed the current provider; if switching fails, tasks stop with a clear message instead of running on the previous provider. Installed apps only use the bundled AI runtime, never a Python found on the computer.
- **Agent approvals:** an approval runs at most once, also when it is confirmed twice at the same time. Pending approvals are stored encrypted (key in the keychain, or only in memory without one), and the mail text is removed once decided. A plain "move" by an agent can no longer reach the trash under any folder name (SPECIAL-USE, known names, subfolders); that still needs approval.
- **Task sync never deletes on incomplete lists:** a list that is longer than one sync can read, or tasks the server lists but this device cannot read, no longer count as "deleted there". Microsoft To Do and Google Tasks changes and deletions are sent with If-Match, so a change made elsewhere meanwhile is merged instead of overwritten.
- **Shared spaces:** sync mails waiting in the hidden folder are never skipped when new ones arrive at the same time; oversized sync mails are not downloaded.
- **Send later with several devices:** a device that is not the owner takes over only after it won an atomic lock on the server (a short-lived folder), so two other devices can never both send.
- **Search index:** a folder counts as indexed only after its messages are stored, so an interrupted run is continued; the index file is only rebuilt when it is really unusable (wrong key, damaged), not after a temporary error.
- **Restore:** restored private keys wait under a staging name until the restart, so cancelling leaves the keychain as it was. Safety copies in `before-restore/` are deleted after 30 days.
- **Settings files:** a damaged file is kept aside instead of being overwritten, a file that cannot be read is never replaced, and writes happen in order.
- **External images** are allowed for exactly one message (account, folder and UID), no longer for another message with the same UID.
- **Links:** links from mails to Microsoft or Google sign-in pages are confirmed like every other link; only the sign-in the app starts itself opens directly.
- **Sign-in with Microsoft or Google:** issuer, audience, expiry and a one-time nonce of the ID token are checked.
- **Encrypted mails:** decrypted content gets the same 12 MiB limit; OpenPGP decompression stops at 16 MiB.
- **AI activity log:** entries older than 30 days are removed at the start and twice a day, also when the AI is not used.
- **Accessibility:** the folder actions menu can be used with the keyboard (focus moves in, arrows/Home/End, Escape returns to the button). In CI, the accessibility test fails instead of being skipped when the browser does not start.
- **Crash reports:** the settings and the privacy notice now say that a memory dump may contain parts of open mails.
- **Long mailboxes:** the message list only renders the rows near the visible area, so it stays fast with tens of thousands of loaded messages. Arrow keys, Home/End and Page Up/Down move between rows, screen readers announce the position (“9,999 of 20,000”), and `j`/`k` keep the selected message visible.
- **Releases:** a draft release is only built from a commit on `master` (also manual and signed runs) whose CI and CodeQL runs passed for exactly this commit. `VALIDATION-REPORT.md` now covers 2.3.0.

### Security, privacy and accessibility (internal audit, 19 November 2026)
- **Calendar series and invitations:** monthly and yearly rules from other apps (2nd Tuesday, day 15, last weekday) are kept when a series is edited; the end date of a series is no longer lost. A cancellation is only accepted from the organizer and for the current version, and a cancelled or declined single date removes only that date. Accepting an invitation in Microsoft 365 no longer sends invitations to the other attendees and keeps the time zone and the repetition.
- **Tasks:** connected lists stay connected after a restart; a repeating task at a fixed time keeps its local time across daylight saving changes.
- **Agent approvals show everything:** sending account, every recipient, the full text, attendees, place and description; deleting shows the subject and sender of the mail. Removing an agent or lowering its level withdraws its pending approvals. Accounts marked "No cloud AI" are hidden from external agents; sorting into bundles in the background uses only the local model. The phishing check passes text from the sender to the model only as untrusted data.
- **Send later:** a mail whose account settings are missing is not lost; a mail that cannot be read is marked as failed instead of being retried forever; the Date header is the sending time; a draft is only reported as saved once the previous version is removed.
- **Reliability:** network calls to Microsoft, Google, CalDAV and the sign-in have timeouts; the AI component restarts cleanly after a crash; space changes are only removed from the outbox once they were sent; leftover search indexes of removed accounts are deleted after a restore; snooze/follow-up data and sender screening decisions are stored encrypted.
- **Privacy:** replying to or forwarding a mail no longer loads its external images; CSS background images can no longer report the opening once external images are loaded. The consent text for cloud AI now lists every kind of content that is sent (style samples, search hits, what routines read); the consent has to be given again.
- **Accessibility (WCAG 2.2 AA):** tasks keep their views and "Neue Aufgabe" on tablets and phones; file uploads in spaces work with the keyboard; space tabs use arrow keys; a visible focus ring on all fields; status colours with enough contrast in both themes; larger targets for folder actions and closing notices; a confirmation that deletes starts on "Cancel"; task and event dialogs ask before discarding typed input; the assistant's answers are announced to screen readers; a text rewritten by the assistant stays marked with "Undo"; dates in approvals and spaces are shown in the app language.
- **Shared spaces sync:** the inbox is no longer scanned and downloaded again every minute; mails with the space header that are no usable sync mail are read once, sync mails that could not be saved are retried with growing pauses. Sync mails another device of the same person moves at the same time are no longer skipped. A sync run no longer brings back an invitation that was accepted or declined meanwhile. Sync mails from a newer Levuvo version are kept until an update instead of being dropped, and the spaces view says an update is needed; changes this version cannot apply no longer cause an endless exchange of sync mails.
- **Deleting in shared spaces really deletes:** a deleted mail, comment, task, event, note or file disappears from every member's copy with the owner's next checkpoint (usually within a minute), its file parts are removed from the disk, and it is never sent to people who join later; they get the current state instead of the whole history. The operation log of a space no longer grows forever: it is cut at each checkpoint, and members who fell behind catch up from it. Changes made within 20 seconds travel as one sync mail per member instead of one mail per change.
- **Shared spaces, safer clicks:** deleting a task, event or comment and removing a mail from a space now ask first, like notes and files. Allowing cloud AI and external agents for a space asks for confirmation, names the providers and that it applies to all members; the activity says "allowed cloud AI" and the space header shows it. A damaged or deleted file is reported as such instead of "being fetched", and a download is no longer decrypted twice. Agent tools for spaces check dates before asking for approval and say which format they need.

## 2.3.0 – 19 November 2026

> **Before using Microsoft To Do or Google Tasks:** these need their own OAuth permissions. Add `Tasks.ReadWrite` to the Azure app registration and enable the Google Tasks API with the scope `https://www.googleapis.com/auth/tasks` in Google Cloud, see `docs/OAUTH-SETUP.md`. Until then, mail, calendar and contacts keep working and only the task sync for these accounts is unavailable.

### New
- **Shared spaces:** a space collects everything about one topic, project or customer: notes several people edit at the same time (with checklists), pinned mails with internal comments, tasks and events with assignees, files with versions and an activity list. Members are invited by e-mail address and have the role owner, editor or reader. There is no Levuvo server: every member keeps an encrypted copy, and changes travel end-to-end encrypted (Ed25519/X25519, AES-256-GCM) as mails between the members' existing mailboxes, across providers. Removing a member rotates the space key. The assistant and agents see a space only if its owner allows it, and every change they propose waits for approval. Spaces are part of the encrypted backup. See `docs/SPACES.md`.
- **Microsoft To Do and Google Tasks:** lists of Microsoft 365 / Outlook.com and Google accounts signed in with the provider can be connected the same way. Microsoft To Do keeps title, note, due day, reminder, priority (low, normal, high), repetition and done; Google Tasks keeps title, note, due day and done, while reminder, priority, repetition and a time of day stay on this device and are never overwritten from there. Accounts signed in before get a one-time "Allow" button for tasks; calendar and contacts keep working without it.
- **Task lists in sync (CalDAV):** a list of a CalDAV account (Nextcloud, mailbox.org, iCloud, Radicale …) can be connected under Tasks → Lists. Its tasks appear in Levuvo, and tasks created or moved there are synced both ways: title, note, due date (with or without time), reminder, priority, repetition and done. Changes on both sides are merged per field; when the same field was changed on both, the newer change wins and the sync says so. A task deleted on one side and changed on the other is kept. Finishing a repeating task moves it to its next date on every device. Properties written by other apps stay untouched. Sync runs shortly after each change, every ten minutes and on "Sync now". The list on this device stays the default; the link to the mail is never sent.
- **Design foundation:** one shared scale for spacing, type, weights, radii, layers and elevation; type sizes are now in rem, so the system font size setting is respected. Shared, accessible building blocks (button, icon button, field, segmented control, dialog, toolbar with overflow menu) for all new screens, documented in `docs/design-system.md`. `npm test` rejects raw sizes, layers, radii and colours in the stylesheets.
- **Phones and tablets:** bottom navigation instead of the side rail, a floating compose button, the reading pane full screen with its actions in a bottom bar, the composer full screen, contacts as list → detail with a back button, the calendar starting with the day view and a new-event button (also on tablets). Filter chips stay available, settings tabs scroll in one row and settings rows wrap instead of cutting off labels. Safe areas (notch, home indicator) are respected; touch screens get 44px controls.
- **Install metadata:** web app manifest and icons; the title bar colour follows the light/dark theme.
- **Accessibility:** WCAG 2.2 AA checked with axe-core on every main view (dark/light, desktop/phone) in CI (`npm run test:a11y`), together with keyboard checks. One main landmark per view, headings in order, 24px target sizes, labelled settings fields, unread count read out on the mail button, labelled mini month and time grid. "Increase contrast" strengthens borders and secondary text, Windows high contrast keeps selected states, switches and badges visible. No horizontal scrolling down to 320px width (400 % zoom).
- **Keyboard:** every dialog (composer, confirmations, event editor, shortcuts, attachment preview, command palette) keeps focus inside while open and returns it to the button that opened it. Segmented controls (design, language, calendar view, format) work with the arrow keys and are a single tab stop.
- **Contact card in the reading pane:** a click on the sender shows the address book entry (organization, phone), the latest mails with this person, shared appointments from the connected calendars (next and past) and the files exchanged with them (same source as the attachment overview). Read from the encrypted local search index (or the inbox when the index is off); nothing is looked up online.
- **Templates:** a template can have a shortcut such as `;mfg`. Typing the shortcut followed by space or Tab in the composer inserts the template in place, placeholders filled in. Shortcuts are shown in the template menu and must be unique.
- **Attachment overview:** a new “Attachments” entry in the sidebar (also in the command palette) lists every file of a folder, newest first, with sender, subject, size and date. Filter by file name, sender or subject, or type an e-mail address to see only the files exchanged with that contact. Files can be downloaded directly (with the usual warning for dangerous file types) or the message opened. Only the message structure is read, not the bodies, and nothing is marked as read.
- **Tasks:** a new "Tasks" module next to Mail, Calendar and Contacts (Alt+5) with the views Today, Upcoming, Overdue, All open and Done, quick add, priority, notes, reminders with desktop notifications, repetition (daily to yearly) and an option to archive the linked mail when a task is done. "Create task" in the reading pane turns a mail into a task with a link back to it; open tasks for a mail show as a hint in the reader, and tasks with a due date appear in the calendar. Tasks are stored encrypted on this computer only (tasks-local.json).
- **Appointments detected in mails:** flights, train and bus trips, hotel stays, rental cars, table reservations and event tickets (schema.org data in booking mails), plain .ics files and dates with a time in the text ("am 12.12. um 14:30", "on December 4 at 2 pm") are shown above the message and go into a calendar with one click. Detection runs locally; quoted replies and past dates are ignored, invitations keep their own card.
- **Sender screening (optional):** with Settings → Reading → “Review new senders first”, mail from people who are not in your contacts, whom you have never written to and who never wrote to you before waits under “New senders” at the top of the inbox. Accept shows their mail in the inbox from then on; Block moves it, and everything that sender sends later, to the spam folder. Newsletters, invoices and notifications are bundled instead of screened. Only mail arriving after switching it on is screened, and if the mailbox history cannot be read, nothing is held back.
- **Inbox bundles:** newsletters, invoices and notifications are collected in three rows at the top of the inbox instead of between personal mail. Opening a bundle shows its messages with “Mark all read”; the newsletter bundle lists its senders with an unsubscribe button each (and offers to delete that sender's messages afterwards). Sorting uses only a few list headers (List-Unsubscribe, List-Id, Precedence, Auto-Submitted), the subject and attachment names, locally. Can be turned off in Settings → Reading.
- **Phishing hints:** the reading pane now also warns about look-alike sender domains (“paypa1.com”, Cyrillic letters, a typo of your own domain such as “levuv0.at”), display names that pose as a brand while the address is from somewhere else, links to look-alike domains, links that hide the real host behind a user name (“https://paypal.com@evil.example”), password forms inside the message and attached web pages (.html, .svg). All checks run locally.
- **Backup and restore, moving to a new computer:** Settings → Backup saves everything that exists only on this device (settings, accounts without passwords, local calendar with attachments, local contacts, templates, snooze/follow-up entries, own PGP/S/MIME keys, shared spaces with their keys, assistant data) into one file encrypted with a password (scrypt + AES-256-GCM). Restoring is also offered on the welcome screen of a new computer. The backup is checked first and applied at the next start, before anything is loaded; the previous data is kept as a safety copy. Passwords, sign-ins and API keys are never part of a backup; a restored mailbox under an ID that pointed to another mailbox never receives the old password.
- **Levuvo Mail Assistant (foundation):** optional AI features, off by default, under Settings → AI & agents. By default a local model (Ollama on this computer) does the work and no content leaves the device; Anthropic or OpenAI can be chosen after a recorded consent, never for accounts marked "No cloud AI". API keys are stored only in the keychain. An AI log records what the AI did (no message content, 30 days), and "Delete all AI data" removes settings, consents, keys and the log at once. The AI component is a separate process based on Orkexa with a minimal environment; mail content always reaches the model marked as untrusted data.
- **Levuvo Mail Assistant in the reading pane and composer:** summarize a message (who wants what by when, deadlines, amounts, open questions), translate it, find events, tasks and contacts from signatures and add them with one click, and check whether a message is genuine (pressure, payment requests, changed bank details, impersonation). In the composer the assistant suggests replies in your own style, turns bullet points into an email, rewrites drafts (shorter, more polite, more formal, English, German, spelling) and checks before sending for a forgotten attachment, a harsh tone, a wrong recipient or sensitive data. A writing style (tone, form of address, closing line, own instructions) can be set under Settings → AI & agents; the safety rules cannot be changed. Results are marked as AI-generated and in the reading pane and composer nothing is saved or sent without a click.
- **Local models:** qwen3.5:9b is the recommended model (qwen3.5:4b for 8 GB RAM, qwen3.5:27b or mistral-small3.2 for 32 GB), Qwen3-Embedding 0.6B (or bge-m3) for search; all Apache 2.0 or MIT. `python -m levuvo_ai.evals --model …` checks a model with synthetic prompt-injection emails before you use it.
- **MCP server for agents:** Levuvo Mail can offer its mailbox, calendar and contacts to AI agents (Claude Desktop, Claude Code and others) through the Model Context Protocol, only on this computer (127.0.0.1) and with a token per agent. Each agent gets a permission level (read, drafts, organize, everything incl. sending). Sending, events with attendees and moving to the trash wait for your approval; at the organize level an agent can move, archive, mark and snooze mails and create events without attendees and contacts without asking; permanent deletion, accounts, passwords, keys and AI settings are never available. Mail content reaches agents marked as untrusted data, and every call is logged locally. Agents can also read the task list, propose tasks (saved after your approval) and, at the organize level, create and complete them; deleting tasks is not available.
- **Assistant panel (Ctrl/⌘+J):** ask your mailbox in your own words and get the answer with the source emails, give the assistant a task ("arrange a meeting with Anna next week"), start routines (daily briefing, waiting for your reply, newsletter clean-up, meeting preparation, arranging a meeting, reply drafts) or your own, and approve what agents prepared. Routines only read or prepare drafts and proposals. With a cloud model, accounts marked "No cloud AI" are invisible to them.
- **Semantic search:** messages are found by meaning, using vectors computed locally from the encrypted search index.
- **Documents for organizations:** templates for an internal usage policy, the record of processing activities (Art. 30 GDPR), a security concept and a short AI guide for users in `docs/ai`.
- **Installers:** the desktop installers include their own Python runtime for the AI component (hash-locked, no separate installation needed).
- **Reading pane:** tracking pixels (invisible 1×1 images and images from known open-tracking services) are removed from HTML mail, even after "Load images". The reading pane shows how many were blocked, e.g. "3 trackers blocked", with the tracker hosts on hover.
- **Contacts on this device:** contacts can be created, edited, deleted, imported and exported without connecting a CardDAV, Microsoft 365 or Google address book. They are stored as vCards, encrypted with AES-256-GCM; the key lives in the system keychain. Without the keychain (or with a different key) the address book stays locked instead of being replaced by an empty one. Addresses from it are suggested when writing and count as known senders.
- **Attachments in events:** files can be attached to events, shown, previewed (images, PDF, text), downloaded and removed in the event editor (button or drag & drop). In the device calendar and CalDAV calendars the files are stored in the event itself (iCalendar `ATTACH`, up to 5 MB per file and 10 MB per event), so they also appear in other apps and in `.ics` exports; links attached by other apps open in the browser. Microsoft 365 stores them as event attachments (up to 3 MB per file). Google Calendar shows its Google Drive attachments, which can be opened and removed; new files are attached there via Google Drive. Invitations carry the files as normal e-mail attachments, and moving an event to another calendar takes them along.

### Performance (large mailboxes, AUD-011)
- **Folder pages:** loading older messages no longer asks the server for every UID below the current position (about 50,000 UIDs per page on a 100k folder). A UID window just below the cursor is searched instead, sized from the folder's UID density and widened only when needed: about 50 UIDs per page, independent of folder size.
- **Folder search:** further result pages only search the part of the folder below the last hit.
- **Search index:** a folder whose message count and UIDNEXT did not change is not listed again on each background run (read/unread changes are still picked up). "Search everywhere" loads its results in pages of 40 with the exact hit count instead of a fixed top 100, sorted newest first without sorting every hit.
- **Search index for other features:** `entries()` and `removedKeys()` report new and removed index entries incrementally (stable keys, a generation ID that changes on rebuild), so features built on the index do not copy it.
- **Benchmark:** `npm run bench:mailbox` measures paging, IMAP search and the index on 100,000 synthetic messages and fails when an upper bound is exceeded; it runs in CI.
- **Search index as encrypted SQLite:** the index is now one SQLite database per account, encrypted as a whole with SQLCipher (AES-256, HMAC-SHA512; key in the system keychain as before). Only changes are written, so the limit rises from 25,000 to 250,000 messages per account; a search over 100,000 messages takes about 25–110 ms. Full-text search uses FTS5: word beginnings everywhere, plus substrings in subject, sender and recipients. The old index file is migrated on first start and then deleted.
- **Vectors for the AI assistant:** embeddings are stored in the same encrypted file (int8, 1 byte per dimension) and searched exactly by cosine similarity (about 25 ms for 20,000 vectors with 1024 dimensions). Removing a message, clearing the index or changing the mailbox of an account removes them too.

### Fixes
- **Tasks, accessibility:** the task dialog keeps keyboard focus inside while it is open and returns it on close, is announced as a dialog, and the rail badge reads "n due today" to screen readers.
- **Mail list:** the quick actions shown on hover no longer cover subject and preview.
- **Phones:** the message list scrolls again and its last rows are no longer hidden behind the navigation.
- **Contacts:** the search field no longer takes up half of the contact list; address and phone types are shown in the UI language, and e-mail types written as `INTERNET,WORK` are read as "work".
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
