# Levuvo Mail 2.2 – Manual

*Less effort. More impact.*

Levuvo Mail brings email, calendar and contacts together in one app for macOS and Windows. Everything
runs on your device; Levuvo never sees your messages or credentials.

**Contents:** 1 Installation · 2 Adding an account · 3 The interface · 4 Reading · 5 Writing ·
6 Staying organized · 7 Search & offline · 8 Filters & vacation reply · 9 Calendar · 10 Contacts ·
11 Encryption · 12 Security & phishing · 13 Settings · 14 Keyboard shortcuts · 15 Troubleshooting ·
16 Privacy

---

## 1 Installation

- **macOS (Apple Silicon):** open the DMG, drag Levuvo Mail to “Applications”, start it from there.
- **Windows (ARM64/x64):** run the setup. Per-user installation, no administrator rights required.

When you close the window, Levuvo Mail keeps running in the menu bar / notification area so that
notifications, event reminders and scheduled messages keep working. Quit via the menu or the tray icon,
where you can also enable “Start automatically at login”.

Signed releases update themselves (check every six hours, installation after confirmation on restart).
Manually: menu → “Check for updates …”.

## 2 Adding an account

**Settings → Accounts → Add account** (opens automatically on first start).

1. Choose the **provider** tile (Microsoft 365, Gmail, GMX, WEB.DE, IONOS, Hetzner, Strato, easyname
   or “Other provider”). Known domains (e.g. gmx.at) select the provider automatically.
2. Enter **email address** and **password**, optionally an account name and your sender name.
3. **Set up account** – receiving (IMAP) and sending (SMTP) are verified before anything is saved. The
   password is stored in the operating system's keychain.

**Microsoft 365 / Outlook.com and Gmail:** if your build has sign-in enabled, “Sign in with Microsoft” /
“Sign in with Google” appear. Your browser opens, you sign in there and the app adds the account
automatically. Gmail also works with an **app password**. From 2.1 on, this sign-in also brings the
account's **calendars and contacts** (chapters 9 and 10).

**Server settings** (only needed for “Other provider”): IMAP server (993/TLS only), SMTP server
(587/STARTTLS or 465/TLS), separate SMTP user, folders for “Sent”/“Drafts”, filter server (Sieve, port 4190 or 2000).

When editing a saved account you can also set:
- **Signature** – formatted, with links and a small logo (up to 200 KB).
- **Additional sender addresses (aliases)** – e.g. office@ and invoices@, each with its own name and
  signature. Only add addresses your mail server allows for sending from this mailbox.

Up to five accounts. “Remove” only deletes the setup on this device, never emails on the server.

## 3 The interface

On the left, the **navigation bar**: Email, Calendar, Contacts, Help, Settings (Alt+1, Alt+2, Alt+3, Alt+,).

In Email: **folder list** – **message list** – **reading pane**. Drag the divider (or use the arrow keys
on it) to resize the list; double-click resets. The indicator at the top shows the connection: **Live**
(new mail appears instantly), **Connecting …**, **Offline** or **Disrupted**.

With several accounts, switch accounts at the bottom left; “All inboxes” shows the newest messages of all accounts.

**Command palette – Ctrl + K (Mac: ⌘ + K)** or the ⌘ icon in the navigation bar: type a few letters and
press Enter – “new email”, “search”, any folder, any account, calendar/contacts, any settings page,
light/dark theme. ↑/↓ selects, Esc closes.

**Quick actions:** hover over a message in the list to archive, delete, mark read/unread or snooze it
without opening it.

## 4 Reading

- Click a message to open it; **J/K** to browse. Optionally it is marked as read when opened.
- **Formatted messages** are shown in a protected view: no scripts, links ask for confirmation showing the
  real destination, **external images are blocked** (“Load images” per message). “Text/HTML” switches to the plain-text version.
- **Attachments:** eye icon = preview (images, PDF, text) without downloading; arrow = download.
  Dangerous file types (e.g. .exe, .js) are flagged and require confirmation.
- **More actions (…):** print / save as PDF, save as .eml.
- **Conversation:** if a message is part of an exchange, the “Conversation” box lists all related
  messages – including your replies from “Sent” and archived ones. Click to expand, “Open full message” to jump.
  The “Conversations” setting (Settings → General) groups related messages in the list.
- **Unsubscribe from newsletters:** if the sender offers it, “Newsletter or promotion from …” with
  **Unsubscribe** appears above the text. Depending on the sender, Levuvo Mail unsubscribes you directly
  (one-click), sends an unsubscribe email or opens the sender's page – always after asking.

## 5 Writing

**New message** (N), **Reply** (R), **Reply all** (A), **Forward** (F, including attachments up to 8 MiB).

- **From:** choose the sender address – the matching signature is inserted or swapped automatically.
- **To/CC/BCC:** suggestions from your address book and previous emails. BCC recipients are hidden from others.
- **Formatted / Plain text:** toolbar for bold, italic, underline, strikethrough, heading, lists, quote, code,
  link, image (up to 1 MB inline), clear formatting, undo/redo.
- **Attachments:** up to eight files, 8 MiB in total – choose or drag & drop into the window.
- **Drafts** are saved automatically; “Close as draft” keeps the current state.
- **Send** (Ctrl/⌘ + Enter): for a few seconds “Sending in … s – Undo” appears at the bottom. Undo reopens the
  message. Set the delay (off, 5–30 s) under Settings → General.
- **Send later:** arrow next to “Send” → this evening, tomorrow morning, Monday morning or a date/time.
  The message waits in “Drafts” (marked “Scheduled to send”). Levuvo Mail must be running at that time
  (the background is enough); otherwise it is sent at the next start. Opening a scheduled message with
  “Edit” cancels the schedule immediately.
- **Follow-up:** at the bottom left of the editor choose “Follow up after 1/2/3/5 days or 1 week”. If no
  reply arrives by then, the message appears under **Follow-up** in the folder list (with a counter) and you
  get a notification. A reply ends the follow-up automatically.
- **Templates:** **Templates** button above the text – insert a template or “Save current message as
  template”. Placeholders such as {Vorname}, {Name}, {Datum} and {Absender} are filled in when inserted.
  Manage them under Settings → Templates.
- **Encryption:** see chapter 11.

## 6 Staying organized

- **Star:** key S or the star in the list. Filters at the top: All · Unread · Starred · Attachment.
- **Archive** (E), **Spam / not spam** (!), **Trash** (Del), **Move** (drop-down in the reading pane).
- **Drag & drop:** drag a message (or all checked ones) onto a folder; onto “Trash” or “Spam” it is handled accordingly.
- **Bulk actions:** tick messages (or “Select all visible”) – mark read/unread, star, archive, spam, trash for up to 500 messages at once.
- **Folders:** “New folder” below the folder list. Right-click (or “…”) a folder to create a subfolder,
  rename or delete it. System folders are protected; only empty folders can be deleted.
- If there is no archive folder, Levuvo Mail creates one on request.
- **Undo:** after moving, archiving, deleting, spam or a bulk action, the message at the bottom offers **Undo**.
- **Snooze** (key B, alarm clock icon): remove a message from the inbox until later today, this evening,
  tomorrow morning, Monday, in a week or a chosen time. It waits in the server folder **Snoozed** and comes
  back **unread** at that time (Levuvo Mail must be running – background is enough). “Bring back now” returns it at once.

## 7 Search & offline

- **This folder:** the search field (key /) searches subject, sender and content on the mail server.
- **Everywhere:** the “Everywhere” switch searches all folders and accounts using the **local, encrypted
  search index** – even without internet. The index is built in the background (Settings → Search & offline:
  status, “Update now”, “Rebuild”, turn off).
- **Offline:** without a connection the app shows recently loaded lists and messages, or the text from the
  index. Moving and sending are possible again once you are online.

## 8 Filters & vacation reply

**Settings → Filters & vacation** (per account). Rules run **on your mail server** (Sieve) and therefore also
work when Levuvo Mail is closed. Requirement: your provider offers ManageSieve (for Microsoft and Google
sign-in, set up rules in the provider's webmail instead).

- **Vacation reply:** enable, optional from/until date, subject, text, “at most every … days” per sender.
- **Rules:** “If all/any of the conditions match” (From, To/CC, Subject, Headers – contains, is exactly,
  does not contain) → actions (move to folder, mark as read, star, trash). Order with the arrows;
  “do not apply further rules afterwards” is available.
- **Save on the server.** If another filter script is already active (e.g. from webmail), Levuvo Mail asks
  before replacing it; the old script stays stored on the server.

## 9 Calendar

**Microsoft 365 and Google:** accounts signed in with Microsoft/Google bring their calendars automatically.
Accounts from version 2.0 show **“Connect calendar & contacts – Allow access”** once; after allowing it in
the browser the calendars appear. Invitations and cancellations are then sent by the provider.

**Without an account – “On this device”:** the calendar works right away. Events, blockers and reminders
go to “Personal · On this device” (stored encrypted, reminders as system notifications). They do not appear
on your phone or other devices. Settings → Calendar & contacts lets you add more device calendars, change
colors, **export as .ics** (backup) and **import .ics** (e.g. from another calendar app).

**Other providers:** **Settings → Calendar & contacts → Connect calendar/contacts** (CalDAV/CardDAV).
Presets for Nextcloud, mailbox.org, iCloud, Fastmail and Posteo; the password (preferably an app password)
is stored in the keychain.

- **Views:** day, week, month, agenda; “Today”, arrows to browse. Clicking a day opens the day view.
- **Month overview** on the left jumps to any day; days with events have a dot.
- **Drag & drop:** drag an event to another time or day (15-minute steps in week/day view, whole days in
  month view). With attendees, Levuvo Mail asks whether to notify them; “Undo” reverts the move.
- **Move to another calendar:** open the event and choose another calendar under “Calendar”.
- **New event:** button, click into a free time slot (week/day) or double-click (month). Title, calendar,
  all day, start/end, location, description, reminder.
- **Repeat:** daily, weekly (choose weekdays), monthly, yearly; interval; ends never, after a number of
  times or on a date. When changing/deleting a recurring event: “Only this event” or “All events in the series”.
- **Reminders** appear as system notifications, even with the window closed.
- **Invitations:** add participants by email address and “Send invitation by email” – they receive a
  standard invitation (iCalendar) that Outlook, Apple Calendar and Google understand. Updates and
  cancellations are sent as well.
- **Receiving an invitation:** an invitation card appears in the email – choose a calendar and
  **Accept / Maybe / Decline**. The organizer receives your reply, the event is added to your calendar.
  Replies to your own invitations are applied with “Apply to calendar” (participation status),
  cancellations with “Remove from calendar”.
- On the left: show/hide calendars; colors and new calendars under “Manage calendars”.

## 10 Contacts

- Search, **New contact** (name, company, job title, several email addresses and phone numbers, address,
  birthday, note), edit, delete.
- **Write email** opens a new message to the contact.
- **Import** a .vcf file (e.g. exported from Outlook, Apple Contacts, Google) and **export** all contacts.

## 11 Encryption

**Protect with password – for any recipient, no setup**

1. When writing, choose **“Protect with password”** next to “Formatted/Plain text”.
2. Levuvo Mail suggests a strong password (edit, copy or regenerate; at least 10 characters). An optional
   **hint** is readable by anyone and must not contain the password.
3. Send. Text and attachments (up to 5 MiB) are encrypted with the password (AES-256-GCM, PBKDF2-SHA256).
   Only sender, recipients and the **subject** stay visible.
4. Share the password on **another channel** – SMS, phone or messenger.

The recipient gets an email with “Geschuetzte-Nachricht.html”, opens it in a current browser and enters the
password; decryption happens only in their browser. Levuvo Mail users enter the password right in the message,
and your own copy in “Sent” opens with the same password. Limits: no expiry or recall; phone mail previews
(e.g. iPhone Mail) do not run scripts – open the file in Safari or Chrome; strict company filters may hold
back .html attachments.

**Settings → Security** (OpenPGP and S/MIME).

**OpenPGP** (compatible with Thunderbird, GnuPG, Proton and others)
1. **Create key** for one of your addresses and set a passphrase (min. 8 characters). Keep the passphrase
   safe – without it encrypted messages can no longer be read.
2. **Export your public key** and send it to your contacts.
3. **Import** your contacts' keys (.asc) or directly from an email with “Import key”. Compare the
   fingerprint through another channel first.
4. To read or sign, **unlock** your key (stays unlocked for 30 minutes).

**S/MIME** (standard in Outlook/Apple Mail)
1. Import your certificate from a certificate authority as a **.p12/.pfx** file (with its password).
   Older “legacy” files (RC2) must be re-exported with AES.
2. Contacts' certificates are taken over automatically from signed emails or imported manually.
3. Optionally add your own root certificates (“Trust certificate authority”) for a company PKI.

**When writing:** choose OpenPGP or S/MIME next to “Formatted/Plain text”, then “Sign” and/or “Encrypt”.
If keys for recipients or yourself are missing, the app tells you before sending. Replies to encrypted
messages are encrypted again automatically.

**When reading,** badges show “encrypted” and the signature status (“Signed by …”, “key unknown”,
“not trusted”, “invalid signature”). With a locked key: “Decrypt”.

## 12 Security & phishing

Levuvo Mail checks every message and warns clearly when
- the mail server recorded a failed sender verification (SPF/DKIM/DMARC),
- the display name pretends to be another address,
- a link shows something different from where it leads,
- replies go to a different domain or the domain uses unusual characters,
- attachments are executable or may contain macros.

A warning is a strong hint, not proof. If in doubt: do not enter credentials, do not make payments and
contact the sender through another channel.

More protection: protected HTML view without scripts, blocked external images, links with confirmation,
passwords/tokens/keys only in the keychain, the app is only reachable from your own device.

## 13 Settings

| Page | Content |
|---|---|
| General | language (system/Deutsch/English), theme (system/light/dark), density, mark read when opened, conversations, default format, undo send, calendar start view |
| Accounts | accounts, sign-in with Microsoft/Google, signatures, sender addresses, connection status and test |
| Templates | create, edit and delete snippets with placeholders |
| Filters & vacation | server rules and vacation reply |
| Calendar & contacts | CalDAV/CardDAV connections, calendar colors, show/hide, new calendars |
| Security | OpenPGP keys, S/MIME certificates |
| Search & offline | local search index |
| Notifications | permission, check now |
| Privacy | crash reports (optional), diagnostic report |
| Help / About | quick help, shortcuts, version, legal notice, licenses |

## 14 Keyboard shortcuts

| Key | Action |
|---|---|
| J / K | next / previous message |
| N | new message |
| R / A / F | reply / reply all / forward |
| U | read ↔ unread |
| S | star |
| E | archive |
| B | snooze |
| Ctrl/⌘ + K | command palette |
| ! | spam / not spam |
| Del | trash |
| P | print / PDF |
| / | search |
| Ctrl/⌘ + Enter | send (in the editor) |
| Alt + 1 · 2 · 3 | Email · Calendar · Contacts |
| Alt + , | Settings |
| Esc | close / clear selection |
| ? | overview |

## 15 Troubleshooting

| Problem | Solution |
|---|---|
| “Check access” at start | Unlock the keychain (macOS) or check the Windows sign-in, then “Check again”. Nothing was deleted. |
| Sign-in failed | Check the password; for GMX/WEB.DE enable IMAP in webmail; for Gmail use an app password or “Sign in with Google”. |
| Sending with Microsoft 365 fails | Ask your admin to enable “Authenticated SMTP” for the mailbox. |
| Filters “not available” | Provider without ManageSieve – check filter server/port in the account settings or create rules in webmail. |
| Calendar does not connect | Check server address (https, e.g. …/remote.php/dav), user name, app password. |
| Microsoft/Google calendar or contacts missing | Click “Allow access” in Calendar or Contacts and confirm in the browser with the **same** account. Companies may need IT to approve the app. |
| Snoozed message does not return | Levuvo Mail must be running at that time (background is enough). In “Snoozed”, “Bring back now” works any time. |
| Scheduled message not sent | Levuvo Mail must be running (background is enough). The status is shown on the draft. |
| “Save status unclear” for a draft | Check the drafts folder, do not save again immediately (prevents duplicates). |
| Support | Settings → Privacy → **Download diagnostic report** and attach it – it contains no content or addresses. Never share passwords. |

## 16 Privacy

See `PRIVACY.md`. In short: no telemetry, no advertising, no Levuvo servers in the data path;
crash reports only if you turn them on.
