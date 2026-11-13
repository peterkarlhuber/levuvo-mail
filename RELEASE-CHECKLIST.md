# Levuvo Mail 2.2.2 – acceptance per platform

Tick off on **macOS arm64, Windows arm64 and Windows x64** each. Everything that can be tested without
the native operating system has already been checked automatically (see `VALIDATION-REPORT.md`).

UI labels are given in English with the German label in parentheses where useful; check both languages.

## Technical
- [ ] `npm ci` without errors
- [ ] `npm run release:check` green (audit, syntax, lint, format, tests, typecheck, build, license notices)
- [ ] Optionally with test servers: `npm run test:integration` and `npm run test:e2e`
- [ ] Installer starts; no Gatekeeper/SmartScreen warning for signed builds
- [ ] Settings → About shows 2.2.2, legal notice (Impressum) filled in

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

## Encryption
- [ ] Password-protected message to Gmail, Outlook.com and a company mailbox → file arrives, opens in Chrome/Edge/Safari (desktop) and Safari/Chrome (phone, “Open in Safari”); a wrong password is rejected
- [ ] OpenPGP with Thunderbird: exchange keys, encrypted + signed in both directions
- [ ] S/MIME with Outlook: import .p12, signed + encrypted in both directions

## Display
- [ ] Light and dark, German and English: no truncated texts
- [ ] 1440×900, 1280×800, minimum size 900×600

## Release
- [ ] `release:manifest` and `release:verify` successful
- [ ] Signed builds: update files uploaded, test update 2.2.2 → 2.2.3 run through once
- [ ] Privacy notice reviewed legally, legal notice (Impressum) filled in
