# Levuvo Mail 2.5.0 – acceptance per platform

Tick off on **macOS arm64, Windows arm64 and Windows x64** each. Everything that can be tested without
the native operating system has already been checked automatically (see `VALIDATION-REPORT.md`).

UI labels are given in English with the German label in parentheses where useful; check both languages.

## Technical
- [ ] `npm ci` without errors
- [ ] `npm run release:check` green (audit, syntax, lint, format, tests, typecheck, build, license notices)
- [ ] Optionally with test servers: `npm run test:integration` and `npm run test:e2e`
- [ ] Installer starts; no Gatekeeper/SmartScreen warning for signed builds
- [ ] The installed app contains the AI runtime (`resources/ai-runtime/python`); Settings → AI & agents shows the AI component as available
- [ ] Settings → About shows 2.5.0, legal notice (Impressum) filled in

## User manual
- [ ] `docs/manual` (German and English) covers every new or changed feature of this release; labels match the app
- [ ] Screenshots re-captured with this version; PDFs (`Levuvo-Mail-Handbuch-X.Y.Z.pdf`, `Levuvo-Mail-Manual-X.Y.Z.pdf`) show this version and date
- [ ] Every page looked at: layout, screenshots beside their text, no split tables, no near-empty pages
- [ ] `npm run manual:features` is clean (feature registry, menu paths, screenshots, CHANGELOG manual references)
- [ ] Independent first-time-user review per `docs/manual/REVIEW.md` done, all **must** findings fixed
- [ ] Settings → Help shows the manual; the assistant answers a "how do I …" question with a manual source

## First setup (fresh user profile)
- [ ] Welcome page in the system language (German or English), theme follows the system
- [ ] Wrong password → clear message, nothing saved; “Test connection” green
- [ ] If OAuth is enabled: “Sign in with Microsoft” / “Sign in with Google” → browser → account connected
- [ ] After a restart the account is there, password/token only in the keychain

## Upgrade from 2.0 (and 1.2)
- [ ] Existing accounts without entering the password again, status “Live”
- [ ] Microsoft/Google account from 2.0: calendar shows “Allow access” (Freigeben) → browser → calendars and contacts appear, email keeps working unchanged

## Email
- [ ] New mail with formatting, image and attachment → correct at the recipient (Outlook, Gmail web, Apple Mail)
- [ ] Signature with logo, switching the sender address swaps the signature
- [ ] Undo send; send later (leave the app in the background) → arrives on time
- [ ] Reply / reply all / forward, draft saved automatically
- [ ] Create/rename/delete folders, drag & drop, star, filters, spam, bulk actions
- [ ] Print/PDF, save .eml, attachment preview (image, **PDF in the native window**, text)
- [ ] Phishing test mail (fake link) → red warning; .exe attachment → confirmation prompt
- [ ] Search in the folder and “Everywhere”; disconnect the network → offline notice, “Everywhere” search works
- [ ] New mail with the window closed → system notification, click opens the account
- [ ] Conversation shows your own reply from “Sent”; undo after delete/archive/move
- [ ] Snooze (leave the app in the background) → message comes back unread on time
- [ ] Follow-up after 1 day without a reply → entry under “Follow-up” + system notification; with a reply → disappears
- [ ] Save a template, insert it with placeholders; command palette (Ctrl/⌘ + K) on all platforms
- [ ] Newsletter with one-click unsubscribe (e.g. a real newsletter) → “Unsubscribed”

## Filters & vacation reply
- [ ] Save a rule and a vacation reply (provider with ManageSieve) → test mail is moved or answered

## Calendar & contacts
- [ ] Connect CalDAV/CardDAV (e.g. Nextcloud)
- [ ] **Microsoft 365** (real account, after entering the client ID): calendars, create/move/delete an event, answer an invitation, create contacts
- [ ] **Google** (real account, Calendar and People API enabled in the project): the same
- [ ] Move an event via drag & drop (week, day, month, all-day), undo
- [ ] Without a calendar account: event “On this device” with a reminder → system notification; export .ics and open it in Apple Calendar/Outlook; move the event to a connected calendar
- [ ] Change and delete an event, a recurring event, “Only this event”/“All events in the series”, time zone across DST
- [ ] Reminder appears as a system notification (also with the window closed), click opens the calendar
- [ ] Invitation to an Outlook/Gmail address → accept there → apply the status in Levuvo
- [ ] Receive an invitation from Outlook/Google → accept → event in the calendar, organizer receives the reply
- [ ] Create contacts, vCard import from Outlook/Apple, export, “Write email”

## Tasks
- [ ] Create a task from a mail, with due time, reminder (system notification) and repetition; complete it → next date at the same local time, also across a DST change
- [ ] Connect a list (CalDAV, Microsoft To Do, Google Tasks) → tasks appear on both sides; restart → still connected; change and complete on both sides
- [ ] At 900px and on a phone: views, lists and “New task” (Neue Aufgabe) are reachable

## Shared spaces
- [ ] Create a space, invite a second account (another provider), accept with the safety code
- [ ] Note edited by both at the same time, task with assignee, event, pinned mail with comment, file upload (also by keyboard) with a second version
- [ ] Remove the member → they keep old content, cannot read new content; dissolve the space

## Backup and moving to a new device
- [ ] Create a backup with a password, restore it in a fresh profile → accounts (password asked again), local calendar, contacts, tasks, templates, spaces, AI settings are back
- [ ] Cancel a restore before the restart → nothing changed

## AI and agents
- [ ] Local model (Ollama): summary, reply suggestion, rewrite (marked “Changed by the assistant” with Undo), question to the mailbox, routine
- [ ] Cloud model: consent dialog lists style samples, search hits and what routines read; an account marked “No cloud AI” is never used
- [ ] MCP: connect Claude Desktop with a token; a send approval shows sender account, all recipients and the full text; removing the agent withdraws its approvals

## Accessibility and mobile
- [ ] Keyboard only: mail, composer, calendar, tasks, spaces (tabs with arrow keys), settings; focus always visible
- [ ] Screen reader (VoiceOver / Narrator): assistant answers are announced; a delete confirmation starts on “Cancel”
- [ ] Phone width (390px): mail, calendar, tasks, spaces usable, no horizontal scrolling at 320px

## Encryption
- [ ] Password-protected message to Gmail, Outlook.com and a company mailbox → file arrives, opens in Chrome/Edge/Safari (desktop) and Safari/Chrome (phone, “Open in Safari”); a wrong password is rejected
- [ ] OpenPGP with Thunderbird: exchange keys, encrypted + signed in both directions
- [ ] S/MIME with Outlook: import .p12, signed + encrypted in both directions

## Display
- [ ] Light and dark, German and English: no truncated texts
- [ ] 1440×900, 1280×800, minimum size 900×600

## Release
- [ ] `release:manifest` and `release:verify` successful
- [ ] Signed builds: update files uploaded, test update 2.5.0 → 2.5.1 run through once
- [ ] Privacy notice reviewed legally, legal notice (Impressum) filled in

## Compliance (every release)
Required for every release, like the manual review. Not legal advice; see `docs/compliance/README.md`.
- [ ] `docs/compliance/` reviewed and updated for this version: gap analyses (CRA, AI Act, GDPR, accessibility, other rules), AI system inventory, risk assessment, record of processing, user information; "Last reviewed" date set
- [ ] Every new feature of this release that processes personal data, uses AI, opens a connection or stores a file is reflected in `PRIVACY.md`, the AI inventory and the data-rights coverage (export / delete all)
- [ ] `npm run check:compliance` green (support period, required documents); end of support in `package.json` → `levuvo.supportUntil` still correct
- [ ] Release assets contain the SBOM (`levuvo-mail-<version>.cdx.json`) and `THIRD-PARTY-NOTICES.txt`; `npm run check:licenses` green, no new licence outside the policy
- [ ] No open security advisory with a missed deadline; fixed vulnerabilities listed under "Security" in `CHANGELOG.md` and published as advisories
- [ ] Settings → About → "Security and support" shows the right version and end of support; "Open-source licences" opens the notices
- [ ] Settings → Privacy: "Export my data" and "Delete all data on this device" tested in a fresh profile; "Install updates automatically" off → only a notification
- [ ] AI: a mail written with the assistant has the header `X-Levuvo-AI-Assisted` at the recipient
- [ ] `docs/compliance/OPEN-ITEMS.md` reviewed with Peter (certificates, support period, DOC-LEV-009, legal review)
