# Levuvo Mail 2.2.0 – validation report

Created on 13 November 2026 during packaging (Linux build environment, Node.js 22.23, Electron 45.3.1).

## Executed and passed

| Check | Result |
|---|---|
| `npm ci` from `package-lock.json` (freshly unpacked kit) | exact versions, reproducible |
| `npm audit --omit=dev` (everything that runs in the app) | **0 vulnerabilities** |
| `check:syntax` · `lint` · `format:check` · `typecheck` · `build` | no findings |
| `npm test` | **201 of 201 passed** (server, UI logic, desktop, translation completeness) – new, among others: Microsoft Graph and Google mapping (events, series, reminders, contacts, error cases), separate Graph tokens, undo via COPYUID, snooze/follow-up, templates, List-Unsubscribe incl. blocking of internal addresses, drag & drop time calculation, command palette |
| `check:i18n` | every UI and server message has an English translation (≈ 1,090 texts), identical placeholders |
| **Integration test against real servers** (`npm run test:integration`, 15 scenarios) | passed – Dovecot (IMAP 993/TLS, IDLE, ManageSieve, UIDPLUS), SMTP 465/TLS, Radicale (CalDAV/CardDAV), local OAuth test provider with a **Microsoft Graph test server** (calendars, create/read/delete an event, contacts, renewed consent for the same mailbox), GnuPG and OpenSSL; new: **password-protected message** (no plain text in mail and attachment, wrong password, lockout after failed attempts, copy in “Sent”), **“On this device” calendar (reminder, export, moving to CalDAV, import)**, **conversation across inbox and Sent, undo with a new UID, snooze and bring back (unread), follow-up (a reply ends it, without a reply it becomes due), templates** |
| **End-to-end UI test** (Chromium, `npm run test:e2e`, 16 flows, 0 JavaScript errors) | all flows from 2.0 plus new: expanding a **conversation** · **quick action “Trash” with undo** · **snooze** and “Bring back now” · **save and insert a template** · **follow-up** when sending → “Follow-up” list · **command palette** (folders, calendar with month view, inbox) · **newsletter unsubscribe** (unsubscribe email arrives at the sender) · **device calendar without an account** with **drag & drop in the week view** · **protected message**: send, unlock in the app and open the attached file in a normal browser |
| **Electron app, also packaged** (`electron-builder --linux dir` from a freshly unpacked kit, app archive 26 MB; under Xvfb with a Secret Service keychain) | starts, version 2.2.0, account via keychain, command palette, “Follow-up”, calendar; template and follow-up interfaces reachable; no JavaScript errors |

### Bugs found and fixed during testing (excerpt)

- **2.1.1:** Drag & drop in the week/day view and for all-day events did not move anything (the drop target read the dragged event after it had already been reset) → fixed, a new end-to-end test drags an event to another day.

- Follow-up and template interfaces required an account with multiple accounts → now account-independent.
- Errors from calendar/contact services (Microsoft/Google) were reported as IMAP errors → own, understandable messages.
- Command palette: quickly reopening right after closing kept the old search text; the first keystrokes could land in the list as shortcuts → focus and reset immediately on opening, shortcuts are paused while the palette is open.
- Menus in the reader toolbar took on the look of the toolbar buttons → consistent menus.
- The reader toolbar wrapped in narrow windows or cut off “Forward” → labels become icons (container queries).
- Setup: long provider names were truncated → tiles in a 3-column grid.

## Licenses

`THIRD-PARTY-NOTICES.txt` (generated with `npm run notices` and packaged into the app): 153 packages,
mostly MIT/BSD/ISC/Apache-2.0. **OpenPGP.js is licensed under LGPL-3.0**: the library is shipped unmodified
and replaceable (its own module in the app archive); the license text is included. Please take this into
account in the legal review.

## Known and deliberately open

- `npm audit` incl. build tools: 15 “moderate” findings in `electron-builder` dependencies; relevant only when building, not in the app.
- **OAuth (Microsoft/Google):** technically complete and tested against a test provider. Real accounts need client IDs from Levuvo (`docs/OAUTH-SETUP.md`); Google requires verification/a security assessment for the Gmail scope.
- **Calendar & contacts from Microsoft 365 / Google:** tested against a simulated Graph server (integration test) or simulated Google responses (unit tests) – **not yet against real Microsoft/Google accounts**, because the client IDs are missing. Accept only after entering the IDs (`RELEASE-CHECKLIST.md`). With Microsoft, series are changed as a whole series or as a single occurrence; Levuvo shows exception details (e.g. individually moved occurrences) as Microsoft/Google deliver them.
- **Snooze and follow-up** need a running app (background is enough); times are stored locally, the snoozed message is kept safely in the server folder “Zurückgestellt” (the folder name is created in German).
- **Newsletter unsubscribe:** one-click only to public https addresses; name resolution to internal addresses (DNS rebinding) is not additionally checked.
- **Crash reports:** consent and technology are in place; without `levuvo.crashReportUrl` they stay off.
- **Legal notice/privacy:** templates with placeholders (`docs/IMPRESSUM.md`, `PRIVACY.md`), legal review required.
- S/MIME: currently RSA certificates (ECDSA is rejected on import); please export .p12 files in the legacy format (RC2) with AES instead.
- Scheduled messages are sent as long as Levuvo Mail is running (also in the background); otherwise at the next start.
- IMAP only via 993/TLS (no STARTTLS on 143) – a deliberate security decision.

- **Device calendar:** no synchronization with other devices (deliberate). If the keychain is locked, the device calendar is missing until it is unlocked (nothing is overwritten).

- **Protected messages:** no expiry date, no recall (that would need a server). Mobile mail previews without scripts (e.g. iPhone Mail) only show the password page – open the file in Safari/Chrome. Strict corporate filters may hold back .html attachments; test with Gmail, Outlook.com and a company mailbox before the release.

## Still to be confirmed on the target systems

- Native builds (DMG, both EXEs), installation, keychain/Credential Manager (`desktop:win:check:vault`).
- System notifications (new mail, event reminder), tray, autostart, link confirmation, printing in the native window.
- Interplay with real counterparts: Outlook/Exchange (invitations, S/MIME), Gmail, Apple Mail, Thunderbird (OpenPGP), Nextcloud.
- Signing, notarization and a real update run (certificates and update URL, see `RELEASE-KIT.md`).

Checklist: `RELEASE-CHECKLIST.md`. The kit contains **no fake installers**.
